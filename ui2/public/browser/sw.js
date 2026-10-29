// Filled by tools/build-browser.mjs with the exact hashed output assets.
const CACHE = 'brainflow-browser-APP_CACHE_VERSION';
const ASSETS = /* APP_ASSETS */ [];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});
// A new version waits until every old viewer is closed. Never reload a viewer
// with loaded data, including another window sharing this service worker.
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('brainflow-browser-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  // No runtime cache: local files, network datasets and unrelated pages never enter it.
  event.respondWith(caches.open(CACHE).then(cache => cache.match(event.request).then(hit => hit || fetch(event.request))));
});
