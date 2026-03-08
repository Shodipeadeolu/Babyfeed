const CACHE = "babyfeed-v6";
const ASSETS = ["./index.html", "./manifest.json"];

// Install — cache core files and skip waiting immediately
self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

// Activate — delete ALL old caches, take control of ALL clients immediately
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => {
        // Tell ALL open clients (including home screen app) to reload
        return self.clients.matchAll({type:"window",includeUncontrolled:true});
      })
      .then(clients => {
        clients.forEach(client => client.postMessage({type:"SW_ACTIVATED"}));
      })
  );
});

// Message handler — SKIP_WAITING forces immediate takeover
self.addEventListener("message", e => {
  if (e.data === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// Fetch — ALWAYS network-first for our own HTML/JS files
// This ensures the home screen app always gets fresh content
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);

  if (url.origin === self.location.origin) {
    // Network-first with no-cache headers to bypass iOS Safari cache
    e.respondWith(
      fetch(e.request, {cache: "no-store"}).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // CDN resources (React, Babel, Firebase) — cache-first for speed
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
      if (res.ok) {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return res;
    }))
  );
});
