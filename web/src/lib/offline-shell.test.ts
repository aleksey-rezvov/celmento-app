// @vitest-environment node

import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, test, vi } from "vitest";
import manifest from "../app/manifest";
import { isOfflinePage, offlinePageTarget } from "./offline-navigation";

const origin = "https://app.celmento.test";
const notePath = "/app/notes/00000000-0000-4000-8000-000000000001";
const aliasPath = "/app/notes/offline";
const corePaths = ["/app", "/app/meetings", "/app/people", "/app/notes", aliasPath];
const scriptPath = "/_next/static/chunks/note.abc123.js";
const stylePath = "/_next/static/chunks/note.abc123.css";
const worker = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");

interface WorkerRequest {
  method: string;
  mode: string;
  url: string;
}

interface WorkerEvent {
  origin?: string;
  data?: { type: string; pathname: string };
  request?: WorkerRequest;
  waitUntil?: (pending: Promise<unknown>) => void;
  respondWith?: (response: Promise<Response>) => void;
}

function startWorker(assetsForPage: (path: string) => string[] = () => [scriptPath, stylePath]) {
  const listeners = new Map<string, (event: WorkerEvent) => void>();
  const caches = new Map<string, Map<string, Response>>();
  let online = true;
  const fetch = vi.fn(async (input: string | WorkerRequest): Promise<Response> => {
    if (!online) {
      throw new TypeError("Network disconnected");
    }
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.pathname.startsWith("/_next/static/")) {
      return new Response("static", { headers: { "Content-Type": "application/octet-stream" } });
    }
    const assets = assetsForPage(url.pathname).map((path) =>
      path.endsWith(".css")
        ? `<link rel="stylesheet" href="${path}">`
        : `<script src="${path}"></script>`,
    );
    return new Response(`<html>${assets.join("")}</html>`, {
      headers: { "Content-Type": "text/html" },
    });
  });

  runInNewContext(worker, {
    self: {
      location: { origin },
      addEventListener: (type: string, listener: (event: WorkerEvent) => void) => {
        listeners.set(type, listener);
      },
    },
    caches: {
      open: async (name: string) => {
        const items = caches.get(name) ?? new Map<string, Response>();
        caches.set(name, items);
        return {
          put: (key: string, response: Response) => items.set(key, response.clone()),
          match: (key: string) => items.get(key)?.clone(),
          delete: (key: string | Request) => items.delete(typeof key === "string" ? key : key.url),
          keys: () => [...items.keys()].map((key) => new Request(key)),
        };
      },
    },
    fetch,
    Response,
    URL,
  });

  return {
    fetch,
    warm: async (pathname: string) => {
      let pending: Promise<unknown> | undefined;
      listeners.get("message")?.({
        origin,
        data: { type: "warm-page", pathname },
        waitUntil: (promise) => {
          pending = promise;
        },
      });
      await pending;
    },
    request: (url: string, mode: string, method = "GET") => {
      let pending: Promise<Response> | undefined;
      listeners.get("fetch")?.({
        request: { url: new URL(url, origin).href, mode, method },
        respondWith: (promise) => {
          pending = promise;
        },
      });
      return pending;
    },
    disconnect: () => {
      online = false;
    },
    evict: (path: string) => {
      for (const items of caches.values()) {
        items.delete(new URL(path, origin).href);
      }
    },
  };
}

// spec:test mobile-app-shell#installable-phone-home-screen
test("offers an installable app named celmēnto with standalone display and both icon sizes", () => {
  expect(manifest()).toMatchObject({
    name: "celmēnto",
    short_name: "celmēnto",
    display: "standalone",
    start_url: "/app",
    icons: [
      { src: "/icon.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/celmento-512.png", sizes: "512x512", type: "image/png" },
    ],
  });
});

test("cold offline navigation opens previously visited Meetings, Notes and note shells", async () => {
  const shell = startWorker();
  const pages = ["/app/meetings", "/app/notes", notePath];
  for (const page of pages) {
    expect(isOfflinePage(page)).toBe(true);
    await shell.warm(page);
    expect(shell.fetch).toHaveBeenCalledWith(
      origin + page,
      expect.objectContaining({ credentials: "omit", redirect: "error" }),
    );
  }
  shell.disconnect();

  for (const page of pages) {
    const document = await shell.request(page, "navigate");
    expect(document?.status).toBe(200);
    expect(await document?.text()).toContain(scriptPath);
  }
  expect(await (await shell.request(scriptPath, "no-cors"))?.text()).toBe("static");
  expect(await (await shell.request(stylePath, "no-cors"))?.text()).toBe("static");
});

