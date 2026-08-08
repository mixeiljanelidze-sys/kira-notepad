const CACHE = 'kira-notepad-v2';
const ASSETS = [
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './storageService.js',
  './ntfyService.js',
  './notepadService.js',
  './configService.js',
  './webhookService.js',
  './supabaseService.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.url.includes('ntfy.sh')) return; // never cache live hook traffic
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request))
  );
});
