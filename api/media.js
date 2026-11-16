/**
 * /api/media   (imágenes y adjuntos, guardados en un Blob PRIVADO; exige X-Espacio)
 *   PUT ?id=ID&hash=H&tipo=MIME   cuerpo binario (máx. ~4 MB)
 *   GET ?id=ID&hash=H             descarga el archivo
 *
 * Los archivos se nombran por el hash SHA-256 de su contenido, así que nunca se
 * sobrescriben (sin problemas de caché) y un archivo repetido no se vuelve a subir.
 * El navegador nunca recibe la URL del Blob: todo pasa por esta función.
 */
import { put, get } from '@vercel/blob';
import { espacioDe, registrarEspacio, limites } from '../lib/espacio.js';
import { comando, pipeline } from '../lib/redis.js';
import {
  json, seguro, parametros, aPares, ID_VALIDO, HASH_VALIDO, MAX_BYTES,
  blobConfigurado, MSG_SIN_BLOB, kMedia, kTam, rutaMedia,
} from '../lib/util.js';

const TIPO_VALIDO = /^[\w.+-]+\/[\w.+-]+$/;

export default async function handler(request) {
  return seguro(async () => {
    const esp = espacioDe(request);
    if (!esp) return json({ error: 'Falta el código de espacio (cabecera X-Espacio) o no es válido.' }, 400);

    const p = parametros(request);
    const id = p.get('id');
    const hash = p.get('hash');
    if (!ID_VALIDO.test(id || '') || !HASH_VALIDO.test(hash || '')) {
      return json({ error: 'Parámetros inválidos.' }, 400);
    }
    if (!blobConfigurado()) return json({ error: MSG_SIN_BLOB }, 503);
    const ruta = rutaMedia(esp, id, hash);

    if (request.method === 'PUT') {
      if (Number(request.headers.get('content-length')) > MAX_BYTES) {
        return json({ error: 'Archivo demasiado grande (máx. 4 MB).' }, 413);
      }
      const datos = Buffer.from(await request.arrayBuffer());
      if (datos.length === 0) return json({ error: 'Archivo vacío.' }, 400);
      if (datos.length > MAX_BYTES) return json({ error: 'Archivo demasiado grande (máx. 4 MB).' }, 413);

      // Cuota de archivos por espacio (volver a subir el mismo archivo no se cuenta dos veces).
      const campo = `${id}/${hash}`;
      const usado = aPares(await comando('HGETALL', kTam(esp)))
        .filter(([k]) => k !== campo)
        .reduce((suma, [, v]) => suma + Number(v), 0);
      const maxBytes = limites().bytes;
      if (usado + datos.length > maxBytes) {
        return json({ error: `Este espacio alcanzó su límite de ${Math.round(maxBytes / 1024 / 1024)} MB de archivos.` }, 403);
      }

      await registrarEspacio(esp);
      const tipo = TIPO_VALIDO.test(p.get('tipo') || '') ? p.get('tipo') : 'application/octet-stream';
      await put(ruta, datos, { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: tipo });
      await pipeline([['SADD', kMedia(esp, id), hash], ['HSET', kTam(esp), campo, datos.length]]);
      return json({ ok: true });
    }

    if (request.method === 'GET') {
      const resultado = await get(ruta, { access: 'private' });
      if (!resultado || resultado.statusCode !== 200) return json({ error: 'Archivo no encontrado.' }, 404);
      return new Response(resultado.stream, {
        headers: {
          'Content-Type': resultado.blob.contentType || 'application/octet-stream',
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'private, no-store',
        },
      });
    }

    return json({ error: 'Método no permitido.' }, 405);
  });
}
