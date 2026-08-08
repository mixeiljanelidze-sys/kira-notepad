const CACHE_NAME = 'kira-notepad-v5';
const ASSETS = [
  './',
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
  e.waitUntil(
    caches.open(CACHE_NAME).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.url.includes('ntfy.sh') || e.request.url.includes('supabase.co')) return;

  // Network first strategy for app code so updates apply immediately on Android / PWA
  e.respondWith(
    fetch(e.request)
      .then((networkRes) => {
        if (networkRes && networkRes.status === 200 && e.request.method === 'GET') {
          const clone = networkRes.clone();
          caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
        }
        return networkRes;
      })
      .catch(() => caches.match(e.request))
  );
});
