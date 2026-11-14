/**
 * db.js — Capa de acceso a datos de NotasJ19
 * ---------------------------------------------------------------
 * Implementación basada en IndexedDB (sin backend). Todas las
 * funciones son asíncronas (Promesas) y devuelven/aceptan objetos
 * planos, de modo que migrar a una API REST (Node.js/Express) solo
 * requiere reemplazar el cuerpo de estas funciones por llamadas
 * fetch() manteniendo la MISMA interfaz pública:
 *
 *   DB.init()            -> Promise<void>
 *   DB.getAll()          -> Promise<Nota[]>
 *   DB.get(id)           -> Promise<Nota | undefined>
 *   DB.create(nota)      -> Promise<Nota>   (asigna id y fechas)
 *   DB.update(id, datos) -> Promise<Nota>
 *   DB.remove(id)        -> Promise<void>
 *
 * Forma de una Nota:
 * {
 *   id: string,
 *   titulo: string,
 *   contenido: string,
 *   imagen: Blob | null,                      // imagen principal
 *   adjunto: { nombre, tipo, tamano, blob } | null,
 *   creada: number (timestamp), actualizada: number (timestamp)
 * }
 *
 * Nota de migración: en una API REST, imagen y adjunto se enviarían
 * con FormData (multipart) y se devolverían como URLs.
 */

// Se usa un IIFE (en vez de import/export) para que la app funcione también
// al abrir index.html con doble clic (file://), donde los módulos ES se bloquean.
// db.js debe cargarse ANTES que app.js y expone la constante global `DB`.
const DB = (() => {
'use strict';

const DB_NAME = 'NotasJ19DB';
const DB_VERSION = 1;
const STORE = 'notas';

let _db = null;

/** Genera un identificador único (en REST lo asignaría el servidor). */
function generarId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/** Envuelve un IDBRequest en una Promesa. */
function promisificar(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Abre (o crea) la base de datos. Debe llamarse una vez al inicio. */
function init() {
  return new Promise((resolve, reject) => {
    if (_db) return resolve();
    if (!('indexedDB' in window)) {
      return reject(new Error('Este navegador no soporta IndexedDB.'));
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    // Se ejecuta la primera vez o al subir DB_VERSION: crea el "almacén".
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('actualizada', 'actualizada');
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(); };
    req.onerror = () => reject(req.error);
  });
}

/** Devuelve un object store dentro de una transacción. */
function store(modo = 'readonly') {
  return _db.transaction(STORE, modo).objectStore(STORE);
}

/** Lista todas las notas, de la más reciente a la más antigua. */
async function getAll() {
  const notas = await promisificar(store().getAll());
  return notas.sort((a, b) => b.actualizada - a.actualizada);
}

/** Obtiene una nota por id. */
function get(id) {
  return promisificar(store().get(id));
}

/** Crea una nota nueva. */
async function create(datos) {
  const ahora = Date.now();
  const nota = {
    id: generarId(),
    titulo: datos.titulo || '',
    contenido: datos.contenido || '',
    imagen: datos.imagen || null,
    adjunto: datos.adjunto || null,
    creada: ahora,
    actualizada: ahora,
  };
  await promisificar(store('readwrite').add(nota));
  return nota;
}

/** Actualiza una nota existente (merge con los campos recibidos). */
async function update(id, datos) {
  const actual = await get(id);
  if (!actual) throw new Error('La nota no existe.');
  const nota = { ...actual, ...datos, id, actualizada: Date.now() };
  await promisificar(store('readwrite').put(nota));
  return nota;
}

/** Elimina una nota. */
async function remove(id) {
  await promisificar(store('readwrite').delete(id));
}

return { init, getAll, get, create, update, remove };
})();
