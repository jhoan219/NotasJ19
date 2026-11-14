/**
 * /api/media   (imágenes y adjuntos, guardados en un Blob PRIVADO)
 *   PUT ?id=ID&hash=H&tipo=MIME   cuerpo binario (máx. ~4 MB)
 *   GET ?id=ID&hash=H             descarga el archivo
 *
 * Los archivos se nombran por el hash SHA-256 de su contenido, así que nunca se
 * sobrescriben (sin problemas de caché) y un archivo repetido no se vuelve a subir.
 * El navegador nunca recibe la URL del Blob: todo pasa por esta función, que
 * exige sesión.
 */
import { put, get } from '@vercel/blob';
import { autorizado } from '../lib/auth.js';
import { comando } from '../lib/redis.js';
import { json, seguro, parametros, ID_VALIDO, HASH_VALIDO, MAX_BYTES, kMedia, rutaMedia } from '../lib/util.js';

const TIPO_VALIDO = /^[\w.+-]+\/[\w.+-]+$/;

export default async function handler(request) {
  return seguro(async () => {
    if (!autorizado(request)) return json({ error: 'No autorizado.' }, 401);

    const p = parametros(request);
    const id = p.get('id');
    const hash = p.get('hash');
    if (!ID_VALIDO.test(id || '') || !HASH_VALIDO.test(hash || '')) {
      return json({ error: 'Parámetros inválidos.' }, 400);
    }
    const ruta = rutaMedia(id, hash);

    if (request.method === 'PUT') {
      if (Number(request.headers.get('content-length')) > MAX_BYTES) {
        return json({ error: 'Archivo demasiado grande (máx. 4 MB).' }, 413);
      }
      const datos = Buffer.from(await request.arrayBuffer());
      if (datos.length === 0) return json({ error: 'Archivo vacío.' }, 400);
      if (datos.length > MAX_BYTES) return json({ error: 'Archivo demasiado grande (máx. 4 MB).' }, 413);

      const tipo = TIPO_VALIDO.test(p.get('tipo') || '') ? p.get('tipo') : 'application/octet-stream';
      await put(ruta, datos, { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: tipo });
      await comando('SADD', kMedia(id), hash);
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
