# Shiori

Gestor de colección de cómics y manga para el móvil. Escaneas el código de barras de la contraportada, busca el ISBN y lo añade a tu biblioteca. Es una PWA: se instala en la pantalla de inicio y funciona sin conexión (salvo la búsqueda de datos).

## Qué hace

- **Escáner** con la cámara del móvil. Usa el lector nativo del navegador cuando existe (Chrome en Android) y, si no, un lector EAN-13 propio en `js/ean.js`, así que también va en iPhone. Modos: «Lo tengo» / «Lo quiero», ráfaga (va guardando tomo tras tomo sin abrir la ficha), linterna, ISBN a mano, leer el código desde una foto y búsqueda por título.
- **Datos**: Google Books y Open Library por ISBN. Detecta serie y número a partir del título («One Piece nº 05», «Chainsaw Man 3», «Dragon Ball Super nº 21/24»), normaliza la editorial y adivina si es manga o americano. Si un tomo no aparece, lo rellenas a mano y le haces una foto a la portada.
- **Biblioteca** con portadas, búsqueda, filtros (pendiente, leyendo, leído; manga, americano) y orden.
- **Series**: agrupa por serie, muestra qué números tienes, cuáles has leído y cuáles te faltan. Puedes indicar el total de tomos y añadir los huecos a «Lo quiero» con un toque.
- **Lo quiero**: lista de deseos con el coste total. «Lo tengo» lo pasa a tu colección con la fecha de hoy.
- **Estadísticas**: gasto por mes, por editorial, progreso de lectura, manga frente a americano y precio medio.
- **Copia de seguridad** en JSON (descargar, compartir e importar).

Los datos se guardan en el propio móvil (IndexedDB). No hay servidor ni cuentas.

## Publicarla gratis en GitHub Pages

La cámara solo funciona en páginas con `https`, por eso hay que subirla a algún sitio. GitHub Pages es lo más sencillo:

1. Crea un repositorio nuevo en GitHub (por ejemplo `shiori`).
2. Sube el contenido de esta carpeta (que `index.html` quede en la raíz del repositorio).
3. En el repositorio: **Settings → Pages → Build and deployment**, elige *Deploy from a branch*, rama `main` y carpeta `/ (root)`. Guarda.
4. En un par de minutos estará en `https://TU-USUARIO.github.io/shiori/`.
5. Ábrela en el móvil y añádela a la pantalla de inicio:
   - Android (Chrome): menú ⋮ → *Añadir a pantalla de inicio* / *Instalar aplicación*.
   - iPhone (Safari): botón compartir → *Añadir a pantalla de inicio*.

Instalarla es importante en iPhone: Safari puede borrar los datos de webs que no se usan en semanas, pero no los de apps instaladas. Aun así, descarga una copia de seguridad de vez en cuando.

Con la terminal sería:

```bash
cd shiori
git init && git add . && git commit -m "Shiori 1.0"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/shiori.git
git push -u origin main
```

También vale Netlify o Vercel arrastrando la carpeta a su web.

## Probarla en el ordenador

```bash
cd shiori
python -m http.server 8000
```

y abre `http://localhost:8000` (en `localhost` la cámara sí funciona).

## Cuando cambies algo

El service worker guarda la app en caché. Al modificar archivos, sube la versión en `sw.js` (`const VERSION = 'shiori-v2'`) para que los móviles descarguen la nueva. Si añades un archivo JS o CSS nuevo, añádelo también a la lista `SHELL`.

## Estructura

```
index.html            estructura de la app
css/styles.css        estilos (modo claro y oscuro)
js/app.js             interfaz y lógica
js/db.js              almacenamiento (IndexedDB)
js/scanner.js         cámara y detección
js/ean.js             lector EAN-13 propio
js/lookup.js          búsqueda por ISBN/título y lectura del título
sw.js                 funcionamiento sin conexión
manifest.webmanifest  datos para instalarla
icons/                iconos
```

