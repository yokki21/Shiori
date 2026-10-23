// Firebase Auth simulado para las pruebas.
const KEY = 'fakeauth';
const listeners = [];
const users = () => JSON.parse(localStorage.getItem('fakeusers') || '{}');
function setUser(u) { if (u) localStorage.setItem(KEY, JSON.stringify(u)); else localStorage.removeItem(KEY); listeners.forEach((f) => f(u)); }
export function getAuth() { return {}; }
export function onAuthStateChanged(a, f) { listeners.push(f); setTimeout(() => f(JSON.parse(localStorage.getItem(KEY) || 'null')), 0); }
export async function createUserWithEmailAndPassword(a, email, pass) {
  const us = users();
  if (us[email]) throw { code: 'auth/email-already-in-use' };
  if (pass.length < 6) throw { code: 'auth/weak-password' };
  us[email] = { pass, uid: 'u_' + email.replace(/\W/g, '') };
  localStorage.setItem('fakeusers', JSON.stringify(us));
  setUser({ uid: us[email].uid, email });
}
export async function signInWithEmailAndPassword(a, email, pass) {
  const u = users()[email];
  if (!u || u.pass !== pass) throw { code: 'auth/invalid-credential' };
  setUser({ uid: u.uid, email });
}
export async function signInWithPopup() { throw { code: 'auth/popup-blocked' }; }
export class GoogleAuthProvider {}
export async function sendPasswordResetEmail() {}
export async function signOut() { setUser(null); }
