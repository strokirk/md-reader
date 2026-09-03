/// <reference lib="webworker" />
import { clientsClaim } from "workbox-core";
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";

declare const self: ServiceWorkerGlobalScope;

const SHARED_CACHE = "shared-files";

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Web Share Target: stash shared files, then send the client to the app with ?shared=1.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "POST" || !url.pathname.endsWith("/share-target")) return;
  event.respondWith(
    (async () => {
      const form = await event.request.formData();
      const cache = await caches.open(SHARED_CACHE);
      const files = form.getAll("files");
      let n = 0;
      for (const entry of files) {
        if (!(entry instanceof File)) continue;
        const name = entry.name || `shared-${n}.md`;
        await cache.put(
          new Request(`${url.origin}/shared/${encodeURIComponent(name)}`),
          new Response(entry, { headers: { "content-type": "text/markdown" } }),
        );
        n++;
      }
      const text = form.get("text");
      if (n === 0 && typeof text === "string" && text.length > 0) {
        const rawTitle = form.get("title");
        const title = typeof rawTitle === "string" && rawTitle.length > 0 ? rawTitle : "shared";
        await cache.put(
          new Request(`${url.origin}/shared/${encodeURIComponent(title)}.md`),
          new Response(text, { headers: { "content-type": "text/markdown" } }),
        );
      }
      const base = url.pathname.replace(/share-target$/, "");
      return Response.redirect(`${base}?shared=1`, 303);
    })(),
  );
});

registerRoute(new NavigationRoute(createHandlerBoundToURL("index.html")));

self.addEventListener("message", (event: ExtendableMessageEvent) => {
  if ((event.data as { type?: string } | null)?.type === "SKIP_WAITING") void self.skipWaiting();
});

clientsClaim();
