// Service worker della versione web: rende l'app installabile e la apre anche senza connessione.
// - /app (la pagina): prima la rete, così gli aggiornamenti arrivano subito; senza rete, l'ultima copia.
// - /js/* (nome con l'hash, non cambia mai): prima la copia, poi la rete.
// - Tutto il resto (Supabase, /api/claude, la landing) passa senza toccarlo: i dati non finiscono in questa cache.
// La build sostituisce VERSION e ASSETS (scripts/build-artifact.mjs).
const VERSION = "/*VERSION*/";
const ASSETS = /*ASSETS*/[];
const CACHE = `studify-${VERSION}`;
const APP = "/app";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll([APP, ...ASSETS])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith("studify-") && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (req.mode === "navigate" && (url.pathname === APP || url.pathname === "/app.html")) {
    event.respondWith(fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(APP, copy)); }
        return res;
      })
      .catch(() => caches.match(APP).then((r) => r ?? Response.error())));
    return;
  }
  if (url.pathname.startsWith("/js/")) {
    event.respondWith(caches.match(req).then((hit) => hit ?? fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
  }
});
