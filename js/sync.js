// Cuentas y sincronización en la nube con Firebase (Authentication + Firestore).
//
// La biblioteca sigue viviendo en el dispositivo (IndexedDB) para funcionar sin
// conexión; con la sesión iniciada, cada cambio se copia a la cuenta y los
// cambios hechos en otros dispositivos llegan en tiempo real.
//
// Datos en Firestore:
//   users/{uid}/comics/{id}    un documento por cómic (borrados: { deleted: true })
//   users/{uid}/series/{key}   datos de serie (total de tomos, terminada)
// Conflictos: gana la versión con `updatedAt` más reciente.

import { FIREBASE_CONFIG } from './config.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';

export const syncAvailable = !!(FIREBASE_CONFIG && FIREBASE_CONFIG.apiKey);

let fb = null; // módulos de Firebase
let auth = null;
let fs = null;
let user = null;
let hooks = {};
let unsubs = [];

// hooks: { onUser(user), onStatus(texto), getLocal(), applyComic(c), applyDelete(id), applySeries(meta) }
export async function initSync(h) {
  hooks = h;
  if (!syncAvailable) return;
  try {
    const [app, a, f] = await Promise.all([
      import(`${SDK}/firebase-app.js`),
      import(`${SDK}/firebase-auth.js`),
      import(`${SDK}/firebase-firestore.js`),
    ]);
    fb = { ...app, ...a, ...f };
    const instance = fb.initializeApp(FIREBASE_CONFIG);
    auth = fb.getAuth(instance);
    fs = fb.getFirestore(instance);
    fb.onAuthStateChanged(auth, async (u) => {
      user = u;
      hooks.onUser?.(u);
      stopListening();
      if (u) await startSync();
    });
  } catch (e) {
    console.warn('No se ha podido cargar Firebase', e);
    hooks.onStatus?.('No se ha podido conectar con el servidor de cuentas.');
  }
}

export const currentUser = () => user;

// ---------- Acceso ----------
const AUTH_ERRORS = {
  'auth/invalid-email': 'Ese correo no es válido.',
  'auth/missing-password': 'Escribe la contraseña.',
  'auth/weak-password': 'La contraseña tiene que tener al menos 6 caracteres.',
  'auth/email-already-in-use': 'Ya hay una cuenta con ese correo. Pulsa «Entrar».',
  'auth/invalid-credential': 'Correo o contraseña incorrectos.',
  'auth/wrong-password': 'Correo o contraseña incorrectos.',
  'auth/user-not-found': 'No hay ninguna cuenta con ese correo. Pulsa «Crear cuenta».',
  'auth/too-many-requests': 'Demasiados intentos. Espera un poco y vuelve a probar.',
  'auth/network-request-failed': 'Sin conexión. Inténtalo cuando tengas internet.',
  'auth/popup-closed-by-user': 'Has cerrado la ventana de Google antes de terminar.',
  'auth/popup-blocked': 'El navegador ha bloqueado la ventana de Google. Usa correo y contraseña.',
  'auth/operation-not-supported-in-this-environment': 'Aquí no se puede entrar con Google. Usa correo y contraseña.',
};
export const authMessage = (e) => AUTH_ERRORS[e?.code] || 'No se ha podido completar. Vuelve a intentarlo.';

export async function signUp(email, pass) {
  await fb.createUserWithEmailAndPassword(auth, email, pass);
}
export async function signIn(email, pass) {
  await fb.signInWithEmailAndPassword(auth, email, pass);
}
export async function signInGoogle() {
  await fb.signInWithPopup(auth, new fb.GoogleAuthProvider());
}
export async function resetPassword(email) {
  await fb.sendPasswordResetEmail(auth, email);
}
export async function signOutUser() {
  stopListening();
  await fb.signOut(auth);
}

// ---------- Sincronización ----------
const clean = (o) => JSON.parse(JSON.stringify(o)); // Firestore no acepta undefined
const comicsCol = () => fb.collection(fs, 'users', user.uid, 'comics');
const seriesCol = () => fb.collection(fs, 'users', user.uid, 'series');
const seriesId = (key) => encodeURIComponent(key).slice(0, 700) || '_';

