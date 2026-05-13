// ══ PicoTrack Service Worker — Cache offline ══
const CACHE = 'picotrack-v1';
const ASSETS = [
  './', './index.html', './style.css', './logo-picotrack.png', './manifest.json',
  './js/core/environments.js', './js/core/licenses.js', './js/core/data.js',
  './js/features/pad-mode.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  // API → réseau uniquement
  if (e.request.url.includes('/api/')) return;
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    })).catch(() => caches.match('./index.html'))
  );
});

// Sync des formulaires saisis hors-ligne (Phase 2 avec backend)
self.addEventListener('sync', e => {
  if (e.tag === 'sync-forms') e.waitUntil(syncPending());
});
async function syncPending() { console.log('[SW] sync formulaires → Phase 2'); }
