/**
 * lib/espacio.js — espacios de notas (sin cuentas ni contraseñas)
 * ---------------------------------------------------------------
 * Cada navegador crea un código aleatorio e imposible de adivinar (144 bits) y
 * lo envía en la cabecera `X-Espacio`. El servidor nunca guarda el código: usa
 * su hash SHA-256 como nombre del espacio. Quien tenga el código (o el enlace
 * que lo contiene) accede a las notas de ese espacio; por eso se comparte
 * como un enlace privado.
 *
 * Como cualquiera puede crear espacios, hay límites para proteger el plan
 * gratuito (se pueden subir con variables de entorno):
 *   MAX_ESPACIOS (25) · MAX_NOTAS_POR_ESPACIO (300) · MAX_MB_POR_ESPACIO (40)
 */
import { createHash } from 'node:crypto';
import { pipeline, comando } from './redis.js';
import { kEspacios, errorHTTP } from './util.js';

const CODIGO_VALIDO = /^[A-Za-z0-9_-]{22,64}$/;

function entero(nombre, defecto) {
  const v = Number.parseInt(process.env[nombre], 10);
  return Number.isFinite(v) && v > 0 ? v : defecto;
}

/** Límites vigentes (se leen en cada petición para respetar cambios de entorno). */
export function limites() {
  return {
    espacios: entero('MAX_ESPACIOS', 25),
    notas: entero('MAX_NOTAS_POR_ESPACIO', 300),
    bytes: entero('MAX_MB_POR_ESPACIO', 40) * 1024 * 1024,
  };
}

/** Nombre del espacio de esta petición, o null si falta o el código no es válido. */
export function espacioDe(request) {
  const codigo = request.headers.get('x-espacio') || '';
  if (!CODIGO_VALIDO.test(codigo)) return null;
  return createHash('sha256').update('notasj19|' + codigo).digest('hex').slice(0, 32);
}

/** Da de alta el espacio la primera vez que escribe, respetando el máximo de espacios. */
export async function registrarEspacio(espacio) {
  const [yaExiste, total] = await pipeline([['SISMEMBER', kEspacios, espacio], ['SCARD', kEspacios]]);
  if (Number(yaExiste) === 1) return;
  if (Number(total) >= limites().espacios) {
    throw errorHTTP(403, 'Este servidor alcanzó su máximo de espacios. Quien lo administra puede subir MAX_ESPACIOS.');
  }
  await comando('SADD', kEspacios, espacio);
}
