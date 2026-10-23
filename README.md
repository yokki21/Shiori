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
- Google Books limita las peticiones sin clave por IP. Para uso personal sobra; si algún día da errores, se puede añadir una API key gratuita en `js/lookup.js`.
