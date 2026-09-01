// โครงหลักของแอป: เมนู · ช่องค้นหาด้านบน · การสลับหน้า
import { api, auth, wh } from './api.js?v=52';
import { h, $ } from './ui.js?v=52';
import { loginView } from './views/login.js?v=52';
import { dashboardView } from './views/dashboard.js?v=52';
import { searchView } from './views/search.js?v=52';
import { pickView } from './views/pick.js?v=52';
import { overviewView, rackView } from './views/map.js?v=52';
import { historyView } from './views/history.js?v=52';
import { settingsView } from './views/settings.js?v=52';
import { reportsView } from './views/reports.js?v=52';
import { warehouseListView, warehouseLayoutView } from './views/layout.js?v=52';
import { inboundView } from './views/inbound.js?v=52';
import { outboundView } from './views/outbound.js?v=52';
import { docsView } from './views/docs.js?v=52';
import { expiryView } from './views/expiry.js?v=52';
import { countView } from './views/count.js?v=52';
import { copilotView, insightsView } from './views/ai.js?v=52';

const NAV = [
  { path: '#/', icon: '🏠', label: 'หน้าแรก', tip: 'ภาพรวมคลังวันนี้ — พื้นที่ที่ใช้ไป ของใกล้หมดอายุ และงานที่ค้างอยู่' },
  { path: '#/search', icon: '🔍', label: 'ค้นหาสินค้า', tip: 'หาว่าสินค้าอยู่ชั้นวางไหน ชั้นใด ตอนที่เท่าไร ดูได้ทั้งแบบตารางและแผนผัง' },
  { path: '#/inbound', icon: '📥', label: 'รับเข้า (GRN)', sec: 'งานคลัง', tip: 'รับสินค้าเข้าคลัง — บันทึกหลายรายการ/หลาย Lot ในใบเดียว หรือให้ AI สแกนใบส่งของมาเติมให้' },
  { path: '#/pick', icon: '📤', label: 'วางแผนหยิบสินค้า', tip: 'คำนวณว่าควรหยิบจากตำแหน่งไหนตามหลัก FEFO แล้วพิมพ์ใบเบิกให้พนักงานถือเข้าคลัง' },
  { path: '#/outbound', icon: '🚚', label: 'งานจ่ายออก', tip: 'ติดตามใบจ่ายสินค้าตั้งแต่หยิบ แพ็ค จนถึงส่งมอบ พร้อมบันทึกเลขพัสดุ' },
  { path: '#/docs', icon: '📋', label: 'โอน / คืน / ตัดเสีย', tip: 'ย้ายของระหว่างตำแหน่ง · รับคืนจากลูกค้า · ส่งคืนผู้ขาย · ตัดของเสียออกจากระบบ' },
  { path: '#/count', icon: '🔢', label: 'นับสต็อก', tip: 'เปิดรอบนับ บันทึกจำนวนที่นับได้จริง แล้วอนุมัติเพื่อปรับยอดให้ตรงกับของจริง' },
  { path: '#/map', icon: '🗺️', label: 'แผนผังชั้นวาง', sec: 'คลังสินค้า', tip: 'ดูผังคลังและชั้นวางทีละตัว คลิกช่องว่างเพื่อจัดเก็บ คลิกช่องที่มีของเพื่อหยิบหรือย้าย' },
  { path: '#/history', icon: '🕘', label: 'ประวัติการเคลื่อนย้าย', tip: 'ทุกการเคลื่อนไหวของสินค้าย้อนหลัง — ลบไม่ได้ ใช้ตรวจสอบย้อนกลับได้เสมอ' },
  { path: '#/copilot', icon: '📦', label: 'น้องสต๊อค (ผู้ช่วย)', sec: 'ผู้ช่วยอัจฉริยะ', tip: 'ถามเรื่องคลังเป็นภาษาไทย น้องสต๊อคจะดึงข้อมูลจริงจากระบบมาตอบ (ดูอย่างเดียว แก้ไขไม่ได้)' },
  { path: '#/insights', icon: '🧠', label: 'วิเคราะห์เชิงลึก', tip: 'วิเคราะห์ 6 มุม — ของจะขายไม่ทัน · พยากรณ์สั่งเติม · จัดตำแหน่งใหม่ · ความผิดปกติ · ภาระงาน' },
  { path: '#/expiry', icon: '⚠️', label: 'อายุสินค้า & Recall', sec: 'ผู้บริหาร', tip: 'เฝ้าดูของใกล้หมดอายุ และค้นหาว่า Lot ที่ต้องเรียกคืนถูกส่งไปที่ไหนบ้าง' },
  { path: '#/reports', icon: '📊', label: 'รายงาน', tip: 'รายงานสรุป — การใช้พื้นที่ อายุสินค้าคงคลัง และความเคลื่อนไหวตามช่วงเวลา' },
  { path: '#/layout', icon: '🏗️', label: 'ผังคลังสินค้า', sec: 'ตั้งค่าระบบ', tip: 'จัดวางตำแหน่ง RACK บนผังพื้นให้ตรงกับคลังจริง เพื่อให้แผนผังใช้นำทางได้' },
  { path: '#/settings', icon: '⚙️', label: 'ข้อมูลหลัก', perm: 'manage', tip: 'ตั้งค่าคลัง โซน ชั้นวาง สินค้า ช่องทางขาย ผู้ใช้งาน และ AI' },
];

const ROUTES = [
  [/^#\/?$/, dashboardView],
  [/^#\/search/, searchView],
  [/^#\/pick/, pickView],
  [/^#\/inbound/, inboundView],
  [/^#\/outbound/, outboundView],
  [/^#\/docs/, docsView],
  [/^#\/copilot/, copilotView],
  [/^#\/insights/, insightsView],
  [/^#\/expiry/, expiryView],
  [/^#\/count$/, countView],
  [/^#\/count\/(\d+)/, countView],
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
          h('a', { href: i.path, 'data-path': i.path, title: i.tip }, i.icon, i.label),
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
        h('button', { class: 'btn ghost menu-toggle', title: 'เปิด/ปิดเมนูด้านซ้าย — ใช้บนจอเล็กอย่างแท็บเล็ตหรือมือถือ',
          onclick: () => $('#sidebar').classList.toggle('open') }, '☰'),
        h('div', { class: 'searchbox' }, h('span', { class: 'icon' }, '🔍'), search),
        h('div', { class: 'who' },
          h('div', {}, h('div', { style: 'font-weight:700' }, user.full_name),
            h('span', { class: 'badge-role' }, user.role_name)),
          h('button', {
            class: 'btn ghost',
            title: 'ออกจากระบบและกลับไปหน้าเข้าสู่ระบบ — งานที่ยังไม่กดบันทึกจะหายไป',
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
