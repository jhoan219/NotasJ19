/**
 * lib/util.js — utilidades compartidas por las funciones de /api
 */

/** Respuesta JSON sin caché. */
export function json(datos, estado = 200) {
  return new Response(JSON.stringify(datos), {
    status: estado,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/** Ejecuta un manejador y convierte cualquier excepción en una respuesta 500. */
export async function seguro(fn) {
  try {
    return await fn();
  } catch (err) {
    console.error(err);
    return json({ error: err.message || 'Error del servidor.' }, 500);
  }
}

/** Parámetros de la URL (sirve tanto con URL completa como con ruta relativa). */
export function parametros(request) {
  return new URL(request.url, 'http://localhost').searchParams;
}

/* Validaciones: los ids y hashes terminan formando claves y rutas, así que se restringen. */
export const ID_VALIDO = /^[A-Za-z0-9-]{8,64}$/;
export const HASH_VALIDO = /^[a-f0-9]{64}$/;

/* Máximo por archivo: las funciones de Vercel aceptan ~4,5 MB por petición. */
export const MAX_BYTES = 4_000_000;

/* Claves de Redis (prefijo para poder compartir la base con otros proyectos). */
export const IDX = 'nj19:idx';                       // hash: id -> actualizada
export const kNota = (id) => `nj19:nota:${id}`;      // string: JSON de la nota
export const kMedia = (id) => `nj19:media:${id}`;    // set: hashes de archivos de la nota

/* Ruta de un archivo dentro del Blob privado. */
export const rutaMedia = (id, hash) => `notasj19/${id}/${hash}`;
