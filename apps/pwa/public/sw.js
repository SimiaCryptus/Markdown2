// Barebones offline support: network first, cache fallback, same-origin GETs only.
// Remote `uri` resources are cross-origin and are never cached here.
const CACHE = 'm2-v8';
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
  '/docs/maps.md',
  '/docs/charts.md',
  '/docs/community.md',
  '/docs/data/planets.csv',
];

self.addEventListener('install', (event) => {
  // One file at a time: a single missing file must not leave the whole shell uncached.
  event.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(SHELL.map((u) => c.add(u)))));
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
        const hit = await caches.match(req, { ignoreSearch: req.mode === 'navigate' });
        if (hit) return hit;
        if (req.mode === 'navigate') {
          const shell = (await caches.match('/index.html')) ?? (await caches.match('/'));
          if (shell) return shell;
          return new Response(
            '<!doctype html><meta charset="utf-8"><title>Offline</title><p>Markdown2 is offline and has not been cached yet. Reconnect and reload.</p>',
            { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } },
          );
        }
        return Response.error();
      }),
  );
});