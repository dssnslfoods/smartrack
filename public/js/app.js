// โครงหลักของแอป: เมนู · ช่องค้นหาด้านบน · การสลับหน้า
import { api, auth, wh } from './api.js';
import { h, $ } from './ui.js';
import { loginView } from './views/login.js';
import { dashboardView } from './views/dashboard.js';
import { searchView } from './views/search.js?v=22';
import { pickView } from './views/pick.js';
import { overviewView, rackView } from './views/map.js';
import { historyView } from './views/history.js';
import { settingsView } from './views/settings.js?v=22';
import { reportsView } from './views/reports.js';
import { warehouseListView, warehouseLayoutView } from './views/layout.js';

const NAV = [
  { path: '#/', icon: '🏠', label: 'หน้าแรก' },
  { path: '#/search', icon: '🔍', label: 'ค้นหาสินค้า' },
  { path: '#/pick', icon: '📤', label: 'วางแผนหยิบสินค้า' },
  { path: '#/map', icon: '🗺️', label: 'แผนผังชั้นวาง' },
  { path: '#/history', icon: '🕘', label: 'ประวัติการเคลื่อนย้าย' },
  { path: '#/reports', icon: '📊', label: 'รายงาน', sec: 'ผู้บริหาร' },
  { path: '#/layout', icon: '🏗️', label: 'ผังคลังสินค้า', sec: 'ตั้งค่าระบบ' },
  { path: '#/settings', icon: '⚙️', label: 'ข้อมูลหลัก', perm: 'manage' },
];

const ROUTES = [
  [/^#\/?$/, dashboardView],
  [/^#\/search/, searchView],
  [/^#\/pick/, pickView],
  [/^#\/map$/, overviewView],
  [/^#\/map\/(\d+)/, rackView],
  [/^#\/history/, historyView],
  [/^#\/reports/, reportsView],
  [/^#\/layout$/, warehouseListView],
  [/^#\/layout\/(\d+)/, warehouseLayoutView],
  [/^#\/settings/, settingsView],
];

function layout() {
  const user = auth.user;
  const whSelect = h('select', { class: 'wh-select', id: 'whSelect',
    onchange: (e) => {
      wh.id = e.target.value || null;
      wh.name = e.target.value ? e.target.options[e.target.selectedIndex].text : null;
      router();
    },
  }, h('option', { value: '' }, '— ทุกคลัง —'));
  loadWarehouses(whSelect);

  const sidebar = h('aside', { class: 'sidebar', id: 'sidebar' },
    h('div', { class: 'brand' }, h('img', { src: '/img/deleaf-icon.png', style: 'width:32px;height:32px' }), h('div', {}, 'จัดการชั้นวางสินค้า', h('small', {}, 'De Leaf'))),
    h('div', { class: 'wh-picker' }, h('label', {}, '🏢 คลังสินค้า'), whSelect),
    h('nav', { class: 'nav' },
      ...NAV.filter((i) => !i.perm || auth.can(i.perm))
        .flatMap((i) => [
          i.sec ? h('div', { class: 'sec' }, i.sec) : null,
          h('a', { href: i.path, 'data-path': i.path }, i.icon, i.label),
        ].filter(Boolean))));

  const search = h('input', {
    id: 'globalSearch', autocomplete: 'off',
    placeholder: 'ค้นหาสินค้า / Lot / รหัสตำแหน่ง — หรือสแกนบาร์โค้ดแล้วกด Enter',
    onkeydown: (e) => {
      if (e.key === 'Enter' && e.target.value.trim()) location.hash = `#/search?q=${encodeURIComponent(e.target.value.trim())}`;
    },
  });

  return h('div', { class: 'app' }, sidebar,
    h('main', { class: 'main' },
      h('header', { class: 'topbar' },
        h('button', { class: 'btn ghost menu-toggle', onclick: () => $('#sidebar').classList.toggle('open') }, '☰'),
        h('div', { class: 'searchbox' }, h('span', { class: 'icon' }, '🔍'), search),
        h('div', { class: 'who' },
          h('div', {}, h('div', { style: 'font-weight:700' }, user.full_name),
            h('span', { class: 'badge-role' }, user.role_name)),
          h('button', {
            class: 'btn ghost',
            onclick: async () => { try { await api.post('/api/auth/logout'); } catch {} auth.clear(); location.hash = '#/login'; location.reload(); },
          }, 'ออกจากระบบ'))),
      h('div', { class: 'offline-bar', id: 'offlineBar', style: 'display:none' },
        '⚠️ ออฟไลน์ — แสดงข้อมูลล่าสุดที่บันทึกไว้ (ค้นหาและดูแผนผังได้ แต่ยังบันทึกรายการไม่ได้)'),
      h('div', { class: 'content', id: 'content' })));
}

let whLoaded;
async function loadWarehouses(sel) {
  whLoaded = (async () => {
    try {
      const list = await api.get('/api/warehouses');
      for (const w of list)
        sel.appendChild(h('option', { value: w.warehouse_id }, `${w.wh_code} — ${w.wh_name}`));
      if (wh.id) {
        sel.value = wh.id;
        const opt = sel.options[sel.selectedIndex];
        if (opt && opt.value) wh.name = opt.text;
      } else if (list.length === 1) {
        wh.id = list[0].warehouse_id;
        sel.value = wh.id;
        wh.name = sel.options[sel.selectedIndex].text;
      }
    } catch {}
  })();
}

function syncWhSelect() {
  const sel = document.getElementById('whSelect');
  if (!sel) return;
  sel.value = wh.id ?? '';
}

async function router() {
  const root = document.getElementById('root');
  const hash = location.hash || '#/';

  if (!auth.token) {
    if (hash !== '#/login') { location.hash = '#/login'; return; }
    root.replaceChildren(loginView());
    return;
  }
  if (hash === '#/login') { location.hash = '#/'; return; }
  if (!document.querySelector('.app')) root.replaceChildren(layout());

  document.querySelectorAll('.nav a').forEach((a) => {
    const p = a.getAttribute('data-path');
    a.classList.toggle('active', p === '#/' ? hash === '#/' : hash.startsWith(p));
  });
  $('#sidebar').classList.remove('open');
  syncWhSelect();

  if (whLoaded) await whLoaded;
  const content = $('#content');
  content.replaceChildren(h('div', { class: 'empty-state' }, 'กำลังโหลด…'));
  const path = hash.split('?')[0];
  const params = new URLSearchParams(hash.split('?')[1] ?? '');

  for (const [re, view] of ROUTES) {
    const match = path.match(re);
    if (!match) continue;
    try {
      content.replaceChildren(await view({ params, match }));
    } catch (err) {
      content.replaceChildren(h('div', { class: 'card' }, h('h2', {}, 'เกิดข้อผิดพลาด'), h('p', {}, err.message)));
    }
    window.scrollTo(0, 0);
    return;
  }
  content.replaceChildren(h('div', { class: 'empty-state' }, 'ไม่พบหน้าที่ต้องการ'));
}

window.addEventListener('hashchange', router);
window.addEventListener('load', async () => {
  await router();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
});
const setOnline = () => {
  const bar = document.getElementById('offlineBar');
  if (bar) bar.style.display = navigator.onLine ? 'none' : 'block';
};
window.addEventListener('online', setOnline);
window.addEventListener('offline', setOnline);
