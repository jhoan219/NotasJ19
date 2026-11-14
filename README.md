# NotasJ19 (versión Vercel)

App de notas con estética cyberpunk y glassmorphism en colores azulgrana. Frontend en HTML5 + CSS3 + JavaScript vanilla; backend propio en funciones serverless de Vercel con contraseña.

- CRUD de notas con título, texto, imagen (con previsualización) y archivo adjunto descargable
- Buscador en tiempo real
- Funciona sin conexión (IndexedDB) y se sincroniza solo entre dispositivos
- Datos protegidos: texto en Redis (Upstash) y archivos en un Blob **privado**, ambos accesibles solo a través de `/api` con tu contraseña

## Estructura

```
index.html, styles.css   Interfaz
app.js                   Lógica de la interfaz
db.js                    Copia local (IndexedDB)
sync.js                  Sincronización con /api
api/login.js             POST  /api/login   -> token de sesión (30 días)
api/notas.js             GET/PUT/DELETE /api/notas   (texto, en Redis)
api/media.js             PUT/GET /api/media          (imágenes y adjuntos, en Blob privado)
lib/                     Contraseña/sesiones, cliente de Redis y utilidades
package.json             Dependencia: @vercel/blob
```

## Despliegue paso a paso

1. **Sube el proyecto a GitHub**: crea un repositorio y sube *el contenido* de esta carpeta (que `index.html`, `api/` y `package.json` queden en la raíz). El repositorio puede ser privado.
2. **Importa en Vercel**: en vercel.com, *Add New → Project*, elige el repositorio y pulsa *Deploy*. No hace falta cambiar nada (Framework: *Other*, sin comando de build).
3. **Crea el almacenamiento de archivos**: en el proyecto, pestaña **Storage → Create Storage → Blob**, y en el acceso elige **Private**. Conéctalo al proyecto en todos los entornos; Vercel añade solas las variables necesarias.
4. **Crea la base de datos**: en **Storage** (o en el Marketplace) elige **Upstash for Redis** ("Redis Compatible Database"), plan gratuito, y conéctala al proyecto. Añade las variables `KV_REST_API_URL` / `KV_REST_API_TOKEN` (o las `UPSTASH_REDIS_REST_*`); el código acepta ambas.
5. **Define tu contraseña**: *Settings → Environment Variables*, añade `NOTAS_PASSWORD` con una contraseña larga (márcala como *Sensitive* si la opción aparece).
6. **Vuelve a desplegar**: las variables nuevas solo se aplican a despliegues nuevos. En *Deployments*, abre el menú del último y pulsa **Redeploy**.
7. **Úsala**: abre tu dirección `https://TU-PROYECTO.vercel.app`, pulsa **☁ Sincronizar**, escribe la contraseña y listo. Repite el paso 7 en cada dispositivo (en el celular también).

Los nombres exactos de los menús de Vercel pueden cambiar un poco con el tiempo; lo importante es: un Blob privado, un Redis conectado y la variable `NOTAS_PASSWORD`.

## Cómo funciona la sincronización

- Cada dispositivo guarda sus notas en el navegador y las iguala con el servidor: al abrir la app, cada 60 segundos mientras la pestaña esté visible, al volver a ella y 1,5 s después de guardar o borrar.
- Nota nueva o editada: se sube y aparece en los demás. Nota borrada: se borra en todos. Editada en dos a la vez: gana la más reciente.
- Las imágenes y adjuntos se identifican por su contenido (SHA-256): solo se suben si el servidor no los tiene, así que editar el texto no vuelve a subir archivos.
- Las fotos grandes se reducen automáticamente (máx. 1920 px, JPEG) antes de guardarse.

## Límites y seguridad

- **4 MB por archivo.** Las funciones de Vercel aceptan unos 4,5 MB por petición. Para archivos mayores habría que subirlos directo al Blob desde el navegador (*client uploads*), que requiere más código.
- **Plan gratuito de Blob**: incluye 1 GB y unas 2.000 operaciones de escritura al mes (cada imagen o adjunto subido cuenta como una). Si se supera, Blob queda bloqueado hasta cumplirse 30 días. Las notas de texto no usan Blob, así que no lo consumen.
- **Redis gratuito (Upstash)**: tiene un límite diario de comandos (revisa tu panel de Upstash). La app hace un comando por sincronización y solo sincroniza con la pestaña visible.
- **Contraseña**: usa una larga. El login solo frena la fuerza bruta con una pausa de 0,8 s por intento; no hay bloqueo por número de intentos. Cambiar `NOTAS_PASSWORD` y redesplegar cierra todas las sesiones.
- **Tu contraseña no se guarda en los dispositivos**: solo un token firmado que caduca a los 30 días. Si se vence, la app avisa y vuelves a entrar.
- **Exportar / Importar** siguen disponibles como copia de seguridad en un archivo `.json`.
- Abrir `index.html` con doble clic funciona (sin sincronización); la sincronización solo existe en la app publicada.
