// Configuración pública de Shiori (no pongas aquí nada secreto: el repositorio es público).

// Dirección del intermediario de Cloudflare que consulta la base de datos de
// libros editados en España (Agencia del ISBN). Ver worker/isbn-espana.js y el README.
// Vacío = no se usa esa fuente.
export const MINISTRY_URL = '';

// Configuración web de Firebase para las cuentas y la sincronización en la nube.
// Se copia de la consola de Firebase (Configuración del proyecto → Tus apps → Web).
// No es secreta: lo que protege los datos son las reglas de Firestore (ver README).
// null = cuentas desactivadas.
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyC9BLFp1_MEy5BXcA0-dGNlmZk45Q3anMA',
  authDomain: 'shiori-9beb6.firebaseapp.com',
  projectId: 'shiori-9beb6',
  storageBucket: 'shiori-9beb6.firebasestorage.app',
  messagingSenderId: '477177297918',
  appId: '1:477177297918:web:b9a939bc6c0b956a9adeaf',
};
