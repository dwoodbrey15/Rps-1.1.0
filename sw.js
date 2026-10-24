const PREFIX = 'pattern-rps-' + new URL(self.registration.scope).pathname + '-';
const CACHE = PREFIX + '1.1.0';
const FILES = ['./', './index.html', './style.css', './app.js', './model.js', './worker.js', './manifest.webmanifest', './icon.svg', './icon-180.png', './icon-192.png', './icon-512.png'];
const urls = FILES.map(f => new URL(f, self.registration.scope).href);
self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  await cache.addAll(urls.map(url => new Request(url, {cache: 'reload'})));
  await self.skipWaiting();
})()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== CACHE).map(k => caches.delete(k)));
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (event.request.mode === 'navigate') {
      try { const response = await fetch(event.request); if (response.ok) return response; } catch {}
      return await cache.match(new URL('./index.html', self.registration.scope).href) || Response.error();
    }
    return await cache.match(event.request, {ignoreSearch: true}) || fetch(event.request);
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type === 'CHECK_OFFLINE') event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const present = await Promise.all(urls.map(url => cache.match(url)));
    event.ports[0]?.postMessage({ready: present.every(Boolean)});
  })());
});
