// Service worker: la app funciona sin conexión (salvo la búsqueda de datos).
const VERSION = 'shiori-v1';
const SHELL = [
  './', 'index.html', 'css/styles.css', 'manifest.webmanifest',
  'js/app.js', 'js/db.js', 'js/ean.js', 'js/lookup.js', 'js/scanner.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/favicon.svg', 'icons/apple-touch-icon.png',
];
const COVERS = 'shiori-covers';
const FONTS = 'shiori-fonts';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((k) => k.startsWith('shiori-v') && k !== VERSION).map((k) => caches.delete(k)),
  )).then(() => self.clients.claim()));
});

async function cacheFirst(req, name, max) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') {
    cache.put(req, res.clone());
    if (max) cache.keys().then((k) => { if (k.length > max) cache.delete(k[0]); });
  }
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Datos de búsqueda: siempre a la red
  if (url.hostname === 'www.googleapis.com' || (url.hostname === 'openlibrary.org' && url.pathname.startsWith('/api'))) return;

  // Portadas: se guardan para verlas sin conexión
  if (req.destination === 'image' && url.origin !== location.origin) {
    e.respondWith(cacheFirst(req, COVERS, 3000).catch(() => new Response('', { status: 404 })));
    return;
  }
  // Tipografías
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(cacheFirst(req, FONTS).catch(() => new Response('', { status: 404 })));
    return;
  }
  // App: primero la caché y se actualiza por detrás
  if (url.origin === location.origin) {
    e.respondWith(caches.open(VERSION).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: true });
      const net = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
      return hit || (await net) || cache.match('index.html');
    }));
  }
});
