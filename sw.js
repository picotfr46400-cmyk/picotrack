// PicoTrack Service Worker — simple et robuste
const CACHE = 'picotrack-v2';
const ASSETS = ['./','./index.html','./style.css','./pad.css','./logo-picotrack.png','./manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(ASSETS.map(a => c.add(a))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.hostname.includes('supabase.co')) return;
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request).then(r => r || caches.match('./index.html'))));
});
