/**
 * sync.js — Sincronización de NotasJ19 con el servidor (/api en Vercel)
 * ---------------------------------------------------------------
 * IndexedDB sigue siendo la copia local (rápida y con soporte offline);
 * este módulo la mantiene igualada con el servidor:
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

const CLAVE_SESION = 'notasj19_sesion';          // { token } de la sesión iniciada
const CLAVE_ESTADO = 'notasj19_sync_estado';     // id -> `actualizada` de la última sincronización
const CLAVE_BORRADAS = 'notasj19_borradas';      // ids borrados en este dispositivo (la escribe app.js)
const API = '/api';
const INTERVALO_MS = 60000;

let enCurso = false;
let repetir = false;
let temporizador = null;
let alCambiar = () => {};   // se llama cuando la sincronización modificó la base local
let alEstado = () => {};    // se llama con ('sincronizando' | 'ok' | 'error', mensaje)

/* ---------- Estado local ---------- */

function leer(clave, defecto) {
  try { const v = JSON.parse(localStorage.getItem(clave)); return v ?? defecto; } catch { return defecto; }
}
function guardar(clave, valor) {
  try { localStorage.setItem(clave, JSON.stringify(valor)); } catch { /* sin localStorage: se ignora */ }
}

const activa = () => Boolean(leer(CLAVE_SESION, null)?.token);
const enArchivoLocal = () => typeof location !== 'undefined' && location.protocol === 'file:';
const MSG_LOCAL = 'La sincronización solo funciona en la app publicada en Vercel, no abierta como archivo.';

function configurar(opciones) {
  if (opciones.alCambiar) alCambiar = opciones.alCambiar;
  if (opciones.alEstado) alEstado = opciones.alEstado;
}

/* ---------- Sesión ---------- */

/** Inicia sesión con la contraseña. Devuelve null si salió bien, o un mensaje de error. */
async function entrar(password) {
  if (enArchivoLocal()) return MSG_LOCAL;
  try {
    const res = await fetch(`${API}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const datos = await res.json().catch(() => ({}));
    if (!res.ok) return (await errorHTTP(res, 'iniciar sesión', datos)).message;
    guardar(CLAVE_SESION, { token: datos.token });
    return null;
  } catch {
    return 'No se pudo conectar con el servidor.';
  }
}

/** Cierra la sesión en este dispositivo (las notas locales se conservan). */
function salir() {
  try { localStorage.removeItem(CLAVE_SESION); } catch { /* ignorar */ }
}

/* ---------- Acceso a la API ---------- */

async function api(ruta, opciones = {}) {
  const sesion = leer(CLAVE_SESION, null);
  const res = await fetch(`${API}/${ruta}`, {
    cache: 'no-store',
    ...opciones,
    headers: { ...(opciones.headers || {}), Authorization: `Bearer ${sesion ? sesion.token : ''}` },
  });
  if (res.status === 401) {
    salir();
    throw new Error('Sesión vencida: pulsa ☁ Sincronizar para entrar de nuevo.');
  }
  return res;
}

/** Traduce una respuesta HTTP fallida a un mensaje entendible. */
async function errorHTTP(res, accion, cuerpo) {
  let msg = '';
  try { msg = (cuerpo || await res.json()).error || ''; } catch { /* sin cuerpo JSON */ }
  if (res.status === 404 && !msg) {
    return new Error('No se encontró el servidor (/api). La sincronización solo funciona en la app publicada en Vercel.');
  }
  if (res.status === 413) return new Error('Archivo demasiado grande para el servidor (máx. 4 MB).');
  return new Error(msg || `El servidor respondió ${res.status} al ${accion}.`);
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
 * Las operaciones son secuenciales para no saturar el servidor.
 */
async function sincronizar() {
  if (!activa()) return null;
  if (enArchivoLocal()) { alEstado('error', MSG_LOCAL); return MSG_LOCAL; }
  if (enCurso) { repetir = true; return null; }
  enCurso = true;
  alEstado('sincronizando');

  const estado = leer(CLAVE_ESTADO, {});
  let huboCambios = false;
  let error = null;

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
      const local = porId.get(id);
      const previo = estado[id];
      if (!local) { estado[id] = await bajar(id); huboCambios = true; continue; }

      const localCambio = previo === undefined || local.actualizada !== previo;
      const remotoCambio = previo === undefined || version !== previo;
      if (!localCambio && !remotoCambio) continue;
      if (remotoCambio && !localCambio) { estado[id] = await bajar(id); huboCambios = true; continue; }
      if (localCambio && !remotoCambio) { await subir(local); estado[id] = local.actualizada; continue; }

      // Cambiaron ambos lados: gana la versión más reciente.
      if (version > local.actualizada) { estado[id] = await bajar(id); huboCambios = true; }
      else if (version === local.actualizada) estado[id] = version;
      else { await subir(local); estado[id] = local.actualizada; }
    }

    // 3) Notas locales que no están en el servidor.
    for (const n of locales) {
      if (borradas.includes(n.id) || remoto[n.id] !== undefined) continue;
      if (estado[n.id] !== undefined && estado[n.id] === n.actualizada) {
        // Ya estaba sincronizada y sin cambios: otro dispositivo la borró.
        await DB.remove(n.id);
        delete estado[n.id];
        huboCambios = true;
      } else {
        await subir(n);   // nota nueva (o editada aquí después de borrarse en otro lado)
        estado[n.id] = n.actualizada;
      }
    }
  } catch (err) {
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
  alEstado(error ? 'error' : 'ok', error);
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

return { activa, entrar, salir, configurar, sincronizar, programar, iniciarAuto };
})();
