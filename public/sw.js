// Service Worker — Offline Mode: ค้นหาสินค้า/ดูแผนผังได้แม้เน็ตขัดข้อง
const SHELL = 'rack-shell-v32';
const DATA = 'rack-data-v32';
const SHELL_FILES = [
  '/', '/index.html', '/css/app.css',
  '/js/app.js', '/js/api.js', '/js/ui.js', '/js/actions.js',
  '/js/views/login.js', '/js/views/dashboard.js', '/js/views/search.js',
  '/js/views/pick.js', '/js/views/map.js', '/js/views/history.js', '/js/views/reports.js',
  '/js/views/layout.js', '/js/views/settings.js',
  '/js/views/inbound.js', '/js/views/outbound.js', '/js/views/docs.js',
  '/js/views/expiry.js', '/js/views/count.js', '/js/views/ai.js',
  '/manifest.webmanifest',
  '/img/deleaf-logo.png', '/img/deleaf-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => ![SHELL, DATA].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const CACHEABLE = [/^\/api\/stock/, /^\/api\/rags\/\d+\/map/, /^\/api\/rags/, /^\/api\/zones/, /^\/api\/overview/, /^\/api\/skus/, /^\/api\/dashboard/, /^\/api\/locations/, /^\/api\/movements/, /^\/api\/reports/, /^\/api\/warehouses/];

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    if (!CACHEABLE.some((re) => re.test(url.pathname))) return;
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(DATA).then((c) => c.put(request, copy));
          return res;
        })
        .catch(async () => {
          const hit = await caches.match(request);
          if (hit) {
            const body = await hit.json();
            return new Response(JSON.stringify(body), {
              headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-From-Cache': '1' },
            });
          }
          return new Response(JSON.stringify({ error: 'ออฟไลน์ และไม่มีข้อมูลที่แคชไว้' }), {
            status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8' },
          });
        }),
    );
    return;
  }
  event.respondWith(caches.match(request).then((hit) => hit || fetch(request).catch(() => caches.match('/index.html'))));
});
