// รายงานผู้บริหาร — 5 รายงานหลักสำหรับการตัดสินใจ
import { api, wh, download } from '../api.js?v=48';
import { h, table, pill, fmtNum, fmtDate, fmtDateTime } from '../ui.js?v=48';

const TABS = [
  { key: 'inventory', label: '📦 สินค้าคงคลัง', tip: 'ยอดคงเหลือทั้งคลัง ดูรวมตามสินค้า ตามโซน หรือตามหมวดหมู่ก็ได้' },
  { key: 'expiry', label: '⏰ ใกล้หมดอายุ', tip: 'Lot ที่จะหมดอายุภายใน 90 วัน เรียงจากด่วนที่สุด — ใช้วางแผนระบายของ' },
  { key: 'space', label: '📊 การใช้พื้นที่', tip: 'ดูว่าแต่ละโซนและชั้นวางใช้พื้นที่ไปกี่ % เหลือที่ว่างตรงไหนบ้าง' },
  { key: 'movements', label: '📈 การเคลื่อนไหว', tip: 'สรุปการรับเข้า-จ่ายออกตามช่วงเวลา ใช้ดูแนวโน้มและปริมาณงาน' },
  { key: 'staff', label: '👥 ประสิทธิภาพพนักงาน', tip: 'จำนวนรายการที่แต่ละคนทำ และค่าเฉลี่ยต่อวัน ใช้ประเมินภาระงาน' },
];

