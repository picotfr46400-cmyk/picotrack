const CACHE = 'picotrack-shell-20261008d';
const SHELL = [
  '/',
  '/index.html',
  '/style.css',
  '/pad.css',
  '/manifest.json',
  '/logo-picotrack.png',
  '/favicon.ico',
  '/pad-device.js?v=20261008a',
  '/assets/app.secured.js?v=20261008a',
  '/assets/core-supervision.js?v=20261008a',
  '/assets/offline-sync.js?v=20261008d',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  'https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js',
  'https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.production.min.js'
];

function sameOriginStatic(url) {
  return url.origin === self.location.origin && !url.pathname.startsWith('/api/');
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(SHELL.map(async url => {
      try { await cache.add(url); } catch (_) {}
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) return;
  const cacheable = sameOriginStatic(url) || url.origin === 'https://cdn.jsdelivr.net';
  if (!cacheable) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok) await cache.put(req, fresh.clone());
      return fresh;
    } catch (err) {
      const cached = await cache.match(req) || (req.mode === 'navigate' ? (await cache.match('/index.html') || await cache.match('/')) : null);
      if (cached) return cached;
      throw err;
    }
  })());
});
