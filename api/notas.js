/**
 * /api/notas   (todas las rutas exigen la cabecera X-Espacio)
 *   GET              -> [{ id, actualizada }]          índice de las notas del espacio
 *   GET    ?id=ID    -> nota (JSON)
 *   PUT    ?id=ID    -> guarda la nota; si faltan archivos responde 409 { faltan: [hash] }
 *   DELETE ?id=ID    -> borra la nota y sus archivos
 *
 * El texto y el índice viven en Redis; las imágenes y adjuntos, en un Blob
 * privado (ver api/media.js). Una nota solo se confirma cuando todos sus
 * archivos ya están subidos.
 */
import { del } from '@vercel/blob';
import { espacioDe, registrarEspacio, limites } from '../lib/espacio.js';
import { comando, pipeline } from '../lib/redis.js';
import {
  json, seguro, parametros, aPares, ID_VALIDO, HASH_VALIDO,
  kIdx, kNota, kMedia, kTam, rutaMedia,
} from '../lib/util.js';

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
    const esp = espacioDe(request);
    if (!esp) return json({ error: 'Falta el código de espacio (cabecera X-Espacio) o no es válido.' }, 400);

    const id = parametros(request).get('id');
    const metodo = request.method;

    /* ----- Índice ----- */
    if (metodo === 'GET' && !id) {
      const lista = aPares(await comando('HGETALL', kIdx(esp)))
        .map(([k, v]) => ({ id: k, actualizada: Number(v) }));
      return json(lista);
    }

    if (!id || !ID_VALIDO.test(id)) return json({ error: 'Id de nota inválido.' }, 400);

    /* ----- Leer una nota ----- */
    if (metodo === 'GET') {
      const texto = await comando('GET', kNota(esp, id));
      if (!texto) return json({ error: 'La nota no existe.' }, 404);
      return new Response(typeof texto === 'string' ? texto : JSON.stringify(texto), {
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }

    /* ----- Guardar una nota ----- */
    if (metodo === 'PUT') {
      const nota = limpiarNota(id, await request.json().catch(() => null));
      if (!nota) return json({ error: 'Nota inválida.' }, 400);

      // Límite de notas por espacio (editar una nota existente siempre se permite).
      const [existe, total] = await pipeline([['HEXISTS', kIdx(esp), id], ['HLEN', kIdx(esp)]]);
      const maxNotas = limites().notas;
      if (Number(existe) === 0 && Number(total) >= maxNotas) {
        return json({ error: `Este espacio alcanzó el máximo de ${maxNotas} notas.` }, 403);
      }

      const referenciados = [...new Set([nota.imagen?.hash, nota.adjunto?.hash].filter(Boolean))];
      const existentes = new Set(await comando('SMEMBERS', kMedia(esp, id)));

      // Si falta algún archivo, el cliente debe subirlo y volver a confirmar.
      const faltan = referenciados.filter((h) => !existentes.has(h));
      if (faltan.length) return json({ faltan }, 409);

      await registrarEspacio(esp);
      await pipeline([
        ['SET', kNota(esp, id), JSON.stringify(nota)],
        ['HSET', kIdx(esp), id, nota.actualizada],
      ]);

      // Archivos que la nota ya no usa (p. ej. se cambió la imagen): se eliminan.
      const huerfanos = [...existentes].filter((h) => !referenciados.includes(h));
      if (huerfanos.length) {
        try {
          await del(huerfanos.map((h) => rutaMedia(esp, id, h)));
          await pipeline([
            ['SREM', kMedia(esp, id), ...huerfanos],
            ['HDEL', kTam(esp), ...huerfanos.map((h) => `${id}/${h}`)],
          ]);
        } catch (err) {
          console.error('No se pudieron limpiar archivos huérfanos:', err);   // no impide guardar
        }
      }
      return json({ ok: true });
    }

    /* ----- Borrar una nota ----- */
    if (metodo === 'DELETE') {
      const hashes = await comando('SMEMBERS', kMedia(esp, id));
      // Si falla el borrado de archivos se lanza el error y NO se tocan las
      // referencias, de modo que el cliente reintente y no queden archivos sueltos.
      if (hashes.length) await del(hashes.map((h) => rutaMedia(esp, id, h)));
      await pipeline([
        ['DEL', kNota(esp, id)],
        ['DEL', kMedia(esp, id)],
        ['HDEL', kIdx(esp), id],
        ...(hashes.length ? [['HDEL', kTam(esp), ...hashes.map((h) => `${id}/${h}`)]] : []),
      ]);
      return json({ ok: true });
    }

    return json({ error: 'Método no permitido.' }, 405);
  });
}
