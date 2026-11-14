/**
 * lib/auth.js — contraseña y sesiones
 * ---------------------------------------------------------------
 * La contraseña vive en la variable de entorno NOTAS_PASSWORD (Vercel).
 * Al iniciar sesión se entrega un token firmado (HMAC) que dura 30 días;
 * así la contraseña no se guarda en los dispositivos. La clave de firma
 * se deriva de la contraseña: cambiarla cierra todas las sesiones.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const DURACION_MS = 30 * 24 * 60 * 60 * 1000;

export const configurado = () => Boolean(process.env.NOTAS_PASSWORD);

function clave() {
  return createHash('sha256').update('notasj19|' + process.env.NOTAS_PASSWORD).digest();
}

/** Comparación en tiempo constante (se comparan hashes para igualar longitudes). */
function iguales(a, b) {
  const ha = createHash('sha256').update(String(a)).digest();
  const hb = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

export function passwordValida(password) {
  return configurado() && iguales(password, process.env.NOTAS_PASSWORD);
}

export function crearToken() {
  const exp = String(Date.now() + DURACION_MS);
  return `${exp}.${createHmac('sha256', clave()).update(exp).digest('hex')}`;
}

function tokenValido(token) {
  if (!configurado() || typeof token !== 'string') return false;
  const [exp, firma] = token.split('.');
  if (!exp || !firma || !Number.isFinite(Number(exp)) || Number(exp) < Date.now()) return false;
  return iguales(firma, createHmac('sha256', clave()).update(exp).digest('hex'));
}

/** ¿La petición trae un token válido en `Authorization: Bearer ...`? */
export function autorizado(request) {
  const cabecera = request.headers.get('authorization') || '';
  return tokenValido(cabecera.startsWith('Bearer ') ? cabecera.slice(7) : '');
}
