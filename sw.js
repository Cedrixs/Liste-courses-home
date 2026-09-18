const CACHE_NAME = 'liste-courses-v11';
const SHELL_FILES = [
  './',
  './index.html',
  './style.css',
  './app-base.js',
  './app-sync.js',
  './app-recettes.js',
  './app.js',
  './config.js',
  './recettes.js',
  './recettes-catalogue.js',
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
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (!ORIGINES_MISES_EN_CACHE.includes(url.origin)) return; // ne pas intercepter les appels vers Apps Script

  // Réseau d'abord (pour toujours servir la dernière version quand la connexion est bonne),
  // avec repli sur le cache local si hors ligne. Seules les réponses valables
  // sont mises en cache (une page d'erreur ne doit pas remplacer un fichier sain) ;
  // les réponses « opaques » (feuille de style Google Fonts) le sont aussi, sinon
  // les polices manqueraient hors ligne.
  event.respondWith(
    fetch(request)
      .then(res => {
        if (res.ok || res.type === 'opaque') {
          const copie = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copie));
        }
        return res;
      })
      .catch(async () => {
        const enCache = await caches.match(request, { ignoreSearch: true });
        if (enCache) return enCache;
        // Ouverture de l'appli hors ligne via une adresse non mise en cache
        // (paramètres dans l'URL, par exemple) : on sert la page principale.
        if (request.mode === 'navigate') return caches.match('./index.html');
        return undefined;
      })
  );
});
