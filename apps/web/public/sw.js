// EngineX Draw service worker.
//
// Scope is deliberately small: this app is a live Firestore-backed
// drawing tool, not a static site, so the service worker's job is just
// two things —
//   1. Make the app installable (a "fetch" handler is what makes Chrome/
//      Edge/Android treat the manifest as a real, installable PWA rather
//      than just a bookmark-with-an-icon).
//   2. Cache the app shell (static JS/CSS/icons Next.js emits) so a
//      repeat launch is fast and the icon/manifest/basic navigation
//      still resolve when briefly offline — it deliberately does NOT
//      try to cache or replay Firestore reads/writes, project data, or
//      any /api or Firebase traffic, since serving stale project
//      geometry or silently dropping a write would be actively unsafe
//      for a CAD tool. Network-first for everything not in the
//      precache list, falling back to cache only if the network is
//      truly unreachable.
const CACHE_VERSION = 'enginexdraw-shell-v1';
const APP_SHELL = [
  '/manifest.json',
  '/favicon.ico',
  '/apple-touch-icon.png',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)).catch(() => {
      // Best-effort — a single missing asset shouldn't block install.
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // never intercept writes

  const url = new URL(request.url);
  // Leave Firebase/Firestore/Google API traffic (and anything cross-origin)
  // strictly alone — always hit the network, no caching, no fallback.
  if (url.origin !== self.location.origin) return;
  // Leave Next's data/RSC routes and API routes alone too — same reasoning.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/_next/data/')) return;

  // Static, hashed Next.js build assets: cache-first, since a hashed
  // filename only ever refers to one immutable version of that file.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
            return response;
          })
      )
    );
    return;
  }

  // Everything else (pages, manifest, icons): network-first, falling
  // back to cache only when the network genuinely fails — keeps project
  // pages from ever serving stale HTML while still giving something
  // (the shell) if the person briefly loses signal.
  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request))
  );
});
