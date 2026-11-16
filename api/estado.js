/**
 * GET /api/estado  ->  { servidor, redis, blob, problemas[] }
 * Diagnóstico para la app: indica si la base de datos y el almacenamiento de
 * archivos están bien conectados. No revela ningún dato ni secreto.
 */
import { comando } from '../lib/redis.js';
import { json, seguro, blobConfigurado, MSG_SIN_BLOB } from '../lib/util.js';

export default async function handler() {
  return seguro(async () => {
    const respuesta = { servidor: true, redis: false, blob: blobConfigurado(), problemas: [] };
    try {
      await comando('PING');
      respuesta.redis = true;
    } catch (err) {
      respuesta.problemas.push(err.message);
    }
    if (!respuesta.blob) respuesta.problemas.push(MSG_SIN_BLOB);
    return json(respuesta);
  });
}
