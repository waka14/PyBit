const CACHE_PREFIX = 'pybit-web-assets-';
const CACHE = `${CACHE_PREFIX}__PYBIT_BUILD_VERSION__`;
self.addEventListener('install', (event) => { event.waitUntil(caches.open(CACHE)); /* A waiting worker never interrupts a form submission. */ });
self.addEventListener('activate', (event) => event.waitUntil((async () => { const keys = await caches.keys(); await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE).map((key) => caches.delete(key))); await self.clients.claim(); })()));
self.addEventListener('message', (event) => { if (event.data === 'PYBIT_ACTIVATE_UPDATE') self.skipWaiting(); });
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (event.request.mode === 'navigate') { event.respondWith(fetch(event.request).catch(() => new Response('当前离线，无法提交账本操作。', { status: 503 }))); return; }
  event.respondWith((async () => { const cache = await caches.open(CACHE); const cached = await cache.match(event.request); if (cached) return cached; const response = await fetch(event.request); if (response.ok && new URL(event.request.url).origin === self.location.origin && /\.(?:js|css|svg|png|webp|woff2?)$/i.test(new URL(event.request.url).pathname)) cache.put(event.request, response.clone()); return response; })());
});