async function startSync() {
  hooks.onStatus?.('Sincronizando…');
  try {
    const local = hooks.getLocal();
    const [cSnap, sSnap] = await Promise.all([fb.getDocs(comicsCol()), fb.getDocs(seriesCol())]);
    const remote = new Map(cSnap.docs.map((d) => [d.id, d.data()]));
    const localById = new Map(local.comics.map((c) => [c.id, c]));
    const writes = [];
    let down = 0;

    for (const [id, r] of remote) {
      const l = localById.get(id);
      const tomb = local.deleted[id];
      if (tomb && tomb >= (r.updatedAt || 0) && !r.deleted) { writes.push([fb.doc(comicsCol(), id), { deleted: true, updatedAt: tomb }]); continue; }
      if (!l || (r.updatedAt || 0) > (l.updatedAt || 0)) {
        if (r.deleted) { if (l) { await hooks.applyDelete(id); down++; } } else { await hooks.applyComic(r); down++; }
      } else if ((l.updatedAt || 0) > (r.updatedAt || 0)) {
        writes.push([fb.doc(comicsCol(), id), clean(l)]);
      }
    }
    for (const l of local.comics) if (!remote.has(l.id)) writes.push([fb.doc(comicsCol(), l.id), clean(l)]);
    for (const [id, t] of Object.entries(local.deleted)) if (!remote.has(id) && !localById.has(id)) writes.push([fb.doc(comicsCol(), id), { deleted: true, updatedAt: t }]);

    const rSeries = new Map(sSnap.docs.map((d) => [d.data().key, d.data()]));
    for (const [key, r] of rSeries) {
      const l = local.series.get(key);
      if (!l || (r.updatedAt || 0) > (l.updatedAt || 0)) await hooks.applySeries(r);
      else if ((l.updatedAt || 0) > (r.updatedAt || 0)) writes.push([fb.doc(seriesCol(), seriesId(key)), clean(l)]);
    }
    for (const [key, l] of local.series) if (!rSeries.has(key)) writes.push([fb.doc(seriesCol(), seriesId(key)), clean({ ...l, updatedAt: l.updatedAt || Date.now() })]);

    // Firestore admite hasta 500 escrituras por lote
    for (let i = 0; i < writes.length; i += 400) {
      const batch = fb.writeBatch(fs);
      for (const [ref, val] of writes.slice(i, i + 400)) batch.set(ref, val);
      await batch.commit();
    }
    hooks.onSynced?.({ down, up: writes.length });
    hooks.onStatus?.('Todo guardado en tu cuenta.');
    listen();
  } catch (e) {
    console.warn('Error al sincronizar', e);
    hooks.onStatus?.(e?.code === 'permission-denied'
      ? 'El servidor ha rechazado los datos: revisa las reglas de Firestore.'
      : 'No se ha podido sincronizar. Se reintentará al volver a abrir la app.');
  }
}

// Cambios que llegan de otros dispositivos
function listen() {
  unsubs.push(fb.onSnapshot(comicsCol(), (snap) => {
    for (const ch of snap.docChanges()) {
      if (ch.doc.metadata.hasPendingWrites) continue; // es un cambio nuestro
      const r = ch.doc.data();
      const l = hooks.getLocal().comics.find((c) => c.id === ch.doc.id);
      if (l && (l.updatedAt || 0) >= (r.updatedAt || 0)) continue;
      if (r.deleted) { if (l) hooks.applyDelete(ch.doc.id); } else hooks.applyComic(r);
    }
  }, () => hooks.onStatus?.('Se ha perdido la conexión con tu cuenta. Los cambios se guardan en el móvil.')));
  unsubs.push(fb.onSnapshot(seriesCol(), (snap) => {
    for (const ch of snap.docChanges()) {
      if (ch.doc.metadata.hasPendingWrites) continue;
      const r = ch.doc.data();
      const l = hooks.getLocal().series.get(r.key);
      if (!l || (r.updatedAt || 0) > (l.updatedAt || 0)) hooks.applySeries(r);
    }
  }));
}

function stopListening() {
  unsubs.forEach((u) => u());
  unsubs = [];
}

// Escrituras sueltas (las llama la app al guardar o borrar)
function write(ref, val) {
  if (!user) return;
  fb.setDoc(ref, val).catch((e) => {
    console.warn('No se ha podido guardar en la nube', e);
    hooks.onStatus?.('Hay cambios sin subir a tu cuenta. Se subirán al volver a abrir la app.');
  });
}
export function pushComic(c) { if (user) write(fb.doc(comicsCol(), c.id), clean(c)); }
export function pushDelete(id, at) { if (user) write(fb.doc(comicsCol(), id), { deleted: true, updatedAt: at }); }
export function pushSeries(meta) { if (user) write(fb.doc(seriesCol(), seriesId(meta.key)), clean(meta)); }
