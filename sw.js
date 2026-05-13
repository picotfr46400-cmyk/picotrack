// ══ PicoTrack Service Worker — Cache offline ══
const CACHE = 'picotrack-v2';
const ASSETS = [
  './', './index.html', './style.css', './pad.css', './logo-picotrack.png', './manifest.json',
  './pad-mode.js', './js/core/data.js', './js/core/supabase.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(ASSETS.map(a => c.add(a))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  // Supabase/API et requêtes non GET → réseau uniquement
  if (e.request.method !== 'GET' || e.request.url.includes('supabase.co') || e.request.url.includes('/rest/v1/')) return;

  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      return res;
    })).catch(() => caches.match('./index.html'))
  );
});

self.addEventListener('sync', e => {
  if (e.tag === 'sync-forms') e.waitUntil(syncPending());
});
async function syncPending() { console.log('[SW] sync formulaires → Phase 2'); }
