// ประวัติการเคลื่อนย้าย — immutable log (แก้ไข/ลบไม่ได้)
import { api, wh, download } from '../api.js?v=42';
import { h, table, pill, fmtDateTime, fmtNum, MOVE_LABEL, MOVE_COLOR } from '../ui.js?v=42';

export async function historyView() {
  const typeSel = h('select', {}, h('option', { value: '' }, 'ทุกประเภท'),
    ...Object.entries(MOVE_LABEL).map(([k, v]) => h('option', { value: k }, v)));
  const q = h('input', { placeholder: 'ค้นหา SKU / Lot / ตำแหน่ง' });
  const from = h('input', { type: 'date' });
  const to = h('input', { type: 'date' });
  const out = h('div', {});
  const summary = h('div', { class: 'muted', style: 'margin:8px 0' });

  async function load() {
    out.replaceChildren(h('div', { class: 'empty-state' }, 'กำลังโหลด…'));
    const rows = await api.get('/api/movements', { type: typeSel.value, q: q.value, from: from.value, to: to.value, warehouse_id: wh.id, limit: 300 });
    summary.textContent = `แสดง ${rows.length} รายการ`;
    out.replaceChildren(table([
      { label: '#', key: 'movement_id', num: true },
      { label: 'วันเวลา', value: (r) => fmtDateTime(r.moved_at) },
      { label: 'ประเภท', value: (r) => pill(MOVE_LABEL[r.movement_type] ?? r.movement_type, MOVE_COLOR[r.movement_type] ?? 'gray') },
      { label: 'สินค้า', value: (r) => h('div', {},
          h('div', {}, r.sku_name ?? '—'),
          h('div', { class: 'mono muted', style: 'font-size:11px' }, r.sku_code ?? '')) },
      { label: 'Lot', key: 'lot_no', mono: true },
      { label: 'จาก', key: 'from_code', mono: true },
      { label: 'ไป', key: 'to_code', mono: true },
      { label: 'จำนวน', value: (r) => fmtNum(r.quantity), num: true },
      { label: 'ผู้ทำรายการ', key: 'user_name' },
      { label: 'หมายเหตุ', value: (r) => h('span', { style: 'font-size:12px;color:#475569' }, r.note ?? '') },
    ], rows, { empty: 'ไม่พบรายการ' }));
  }

  [typeSel, from, to].forEach((el) => el.addEventListener('change', load));
  q.addEventListener('keydown', (e) => e.key === 'Enter' && load());
  await load();

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'ประวัติการเคลื่อนย้าย'),
        h('p', {}, `คลัง: ${wh.label} — ทุกรายการถูกบันทึกถาวร ตรวจสอบย้อนกลับได้ทั้งหมด`)),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', title: 'ดาวน์โหลดรายการตามเงื่อนไขที่กรองไว้เป็นไฟล์ CSV ไว้เปิดใน Excel หรือส่งให้ผู้ตรวจสอบ', onclick: () => download('/api/export/movements.csv', { type: typeSel.value, q: q.value, from: from.value, to: to.value, warehouse_id: wh.id }) }, '⬇️ ดาวน์โหลด CSV'))),
    h('div', { class: 'card' },
      h('div', { class: 'row' },
        h('div', {}, h('label', {}, 'ประเภท'), typeSel),
        h('div', { style: 'flex:2' }, h('label', {}, 'ค้นหา'), q),
        h('div', {}, h('label', {}, 'ตั้งแต่'), from),
        h('div', {}, h('label', {}, 'ถึง'), to)),
      summary,
      out));
}
