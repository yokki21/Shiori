# Shiori 栞

Tu colección de cómics en el móvil: escaneas el código de barras, el cómic se añade solo y llevas la cuenta de lo que tienes, lo que has leído y lo que te falta.

App web instalable (PWA) en **https://yokki21.github.io/Shiori/**. Funciona sin conexión y no necesita compilación.

## Qué hace

- **Escanear:** apuntas a la contraportada y se añade con portada, título, serie, número, editorial y precio. Lee ISBN (tomos) e ISSN con el número del suplemento de 2 o 5 cifras (grapas). Si la serie se reconoce pero no el número, eliges el número tocando su portada.
- **Añadir sin cámara:** un buscador que entiende título, ISBN o ISSN, o leer el código desde una foto.
- **Biblioteca:** tus portadas, con buscador y filtro de leídos. Al tocar un cómic ves toda su información y el botón **Marcar como leído**.
- **Series:** cada serie que tienes, qué números, cuántos te faltan y cuánto costaría completarla. Desde ahí puedes añadir los que te falten.
- **Perfil:** cómics, dinero invertido, porcentaje leído, series completas, lo que costaría completar todas, gasto por mes y por editorial. Y los ajustes: añadir automáticamente, copia de seguridad, cuenta.

## De dónde salen los datos

1. **Catálogo propio** (`catalog/catalog.json`): todo Marvel y DC de Panini España, a la venta y agotado, sacado de su web oficial (listados, mapa del sitio y fichas de producto). Cada cómic lleva portada, precio, fecha, páginas y autores; los tomos, su ISBN, y las grapas, el ISSN de su colección y el número. `tools/panini_raw.json` guarda lo recogido y `python3 tools/build_panini.py` regenera el catálogo; `tools/panini_manual.json` añade números que no salen en Panini.
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
       match /users/{uid}/{document=**} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }
     }
   }
   ```

   Así cada usuario solo puede leer y escribir sus propios cómics.
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
