/* Filmstrip service worker.
   App shell is cached so the thing opens with no connection. Posters are
   fetched from TMDB and cached opportunistically as you encounter them. */

const SHELL = "filmstrip-shell-v1";
const IMAGES = "filmstrip-posters-v1";

const SHELL_FILES = [
  "./",
  "./index.html",
  "./app.js",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== SHELL && k !== IMAGES).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;

  // Posters: serve from cache if we've seen them, otherwise fetch and keep a copy.
  if (url.hostname === "image.tmdb.org") {
    e.respondWith(
      caches.open(IMAGES).then(async (cache) => {
        const hit = await cache.match(e.request);
        if (hit) return hit;
        try {
          const res = await fetch(e.request);
          if (res.ok) cache.put(e.request, res.clone());
          return res;
        } catch {
          return new Response("", { status: 504 });
        }
      })
    );
    return;
  }

  // App shell: cache first, network as backup, so it opens offline.
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.match(e.request).then((hit) => hit || fetch(e.request))
    );
  }
});
