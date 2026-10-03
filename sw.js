// Offline engine for the installed app.
// - App files: precached per release and served cache-first, so the app opens
//   in airplane mode. A new release installs a fresh cache and the page offers
//   to reload.
// - NASA report snapshot (live/): network-first, falling back to the saved copy.
// - NASA image thumbnails: saved as they are viewed, for offline browsing.
// VERSION and SHELL are stamped at deploy time by scripts/stamp-sw.mjs; the
// defaults below serve local development.
const VERSION = "ff-dev";
const SHELL = [
  "./", "index.html", "manifest.webmanifest",
  "assets/styles.css", "assets/theme.js", "assets/data.js", "assets/engine.js", "assets/charts.js", "assets/live.js", "assets/app.js",
  "assets/icon.svg", "assets/icon-180.png", "assets/icon-192.png", "assets/icon-512.png",
  "assets/fonts/barlow-condensed-600.woff2", "assets/fonts/barlow-condensed-700.woff2",
  "assets/fonts/ibm-plex-mono-400.woff2", "assets/fonts/ibm-plex-mono-500.woff2", "assets/fonts/ibm-plex-sans-var.woff2",
  "live/ntrs.json"
];
const APP = "ff-app-" + VERSION;
const DATA = "ff-data";
const IMG = "ff-img";
const IMG_MAX = 80;

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(APP)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" }))))
      .then(() => caches.open(DATA))
      .then((d) => caches.open(APP).then((c) => c.match("live/ntrs.json")).then((r) => r && d.put("live/ntrs.json", r)))
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("ff-app-") && k !== APP).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (e) => {
  const msg = e.data || {};
  if (msg.type === "skip-waiting") self.skipWaiting();
  // Save NASA image thumbnails ahead of time so the gallery works offline
  // even if it was never opened online.
  if (msg.type === "cache-images" && Array.isArray(msg.urls)) {
    const urls = msg.urls.filter((u) => typeof u === "string" && u.startsWith("https://images-assets.nasa.gov/")).slice(0, IMG_MAX);
    e.waitUntil(caches.open(IMG).then((c) => Promise.all(urls.map((u) => c.match(u).then((hit) => hit || fetch(u, { mode: "no-cors" }).then((r) => c.put(u, r)).catch(() => {}))))).then(trimImages));
  }
  if (msg.type === "status") {
    e.waitUntil(caches.open(APP).then((c) => Promise.all(SHELL.map((u) => c.match(u)))).then((hits) => {
      const saved = hits.filter(Boolean).length;
      e.source && e.source.postMessage({ type: "status", version: VERSION, saved, total: SHELL.length });
    }));
  }
});

function trimImages() {
  return caches.open(IMG).then((c) => c.keys().then((keys) => Promise.all(keys.slice(0, Math.max(0, keys.length - IMG_MAX)).map((k) => c.delete(k)))));
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // NASA image thumbnails: cache-first so the gallery works offline.
  if (url.hostname === "images-assets.nasa.gov") {
    e.respondWith(caches.open(IMG).then((c) => c.match(req).then((hit) => hit || fetch(req).then((r) => {
      if (r.ok || r.type === "opaque") { c.put(req, r.clone()); trimImages(); }
      return r;
    }))));
    return;
  }
  if (url.origin !== location.origin) return;

  // Report snapshot: fresh when online, last saved copy offline. One key, no
  // matter the cache-busting query, so the cache never grows.
  if (url.pathname.endsWith("/live/ntrs.json")) {
    e.respondWith(fetch(req).then((r) => {
      if (r.ok) { const copy = r.clone(); caches.open(DATA).then((c) => c.put("live/ntrs.json", copy)); }
      return r;
    }).catch(() => caches.open(DATA).then((c) => c.match("live/ntrs.json"))));
    return;
  }

  // Page loads. The app's own page comes from the cache, even offline. Any
  // other page (such as the offline edition) comes from the network, with the
  // app as the offline fallback.
  if (req.mode === "navigate") {
    const root = new URL(self.registration.scope).pathname;
    const shell = () => caches.open(APP).then((c) => c.match("index.html"));
    if (url.pathname === root || url.pathname === root + "index.html") {
      e.respondWith(shell().then((hit) => hit || fetch(req)));
    } else {
      e.respondWith(fetch(req).catch(() => shell()));
    }
    return;
  }

  // App files: cache-first from this release.
  e.respondWith(caches.open(APP).then((c) => c.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req))));
});