test("warms the installed launch, role defaults and Notes shells from one visited page", async () => {
  const shell = startWorker();
  await shell.warm(notePath);
  shell.disconnect();

  for (const page of corePaths) {
    expect(isOfflinePage(page)).toBe(true);
    expect((await shell.request(page, "navigate"))?.status).toBe(200);
  }
});

test("opens an uncached physical note link with the cached read-only Notes shell", async () => {
  const shell = startWorker();
  const folderId = "bbbbbbbb-0000-4000-8000-000000000002";
  const clientId = "cccccccc-0000-4000-8000-000000000003";
  const noteId = notePath.split("/").at(-1);
  const query = `?folder_id=${folderId.toUpperCase()}&client_id=${clientId}&ticket=secret`;
  await shell.warm("/app/notes");
  shell.disconnect();

  const redirect = await shell.request(notePath + query, "navigate");
  expect(redirect?.status).toBe(302);
  const location = redirect?.headers.get("location");
  expect(location).toBe(
    `${origin}${aliasPath}?offline_note=${noteId}&folder_id=${folderId}&client_id=${clientId}`,
  );
  expect((await shell.request(location ?? "", "navigate"))?.status).toBe(200);

  const invalidContext = await shell.request(
    notePath + "?folder_id=https://other.test",
    "navigate",
  );
  expect(invalidContext?.headers.get("location")).toBe(
    `${origin}${aliasPath}?offline_note=${noteId}`,
  );
  expect((await shell.request("/app/notes/folders/" + folderId, "navigate"))?.type).toBe("error");
  expect(shell.request(notePath + "/tag", "navigate")).toBeUndefined();
});

test("opens a note directly from the offline grid without fetching a note-specific document", () => {
  const location = new URL("/app/notes", origin);
  const connection = { onLine: false, serviceWorker: { controller: {} } };
  vi.stubGlobal("navigator", connection);
  vi.stubGlobal("window", { location });
  try {
    const noteId = notePath.split("/").at(-1);
    const clientId = "aaaaaaaa-0000-4000-8000-000000000002";
    const target = offlinePageTarget(
      notePath + "?client_id=" + clientId.toUpperCase() + "&ticket=secret",
    );
    expect(target?.href).toBe(`${origin}${aliasPath}?offline_note=${noteId}&client_id=${clientId}`);
    expect(offlinePageTarget(notePath + "?folder_id=invalid")?.href).toBe(
      `${origin}${aliasPath}?offline_note=${noteId}`,
    );
    expect(offlinePageTarget("/app/meetings")?.href).toBe(origin + "/app/meetings");
    expect(offlinePageTarget("https://other.test" + notePath)).toBeNull();
    connection.onLine = true;
    expect(offlinePageTarget(notePath)).toBeNull();
  } finally {
    vi.unstubAllGlobals();
  }
});

test("ordinary note and asset eviction cannot remove the core documents and their release assets", async () => {
  const files = (pathname: string): string[] =>
    Array.from(
      { length: 16 },
      (_, number) => `/_next/static/chunks${pathname.replaceAll("/", "-")}-${number}.js`,
    );
  const shell = startWorker(files);
  await shell.warm(notePath);
  for (let index = 2; index <= 19; index += 1) {
    await shell.warm(notePath.slice(0, -2) + String(index).padStart(2, "0"));
  }
  shell.disconnect();

  expect((await shell.request(notePath, "navigate"))?.status).toBe(302);
  const oldestAsset = files(notePath)[0] ?? "";
  expect((await shell.request(oldestAsset, "no-cors"))?.type).toBe("error");
  for (const page of corePaths) {
    expect((await shell.request(page, "navigate"))?.status).toBe(200);
    for (const asset of files(page)) {
      expect((await shell.request(asset, "no-cors"))?.status).toBe(200);
    }
  }
});

test("leaves auth, API, RSC and non-navigation requests on the network", async () => {
  const shell = startWorker();
  for (const path of ["/login", "/register/finish?ticket=one", "/privacy", "/api/v1/notes"]) {
    expect(isOfflinePage(new URL(path, origin).pathname)).toBe(false);
    await shell.warm(path);
    expect(shell.request(path, "navigate")).toBeUndefined();
  }
  expect(shell.request("https://other.test" + scriptPath, "no-cors")).toBeUndefined();
  expect(shell.request(scriptPath, "no-cors", "POST")).toBeUndefined();
  expect(shell.request("/app/notes?_rsc=one", "cors")).toBeUndefined();
  expect(shell.fetch).not.toHaveBeenCalled();
});

test("refuses a stale document after a required release asset has been evicted", async () => {
  const shell = startWorker();
  await shell.warm(notePath);
  shell.evict(scriptPath);
  shell.disconnect();

  expect((await shell.request(notePath, "navigate"))?.type).toBe("error");
});
