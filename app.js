/**
 * app.js — Lógica de interfaz de NotasJ19
 * ---------------------------------------------------------------
 * Se encarga de: renderizar notas, búsqueda en tiempo real,
 * formulario de crear/editar, previsualización de imágenes y
 * descarga de adjuntos. Toda la persistencia pasa por db.js.
 */
/* `DB` es global: se define en db.js, que se carga antes que este archivo. */

/* ---------- Referencias al DOM ---------- */
const $ = (id) => document.getElementById(id);
const el = {
  lista: $('listaNotas'), vacio: $('vacio'), contador: $('contador'),
  buscador: $('buscador'), btnNueva: $('btnNueva'),
  btnExportar: $('btnExportar'), inImportar: $('inputImportar'),
  btnSync: $('btnSync'), estadoSync: $('estadoSync'), modalSync: $('modalSync'), formSync: $('formSync'),
  syncPassword: $('syncPassword'), syncError: $('syncError'),
  btnSyncDesconectar: $('btnSyncDesconectar'), btnSyncCerrar: $('btnSyncCerrar'), btnSyncGuardar: $('btnSyncGuardar'),
  modalEditor: $('modalEditor'), form: $('formNota'), tituloModal: $('tituloModal'),
  inTitulo: $('inputTitulo'), inContenido: $('inputContenido'),
  inImagen: $('inputImagen'), previaImagen: $('previaImagen'), btnQuitarImagen: $('btnQuitarImagen'),
  inAdjunto: $('inputAdjunto'), nombreAdjunto: $('nombreAdjunto'), btnQuitarAdjunto: $('btnQuitarAdjunto'),
  errorForm: $('errorForm'), btnCancelar: $('btnCancelar'),
  modalBorrar: $('modalBorrar'), btnSiBorrar: $('btnSiBorrar'), btnNoBorrar: $('btnNoBorrar'),
  modalImagen: $('modalImagen'), imagenGrande: $('imagenGrande'),
};

/* ---------- Estado ---------- */
let notas = [];            // copia en memoria de todas las notas
let editandoId = null;     // id de la nota abierta en el editor (null = nueva)
let imagenActual = null;   // Blob de la imagen en el formulario
let adjuntoActual = null;  // { nombre, tipo, tamano, blob } en el formulario
let borrarId = null;       // id pendiente de confirmar eliminación
let urlsActivas = [];      // Object URLs creadas (se liberan al re-renderizar)
let urlPrevia = null;      // Object URL de la previsualización del formulario

const LIMITE_MB = 4;       // límite por archivo: las funciones gratuitas de Vercel aceptan ~4,5 MB por petición

/* Ids de notas borradas en ESTE dispositivo: sync.js los usa para borrarlas
 * también en el servidor y para que no reaparezcan. */
const CLAVE_BORRADAS = 'notasj19_borradas';
function marcarBorrada(id) {
  try {
    const b = JSON.parse(localStorage.getItem(CLAVE_BORRADAS)) || [];
    if (!b.includes(id)) { b.push(id); localStorage.setItem(CLAVE_BORRADAS, JSON.stringify(b)); }
  } catch { /* localStorage no disponible: se ignora */ }
}

/* ---------- Utilidades ---------- */

