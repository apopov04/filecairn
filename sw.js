// Offline support: the app shell is cached on install; pdf.js fonts/cmaps/wasm
// are cached the first time they're used. App files are fetched with
// cache: "no-cache" so updates show up on the next reload.
const VERSION = "filecairn-v9";
const SHELL = [
  "./", "index.html", "css/app.css", "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png",
  "js/main.js", "js/pages.js", "js/engine.js", "js/zip.js", "js/icons.js", "js/api.js", "js/redact.js", "js/pageview.js", "js/annots.js", "js/history.js",
  "vendor/pdfjs/pdf.min.mjs", "vendor/pdfjs/pdf.worker.min.mjs", "vendor/pdf-lib/pdf-lib.esm.min.js",
];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("filecairn-v") && k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    (e.request.mode === "navigate" ? fetch(e.request) : fetch(e.request, { cache: "no-cache" })).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
