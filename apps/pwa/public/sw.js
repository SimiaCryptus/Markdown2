// Barebones offline support: network first, cache fallback, same-origin GETs only.
// Remote `uri` resources are cross-origin and are never cached here.
const CACHE = 'm2-v5';
const SHELL = [
   '/',
   '/index.html',
   '/manifest.webmanifest',
   '/icon.svg',
   '/docs/index.md',
   '/docs/guide.md',
   '/docs/markdown.md',
   '/docs/resources.md',
   '/docs/trust.md',
   '/docs/styles.md',
   '/docs/developer.md',
   '/docs/embeds.md',
    '/docs/tables.md',
    '/docs/community.md',
    '/docs/data/planets.csv',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          void caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(req);
        if (hit) return hit;
        if (req.mode === 'navigate') {
          const shell = await caches.match('/index.html');
          if (shell) return shell;
        }
        return Response.error();
      }),
  );
});