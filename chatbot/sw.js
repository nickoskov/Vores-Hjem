// Minimal service worker — gør admin-siden installérbar som app (PWA).
// INGEN fetch-handler: alle kald går direkte på netværket uden SW-overhead.
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
