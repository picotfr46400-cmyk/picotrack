// PicoTrack Service Worker — V19 anti-cache obsolète
// Objectif : ne jamais servir une ancienne version de l'application après un déploiement Vercel.
const CACHE = 'picotrack-v23-static';
const ASSETS = ['./logo-picotrack.png', './manifest.json'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => Promise.allSettled(ASSETS.map(asset => cache.add(asset))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.hostname.includes('supabase.co')) return;

  // HTML/CSS/JS : réseau obligatoire pour éviter les anciennes versions.
  if (req.mode === 'navigate' || /\.(html|js|css)(\?|$)/.test(url.pathname)) {
    event.respondWith(fetch(req));
    return;
  }

  // Assets : réseau puis cache en secours.
  event.respondWith(fetch(req).catch(() => caches.match(req)));
});
