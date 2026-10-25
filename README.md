# Shiori 栞

Tu colección de cómics en el móvil: escaneas el código de barras, el cómic se añade solo y llevas la cuenta de lo que tienes, lo que has leído y lo que te falta.

App web instalable (PWA) en **https://yokki21.github.io/Shiori/**. Funciona sin conexión y no necesita compilación.

## Qué hace

- **Escanear:** apuntas a la contraportada y se añade con portada, título, serie, número, editorial y precio. Lee ISBN (tomos) e ISSN con el número del suplemento de 2 o 5 cifras (grapas). Si la serie se reconoce pero no el número, eliges el número tocando su portada.
- **Añadir sin cámara:** un buscador que entiende título, ISBN o ISSN, o leer el código desde una foto.
- **Biblioteca:** tus portadas, con buscador y filtro de leídos. Al tocar un cómic ves toda su información y el botón **Marcar como leído**.
- **Biblioteca y series en una sección:** un selector cambia entre ver tus cómics y ver tus series; el buscador vale para las dos.
- **Buscar:** todo el catálogo por título, serie o ISBN, desde el menú. Cada cómic abre su ficha (información, notas de otros lectores) para apuntarlo en deseados o añadirlo; cada serie, su hoja con lo que tienes y lo que falta.
- **Próximas novedades:** lo que Panini, Planeta Cómic, Norma e Ivrea aún no han sacado, con fecha y precio, filtrable por editorial y línea; tocar una abre su ficha; primero los números de tus series y tus deseados.
- **Series:** cada serie que tienes, qué números, cuántos te faltan y cuánto costaría completarla. Desde ahí puedes añadir los que te falten.
- **Deseados:** buscas en el catálogo una serie, grapa o tomo y lo apuntas (o la serie entera). Al escanearlo, pasa solo a la biblioteca.
- **Notas:** tu nota de 1 a 5 y tu reseña; la nota de Google Books u Open Library si la hay, y enlaces a Goodreads, League of Comic Geeks y Comic Book Roundup.
- **Perfil:** nombre de usuario único y foto (con cuenta); cómics, dinero invertido, porcentaje leído, series completas, lo que costaría completar todas, gasto por mes y por editorial. Y los ajustes: añadir automáticamente, copia de seguridad, cuenta.

## De dónde salen los datos

1. **Catálogo propio** (`catalog/catalog.json`): todo el catálogo de cómics y manga de Panini España (Marvel, DC, manga y sus otras líneas), a la venta y agotado, sacado de su web oficial (listados, mapa del sitio y fichas de producto). Cada cómic lleva portada, precio, fecha, páginas y autores; los tomos, su ISBN, y las grapas, el código ISSN y el suplemento que trae su ficha. `tools/panini_raw.json` guarda lo recogido y `python3 tools/build_panini.py` regenera el catálogo. Cada lunes, la tarea «Catálogo semanal» de GitHub ejecuta `tools/update_panini.py` (busca en el mapa del sitio de Panini las fichas nuevas de Marvel y DC y refresca las que salen pronto), regenera el catálogo y lo publica; `tools/panini_manual.json` añade números que no salen en Panini.
   También entra todo el catálogo de Planeta Cómic (manga y cómic, unos 5.400 tomos) sacado de las fichas de planetadelibros.com: `tools/planeta_raw.json` guarda lo recogido, `tools/build_planeta.py` lo convierte en series y tomos, y la tarea semanal ejecuta `tools/update_planeta.py` (novedades de la página de la editorial, una petición cada 5 s como pide su robots.txt).
   Y el de Norma Editorial (manga, cómic americano y europeo, unos 5.100 tomos) con los datos estructurados de las fichas de normaeditorial.com: `tools/norma_raw.json`, `tools/build_norma.py` y, cada semana, `tools/update_norma.py` (fichas nuevas de su mapa del sitio). `tools/build_common.py` arma las series y tomos de ambas.
   Y Ivrea España (unas 480 series de manga) desde editorialivrea.com/ESP: la ficha de cada título (portada de cada tomo) y el calendario de salidas, en `tools/ivrea_raw.json`; como su web no da ISBN ni precio, salen de La Comiquería, su tienda online (`tools/ivrea_isbn.json`). `tools/build_ivrea.py` lo cruza y `tools/update_ivrea.py` lo actualiza cada semana.