/** Escapa HTML para evitar inyección al insertar texto del usuario. */
function escaparHTML(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Escapa y resalta coincidencias de la búsqueda con <mark>. */
function resaltar(texto, consulta) {
  const seguro = escaparHTML(texto);
  if (!consulta) return seguro;
  const patron = escaparHTML(consulta).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return seguro.replace(new RegExp(`(${patron})`, 'gi'), '<mark>$1</mark>');
}

function formatearTamano(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function formatearFecha(ts) {
  return new Date(ts).toLocaleString('es-PE', { dateStyle: 'medium', timeStyle: 'short' });
}

function crearURL(blob) {
  const url = URL.createObjectURL(blob);
  urlsActivas.push(url);
  return url;
}

/* ---------- Renderizado ---------- */

/** Dibuja las notas filtradas según el texto del buscador. */
function render() {
  urlsActivas.forEach(URL.revokeObjectURL);
  urlsActivas = [];

  const q = el.buscador.value.trim();
  const qMin = q.toLowerCase();
  const visibles = notas.filter((n) =>
    !qMin || n.titulo.toLowerCase().includes(qMin) || n.contenido.toLowerCase().includes(qMin));

  el.lista.innerHTML = '';
  el.vacio.hidden = visibles.length > 0;
  el.contador.textContent = q
    ? `${visibles.length} de ${notas.length} notas`
    : `${notas.length} ${notas.length === 1 ? 'nota' : 'notas'}`;

  for (const n of visibles) el.lista.appendChild(crearTarjeta(n, q));
}

/** Construye el elemento DOM de una nota. */
function crearTarjeta(n, q) {
  const art = document.createElement('article');
  art.className = 'nota';

  let html = '';
  if (n.imagen) {
    html += `<img class="nota__img" src="${crearURL(n.imagen)}" alt="Imagen de la nota" data-accion="ampliar" />`;
  }
  html += `<div class="nota__cuerpo">
    <h3 class="nota__titulo">${resaltar(n.titulo || 'Sin título', q)}</h3>
    ${n.contenido ? `<p class="nota__texto">${resaltar(n.contenido, q)}</p>` : ''}
  </div>`;
  if (n.adjunto) {
    html += `<div class="nota__adjunto">
      <span class="nota__adjunto-nombre" title="${escaparHTML(n.adjunto.nombre)}">📎 ${escaparHTML(n.adjunto.nombre)} · ${formatearTamano(n.adjunto.tamano)}</span>
      <button class="btn btn--sec btn--mini" data-accion="descargar" type="button">Descargar</button>
    </div>`;
  }
  html += `<div class="nota__pie">
    <span class="nota__fecha">${formatearFecha(n.actualizada)}</span>
    <div class="nota__acciones">
      <button class="btn btn--sec btn--mini" data-accion="editar" type="button">Editar</button>
      <button class="btn btn--peligro btn--mini" data-accion="borrar" type="button">Eliminar</button>
    </div>
  </div>`;

  art.innerHTML = html;
  art.dataset.id = n.id;
  return art;
}

/* ---------- Eventos de la lista (delegación) ---------- */
el.lista.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-accion]');
  if (!btn) return;
  const id = btn.closest('.nota').dataset.id;
  const nota = notas.find((n) => n.id === id);
  if (!nota) return;

  switch (btn.dataset.accion) {
    case 'editar': abrirEditor(nota); break;
    case 'borrar': borrarId = id; el.modalBorrar.showModal(); break;
    case 'descargar': descargar(nota.adjunto); break;
    case 'ampliar':
      el.imagenGrande.src = btn.src;
      el.modalImagen.showModal();
      break;
  }
});

