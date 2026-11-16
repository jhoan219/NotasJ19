# NotasJ19 (versión Vercel, sin contraseñas)

App de notas con estética cyberpunk y glassmorphism en colores azulgrana. Frontend en HTML5 + CSS3 + JavaScript vanilla; backend propio en funciones serverless de Vercel.

- CRUD de notas con título, texto, imagen (con previsualización) y archivo adjunto descargable
- Buscador en tiempo real
- Funciona sin conexión (IndexedDB) y se sincroniza solo entre dispositivos
- **Sin cuentas ni contraseñas**: para ver tus notas en otro dispositivo abres un enlace

## Cómo funciona el acceso

La primera vez que abres la web, tu navegador crea un **código aleatorio** (144 bits, imposible de adivinar) que define tu espacio de notas. En el botón **☁ Sincronizar** aparece un enlace que contiene ese código: ábrelo en tu celular o en otra computadora y verás las mismas notas, siempre al día. También puedes pegar un enlace o un código en el otro dispositivo.

- El servidor no guarda el código, solo su hash SHA-256.
- **Quien tenga el enlace puede ver y editar tus notas.** Trátalo como una llave: no lo publiques.
- Si lo pierdes en todos tus dispositivos, no hay forma de recuperar las notas del servidor (no hay cuenta). Usa **Exportar** de vez en cuando como copia de seguridad.

## Estructura

```
index.html, styles.css   Interfaz
app.js                   Lógica de la interfaz
db.js                    Copia local (IndexedDB)
sync.js                  Espacio, enlace y sincronización con /api
api/notas.js             GET/PUT/DELETE /api/notas   (texto, en Redis)
api/media.js             PUT/GET /api/media          (imágenes y adjuntos, en Blob privado)
api/estado.js            GET /api/estado             (diagnóstico: ¿Redis y Blob conectados?)
lib/                     Espacios, cliente de Redis y utilidades
package.json             Dependencia: @vercel/blob
```

## Despliegue paso a paso

1. **Sube el proyecto a GitHub**: crea un repositorio y sube *el contenido* de esta carpeta (que `index.html`, `api/` y `package.json` queden en la raíz).
2. **Importa en Vercel**: en vercel.com, *Add New → Project*, elige el repositorio y pulsa *Deploy*. No hace falta cambiar nada (Framework: *Other*, sin comando de build).
3. **Crea el almacenamiento de archivos**: en el proyecto, pestaña **Storage → Create Storage → Blob**, y en el acceso elige **Private**. Conéctalo al proyecto en todos los entornos.
4. **Crea la base de datos**: en **Storage** (o en el Marketplace) elige **Upstash for Redis** ("Redis Compatible Database"), plan gratuito, y conéctala al proyecto.
5. **Vuelve a desplegar**: las conexiones nuevas solo se aplican a despliegues nuevos. En *Deployments*, abre el menú `⋯` del último y pulsa **Redeploy**.
6. **Abre tu dirección pública** `https://TU-PROYECTO.vercel.app` y pulsa **☁ Sincronizar**. Arriba verás un diagnóstico con ✓ o ✗ para la base de datos y los archivos.

No hace falta definir ninguna contraseña ni variable de entorno propia.

### Si Vercel te pide iniciar sesión al abrir la web

Es la protección de despliegues de Vercel, no de la app. Usa la dirección de producción (`TU-PROYECTO.vercel.app`, no las de cada despliegue con letras y números) y, si aun así la pide, ve a **Settings → Deployment Protection** y desactiva **Vercel Authentication** para que la web sea pública.

### Diagnóstico

El modal **☁ Sincronizar** muestra el estado del servidor:

- `✗ Sin servidor…` → la app no está abierta desde Vercel (por ejemplo, GitHub Pages o doble clic en el archivo). Solo guarda en el navegador.
- `✗ Base de datos (Redis)` → falta conectar Upstash Redis al proyecto (paso 4) o hacer Redeploy.
- `✗ Archivos (Blob)` → falta el Blob privado (paso 3) o el Redeploy. Las notas de texto sincronizan igual; solo fallan las imágenes y adjuntos.

## Límites (para cuidar el plan gratuito)

Como cualquiera con la dirección puede crear su espacio, el servidor pone topes. Puedes cambiarlos en *Settings → Environment Variables* (y Redeploy):

| Variable | Por defecto | Qué limita |
|---|---|---|
| `MAX_ESPACIOS` | 25 | Espacios (usuarios) que pueden escribir en el servidor |
| `MAX_NOTAS_POR_ESPACIO` | 300 | Notas por espacio |
| `MAX_MB_POR_ESPACIO` | 40 | Megabytes de imágenes y adjuntos por espacio |

Otros límites:

- **4 MB por archivo.** Las funciones de Vercel aceptan unos 4,5 MB por petición. Las fotos grandes se reducen solas antes de guardarse. Para archivos mayores habría que subirlos directo al Blob desde el navegador (*client uploads*).
- **Blob gratuito**: unos 1 GB y unas 2.000 operaciones de escritura al mes (cada archivo subido cuenta una). Si se supera, Blob queda bloqueado hasta cumplirse 30 días. Las notas de texto no usan Blob.
- **Redis gratuito (Upstash)**: tiene un límite diario de comandos (revisa tu panel). La app hace un comando por sincronización y solo sincroniza con la pestaña visible, pero una web abierta a cualquiera puede recibir tráfico ajeno: si ves el límite agotado, baja `MAX_ESPACIOS` o vuelve a poner una protección.
- **Exportar / Importar** siguen disponibles como copia de seguridad en un archivo `.json`.

## Cómo se sincroniza

- Al abrir la app, cada 60 segundos mientras la pestaña esté visible, al volver a ella y 1,5 s después de guardar o borrar.
- Nota nueva o editada: se sube y aparece en los demás. Nota borrada: se borra en todos. Editada en dos a la vez: gana la más reciente.
- Las imágenes y adjuntos se identifican por su contenido (SHA-256): solo se suben si el servidor no los tiene, así que editar el texto no vuelve a subir archivos.
- Si una nota falla (límite o archivo grande), las demás se siguen sincronizando y la app te avisa del problema.
