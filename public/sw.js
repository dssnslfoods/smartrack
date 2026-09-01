// Service Worker — Offline Mode: ค้นหาสินค้า/ดูแผนผังได้แม้เน็ตขัดข้อง
// เลขเวอร์ชันมีที่เดียวตรงนี้ — ต้องตรงกับ ?v= ใน index.html และ import ของ app.js
const VERSION = 50;
const SHELL = `rack-shell-v${VERSION}`;
const DATA = `rack-data-v${VERSION}`;
// ไฟล์ที่มีเวอร์ชันต่อท้ายต้องแคชด้วย URL ที่มี ?v= ให้ตรงกับที่หน้าเว็บเรียกจริง
// ไม่งั้นจะแคชไว้เฉย ๆ แต่ไม่มีใครใช้ แล้วยังได้ไฟล์เก่าจาก HTTP cache มาแทน
const V = (p) => `${p}?v=${VERSION}`;
// ทุกไฟล์ .js/.css ต้องผ่าน V() ให้หมด — ถ้าลืมไฟล์ไหน ไฟล์นั้นจะค้างเวอร์ชันเก่า
// ในเบราว์เซอร์ผู้ใช้ได้นานถึง 10 นาที (Firebase ตั้ง max-age=600)
const SHELL_FILES = [
  '/', '/index.html', V('/css/app.css'),
  V('/js/app.js'), V('/js/api.js'), V('/js/ui.js'), V('/js/actions.js'),
  ...['login', 'dashboard', 'search', 'pick', 'map', 'history', 'reports', 'layout',
      'settings', 'inbound', 'outbound', 'docs', 'expiry', 'count', 'ai', 'store']
    .map((n) => V(`/js/views/${n}.js`)),
  '/manifest.webmanifest',
  '/img/deleaf-logo.png', '/img/deleaf-icon.png',
];

self.addEventListener('install', (e) => {
  // reload = ข้าม HTTP cache ของเบราว์เซอร์ ไม่งั้นอาจแคชไฟล์เก่าค้างไว้ทั้งรอบ
  e.waitUntil(caches.open(SHELL)
    .then((c) => Promise.all(SHELL_FILES.map((f) =>
      fetch(f, { cache: 'reload' }).then((r) => (r.ok ? c.put(f, r) : null)).catch(() => null))))
    .then(() => self.skipWaiting()));
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
