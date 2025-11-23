// Increment SW_VERSION whenever you want clients to update
const SW_VERSION = 'v3';
const CACHE_NAME = `p2p-file-share-${SW_VERSION}`;
// Precache only the minimal offline shell; avoid caching JS during dev
const PRECACHE_URLS = [
  '/',
  '/manifest.json',
  '/css/style.css'
];

// Install event
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
});

// Fetch event
self.addEventListener('fetch', (event) => {
  const { request } = event;
  // Bypass non-GET and socket.io requests
  if (request.method !== 'GET' || request.url.includes('/socket.io/')) {
    return; // default network
  }

  const destination = request.destination;

  // Network-first for navigation/documents to pick up latest HTML quickly
  if (request.mode === 'navigate' || destination === 'document') {
    event.respondWith(
      fetch(request)
        .then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => { });
          return resp;
        })
        .catch(() => caches.match(request).then(r => r || caches.match('/')))
    );
    return;
  }

  // Network-first for scripts and styles during development to avoid stale code
  if (destination === 'script' || destination === 'style') {
    event.respondWith(
      fetch(request)
        .then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => { });
          return resp;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Cache-first with background refresh for images and other static assets
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => { });
          return resp;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});

// Activate event
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME && cacheName.startsWith('p2p-file-share-')) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});