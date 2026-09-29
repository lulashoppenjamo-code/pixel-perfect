const CACHE_NAME = "lula-shop-os-pwa-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();

      await Promise.all(
        cacheNames
          .filter((name) => name.startsWith("lula-shop-os-pwa-") && name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      );

      await self.clients.claim();
    })(),
  );
});

// El service worker no intercepta ni modifica las peticiones.
// La aplicación continúa trabajando normalmente con la red.
self.addEventListener("fetch", () => {});