/** Descarga un adjunto mediante un enlace temporal. */
function descargar(adj) {
  const url = URL.createObjectURL(adj.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = adj.nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- Editor (crear / editar) ---------- */

function abrirEditor(nota = null) {
  editandoId = nota ? nota.id : null;
  el.tituloModal.textContent = nota ? 'Editar nota' : 'Nueva nota';
  el.inTitulo.value = nota ? nota.titulo : '';
  el.inContenido.value = nota ? nota.contenido : '';
  el.errorForm.hidden = true;
  el.inImagen.value = '';
  el.inAdjunto.value = '';
  fijarImagen(nota ? nota.imagen : null);
  fijarAdjunto(nota ? nota.adjunto : null);
  el.modalEditor.showModal();
  el.inTitulo.focus();
}

function fijarImagen(blob) {
  imagenActual = blob;
  if (urlPrevia) { URL.revokeObjectURL(urlPrevia); urlPrevia = null; }
  if (blob) {
    urlPrevia = URL.createObjectURL(blob);
    el.previaImagen.src = urlPrevia;
  }
  el.previaImagen.hidden = !blob;
  el.btnQuitarImagen.hidden = !blob;
}

function fijarAdjunto(adj) {
  adjuntoActual = adj;
  el.nombreAdjunto.hidden = !adj;
  el.btnQuitarAdjunto.hidden = !adj;
  if (adj) el.nombreAdjunto.textContent = `📎 ${adj.nombre} · ${formatearTamano(adj.tamano)}`;
}

function mostrarError(msg) {
  el.errorForm.textContent = msg;
  el.errorForm.hidden = false;
}

/**
 * Reduce fotos grandes (p. ej. las del celular) a máx. 1920 px en JPEG, para que
 * quepan en el límite de subida y ocupen menos espacio. Si no se puede (GIF/SVG,
 * error) o no mejora el tamaño, devuelve el archivo original.
 */
async function comprimirImagen(archivo) {
  if (archivo.size <= 1.5 * 1024 ** 2 || /gif|svg/.test(archivo.type)) return archivo;
  try {
    const bmp = await createImageBitmap(archivo);
    const escala = Math.min(1, 1920 / Math.max(bmp.width, bmp.height));
    const lienzo = document.createElement('canvas');
    lienzo.width = Math.round(bmp.width * escala);
    lienzo.height = Math.round(bmp.height * escala);
    const ctx = lienzo.getContext('2d');
    ctx.fillStyle = '#fff';   // fondo blanco para PNG con transparencia
    ctx.fillRect(0, 0, lienzo.width, lienzo.height);
    ctx.drawImage(bmp, 0, 0, lienzo.width, lienzo.height);
    if (bmp.close) bmp.close();
    const blob = await new Promise((ok) => lienzo.toBlob(ok, 'image/jpeg', 0.85));
    return blob && blob.size < archivo.size ? blob : archivo;
  } catch {
    return archivo;
  }
}

el.inImagen.addEventListener('change', async () => {
  const f = el.inImagen.files[0];
  if (!f) return;
  if (!f.type.startsWith('image/')) return mostrarError('El archivo elegido no es una imagen.');
  const imagen = await comprimirImagen(f);
  if (imagen.size > LIMITE_MB * 1024 ** 2) return mostrarError(`La imagen supera ${LIMITE_MB} MB incluso comprimida.`);
  el.errorForm.hidden = true;
  fijarImagen(imagen);
});

el.inAdjunto.addEventListener('change', () => {
  const f = el.inAdjunto.files[0];
  if (!f) return;
  if (f.size > LIMITE_MB * 1024 ** 2) return mostrarError(`El archivo supera ${LIMITE_MB} MB.`);
  el.errorForm.hidden = true;
  fijarAdjunto({ nombre: f.name, tipo: f.type, tamano: f.size, blob: f });
});

el.btnQuitarImagen.addEventListener('click', () => { el.inImagen.value = ''; fijarImagen(null); });
el.btnQuitarAdjunto.addEventListener('click', () => { el.inAdjunto.value = ''; fijarAdjunto(null); });
el.btnCancelar.addEventListener('click', () => el.modalEditor.close());
el.btnNueva.addEventListener('click', () => abrirEditor());

/** Guardar: crea o actualiza según editandoId. */
el.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const titulo = el.inTitulo.value.trim();
  const contenido = el.inContenido.value.trim();

  if (!titulo && !contenido && !imagenActual && !adjuntoActual) {
    return mostrarError('Agrega al menos un título, texto, imagen o archivo.');
  }

  const datos = { titulo, contenido, imagen: imagenActual, adjunto: adjuntoActual };
  try {
    if (editandoId) await DB.update(editandoId, datos);
    else await DB.create(datos);
    el.modalEditor.close();
    await cargar();
    Sync.programar();
  } catch (err) {
    console.error(err);
    mostrarError('No se pudo guardar. Revisa el espacio disponible del navegador.');
  }
});

