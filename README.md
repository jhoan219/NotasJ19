# NotasJ19

App de notas con estética cyberpunk y glassmorphism en colores azulgrana. HTML5 + CSS3 + JavaScript vanilla (ES6+), sin dependencias ni backend.

## Características

- CRUD completo de notas (crear, leer, editar, eliminar)
- Título, texto, imagen con previsualización y archivo adjunto descargable
- Buscador en tiempo real por título o contenido (con resaltado)
- Persistencia local con IndexedDB (soporta archivos pesados)
- Responsive (móvil, tablet, escritorio)

## Estructura

```
index.html   Estructura de la página
styles.css   Estilos (paleta, glassmorphism, responsive)
db.js        Capa de datos (IndexedDB) — única parte que habla con el almacenamiento
app.js       Lógica de interfaz
```

## Despliegue en GitHub Pages

1. Crea un repositorio y sube estos archivos a la raíz.
2. En GitHub: **Settings → Pages → Build and deployment**.
3. Elige **Deploy from a branch**, rama `main`, carpeta `/ (root)`, y guarda.
4. Tu app quedará en `https://TU-USUARIO.github.io/NOMBRE-DEL-REPO/`.

> Para probar en local basta con abrir `index.html` con doble clic en Chrome, Edge o Firefox (no usa módulos ES, así que no necesita servidor).

## Compartir notas entre dispositivos con `notas.json`

GitHub Pages no puede guardar datos, así que las notas viven en cada navegador. Para llevarlas a otro dispositivo se usa un archivo `notas.json`:

1. En el dispositivo con las notas, pulsa **Exportar**: descarga `notas.json` (incluye imágenes y adjuntos en base64).
2. Reemplaza el `notas.json` de la raíz del repositorio por ese archivo (GitHub → *Add file → Upload files*).
3. Al abrir la web en otro dispositivo, la app carga `notas.json` sola y agrega las notas nuevas. Si una nota existe en ambos lados, gana la más reciente.

También puedes usar **Importar** para cargar un `.json` a mano (sirve en local con doble clic, donde la carga automática no funciona).

Ojo:
- Es una sincronización **manual y en un solo sentido** (repo → dispositivos). Para sincronizar automáticamente en ambos sentidos hace falta un backend (Firebase, Supabase o Express).
- Una nota borrada en un dispositivo no reaparece al recargar `notas.json` en ese mismo dispositivo, pero seguirá en el JSON hasta que lo vuelvas a exportar y subir.
- Si el repositorio es público, **`notas.json` también lo es**: cualquiera con el enlace podría leer tus notas, imágenes y adjuntos. Usa un repo privado con Pages solo si tu plan lo permite, o no publiques notas sensibles.
- Un JSON con muchas imágenes pesa (base64 añade ~33 %). Súbelo por la web de GitHub solo si pesa menos de 25 MB.

## Migrar a una API REST (Node.js/Express)

`app.js` solo usa esta interfaz de `db.js`:

| Función | Equivalente REST sugerido |
|---|---|
| `DB.init()` | (no necesaria) |
| `DB.getAll()` | `GET /api/notas` |
| `DB.get(id)` | `GET /api/notas/:id` |
| `DB.create(datos)` | `POST /api/notas` (multipart/form-data) |
| `DB.update(id, datos)` | `PUT /api/notas/:id` |
| `DB.remove(id)` | `DELETE /api/notas/:id` |

Basta con reescribir el cuerpo de esas funciones con `fetch()`. Imagen y adjunto pasarían a enviarse con `FormData` y a recibirse como URLs (habría que ajustar `crearURL` en `app.js` para usar la URL directamente).

## Notas

- Los datos viven en el navegador del usuario: borrar los datos del sitio o usar modo incógnito los elimina.
- Límite de 50 MB por archivo (ajustable con `LIMITE_MB` en `app.js`).
