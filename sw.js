const CACHE='picotrack-v40-client-global-split-v28';
self.addEventListener('install',event=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(
  caches.keys().then(keys=>Promise.all(keys.map(key=>caches.delete(key)))).then(()=>self.clients.claim())
));
self.addEventListener('fetch',event=>{
  const req=event.request;
  const url=new URL(req.url);
  if(url.pathname.startsWith('/api/')) return;
  event.respondWith(fetch(req,{cache:'no-store'}).catch(()=>caches.match(req)));
});
