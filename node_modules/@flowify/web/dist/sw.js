self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isNavigation = request.mode === 'navigate' || request.destination === 'document';
  const isAppShell = isSameOrigin && (isNavigation || url.pathname.endsWith('/index.html'));
  const isFreshAppAsset = isSameOrigin && (
    url.pathname.endsWith('/assets/index.js') ||
    url.pathname.endsWith('/assets/index.css') ||
    url.pathname.endsWith('/flowify-config.json') ||
    url.pathname.endsWith('/manifest.webmanifest')
  );

  if (!isAppShell && !isFreshAppAsset) return;

  event.respondWith(
    fetch(new Request(request, { cache: 'no-store' })).catch(() => fetch(request)),
  );
});
