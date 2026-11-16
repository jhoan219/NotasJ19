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

/** Error con código HTTP (lo convierte en respuesta la función `seguro`). */
export function errorHTTP(estado, mensaje) {
  const err = new Error(mensaje);
  err.estado = estado;
  return err;
}

/** Ejecuta un manejador y convierte cualquier excepción en una respuesta de error. */
export async function seguro(fn) {
  try {
    return await fn();
  } catch (err) {
    if (!err.estado || err.estado >= 500) console.error(err);   // los rechazos esperados (403, 413…) no son errores
    return json({ error: err.message || 'Error del servidor.' }, err.estado || 500);
  }
}

/** Parámetros de la URL (sirve tanto con URL completa como con ruta relativa). */
export function parametros(request) {
  return new URL(request.url, 'http://localhost').searchParams;
}

/** Convierte la respuesta de HGETALL (lista plana u objeto) en pares [clave, valor]. */
export function aPares(plano) {
  if (Array.isArray(plano)) {
    const pares = [];
    for (let i = 0; i < plano.length; i += 2) pares.push([plano[i], plano[i + 1]]);
    return pares;
  }
  return plano && typeof plano === 'object' ? Object.entries(plano) : [];
}

/* Validaciones: los ids y hashes terminan formando claves y rutas, así que se restringen. */
export const ID_VALIDO = /^[A-Za-z0-9-]{8,64}$/;
export const HASH_VALIDO = /^[a-f0-9]{64}$/;

/* Máximo por archivo: las funciones de Vercel aceptan ~4,5 MB por petición. */
export const MAX_BYTES = 4_000_000;

/** ¿Hay un Blob conectado al proyecto? (privado: BLOB_STORE_ID; público: BLOB_READ_WRITE_TOKEN) */
export const blobConfigurado = () => Boolean(process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN);
export const MSG_SIN_BLOB = 'Falta conectar un Blob privado al proyecto en Vercel (Storage → Create → Blob → Private).';

/* Claves de Redis. Todo cuelga de un "espacio" (hash del código de cada usuario). */
export const kEspacios = 'nj19:espacios';                        // set: espacios existentes
export const kIdx = (e) => `nj19:${e}:idx`;                      // hash: id -> actualizada
export const kNota = (e, id) => `nj19:${e}:nota:${id}`;          // string: JSON de la nota
export const kMedia = (e, id) => `nj19:${e}:media:${id}`;        // set: hashes de archivos de la nota
export const kTam = (e) => `nj19:${e}:tam`;                      // hash: "id/hash" -> bytes (para la cuota)

/* Ruta de un archivo dentro del Blob privado. */
export const rutaMedia = (e, id, hash) => `notasj19/${e}/${id}/${hash}`;
