// Organizator – offline support. App shell is served from the cache and refreshed in the background.
// VERSION is stamped by the Pages workflow on every deploy so iPhones pick up updates.
const VERSION = "org-1.0.0";
const ASSETS = [
  "./", "index.html", "styles.css", "manifest.webmanifest",
  "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png",
  "js/app.js", "js/model.js", "js/store.js", "js/ui.js", "js/theme.js", "js/dnd.js",
  "js/views/shared.js", "js/views/home.js", "js/views/board.js", "js/views/card.js", "js/views/labels.js", "js/views/settings.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("org-") && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    caches.open(VERSION).then((cache) =>
      cache.match(e.request, { ignoreSearch: true }).then((hit) => {
        const net = fetch(e.request)
          .then((res) => {
            if (res.ok) cache.put(e.request, res.clone());
            return res;
          })
          .catch(() => hit || cache.match("index.html"));
        return hit || net;
      }),
    ),
  );
});
