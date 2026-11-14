/**
 * /api/notas
 *   GET              -> [{ id, actualizada }]          índice de todas las notas
 *   GET    ?id=ID    -> nota (JSON)
 *   PUT    ?id=ID    -> guarda la nota; si faltan archivos responde 409 { faltan: [hash] }
 *   DELETE ?id=ID    -> borra la nota y sus archivos
 *
 * El texto y el índice viven en Redis; las imágenes y adjuntos, en un Blob
 * privado (ver api/media.js). Una nota solo se confirma cuando todos sus
 * archivos ya están subidos.
 */
import { del } from '@vercel/blob';
import { autorizado } from '../lib/auth.js';
import { comando, pipeline } from '../lib/redis.js';
import { json, seguro, parametros, ID_VALIDO, HASH_VALIDO, IDX, kNota, kMedia, rutaMedia } from '../lib/util.js';

/** Valida y normaliza una nota recibida. Devuelve null si no es válida. */
function limpiarNota(id, d) {
  if (!d || typeof d !== 'object') return null;
  if (typeof d.titulo !== 'string' || typeof d.contenido !== 'string') return null;
  if (d.titulo.length > 500 || d.contenido.length > 200_000) return null;
  const fecha = (v) => Number.isFinite(v) && v > 0;
  if (!fecha(d.creada) || !fecha(d.actualizada)) return null;

  const archivo = (m, conNombre) => {
    if (m === null || m === undefined) return null;
    if (typeof m !== 'object' || !HASH_VALIDO.test(m.hash)) throw new Error('archivo inválido');
    const r = {
      hash: m.hash,
      tipo: String(m.tipo || 'application/octet-stream').slice(0, 100),
      tamano: Number(m.tamano) || 0,
    };
    if (conNombre) r.nombre = String(m.nombre || 'archivo').slice(0, 255);
    return r;
  };

  try {
    return {
      id,
      titulo: d.titulo,
      contenido: d.contenido,
      creada: d.creada,
      actualizada: d.actualizada,
      imagen: archivo(d.imagen, false),
      adjunto: archivo(d.adjunto, true),
    };
  } catch {
    return null;
  }
}

export default async function handler(request) {
  return seguro(async () => {
    if (!autorizado(request)) return json({ error: 'No autorizado.' }, 401);

    const id = parametros(request).get('id');
    const metodo = request.method;

    /* ----- Índice ----- */
    if (metodo === 'GET' && !id) {
      const plano = await comando('HGETALL', IDX);
      const lista = [];
      if (Array.isArray(plano)) {
        for (let i = 0; i < plano.length; i += 2) lista.push({ id: plano[i], actualizada: Number(plano[i + 1]) });
      } else if (plano && typeof plano === 'object') {
        for (const [k, v] of Object.entries(plano)) lista.push({ id: k, actualizada: Number(v) });
      }
      return json(lista);
    }

    if (!id || !ID_VALIDO.test(id)) return json({ error: 'Id de nota inválido.' }, 400);

    /* ----- Leer una nota ----- */
    if (metodo === 'GET') {
      const texto = await comando('GET', kNota(id));
      if (!texto) return json({ error: 'La nota no existe.' }, 404);
      return new Response(typeof texto === 'string' ? texto : JSON.stringify(texto), {
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }

    /* ----- Guardar una nota ----- */
    if (metodo === 'PUT') {
      const nota = limpiarNota(id, await request.json().catch(() => null));
      if (!nota) return json({ error: 'Nota inválida.' }, 400);

      const referenciados = [...new Set([nota.imagen?.hash, nota.adjunto?.hash].filter(Boolean))];
      const existentes = new Set(await comando('SMEMBERS', kMedia(id)));

      // Si falta algún archivo, el cliente debe subirlo y volver a confirmar.
      const faltan = referenciados.filter((h) => !existentes.has(h));
      if (faltan.length) return json({ faltan }, 409);

      await pipeline([
        ['SET', kNota(id), JSON.stringify(nota)],
        ['HSET', IDX, id, nota.actualizada],
      ]);

      // Archivos que la nota ya no usa (p. ej. se cambió la imagen): se eliminan.
      const huerfanos = [...existentes].filter((h) => !referenciados.includes(h));
      if (huerfanos.length) {
        try {
          await del(huerfanos.map((h) => rutaMedia(id, h)));
          await comando('SREM', kMedia(id), ...huerfanos);
        } catch (err) {
          console.error('No se pudieron limpiar archivos huérfanos:', err);   // no impide guardar
        }
      }
      return json({ ok: true });
    }

    /* ----- Borrar una nota ----- */
    if (metodo === 'DELETE') {
      const hashes = await comando('SMEMBERS', kMedia(id));
      // Si falla el borrado de archivos se lanza el error y NO se tocan las
      // referencias, de modo que el cliente reintente y no queden archivos sueltos.
      if (hashes.length) await del(hashes.map((h) => rutaMedia(id, h)));
      await pipeline([['DEL', kNota(id)], ['DEL', kMedia(id)], ['HDEL', IDX, id]]);
      return json({ ok: true });
    }

    return json({ error: 'Método no permitido.' }, 405);
  });
}
