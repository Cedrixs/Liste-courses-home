const CACHE_NAME = 'liste-courses-v7';
const SHELL_FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './config.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-192-maskable.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

const ORIGINES_MISES_EN_CACHE = [self.location.origin, 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'];

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (!ORIGINES_MISES_EN_CACHE.includes(url.origin)) return; // ne pas intercepter les appels vers Apps Script

  // Réseau d'abord (pour toujours servir la dernière version quand la connexion est bonne),
  // avec repli sur le cache local si hors ligne.
  event.respondWith(
    fetch(event.request)
      .then(res => {
        const copie = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copie));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
