/* Shareek Health Dashboard — service worker.
 *
 * Strategy is deliberately conservative because this is a LIVE dashboard:
 *   - HTML / navigations  -> network-first (always try the latest; fall back to
 *                            cache only when the device is offline). This means a
 *                            freshly published dashboard shows up immediately.
 *   - Static assets       -> cache-first (icons, manifest — they rarely change).
 *   - Supabase API calls  -> never touched (cross-origin -> passes straight through,
 *                            so live data is never served stale).
 *
 * Bump CACHE_VERSION whenever you want to force every installed app to drop its
 * old cached shell.
 */
const CACHE_VERSION = "shareek-health-v1";
const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      // best-effort precache; don't fail install if one asset 404s
      Promise.allSettled(SHELL.map((url) => cache.add(url)))
    )
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle our own origin, GET only. Everything else (Supabase, fonts,
  // POSTs) goes straight to the network untouched.
  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  const isNavigation =
    req.mode === "navigate" ||
    (req.headers.get("accept") || "").includes("text/html");

  if (isNavigation) {
    // Network-first: latest dashboard when online, cached shell when offline.
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() =>
          caches.match(req).then((hit) => hit || caches.match("./index.html"))
        )
    );
    return;
  }

  // Static assets: cache-first, then network (and cache the result).
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
    )
  );
});
