/**
 * POST /api/login   { password }  ->  { token }
 */
import { configurado, passwordValida, crearToken } from '../lib/auth.js';
import { json, seguro } from '../lib/util.js';

export default async function handler(request) {
  return seguro(async () => {
    if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);
    if (!configurado()) {
      return json({ error: 'El servidor no tiene definida la variable NOTAS_PASSWORD.' }, 503);
    }

    let password = '';
    try { password = (await request.json()).password; } catch { /* cuerpo inválido */ }

    if (!passwordValida(password)) {
      await new Promise((r) => setTimeout(r, 800));   // frena la fuerza bruta
      return json({ error: 'Contraseña incorrecta.' }, 401);
    }
    return json({ token: crearToken() });
  });
}
