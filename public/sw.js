// Content-addressed offline Service Worker for Verdant AQM (GitHub Pages).
// Modeled directly after `afflom/verdant-engine/site/sw.js`:
//  - `precache.json`, written after the static site is assembled in `pages.yml`,
//    carries a `version` hash of every served file: a new deploy opens a new
//    `prism-<version>` cache and drops superseded caches; an unchanged deploy
//    keeps the existing cache with zero redundant network transfers.
//  - Navigation (`index.html` / `./`) checks the network first and triggers
//    `follow()` so new deploys appear immediately on the next visit, falling
//    back to `./` in `prism-<version>` when offline.
//  - Immutable content-hashed assets (`./assets/*`, `./app.holo`) serve from
//    the `prism-<version>` cache first and populate on miss.

const MANIFEST = "./precache.json";
let cacheName = null;

async function manifest() {
  const response = await fetch(MANIFEST, { cache: "no-store" });
  if (!response.ok) throw new Error(`precache.json: HTTP ${response.status}`);
  return response.json();
}

async function currentCacheName() {
  if (cacheName) return cacheName;
  const names = (await caches.keys()).filter((name) => name.startsWith("prism-"));
  cacheName = names[names.length - 1] ?? null;
  return cacheName;
}

async function keep(list) {
  const cache = await caches.open(`prism-${list.version}`);
  await cache.put(
    MANIFEST,
    new Response(JSON.stringify(list), {
      headers: { "content-type": "application/json" },
    }),
  );
  const eager = list.files
    .filter((file) => file.eager)
    .map((file) => new Request(file.path, { cache: "reload" }));
  if (eager.length > 0) {
    await cache.addAll(eager);
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const list = await manifest();
        await keep(list);
        cacheName = `prism-${list.version}`;
      } catch {
        // Offline or dev preview without precache.json: activate gracefully.
      }
    })(),
  );
});

let moving = null;
function follow() {
  moving ??= (async () => {
    const list = await manifest();
    const name = `prism-${list.version}`;
    if (name === (await currentCacheName())) return;
    await keep(list);
    cacheName = name;
    for (const old of await caches.keys()) {
      if (old.startsWith("prism-") && old !== name) {
        await caches.delete(old);
      }
    }
  })()
    .catch(() => {})
    .finally(() => {
      moving = null;
    });
  return moving;
}

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keepName = await currentCacheName();
      for (const name of await caches.keys()) {
        if (name.startsWith("prism-") && name !== keepName) {
          await caches.delete(name);
        }
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || !url.href.startsWith(self.registration.scope)) {
    return;
  }
  if (url.pathname.endsWith("/precache.json")) {
    return;
  }

  const isPage =
    event.request.mode === "navigate" ||
    url.pathname.endsWith("/") ||
    url.pathname.endsWith("/index.html");

  event.respondWith(
    (async () => {
      if (isPage) {
        let fresh = null;
        try {
          fresh = await fetch(event.request);
        } catch {
          const name = await currentCacheName();
          const cache = name ? await caches.open(name) : null;
          return (
            (cache && ((await cache.match("./")) ?? (await cache.match(event.request)))) ??
            Response.error()
          );
        }
        if (fresh.ok) {
          await follow();
          const name = await currentCacheName();
          if (name) await (await caches.open(name)).put("./", fresh.clone());
        }
        return fresh;
      }

      const name = await currentCacheName();
      const cache = name ? await caches.open(name) : null;
      const hit = cache && (await cache.match(event.request, { ignoreSearch: true }));
      if (hit) return hit;

      const fresh = await fetch(event.request);
      if (fresh.ok && cache) await cache.put(event.request, fresh.clone());
      return fresh;
    })(),
  );
});