2. **Google Books** (mejor con una clave propia, ver abajo) y **Open Library**.
3. Lo que completas a mano se queda en tu biblioteca, y las grapas aprenden su serie a partir del primer número.

## Estructura

```
index.html, css/styles.css     interfaz
js/app.js                      arranque y navegación
js/store.js                    estado, guardado local (IndexedDB) y nube
js/sync.js                     cuentas y sincronización (Firebase)
js/series.js                   series: faltantes y precio para completarlas
js/comic.js                    ficha del cómic y edición
js/scan.js                     escanear y añadir (cámara, código, foto, título)
js/scanner.js, js/ean.js       cámara y lector EAN-13 propio (en un Web Worker)
js/decoder-worker.js           decodificación fuera del hilo principal
js/lookup.js, js/catalog.js    búsqueda en Google Books, Open Library y catálogo
js/views/                      Biblioteca, Series y Perfil
sw.js                          funcionamiento sin conexión
tools/                         origen y script del catálogo
tests/                         pruebas
worker/                        intermediario opcional para la Agencia del ISBN
```

## Pruebas

```bash
node --test tests/unit.test.mjs          # lector EAN, ISSN, ISBN, títulos
pip install playwright pillow && playwright install chromium
python3 tests/e2e_test.py                # recorrido completo con cámara y nube simuladas
```

Se ejecutan solas en GitHub Actions en cada push.

## Publicar cambios

GitHub Pages publica la rama `main`. Si añades un archivo JS o CSS, inclúyelo en `SHELL` de `sw.js` y sube `VERSION`.

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
       // Tus cómics, series y perfil (nombre de usuario y foto): solo tú
       match /users/{uid}/{document=**} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }
       // Nombres de usuario: cualquiera puede comprobar si uno está libre;
       // solo se reserva uno libre para tu cuenta y solo puedes liberar el tuyo
       match /usernames/{name} {
         allow read: if true;
         allow create: if request.auth != null
                       && request.resource.data.uid == request.auth.uid
                       && name.matches('^[a-z0-9_.]{3,20}$');
         allow delete: if request.auth != null && resource.data.uid == request.auth.uid;
       }
     }
   }
   ```

   Así cada usuario solo puede leer y escribir sus propios cómics, y los nombres de usuario no se repiten.
5. *Configuración del proyecto (rueda) → Tus apps → Web (`</>`)*, registra la app «Shiori» y copia el objeto `firebaseConfig` en `FIREBASE_CONFIG` de `js/config.js`. Esa configuración no es secreta.

El plan gratuito (Spark) sobra para uso personal: 50.000 lecturas y 20.000 escrituras al día.


## Conseguir la clave de Google Books

1. Entra en https://console.cloud.google.com/ y crea un proyecto (por ejemplo «Shiori»).
2. En *APIs y servicios → Biblioteca*, busca **Books API** y pulsa *Habilitar*.
3. En *APIs y servicios → Credenciales*, pulsa *Crear credenciales → Clave de API*.
4. Edita la clave: en *Restricciones de aplicaciones* elige *Sitios web* y añade `https://yokki21.github.io/*`; en *Restricciones de API* elige solo *Books API*. Guarda.
5. Copia la clave (empieza por `AIza`) y pégala en Shiori, en *Ajustes*. Pulsa *Guardar y probar*.

No hace falta tarjeta ni facturación para la Books API.

## Fuente opcional: Agencia del ISBN

`worker/isbn-espana.js` es un intermediario para Cloudflare Workers que consulta la base de datos de libros editados en España. Se activa poniendo su dirección en `MINISTRY_URL` (`js/config.js`). Sin él, la app funciona igual.
