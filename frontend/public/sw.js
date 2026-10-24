// Minimalni service worker: samo da preglednik prepozna aplikaciju kao instalabilnu.
// Namjerno NE sprema ništa u predmemoriju — podaci i nova izdanja uvijek dolaze s mreže (nema zastarjelih verzija).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
