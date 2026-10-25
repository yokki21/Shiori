// Service worker: la app abre sin conexión y con mala cobertura.
// Archivos propios: red primero con límite de 2,5 s; si tarda o falla, la copia guardada.
// No se guardan imágenes de otras webs: el navegador las cuenta como ~7 MB cada una.
const VERSION = 'shiori-v27';
const SHELL = [
  './', 'index.html', 'css/styles.css', 'manifest.webmanifest', 'catalog/catalog.json',
  'js/app.js', 'js/util.js', 'js/store.js', 'js/db.js', 'js/sync.js', 'js/config.js',
  'js/catalog.js', 'js/series.js', 'js/comic.js', 'js/scan.js', 'js/scanner.js', 'js/ean.js', 'js/lookup.js',
  'js/decoder-worker.js', 'js/views/library.js', 'js/views/series.js', 'js/views/profile.js', 'js/views/wish.js', 'js/views/upcoming.js', 'js/views/search.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/favicon.svg', 'icons/apple-touch-icon.png',
];
const FONTS = 'shiori-fonts';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION)
    .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== FONTS).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(FONTS).then(async (cache) => {
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    }).catch(() => new Response('', { status: 404 })));
    return;
  }
  if (url.origin !== location.origin) return;

  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const net = fetch(req, { cache: 'no-cache' }).then((res) => {
      if (res.ok && !url.search) cache.put(req, res.clone());
      return res;
    });
    try {
      return await Promise.race([net, timeout(2500)]);
    } catch {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      try { return await net; } catch { return (await cache.match('index.html')) || Response.error(); }
    }
  })());
});
