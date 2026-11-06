// Offline support: cache-first for the app shell, versioned.
const VERSION = "uv-1.0.0-1";
const ASSETS = [
  "./", "index.html", "styles.css", "manifest.webmanifest",
  "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png",
  "js/app.js", "js/store.js",
  "js/ui/kit.js", "js/ui/common.js", "js/ui/code-editor.js", "js/ui/editors.js", "js/ui/views-main.js", "js/ui/views-workflow.js",
  "js/core/analyzer.js", "js/core/catalog.js", "js/core/claude.js", "js/core/editor-assist.js", "js/core/files.js",
  "js/core/lexer.js", "js/core/markdown.js", "js/core/search.js", "js/core/sync.js", "js/core/templates.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return; // GitHub API & compiler: always network
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => {
      const net = fetch(e.request).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
        return res;
      }).catch(() => hit || caches.match("index.html"));
      return hit || net;
    })
  );
});