/* ---------- Eliminar ---------- */
el.btnNoBorrar.addEventListener('click', () => el.modalBorrar.close());
el.btnSiBorrar.addEventListener('click', async () => {
  try {
    await DB.remove(borrarId);
    marcarBorrada(borrarId);
  } catch (err) {
    console.error(err);
  }
  borrarId = null;
  el.modalBorrar.close();
  await cargar();
  Sync.programar();
});

/* ---------- Visor de imagen: cerrar al hacer clic ---------- */
el.modalImagen.addEventListener('click', () => el.modalImagen.close());

/* ---------- Cerrar modales al hacer clic en el fondo oscuro ---------- */
for (const m of [el.modalEditor, el.modalBorrar]) {
  m.addEventListener('mousedown', (e) => { if (e.target === m) m.close(); });
}

/* ---------- Búsqueda en tiempo real ---------- */
el.buscador.addEventListener('input', render);

/* ---------- Exportar / importar notas.json ---------- */
el.btnExportar.addEventListener('click', async () => {
  try {
    const datos = await DB.exportar();
    const blob = new Blob([JSON.stringify(datos)], { type: 'application/json' });
    descargar({ nombre: 'notas.json', blob });
  } catch (err) {
    console.error(err);
    alert('No se pudo exportar las notas.');
  }
});

el.inImportar.addEventListener('change', async () => {
  const f = el.inImportar.files[0];
  if (!f) return;
  try {
    const cambios = await DB.importar(JSON.parse(await f.text()));
    await cargar();
    Sync.programar();
    alert(cambios ? `Se importaron ${cambios} nota(s).` : 'No había notas nuevas para importar.');
  } catch (err) {
    console.error(err);
    alert('Archivo no válido: ' + err.message);
  }
  el.inImportar.value = '';
});

/* ---------- Sincronización con el servidor (ver sync.js) ---------- */
function pintarEstado(estado, mensaje) {
  const hora = new Date().toLocaleTimeString('es-PE', { timeStyle: 'short' });
  const textos = {
    sincronizando: '☁ Sincronizando…',
    ok: `☁ Sincronizado ${hora}`,
    error: `⚠ ${mensaje}`,
    apagada: '',
  };
  el.estadoSync.textContent = textos[estado] ?? '';
}
Sync.configurar({ alCambiar: cargar, alEstado: pintarEstado });

el.btnSync.addEventListener('click', () => {
  const dentro = Sync.activa();
  el.syncPassword.value = '';
  el.syncPassword.closest('label').hidden = dentro;   // con sesión iniciada no hace falta la contraseña
  el.btnSyncDesconectar.hidden = !dentro;
  el.btnSyncGuardar.textContent = dentro ? 'Sincronizar ahora' : 'Entrar y sincronizar';
  el.syncError.hidden = true;
  el.modalSync.showModal();
  if (!dentro) el.syncPassword.focus();
});
el.btnSyncCerrar.addEventListener('click', () => el.modalSync.close());

el.formSync.addEventListener('submit', async (e) => {
  e.preventDefault();
  el.syncError.hidden = true;
  el.btnSyncGuardar.disabled = true;

  let error = null;
  if (!Sync.activa()) {
    const clave = el.syncPassword.value;
    error = clave ? await Sync.entrar(clave) : 'Escribe la contraseña.';
  }
  if (!error) error = await Sync.sincronizar();

  el.btnSyncGuardar.disabled = false;
  if (error) {
    el.syncError.textContent = error;
    el.syncError.hidden = false;
  } else {
    el.syncPassword.value = '';
    el.modalSync.close();
  }
});

el.btnSyncDesconectar.addEventListener('click', () => {
  Sync.salir();
  pintarEstado('apagada');
  el.modalSync.close();
});

/* ---------- Arranque ---------- */
async function cargar() {
  notas = await DB.getAll();
  render();
}

(async function iniciar() {
  try {
    await DB.init();
    await cargar();
    Sync.iniciarAuto();
    Sync.sincronizar();
  } catch (err) {
    console.error(err);
    el.contador.textContent = 'No se pudo iniciar el almacenamiento local (¿modo privado?).';
  }
})();
