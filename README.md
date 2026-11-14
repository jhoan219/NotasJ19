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
