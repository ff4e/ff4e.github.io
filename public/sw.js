/*
 * Minimal offline app-shell service worker for Fish Fillets 4ever.
 *
 * Goal (P2): make the site an installable PWA — the prerequisite for wrapping it
 * into an Xbox / Windows MSIX with PWABuilder — and give a resilient offline shell.
 * It deliberately caches only the small app shell (HTML / hashed JS+CSS / fonts /
 * icons / enhanced art), NOT the ~365 MB /data/ game assets (those stay network-only
 * so the cache can't balloon). Kept dependency-free and hand-written; regenerate/bump
 * CACHE_VERSION when the shell strategy changes.
 *
 * Strategy:
 *   - navigations (mode: 'navigate')  -> network-first, fall back to cached index.html
 *   - other same-origin GETs          -> stale-while-revalidate (serve cache, refresh)
 *   - /data/ and cross-origin         -> passthrough (untouched)
 */
const CACHE_VERSION = 'ff4e-shell-v1';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((c) => c.addAll(SHELL))
      .catch(() => {}) // a missing shell entry must never block activation
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isCacheableAsset(url) {
  if (url.origin !== self.location.origin) return false; // cross-origin: passthrough
  if (url.pathname.startsWith('/data/')) return false; // huge game data: network-only
  return true;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // App navigations: network-first, offline fallback to the cached shell.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put('/index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('/index.html').then((r) => r || caches.match('/'))),
    );
    return;
  }

  if (!isCacheableAsset(url)) return; // passthrough (game data, cross-origin)

  // Everything else: stale-while-revalidate.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
