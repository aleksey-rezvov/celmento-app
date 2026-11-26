/* global caches, self */

const cachePrefix = "celmento-shell-";
const coreCache = `${cachePrefix}2-core`;
const pageCache = `${cachePrefix}2-pages`;
const assetCache = `${cachePrefix}2-assets`;
const pageLimit = 16;
const assetLimit = 256;
const offlineNotePath = "/app/notes/offline";
const corePages = ["/app", "/app/meetings", "/app/people", "/app/notes", offlineNotePath];
const uuid = "[\\da-f]{8}-(?:[\\da-f]{4}-){3}[\\da-f]{12}";
const scopePattern = new RegExp(`^${uuid}$`, "iu");
const notePathPattern = new RegExp(`^/app/notes/(folders/)?(${uuid})$`, "iu");
const staticAssetPattern =
  /^\/_next\/static\/[\w/%+.~@-]+\.(?:css|js|mjs|woff2?|ttf|otf|png|svg|webp|ico)$/u;
const publicAssetPattern =
  /^(?:\/(?:characters|icons)\/[\w.%+@-]+\.(?:png|svg|webp)|\/icon\.png|\/manifest\.webmanifest)$/u;
const shellRequest = { credentials: "same-origin", redirect: "error" };

let pageWrites = Promise.resolve();

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      const active = [coreCache, pageCache, assetCache];
      await Promise.all(
        keys
          .filter((key) => key.startsWith(cachePrefix) && !active.includes(key))
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

async function trim(cache, limit) {
  const keys = await cache.keys();
  await Promise.all(
    keys.slice(0, Math.max(0, keys.length - limit)).map((key) => cache.delete(key)),
  );
}

function requiredAssets(html) {
  return Array.from(
    new Set(
      Array.from(
        html.matchAll(/\/_next\/static\/[\w/%+.~@-]+\.(?:css|js|mjs|woff2?)\b/gu),
        (match) => new URL(match[0], self.location.origin).href,
      ),
    ),
  );
}

function isOfflinePage(pathname) {
  return corePages.includes(pathname) || notePathPattern.test(pathname);
}

function shellUrl(pathname) {
  return new URL(pathname, self.location.origin).href;
}

function isAsset(response) {
  return response.status === 200 && !response.headers.get("content-type")?.includes("text/html");
}

async function readOrFetchAsset(cache, url, source) {
  const cached = await cache.match(url);
  if (cached) {
    return cached;
  }

  const response = (await source?.match(url)) ?? (await fetch(url, shellRequest));
  if (isAsset(response)) {
    await cache.put(url, response.clone());
  }
  return response;
}

async function trimCore(cache) {
  const keep = new Set(corePages.map(shellUrl));
  for (const url of [...keep]) {
    const page = await cache.match(url, { ignoreVary: true });
    if (page) {
      for (const asset of requiredAssets(await page.text())) {
        keep.add(asset);
      }
    }
  }
  const keys = await cache.keys();
  await Promise.all(keys.filter((key) => !keep.has(key.url)).map((key) => cache.delete(key)));
}

async function warmPage(pathname) {
  // The HTML is an account-independent shell. An invitation gateway may require its cookie.
  const url = shellUrl(pathname);
  const response = await fetch(url, {
    ...shellRequest,
    cache: "no-store",
    headers: { Accept: "text/html" },
  });
  if (response.status !== 200 || !response.headers.get("content-type")?.includes("text/html")) {
    return;
  }

  const urls = requiredAssets(await response.clone().text());
  if (!urls.length || urls.length > assetLimit) {
    return;
  }
  const core = await caches.open(coreCache);
  const assets = await caches.open(assetCache);
  const pin = corePages.includes(pathname);
  const target = pin ? core : assets;
  const source = pin ? assets : core;

  try {
    const loaded = await Promise.allSettled(
      urls.map((url) => readOrFetchAsset(target, url, source)),
    );
    if (!loaded.every((asset) => asset.status === "fulfilled" && isAsset(asset.value))) {
      return;
    }

    const pages = pin ? core : await caches.open(pageCache);
    if (!pin) {
      await pages.delete(url);
    }
    await pages.put(url, response);
    if (!pin) {
      await trim(pages, pageLimit);
    }
  } finally {
    if (pin) {
      await trimCore(core);
    } else {
      await trim(assets, assetLimit);
    }
  }
}

async function cachedPage(pathname) {
  const core = await caches.open(coreCache);
  const pin = corePages.includes(pathname);
  const pages = pin ? core : await caches.open(pageCache);
  const page = await pages.match(shellUrl(pathname), { ignoreVary: true });
  if (!page) {
    return undefined;
  }

  const assets = pin ? core : await caches.open(assetCache);
  const urls = requiredAssets(await page.clone().text());
  const ready = await Promise.all(
    urls.map(async (asset) => (await assets.match(asset)) ?? (pin ? undefined : core.match(asset))),
  );
  return ready.every(Boolean) ? page : undefined;
}

self.addEventListener("message", (event) => {
  const { type, pathname } = event.data ?? {};
  if (
    event.origin !== self.location.origin ||
    type !== "warm-page" ||
    typeof pathname !== "string" ||
    !isOfflinePage(pathname)
  ) {
    return;
  }

  pageWrites = pageWrites
    .then(async () => {
      await warmPage(pathname);
      // The install entry and both role defaults are needed before local account data loads.
      for (const start of corePages) {
        if (start !== pathname && !(await cachedPage(start))) {
          await warmPage(start);
        }
      }
    })
    .catch(() => undefined);
  event.waitUntil(pageWrites);
});

async function navigate(request, url) {
  try {
    return await fetch(request);
  } catch {
    const page = await cachedPage(url.pathname);
    if (page) {
      return page;
    }

    const note = notePathPattern.exec(url.pathname);
    if (!note || note[1] || !(await cachedPage(offlineNotePath))) {
      return Response.error();
    }

    const target = new URL(offlineNotePath, url.origin);
    target.searchParams.set("offline_note", note[2].toLowerCase());
    for (const key of ["folder_id", "client_id"]) {
      const value = url.searchParams.get(key);
      if (value && scopePattern.test(value)) {
        target.searchParams.set(key, value.toLowerCase());
      }
    }
    return Response.redirect(target.href, 302);
  }
}

async function staticAsset(url) {
  const core = await caches.open(coreCache);
  const pinned = await core.match(url);
  if (pinned) {
    return pinned;
  }

  const assets = await caches.open(assetCache);
  const response = await readOrFetchAsset(assets, url);
  await trim(assets, assetLimit);
  return response;
}

// spec:impl mobile-app-shell#installable-phone-home-screen
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  const path = url.pathname;
  if (request.mode === "navigate" && isOfflinePage(path)) {
    event.respondWith(navigate(request, url));
    return;
  }

  if (!url.search && (staticAssetPattern.test(path) || publicAssetPattern.test(path))) {
    event.respondWith(staticAsset(url.href).catch(() => Response.error()));
  }
});
