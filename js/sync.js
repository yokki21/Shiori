// Cuentas y sincronización en la nube con Firebase (Authentication + Firestore).
//
// La biblioteca vive en el dispositivo (IndexedDB) y funciona sin conexión;
// con la sesión iniciada, cada cambio se copia a la cuenta y los cambios de
// otros dispositivos llegan en tiempo real.
//
// Datos en Firestore:
//   users/{uid}/comics/{id}    un documento por cómic (borrados: { deleted: true })
//   users/{uid}/series/{key}   datos de serie (total de tomos, terminada)
// Conflictos: gana la versión con `updatedAt` más reciente.
// Al abrir la app solo se descargan los cambios desde la última vez.

import { FIREBASE_CONFIG } from './config.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';
const MARGIN = 5 * 60 * 1000; // margen por si los relojes de los dispositivos no coinciden

export const syncAvailable = !!(FIREBASE_CONFIG && FIREBASE_CONFIG.apiKey);

let fb = null;
let auth = null;
let fs = null;
let user = null;
let hooks = {};
let unsubs = [];

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
      stopListening();
      user = u;
      if (u) await hooks.beforeSync?.(u);
      hooks.onUser?.(u);
      if (u) await startSync();
    });
  } catch (e) {
    console.warn('No se ha podido cargar Firebase', e);
    hooks.onStatus?.('No se ha podido conectar con el servidor de cuentas.');
  }
}

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

export const signUp = (email, pass) => fb.createUserWithEmailAndPassword(auth, email, pass);
export const signIn = (email, pass) => fb.signInWithEmailAndPassword(auth, email, pass);
export const signInGoogle = () => fb.signInWithPopup(auth, new fb.GoogleAuthProvider());
export const resetPassword = (email) => fb.sendPasswordResetEmail(auth, email);
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
  const uid = user.uid;
  const since = await hooks.getLastSync(uid);
  const q = since ? fb.query(comicsCol(), fb.where('updatedAt', '>', since - MARGIN)) : comicsCol();
  let first = true;
  let newest = since;

  // Un solo listener: su primera respuesta son los cambios desde la última vez,
  // y las siguientes, lo que se cambie en otros dispositivos mientras la app está abierta
  unsubs.push(fb.onSnapshot(q, async (snap) => {
    try {
      const local = hooks.getLocal();
      const localById = new Map(local.comics.map((c) => [c.id, c]));
      const remoteIds = new Set();
      let down = 0;
      const changes = first ? snap.docs.map((d) => ({ doc: d })) : snap.docChanges().filter((ch) => ch.type !== 'removed');
      for (const { doc } of changes) {
        if (doc.metadata?.hasPendingWrites) continue; // es un cambio nuestro
        const r = doc.data();
        remoteIds.add(doc.id);
        newest = Math.max(newest, r.updatedAt || 0);
        const l = localById.get(doc.id);
        const tomb = local.deleted[doc.id];
        if (tomb && tomb >= (r.updatedAt || 0)) continue;
        if (l && (l.updatedAt || 0) >= (r.updatedAt || 0)) continue;
        if (r.deleted) { if (l) { await hooks.applyDelete(doc.id); down++; } } else { await hooks.applyComic(r); down++; }
      }
      if (first) {
        first = false;
        // Sube lo que este dispositivo tenga más nuevo que la nube
        const writes = [];
        const remote = new Map(snap.docs.map((d) => [d.id, d.data()]));
        for (const l of local.comics) {
          if ((l.updatedAt || 0) > since - MARGIN || !since) {
            const r = remote.get(l.id);
            if (!r || (l.updatedAt || 0) > (r.updatedAt || 0)) writes.push([fb.doc(comicsCol(), l.id), clean(l)]);
          }
        }
        for (const [id, t] of Object.entries(local.deleted)) {
          if (t > since - MARGIN || !since) writes.push([fb.doc(comicsCol(), id), { deleted: true, updatedAt: t }]);
        }
        for (let i = 0; i < writes.length; i += 400) {
          const batch = fb.writeBatch(fs);
          for (const [ref, val] of writes.slice(i, i + 400)) batch.set(ref, val);
          await batch.commit();
        }
        await syncSeries();
        hooks.onSynced?.({ down, up: writes.length });
        hooks.onStatus?.('Todo guardado en tu cuenta.');
      } else if (down) {
        hooks.onStatus?.('Cambios recibidos de otro dispositivo.');
      }
      await hooks.setLastSync(uid, Math.max(newest, Date.now() - MARGIN));
    } catch (e) {
      console.warn('Error al sincronizar', e);
      hooks.onStatus?.(e?.code === 'permission-denied'
        ? 'El servidor ha rechazado los datos: revisa las reglas de Firestore.'
        : 'No se ha podido sincronizar. Se reintentará al volver a abrir la app.');
    }
  }, () => hooks.onStatus?.('Sin conexión con tu cuenta. Los cambios se guardan en el móvil y se subirán después.')));
}

// Las series son pocas: se comparan enteras
async function syncSeries() {
  const local = hooks.getLocal();
  const snap = await fb.getDocs(seriesCol());
  const remote = new Map(snap.docs.map((d) => [d.data().key, d.data()]));
  for (const [key, r] of remote) {
    const l = local.series.get(key);
    if (!l || (r.updatedAt || 0) > (l.updatedAt || 0)) await hooks.applySeries(r);
  }
  for (const [key, l] of local.series) {
    const r = remote.get(key);
    if (!r || (l.updatedAt || 0) > (r.updatedAt || 0)) await fb.setDoc(fb.doc(seriesCol(), seriesId(key)), clean({ ...l, updatedAt: l.updatedAt || Date.now() }));
  }
}

function stopListening() {
  unsubs.forEach((u) => u());
  unsubs = [];
}

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
