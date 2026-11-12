const CACHE_NAME = "nexo-pwa-shell-v1";
const APP_SCOPE = new URL(self.registration.scope);
const APP_ROOT = new URL("./", APP_SCOPE).href;

function isAppRequest(url) {
  if (url.origin !== self.location.origin || !url.pathname.startsWith(APP_SCOPE.pathname)) return false;
  const relativePath = url.pathname.slice(APP_SCOPE.pathname.length);
  return relativePath !== "api" && !relativePath.startsWith("api/") &&
    relativePath !== "ws" && !relativePath.startsWith("ws/");
}

function isStaticAppAsset(request, url) {
  return isAppRequest(url) &&
    ["script", "style", "image", "font", "manifest"].includes(request.destination);
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    try {
      const response = await fetch(APP_ROOT, { cache: "reload" });
      if (response.ok && response.type === "basic") {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(APP_ROOT, response.clone());
        const html = await response.text();
        const resources = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
          .map((match) => new URL(match[1], APP_ROOT))
          .filter((url) => isAppRequest(url) && /\.(?:js|css)$/i.test(url.pathname))
          .slice(0, 64);
        await Promise.all(resources.map(async (url) => {
          try {
            const asset = await fetch(url.href, { cache: "reload" });
            if (asset.ok && asset.type === "basic") await cache.put(url.href, asset);
          } catch {
            // A missed optional asset should not prevent the PWA from installing.
          }
        }));
      }
    } catch {
      // The app can still run online if an offline shell cannot be cached.
    }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames
      .filter((name) => name.startsWith("nexo-pwa-shell-") && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (!isAppRequest(url)) return;

  if (request.mode === "navigate" && url.pathname === APP_SCOPE.pathname) {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok && response.type === "basic") {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(APP_ROOT, response.clone());
        }
        return response;
      } catch {
        return await caches.match(APP_ROOT) ??
          new Response("Nexo is offline. Reconnect to use AI and Live voice.", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
      }
    })());
    return;
  }

  if (!isStaticAppAsset(request, url)) return;
  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response.ok && response.type === "basic") {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    } catch {
      return await caches.match(request) ?? Response.error();
    }
  })());
});
