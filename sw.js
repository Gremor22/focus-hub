const CACHE_VERSION = 'dev';
const CACHE_NAME = `focus-hub-shell-${CACHE_VERSION}`;
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './state.js',
  './render.js',
  './actions.js',
  './manifest.webmanifest',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png',
  './firebase-messaging-sw.js'
];
const STATIC_ASSET_PATHS = new Set(APP_SHELL.map((path) => new URL(path, self.location.origin).pathname));

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

function isApiRequest(url) {
  return url.pathname === '/api' || url.pathname.startsWith('/api/');
}

function isStaticAssetRequest(url) {
  return STATIC_ASSET_PATHS.has(url.pathname);
}

function isNavigationRequest(request) {
  return request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html');
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || isApiRequest(url)) return;

  if (isNavigationRequest(request)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', clone)).catch(() => {});
          }
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  if (!isStaticAssetRequest(url)) return;

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request)
      .then((response) => {
        if (!response.ok) return response;
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone)).catch(() => {});
        return response;
      }))
  );
});
