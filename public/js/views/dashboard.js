// หน้าแรก — สรุปว่าคลังใช้ไปเท่าไร ว่างเท่าไร และรายการเคลื่อนย้ายล่าสุด
import { api, auth, wh } from '../api.js';

import { h, table, pill, fmtDateTime, fmtNum, MOVE_LABEL, MOVE_COLOR, scanInput, toast } from '../ui.js';

export async function dashboardView() {
  const d = await api.get('/api/dashboard', { warehouse_id: wh.id });

  const kpi = (label, value, sub, extra) =>
    h('div', { class: 'card kpi' }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, value),
      sub ? h('div', { class: 'sub' }, sub) : null, extra);

  const jump = scanInput('สแกนป้ายตำแหน่ง หรือพิมพ์รหัสตำแหน่ง แล้วกด Enter', (v) => {
    location.hash = `#/search?q=${encodeURIComponent(v)}`;
  }, { autofocus: false });

  const zones = h('div', { class: 'card' },
    h('h2', {}, 'การใช้พื้นที่แต่ละโซน'),
    table([
      { label: 'โซน', value: (z) => `${z.zone_code} — ${z.zone_name}` },
      { label: 'ตำแหน่งทั้งหมด', key: 'total', num: true },
      { label: 'มีสินค้า', key: 'occupied', num: true },
      { label: 'ว่าง', key: 'empty', num: true },
      { label: 'ใช้ไป', value: (z) => h('div', {}, `${z.usage_pct}%`, h('div', { class: 'bar' }, h('span', { style: `width:${z.usage_pct}%` }))) },
    ], d.zones, { empty: 'ยังไม่มีข้อมูลโซน' }));

  const recent = h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, 'การเคลื่อนย้ายล่าสุด'),
      h('a', { class: 'btn ghost', href: '#/history' }, 'ดูทั้งหมด')),
    table([
      { label: 'เวลา', value: (m) => fmtDateTime(m.moved_at) },
      { label: 'รายการ', value: (m) => pill(MOVE_LABEL[m.movement_type], MOVE_COLOR[m.movement_type]) },
      { label: 'สินค้า', key: 'sku_name' },
      { label: 'จำนวน', value: (m) => fmtNum(m.quantity), num: true },
      { label: 'จาก', key: 'from_code', mono: true },
      { label: 'ไป', key: 'to_code', mono: true },
      { label: 'ผู้ทำรายการ', key: 'user_name' },
    ], d.recent_movements, { empty: 'ยังไม่มีรายการ' }));

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, `ภาพรวมคลังสินค้า`), h('p', {}, `คลัง: ${wh.label} · ข้อมูล ณ ${new Date().toLocaleString('th-TH')}`)),
      h('div', { class: 'actions' },
        auth.can('move') ? h('a', { class: 'btn primary', href: '#/map' }, '📥 จัดเก็บสินค้า') : null,
        h('a', { class: 'btn', href: '#/search' }, '🔍 ค้นหาสินค้า'))),
    h('div', { class: 'grid g4' },
      kpi('ใช้พื้นที่ไป', `${d.warehouse.usage_pct}%`, `${fmtNum(d.warehouse.occupied)} จาก ${fmtNum(d.warehouse.usable)} ตำแหน่ง`,
        h('div', { class: 'bar' }, h('span', { style: `width:${d.warehouse.usage_pct}%` }))),
      kpi('ตำแหน่งว่าง', fmtNum(d.warehouse.empty), 'พร้อมจัดเก็บสินค้า'),
      kpi('รายการที่จัดเก็บอยู่', fmtNum(d.items_in_stock), `รวม ${fmtNum(d.total_quantity)} หน่วย`),
      kpi('ชนิดสินค้าในคลัง', fmtNum(d.sku_count), 'รายการสินค้า (SKU)')),
    h('div', { class: 'card', style: 'margin-top:14px' },
      h('h2', {}, 'ค้นหาเร็ว'),
      h('div', { class: 'scan' }, jump),
      h('p', { class: 'muted', style: 'margin-bottom:0' },
        'สแกนป้ายที่ติดอยู่หน้าชั้นวาง เพื่อดูว่าตำแหน่งนั้นเก็บสินค้าอะไรอยู่')),
    h('div', { class: 'grid g2', style: 'margin-top:14px' }, zones, recent));
}
