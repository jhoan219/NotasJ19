/**
 * lib/redis.js — cliente mínimo para la API REST de Upstash Redis
 * ---------------------------------------------------------------
 * Sin dependencias: solo fetch. La integración de Upstash en el Marketplace
 * de Vercel define las variables de entorno (se aceptan los dos nombres usados).
 */

function config() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    throw new Error('Falta conectar la base de datos Redis (Upstash) al proyecto en Vercel.');
  }
  return { url: url.replace(/\/$/, ''), token };
}

async function enviar(ruta, cuerpo) {
  const { url, token } = config();
  const res = await fetch(url + ruta, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
  const datos = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Redis respondió ${res.status}${datos && datos.error ? ': ' + datos.error : ''}`);
  return datos;
}

/** Ejecuta un comando: comando('HGETALL', 'clave'). Devuelve el resultado. */
export async function comando(...args) {
  const datos = await enviar('', args.map(String));
  if (datos.error) throw new Error('Redis: ' + datos.error);
  return datos.result;
}

/** Ejecuta varios comandos en una sola petición. Devuelve la lista de resultados. */
export async function pipeline(lista) {
  const datos = await enviar('/pipeline', lista.map((c) => c.map(String)));
  const fallo = datos.find((r) => r.error);
  if (fallo) throw new Error('Redis: ' + fallo.error);
  return datos.map((r) => r.result);
}