## Límites conocidos

- La cobertura de Google Books y Open Library para cómic español es buena pero no total: algunos tomos saldrán sin portada o sin datos. Una mejora futura sería consultar la base de datos del ISBN del Ministerio de Cultura a través de un pequeño servidor intermedio (desde el navegador no se puede por CORS).
- Las grapas de quiosco suelen llevar un código que no es ISBN (empieza por 977) y no se encuentran; se añaden a mano.
- Google Books sin clave comparte una cuota global que suele estar agotada (error 429). Con una clave propia (gratis, 1.000 búsquedas al día) funciona bien: se añade en *Ajustes → Clave de Google Books* y se guarda solo en el dispositivo, nunca en el repositorio.

## Cuentas y sincronización (Firebase)

Con una cuenta, la biblioteca se guarda también en la nube y se sincroniza entre dispositivos. Se configura una vez:

1. Entra en https://console.firebase.google.com y crea un proyecto (por ejemplo `shiori`). Google Analytics no hace falta.
2. *Compilación → Authentication → Comenzar*. En *Método de acceso* activa **Correo electrónico/contraseña** (y **Google** si quieres).
3. En *Authentication → Configuración → Dominios autorizados*, añade `yokki21.github.io`.
4. *Compilación → Firestore Database → Crear base de datos*, ubicación `eur3 (Europe)`, modo producción. En la pestaña *Reglas* pega esto y pulsa *Publicar*:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{uid}/{document=**} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }
     }
   }
   ```

   Así cada usuario solo puede leer y escribir sus propios cómics.
5. *Configuración del proyecto (rueda) → Tus apps → Web (`</>`)*, registra la app «Shiori» y copia el objeto `firebaseConfig` en `FIREBASE_CONFIG` de `js/config.js`. Esa configuración no es secreta.

El plan gratuito (Spark) sobra para uso personal: 50.000 lecturas y 20.000 escrituras al día.

## Fuente extra: base de datos de libros editados en España

La Agencia del ISBN (Ministerio de Cultura) tiene casi todos los tomos editados en España, con título exacto de la edición, editorial y precio. Su buscador no se puede consultar desde el navegador, así que hace falta un pequeño intermediario gratuito en Cloudflare (`worker/isbn-espana.js`):

1. Crea una cuenta gratuita en https://dash.cloudflare.com.
2. Ve a *Workers y Pages → Crear → Crear Worker*, llámalo `shiori-isbn` y pulsa *Implementar*.
3. Pulsa *Editar código*, borra lo que hay, pega el contenido de [`worker/isbn-espana.js`](worker/isbn-espana.js) y pulsa *Implementar*.
4. Comprueba que funciona abriendo `https://shiori-isbn.TU-SUBDOMINIO.workers.dev/?isbn=9788468471563`: debe salir un JSON con «One Piece 5».
5. Pon esa dirección en `js/config.js` (`MINISTRY_URL`). No es secreta: el intermediario solo responde a peticiones desde `yokki21.github.io`.

El plan gratuito de Cloudflare permite 100.000 consultas al día y el intermediario guarda cada respuesta 7 días en caché.

## Conseguir la clave de Google Books

1. Entra en https://console.cloud.google.com/ y crea un proyecto (por ejemplo «Shiori»).
2. En *APIs y servicios → Biblioteca*, busca **Books API** y pulsa *Habilitar*.
3. En *APIs y servicios → Credenciales*, pulsa *Crear credenciales → Clave de API*.
4. Edita la clave: en *Restricciones de aplicaciones* elige *Sitios web* y añade `https://yokki21.github.io/*`; en *Restricciones de API* elige solo *Books API*. Guarda.
5. Copia la clave (empieza por `AIza`) y pégala en Shiori, en *Ajustes*. Pulsa *Guardar y probar*.

No hace falta tarjeta ni facturación para la Books API.
