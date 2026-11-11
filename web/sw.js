/**
 * MP3-Aigis — Service Worker for Offline Playlist & Asset Resilience
 */
const CACHE_NAME = 'mp3-aigis-v1.0.0';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/base-liquid-glass.css',
  '/css/themes.css',
  '/js/color-extractor.js',
  '/js/audio-engine.js',
  '/js/offline-sync.js',
  '/js/app.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  // Network-first with offline cache fallback for API playlists/home/streams
  if (request.url.includes('/api/')) {
    event.respondWith(
      fetch(request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(request, clone));
          return res;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Cache-first for UI shell
  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request))
  );
});
