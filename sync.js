/**
 * sync.js — Sincronización de NotasJ19 con el servidor (/api en Vercel)
 * ---------------------------------------------------------------
 * Sin cuentas ni contraseñas: cada navegador genera un código de "espacio"
 * aleatorio. Para ver las mismas notas en otro dispositivo basta con abrir el
 * enlace que contiene ese código (o pegar el código). Quien tenga el enlace
 * accede a las notas, así que se trata como un enlace privado.
 *
 * IndexedDB sigue siendo la copia local (rápida y con soporte offline); este
 * módulo la mantiene igualada con el servidor:
 *   - nota nueva o editada aquí      -> se sube
 *   - nota nueva o editada en otro   -> se baja
 *   - nota borrada aquí              -> se borra en el servidor
 *   - nota borrada en otro           -> se borra aquí
 *   - editada en ambos a la vez      -> gana la más reciente
 *
 * La "versión" de una nota es su fecha `actualizada`. Las imágenes y adjuntos
 * se identifican por el hash SHA-256 de su contenido: solo se suben si el
 * servidor aún no los tiene. Depende de la constante global `DB` (db.js).
 */
const Sync = (() => {
'use strict';

const CLAVE_ESPACIO = 'notasj19_espacio';        // código del espacio de este dispositivo
const CLAVE_APAGADA = 'notasj19_sync_apagada';   // true si el usuario desactivó la sincronización
const CLAVE_ESTADO = 'notasj19_sync_estado';     // id -> `actualizada` de la última sincronización
const CLAVE_BORRADAS = 'notasj19_borradas';      // ids borrados en este dispositivo (la escribe app.js)
const API = '/api';
const INTERVALO_MS = 60000;
const CODIGO_VALIDO = /^[A-Za-z0-9_-]{22,64}$/;
const TOLERADOS = [400, 403, 413, 503];          // errores propios de una nota: no frenan a las demás
const MSG_LOCAL = 'Sin servidor: la app está abierta como archivo o en un sitio sin /api. Tus notas se guardan solo en este navegador.';

let enCurso = false;
let repetir = false;
let servidorAusente = false;   // no hay /api: se deja de intentar hasta recargar la página
let temporizador = null;
let alCambiar = () => {};   // se llama cuando la sincronización modificó la base local
let alEstado = () => {};    // se llama con ('sincronizando' | 'ok' | 'error' | 'local', mensaje)

/* ---------- Estado local ---------- */

function leer(clave, defecto) {
  try { const v = JSON.parse(localStorage.getItem(clave)); return v ?? defecto; } catch { return defecto; }
}
function guardar(clave, valor) {
  try { localStorage.setItem(clave, JSON.stringify(valor)); } catch { /* sin localStorage: se ignora */ }
}
function quitar(clave) {
  try { localStorage.removeItem(clave); } catch { /* ignorar */ }
}

const enArchivoLocal = () => typeof location !== 'undefined' && location.protocol === 'file:';
const espacio = () => leer(CLAVE_ESPACIO, null);
const activa = () => Boolean(espacio()) && !leer(CLAVE_APAGADA, false);

function configurar(opciones) {
  if (opciones.alCambiar) alCambiar = opciones.alCambiar;
  if (opciones.alEstado) alEstado = opciones.alEstado;
}

/* ---------- Espacio (código de acceso) ---------- */

/** 24 caracteres aleatorios (144 bits), seguros para usar en una URL. */
function generarCodigo() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Al abrir la app: si no hay espacio y la sincronización no está apagada, crea uno. */
function iniciar() {
  if (!enArchivoLocal() && !leer(CLAVE_APAGADA, false) && !espacio()) guardar(CLAVE_ESPACIO, generarCodigo());
}

/** Enlace que abre este mismo espacio en otro dispositivo. */
function enlace() {
  return `${location.origin}${location.pathname}#e=${espacio()}`;
}

/** Código contenido en la dirección actual (`#e=CODIGO`), o null. */
function codigoDeEnlace() {
  const m = (typeof location !== 'undefined' ? location.hash : '').match(/^#?e=([A-Za-z0-9_-]{22,64})$/);
  return m ? m[1] : null;
}

/** Saca el código de un texto pegado: un enlace completo o el código solo. */
function extraerCodigo(texto) {
  const t = String(texto || '').trim();
  const m = t.match(/[#?&]e=([A-Za-z0-9_-]{22,64})/);
  if (m) return m[1];
  return CODIGO_VALIDO.test(t) ? t : null;
}

/** Vincula este dispositivo a un espacio (sus notas se combinarán con las de ese espacio). */
function adoptar(codigo) {
  if (!CODIGO_VALIDO.test(codigo)) return false;
  if (codigo !== espacio()) {
    guardar(CLAVE_ESPACIO, codigo);
    quitar(CLAVE_ESTADO);        // historial de otro espacio: ya no sirve
  }
  quitar(CLAVE_APAGADA);
  servidorAusente = false;
  return true;
}

function activar() {
  quitar(CLAVE_APAGADA);
  if (!espacio() && !enArchivoLocal()) guardar(CLAVE_ESPACIO, generarCodigo());
}

/** Detiene la sincronización (las notas locales y el código se conservan). */
function desactivar() {
  guardar(CLAVE_APAGADA, true);
}

/* ---------- Acceso a la API ---------- */

function api(ruta, opciones = {}) {
  return fetch(`${API}/${ruta}`, {
    cache: 'no-store',
    ...opciones,
    headers: { ...(opciones.headers || {}), 'X-Espacio': espacio() },
  });
}

/** Traduce una respuesta HTTP fallida a un error con mensaje entendible. */
async function errorHTTP(res, accion) {
  let msg = '';
  try { msg = (await res.json()).error || ''; } catch { /* sin cuerpo JSON */ }
  let err;
  if (res.status === 404 && !msg) {
    err = new Error(MSG_LOCAL);
    err.ausente = true;
  } else if (res.status === 413) {
    err = new Error('Archivo demasiado grande para el servidor (máx. 4 MB).');
  } else {
    err = new Error(msg || `El servidor respondió ${res.status} al ${accion}.`);
  }
  err.estado = res.status;
  return err;
}

/** Comprueba si el servidor, la base de datos y el almacenamiento de archivos están listos. */
async function diagnostico() {
  if (enArchivoLocal()) return { servidor: false, mensaje: MSG_LOCAL };
  try {
    const res = await fetch(`${API}/estado`, { cache: 'no-store' });
    if (!res.ok) return { servidor: false, mensaje: MSG_LOCAL };
    return await res.json();
  } catch {
    return { servidor: false, mensaje: 'No se pudo conectar con el servidor.' };
  }
}

const enc = encodeURIComponent;

/** Índice remoto: { id: actualizada }. */
async function listar() {
  const res = await api('notas');
  if (!res.ok) throw await errorHTTP(res, 'listar las notas');
  const mapa = {};
  for (const n of await res.json()) mapa[n.id] = n.actualizada;
  return mapa;
}

/** SHA-256 (hex) del contenido de un Blob. */
async function hashBlob(blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function subirArchivo(id, hash, blob, tipo) {
  const res = await api(`media?id=${enc(id)}&hash=${hash}&tipo=${enc(tipo)}`, { method: 'PUT', body: blob });
  if (!res.ok) throw await errorHTTP(res, 'subir un archivo');
}

async function descargarArchivo(id, m) {
  const res = await api(`media?id=${enc(id)}&hash=${m.hash}`);
  if (!res.ok) throw await errorHTTP(res, 'descargar un archivo');
  return new Blob([await res.blob()], { type: m.tipo });
}

/** Pide al servidor que confirme la nota. Devuelve { ok } o { faltan: [hash] }. */
async function confirmar(meta) {
  const res = await api(`notas?id=${enc(meta.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(meta),
  });
  if (res.status === 409) return res.json();
  if (!res.ok) throw await errorHTTP(res, 'guardar una nota');
  return res.json();
}

/** Sube una nota: primero confirma; sube solo los archivos que falten; vuelve a confirmar. */
async function subir(n) {
  const meta = {
    id: n.id, titulo: n.titulo, contenido: n.contenido,
    creada: n.creada, actualizada: n.actualizada, imagen: null, adjunto: null,
  };
  const archivos = new Map();   // hash -> { blob, tipo }

  if (n.imagen) {
    const hash = await hashBlob(n.imagen);
    const tipo = n.imagen.type || 'image/jpeg';
    archivos.set(hash, { blob: n.imagen, tipo });
    meta.imagen = { hash, tipo, tamano: n.imagen.size };
  }
  if (n.adjunto) {
    const hash = await hashBlob(n.adjunto.blob);
    const tipo = n.adjunto.tipo || n.adjunto.blob.type || 'application/octet-stream';
    archivos.set(hash, { blob: n.adjunto.blob, tipo });
    meta.adjunto = { hash, nombre: n.adjunto.nombre, tipo, tamano: n.adjunto.tamano };
  }

  let r = await confirmar(meta);
  if (r.faltan && r.faltan.length) {
    for (const h of r.faltan) await subirArchivo(n.id, h, archivos.get(h).blob, archivos.get(h).tipo);
    r = await confirmar(meta);
  }
  if (!r.ok) throw new Error('El servidor no pudo guardar la nota.');
}

/** Descarga una nota (con sus archivos) a la base local. Devuelve su `actualizada`. */
async function bajar(id) {
  const res = await api(`notas?id=${enc(id)}`);
  if (!res.ok) throw await errorHTTP(res, 'descargar una nota');
  const m = await res.json();
  const nota = {
    id: m.id, titulo: m.titulo, contenido: m.contenido, creada: m.creada, actualizada: m.actualizada,
    imagen: m.imagen ? await descargarArchivo(id, m.imagen) : null,
    adjunto: m.adjunto
      ? { nombre: m.adjunto.nombre, tipo: m.adjunto.tipo, tamano: m.adjunto.tamano, blob: await descargarArchivo(id, m.adjunto) }
      : null,
  };
  await DB.guardar(nota);
  return nota.actualizada;
}

async function borrarRemoto(id) {
  const res = await api(`notas?id=${enc(id)}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw await errorHTTP(res, 'borrar una nota');
}

/* ---------- Sincronización ---------- */

/**
 * Iguala la base local con el servidor.
 * Devuelve null si todo fue bien, o un mensaje de error.
 * Si una nota concreta falla (límite, archivo grande…), las demás se siguen
 * sincronizando y se informa del primer problema.
 */
async function sincronizar() {
  if (enArchivoLocal() || servidorAusente) { alEstado('local', MSG_LOCAL); return MSG_LOCAL; }
  if (!activa()) return null;
  if (enCurso) { repetir = true; return null; }
  enCurso = true;
  alEstado('sincronizando');

  const estado = leer(CLAVE_ESTADO, {});
  let huboCambios = false;
  let error = null;
  let primerError = null;

  // Ejecuta el paso de una nota; los errores "de esa nota" no detienen el resto.
  const tolerar = async (paso) => {
    try {
      await paso();
    } catch (err) {
      if (err.estado && TOLERADOS.includes(err.estado)) primerError = primerError || err.message;
      else throw err;
    }
  };

  try {
    const borradas = leer(CLAVE_BORRADAS, []);
    const remoto = await listar();
    const locales = await DB.getAll();
    const porId = new Map(locales.map((n) => [n.id, n]));

    // 1) Borrados hechos en este dispositivo -> borrar también en el servidor.
    for (const id of borradas) {
      if (remoto[id] !== undefined) { await borrarRemoto(id); delete remoto[id]; }
      delete estado[id];
    }

    // 2) Notas que existen en el servidor.
    for (const [id, version] of Object.entries(remoto)) {
      await tolerar(async () => {
        const local = porId.get(id);
        const previo = estado[id];
        if (!local) { estado[id] = await bajar(id); huboCambios = true; return; }

        const localCambio = previo === undefined || local.actualizada !== previo;
        const remotoCambio = previo === undefined || version !== previo;
        if (!localCambio && !remotoCambio) return;
        if (remotoCambio && !localCambio) { estado[id] = await bajar(id); huboCambios = true; return; }
        if (localCambio && !remotoCambio) { await subir(local); estado[id] = local.actualizada; return; }

        // Cambiaron ambos lados: gana la versión más reciente.
        if (version > local.actualizada) { estado[id] = await bajar(id); huboCambios = true; }
        else if (version === local.actualizada) estado[id] = version;
        else { await subir(local); estado[id] = local.actualizada; }
      });
    }

    // 3) Notas locales que no están en el servidor.
    for (const n of locales) {
      if (borradas.includes(n.id) || remoto[n.id] !== undefined) continue;
      await tolerar(async () => {
        if (estado[n.id] !== undefined && estado[n.id] === n.actualizada) {
          // Ya estaba sincronizada y sin cambios: otro dispositivo la borró.
          await DB.remove(n.id);
          delete estado[n.id];
          huboCambios = true;
        } else {
          await subir(n);   // nota nueva (o editada aquí después de borrarse en otro lado)
          estado[n.id] = n.actualizada;
        }
      });
    }
    error = primerError;
  } catch (err) {
    if (err.ausente) servidorAusente = true;
    if (err instanceof TypeError) {
      error = navigator.onLine ? 'No se pudo conectar con el servidor.' : 'Sin conexión; se sincronizará al volver.';
    } else if (err instanceof SyntaxError) {
      error = 'El servidor no respondió como se esperaba (¿está desplegado /api?).';
    } else {
      error = err.message || 'Error de sincronización.';
    }
  } finally {
    guardar(CLAVE_ESTADO, estado);
    enCurso = false;
  }

  if (huboCambios) alCambiar();
  if (servidorAusente) alEstado('local', MSG_LOCAL);
  else alEstado(error ? 'error' : 'ok', error);
  if (repetir) { repetir = false; sincronizar(); }
  return error;
}

/** Programa una sincronización breve después de guardar o borrar una nota. */
function programar() {
  if (!activa()) return;
  clearTimeout(temporizador);
  temporizador = setTimeout(sincronizar, 1500);
}

/** Sincroniza periódicamente (solo con la pestaña visible), al volver a ella y al recuperar la conexión. */
function iniciarAuto() {
  setInterval(() => { if (!document.hidden) sincronizar(); }, INTERVALO_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sincronizar(); });
  window.addEventListener('online', sincronizar);
}

return {
  activa, espacio, iniciar, enlace, codigoDeEnlace, extraerCodigo, adoptar, activar, desactivar,
  diagnostico, configurar, sincronizar, programar, iniciarAuto,
};
})();