export async function reportsView({ params }) {
  let active = params.get('tab') || 'inventory';
  const content = h('div', {});
  const tabBar = h('div', { class: 'tab-bar' });

  function renderTabs() {
    tabBar.replaceChildren(...TABS.map((t) =>
      h('button', { class: `tab ${t.key === active ? 'active' : ''}`, title: t.tip, onclick: () => { active = t.key; renderTabs(); load(); } }, t.label)));
  }

  async function load() {
    content.replaceChildren(h('div', { class: 'empty-state' }, 'กำลังโหลด…'));
    try {
      if (active === 'inventory') await loadInventory();
      else if (active === 'expiry') await loadExpiry();
      else if (active === 'space') await loadSpace();
      else if (active === 'movements') await loadMovements();
      else await loadStaff();
    } catch (err) { content.replaceChildren(h('div', { class: 'empty-state' }, err.message)); }
  }

  // ======== 1. สินค้าคงคลัง ========
  async function loadInventory() {
    let groupBy = 'sku';
    const render = async () => {
      const data = await api.get('/api/reports/inventory', { group_by: groupBy, warehouse_id: wh.id });
      const groupBtns = h('div', { class: 'tabs', style: 'margin-bottom:14px' },
        ...['sku', 'zone', 'category'].map((g) =>
          h('button', {
            class: `${g === groupBy ? 'active' : ''}`,
            title: g === 'sku' ? 'รวมยอดทีละสินค้า — ดูว่าสินค้าแต่ละตัวเหลือเท่าไร กระจายอยู่กี่ตำแหน่ง'
              : g === 'zone' ? 'รวมยอดทีละโซน — ดูว่าของกองอยู่โซนไหนมากที่สุด'
              : 'รวมยอดทีละหมวดหมู่สินค้า เช่น ครีม สบู่ แชมพู',
            onclick: () => { groupBy = g; render(); },
          }, g === 'sku' ? 'ตาม SKU' : g === 'zone' ? 'ตามโซน' : 'ตามหมวดหมู่')));

      let tbl;
      if (groupBy === 'sku') {
        const totalQty = data.reduce((a, r) => a + r.total_qty, 0);
        tbl = h('div', {},
          h('div', { class: 'grid g3', style: 'margin-bottom:14px' },
            kpiCard('SKU ทั้งหมด', data.length, 'รายการ'),
            kpiCard('จำนวนรวม', fmtNum(totalQty), 'หน่วย'),
            kpiCard('ตำแหน่งที่ใช้', fmtNum(data.reduce((a, r) => a + r.locations_used, 0)), 'ตำแหน่ง')),
          table([
            { label: 'รหัส', key: 'sku_code', mono: true },
            { label: 'ชื่อสินค้า', key: 'sku_name' },
            { label: 'หมวด', key: 'category' },
            { label: 'จำนวน', value: (r) => `${fmtNum(r.total_qty)} ${r.unit}`, num: true },
            { label: 'ตำแหน่ง', key: 'locations_used', num: true },
            { label: 'ใกล้หมดอายุ', value: (r) => r.nearest_expiry ? fmtDate(r.nearest_expiry) : '—' },
          ], data));
      } else if (groupBy === 'zone') {
        tbl = table([
          { label: 'โซน', value: (r) => `${r.zone_code} — ${r.zone_name}` },
          { label: 'SKU', key: 'sku_count', num: true },
          { label: 'รายการ', key: 'items', num: true },
          { label: 'จำนวนรวม', value: (r) => fmtNum(r.total_qty), num: true },
          { label: 'RACK', key: 'rack_count', num: true },
        ], data);
      } else {
        tbl = table([
          { label: 'หมวดหมู่', key: 'category' },
          { label: 'SKU', key: 'sku_count', num: true },
          { label: 'รายการ', key: 'items', num: true },
          { label: 'จำนวนรวม', value: (r) => fmtNum(r.total_qty), num: true },
        ], data);
      }
      content.replaceChildren(groupBtns, tbl);
    };
    await render();
  }

  // ======== 2. ใกล้หมดอายุ ========
  async function loadExpiry() {
    const data = await api.get('/api/reports/expiry', { warehouse_id: wh.id });
    const s = data.summary;

    content.replaceChildren(
      h('div', { class: 'grid g4', style: 'margin-bottom:14px' },
        kpiCard('หมดอายุแล้ว', s.expired.count, `${fmtNum(s.expired.qty)} หน่วย`, 'red'),
        kpiCard('ภายใน 30 วัน', s.within30.count, `${fmtNum(s.within30.qty)} หน่วย`, 'amber'),
        kpiCard('ภายใน 60 วัน', s.within60.count, `${fmtNum(s.within60.qty)} หน่วย`, 'blue'),
        kpiCard('ภายใน 90 วัน', s.within90.count, `${fmtNum(s.within90.qty)} หน่วย`, 'gray')),
      data.items.length
        ? table([
            { label: 'ตำแหน่ง', key: 'location_code', mono: true },
            { label: 'โซน', key: 'zone_code' },
            { label: 'สินค้า', value: (r) => `${r.sku_name} (${r.sku_code})` },
            { label: 'Lot', key: 'lot_no' },
            { label: 'จำนวน', value: (r) => `${fmtNum(r.quantity)} ${r.unit}`, num: true },
            { label: 'หมดอายุ', value: (r) => fmtDate(r.exp_date) },
            { label: 'เหลือ', value: (r) => r.days_left < 0
                ? pill(`หมดแล้ว ${Math.abs(r.days_left)} วัน`, 'red')
                : pill(`${r.days_left} วัน`, r.days_left <= 30 ? 'amber' : r.days_left <= 60 ? 'blue' : 'gray') },
          ], data.items)
        : h('div', { class: 'empty-state' }, 'ไม่มีสินค้าใกล้หมดอายุภายใน 90 วัน'));
  }

  // ======== 3. การใช้พื้นที่ ========
  async function loadSpace() {
    const data = await api.get('/api/reports/space', { warehouse_id: wh.id });

    const totalAll = data.zones.reduce((a, z) => a + z.total, 0);
    const occAll = data.zones.reduce((a, z) => a + z.occupied, 0);
    const emptyAll = data.zones.reduce((a, z) => a + z.empty, 0);
    const usableAll = data.zones.reduce((a, z) => a + z.usable, 0);
    const pctAll = usableAll ? Math.round((occAll / usableAll) * 1000) / 10 : 0;

    const parts = [
      h('div', { class: 'grid g4', style: 'margin-bottom:14px' },
        kpiCard('ตำแหน่งทั้งหมด', totalAll, ''),
        kpiCard('ใช้งาน', occAll, `${pctAll}%`, pctAll >= 85 ? 'red' : 'blue'),
        kpiCard('ว่าง', emptyAll, 'ตำแหน่ง', 'green'),
        kpiCard('RACK ที่แน่น (≥85%)', data.overloaded.length, 'ชั้นวาง', data.overloaded.length ? 'amber' : 'green')),

      h('h2', { style: 'margin-top:18px' }, 'สรุปแต่ละโซน'),
      table([
        { label: 'โซน', value: (r) => `${r.zone_code} — ${r.zone_name}` },
        { label: 'ตำแหน่ง', key: 'total', num: true },
        { label: 'มีสินค้า', key: 'occupied', num: true },
        { label: 'ว่าง', key: 'empty', num: true },
        { label: 'ปิดใช้งาน', key: 'disabled', num: true },
        { label: '% ใช้งาน', value: (r) => pill(`${r.usage_pct}%`, r.usage_pct >= 85 ? 'red' : r.usage_pct >= 60 ? 'amber' : 'green') },
      ], data.zones),
    ];

    if (data.overloaded.length) parts.push(h('div', {},
      h('h2', { style: 'margin-top:18px;color:var(--amber)' }, 'RACK ที่แน่นมาก (≥85%)'),
      table([
        { label: 'RACK', value: (r) => `${r.zone_code}-${r.rag_no}` },
        { label: 'โซน', key: 'zone_name' },
        { label: 'มีสินค้า', value: (r) => `${r.occupied}/${r.usable}`, num: true },
        { label: '% ใช้งาน', value: (r) => pill(`${r.usage_pct}%`, 'red') },
      ], data.overloaded)));

    if (data.underused.length) parts.push(h('div', {},
      h('h2', { style: 'margin-top:18px;color:var(--green)' }, 'RACK ที่ว่างมาก (≤20%)'),
      table([
        { label: 'RACK', value: (r) => `${r.zone_code}-${r.rag_no}` },
        { label: 'โซน', key: 'zone_name' },
        { label: 'มีสินค้า', value: (r) => `${r.occupied}/${r.usable}`, num: true },
        { label: '% ใช้งาน', value: (r) => pill(`${r.usage_pct}%`, 'green') },
      ], data.underused)));

    content.replaceChildren(...parts);
  }

  // ======== 4. การเคลื่อนไหว ========
  async function loadMovements() {
    let days = 30;
    const TYPE_LABEL = { STORE: 'จัดเก็บ', REMOVE: 'หยิบออก', MOVE: 'ย้าย', EDIT: 'แก้ไข' };
    const TYPE_COLOR = { STORE: 'green', REMOVE: 'amber', MOVE: 'blue', EDIT: 'gray' };

    const render = async () => {
      const data = await api.get('/api/reports/movements', { days, warehouse_id: wh.id });
      const dayBtns = h('div', { class: 'tabs', style: 'margin-bottom:14px' },
        ...[7, 14, 30, 60, 90].map((d) =>
          h('button', { class: d === days ? 'active' : '', onclick: () => { days = d; render(); } }, `${d} วัน`)));

      const totalActions = data.byType.reduce((a, r) => a + r.count, 0);
      const totalQty = data.byType.reduce((a, r) => a + r.total_qty, 0);

      const parts = [dayBtns,
        h('div', { class: 'grid g4', style: 'margin-bottom:14px' },
          kpiCard('รายการทั้งหมด', fmtNum(totalActions), `ใน ${days} วัน`),
          ...data.byType.map((t) =>
            kpiCard(TYPE_LABEL[t.movement_type] ?? t.movement_type, fmtNum(t.count), `${fmtNum(t.total_qty)} หน่วย`, TYPE_COLOR[t.movement_type]))),

        h('div', { class: 'grid g2', style: 'margin-top:14px' },
          h('div', { class: 'card' },
            h('h2', {}, 'สินค้าเคลื่อนไหวมากที่สุด (Top 10)'),
            data.topMoving.length
              ? table([
                  { label: 'รหัส', key: 'sku_code', mono: true },
                  { label: 'ชื่อสินค้า', key: 'sku_name' },
                  { label: 'ครั้ง', key: 'move_count', num: true },
                  { label: 'จำนวนรวม', value: (r) => `${fmtNum(r.total_qty)} ${r.unit}`, num: true },
                ], data.topMoving)
              : h('div', { class: 'empty-state' }, 'ไม่มีข้อมูล')),

          h('div', { class: 'card' },
            h('h2', {}, `สินค้าไม่เคลื่อนไหว (>${days} วัน)`),
            data.slowMoving.length
              ? table([
                  { label: 'สินค้า', value: (r) => `${r.sku_name}` },
                  { label: 'ตำแหน่ง', key: 'location_code', mono: true },
                  { label: 'จำนวน', value: (r) => `${fmtNum(r.quantity)} ${r.unit}`, num: true },
                  { label: 'อยู่มาแล้ว', value: (r) => pill(`${r.days_stored} วัน`, r.days_stored > 90 ? 'red' : 'amber') },
                ], data.slowMoving)
              : h('div', { class: 'empty-state' }, 'ไม่มีสินค้าค้างนาน'))),
      ];

      if (data.byDay.length) parts.push(h('div', { style: 'margin-top:14px' },
        h('div', { class: 'card' },
          h('h2', {}, 'จำนวนรายการต่อวัน'),
          miniChart(data.byDay, days))));

      content.replaceChildren(...parts);
    };
    await render();
  }

  // ======== 5. ประสิทธิภาพพนักงาน ========
  async function loadStaff() {
    let days = 30;
    const render = async () => {
      const data = await api.get('/api/reports/staff', { days, warehouse_id: wh.id });
      const dayBtns = h('div', { class: 'tabs', style: 'margin-bottom:14px' },
        ...[7, 14, 30, 60, 90].map((d) =>
          h('button', { class: d === days ? 'active' : '', onclick: () => { days = d; render(); } }, `${d} วัน`)));

      const totalActions = data.byUser.reduce((a, r) => a + r.total_actions, 0);

      content.replaceChildren(dayBtns,
        h('div', { class: 'grid g3', style: 'margin-bottom:14px' },
          kpiCard('รายการทั้งหมด', fmtNum(totalActions), `ใน ${days} วัน`),
          kpiCard('พนักงานที่ทำรายการ', data.byUser.length, 'คน'),
          kpiCard('เฉลี่ยต่อคน', data.byUser.length ? fmtNum(Math.round(totalActions / data.byUser.length)) : 0, 'รายการ')),

        data.byUser.length
          ? table([
              { label: 'ชื่อ', key: 'full_name' },
              { label: 'บทบาท', value: (r) => pill(r.role, r.role === 'ADMIN' ? 'blue' : 'green') },
              { label: 'ทั้งหมด', key: 'total_actions', num: true },
              { label: 'จัดเก็บ', key: 'stores', num: true },
              { label: 'หยิบออก', key: 'removes', num: true },
              { label: 'ย้าย', key: 'moves', num: true },
              { label: 'แก้ไข', key: 'edits', num: true },
              { label: 'จำนวนรวม', value: (r) => fmtNum(r.total_qty), num: true },
            ], data.byUser)
          : h('div', { class: 'empty-state' }, 'ไม่มีข้อมูล'));
    };
    await render();
  }

  renderTabs();
  await load();

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'รายงานผู้บริหาร'),
        h('p', {}, `ข้อมูลวิเคราะห์สำหรับการตัดสินใจ — คลัง: ${wh.label}`))),
    h('div', { class: 'card' }, tabBar, content));
}

// ======== helpers ========
function kpiCard(label, value, sub, color) {
  return h('div', { class: 'card kpi' },
    h('div', { class: 'label' }, label),
    h('div', { class: 'value', style: color ? `color:var(--${color})` : null }, value),
    h('div', { class: 'sub' }, sub));
}

function miniChart(byDay, days) {
  const dayMap = new Map();
  for (const r of byDay) {
    dayMap.set(r.day, (dayMap.get(r.day) || 0) + r.count);
  }
  const counts = [...dayMap.values()];
  const maxVal = Math.max(...counts, 1);

  return h('div', { class: 'spark', style: 'height:80px;gap:2px' },
    ...[...dayMap.entries()].slice(-Math.min(days, 60)).map(([day, count]) =>
      h('div', { title: `${day}: ${count} รายการ`, style: 'position:relative' },
        h('span', { style: `height:${Math.max((count / maxVal) * 100, 4)}%` }))));
}
