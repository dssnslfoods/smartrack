// ค้นหาสินค้า — ตอบคำถามหลัก "สินค้าตัวนี้อยู่ที่ไหน"
import { api, auth, wh, download } from '../api.js';
import { h, table, pill, expiryPill, field, fmtNum, fmtDateTime, scanInput, modal, MOVE_LABEL, MOVE_COLOR, pctPill } from '../ui.js?v=30';
import { itemActions } from '../actions.js';

async function checkEmptyLocation(q) {
  const code = (q ?? '').trim().toUpperCase();
  if (!code || code.length < 5) return null;
  try {
    const data = await api.get(`/api/locations/${encodeURIComponent(code)}`);
    const loc = data.location;
    if (!loc) return null;
    const statusLabel = { EMPTY: '📭 ว่าง — พร้อมจัดเก็บสินค้า', DISABLED: '🚫 ปิดใช้งาน', OCCUPIED: '📦 มีสินค้าอยู่' }[loc.status] || loc.status;
    const parts = [
      h('div', { class: 'card' },
        h('h2', {}, `ตำแหน่ง ${loc.location_code}`),
        h('div', { class: 'grid g2', style: 'margin:12px 0' },
          h('div', {}, h('div', { class: 'muted', style: 'font-size:12px' }, 'สถานะ'), h('div', { style: 'font-weight:600' }, statusLabel)),
          h('div', {}, h('div', { class: 'muted', style: 'font-size:12px' }, 'ชั้นวาง'), h('div', { style: 'font-weight:600' }, loc.rag_no)),
          h('div', {}, h('div', { class: 'muted', style: 'font-size:12px' }, 'โซน'), h('div', { style: 'font-weight:600' }, `${loc.zone_code} — ${loc.zone_name}`)),
          h('div', {}, h('div', { class: 'muted', style: 'font-size:12px' }, 'ชั้น / ตอน'), h('div', { style: 'font-weight:600' }, `L${loc.level} / D${loc.depth}`))),
        h('a', { class: 'btn primary', href: `#/map/${loc.rag_id}?loc=${loc.location_code}` }, '🗺️ ดูบนแผนผัง')),
    ];
    if (data.history && data.history.length) {
      parts.push(h('div', { class: 'card', style: 'margin-top:14px' },
        h('h2', {}, 'ประวัติการเคลื่อนย้ายของตำแหน่งนี้'),
        table([
          { label: 'เวลา', value: (m) => fmtDateTime(m.moved_at) },
          { label: 'รายการ', value: (m) => pill(MOVE_LABEL[m.movement_type], MOVE_COLOR[m.movement_type]) },
          { label: 'สินค้า', key: 'sku_name' },
          { label: 'จำนวน', value: (m) => fmtNum(m.quantity), num: true },
          { label: 'จาก', key: 'from_code', mono: true },
          { label: 'ไป', key: 'to_code', mono: true },
          { label: 'ผู้ทำรายการ', key: 'user_name' },
          { label: 'หมายเหตุ', key: 'note' },
        ], data.history)));
    }
    return h('div', {}, ...parts);
  } catch { return null; }
}

export async function searchView({ params }) {
  const q = params.get('q') ?? '';
  const zones = await api.get('/api/zones');

  const input = scanInput('พิมพ์ชื่อสินค้า / รหัสสินค้า / Lot / รหัสตำแหน่ง — หรือสแกนบาร์โค้ด', (v) => {
    location.hash = `#/search?q=${encodeURIComponent(v)}`;
  });
  input.value = q;

  const zoneSel = h('select', { onchange: () => run() },
    h('option', { value: '' }, 'ทุกโซน'),
    ...zones.map((z) => h('option', { value: z.zone_id }, `${z.zone_code} — ${z.zone_name}`)));

  // ---- ตัวกรองเพิ่มเติม: อายุคงเหลือ / จำนวนคงเหลือ ----
  const minDays = h('input', { type: 'number', min: '0', placeholder: 'เช่น 90' });
  const maxDays = h('input', { type: 'number', min: '0', placeholder: 'ไม่จำกัด' });
  const minQty = h('input', { type: 'number', min: '0', placeholder: 'เช่น 100' });
  const filters = [minDays, maxDays, minQty];
  filters.forEach((el) => {
    el.addEventListener('change', () => run());
    el.addEventListener('keydown', (e) => e.key === 'Enter' && run());
  });
  const clearFilters = h('button', {
    class: 'btn ghost',
    onclick: () => { filters.forEach((el) => { el.value = ''; }); zoneSel.value = ''; run(); },
  }, 'ล้างตัวกรอง');

  const filterRow = h('details', { class: 'filter-box' },
    h('summary', {}, '⚙️ ตัวกรองเพิ่มเติม — อายุคงเหลือ / จำนวน'),
    h('div', { class: 'row', style: 'margin-top:10px' },
      field('อายุคงเหลืออย่างน้อย (วัน)', minDays, null, 'แสดงเฉพาะสินค้าที่เหลืออายุอย่างน้อยกี่วัน — เว้นว่างคือไม่กำหนด'),
      field('อายุคงเหลือไม่เกิน (วัน)', maxDays, null, 'แสดงเฉพาะสินค้าที่เหลืออายุไม่เกินกี่วัน — ใช้หาของใกล้หมดอายุ'),
      field('จำนวนคงเหลืออย่างน้อย', minQty, null, 'แสดงเฉพาะตำแหน่งที่มีสินค้าอย่างน้อยเท่านี้'),
      h('div', { style: 'flex:0' }, clearFilters)));

  const query = () => ({
    q, zone_id: zoneSel.value, warehouse_id: wh.id,
    min_days: minDays.value, max_days: maxDays.value, min_qty: minQty.value,
  });

  const summary = h('div', { class: 'muted', style: 'margin:10px 0' });
  const results = h('div', {});

  async function run() {
    results.replaceChildren(h('div', { class: 'empty-state' }, 'กำลังค้นหา…'));
    const t0 = performance.now();
    const rows = await api.get('/api/stock', { ...query(), limit: 500 });
    const ms = Math.round(performance.now() - t0);
    const filtered = [minDays.value, maxDays.value, minQty.value].some(Boolean);
    summary.textContent = q
      ? (rows.length ? `พบ ${rows.length} รายการ (${ms} ms)` : `ไม่พบสินค้าที่ตรงกับ "${q}"${filtered ? ' ตามตัวกรองที่เลือก' : ''}`)
      : `แสดงสินค้า${filtered ? 'ตามตัวกรอง' : 'ทั้งหมดในคลัง'} ${rows.length} รายการ (${ms} ms)`;

    if (rows.length) {
      results.replaceChildren(table([
        { label: 'ตำแหน่ง', value: (r) => h('a', { href: `#/map/${r.rag_id}?loc=${r.location_code}` }, r.location_code), mono: true },
        { label: 'สินค้า', value: (r) => h('div', {},
            h('div', { style: 'font-weight:600' }, r.sku_name),
            h('div', { class: 'mono muted', style: 'font-size:12px' }, r.sku_code)) },
        { label: 'ชั้น / ตอน', value: (r) => `L${r.level} / D${r.depth}` },
        { label: 'Lot', key: 'lot_no', mono: true },
        { label: 'จำนวน', value: (r) => `${fmtNum(r.quantity)} ${r.unit}`, num: true },
        { label: 'วันหมดอายุ', value: (r) => (r.exp_date ? h('div', {}, r.exp_date, ' ', expiryPill(r.expiry)) : '—') },
        { label: '% อายุ', value: (r) => pctPill(r.pct_remaining) },
        { label: 'หมายเหตุ', value: (r) => (r.needs_forklift ? pill('ชั้นสูง — ใช้รถยก', 'blue') : null) },
        { label: '', value: (r) => h('button', { class: 'btn ghost', onclick: () => detail(r) }, 'รายละเอียด') },
      ], rows));
    } else {
      // ถ้ากำลังกรองอยู่ การบอกว่า "ตำแหน่งนี้ว่าง" จะทำให้เข้าใจผิด — ข้ามไป
      const locEl = filtered ? null : await checkEmptyLocation(q);
      if (locEl) { summary.textContent = `พบตำแหน่ง "${q}" ในระบบ`; results.replaceChildren(locEl); return; }

      // ค้นจาก SKU Master — แม้ไม่มีสต๊อกในคลัง ก็แสดงข้อมูลสินค้าได้
      if (q && !filtered) {
        try {
          const skus = await api.get('/api/skus', { q, warehouse_id: wh.id });
          if (skus.length) {
            summary.textContent = `ไม่พบสินค้า "${q}" ในคลัง — แต่พบข้อมูลสินค้าที่ตรงกัน ${skus.length} รายการ`;
            results.replaceChildren(
              h('div', { class: 'card', style: 'margin-top:8px;background:#fffbeb;border:1px solid #f59e0b;border-radius:8px;padding:12px 16px' },
                h('div', { style: 'font-weight:600;margin-bottom:4px' }, '⚠️ สินค้าเหล่านี้มีในระบบแต่ยังไม่มีสต๊อกในคลังที่เลือก')),
              table([
                { label: 'รหัสสินค้า', key: 'sku_code', mono: true },
                { label: 'ชื่อสินค้า', key: 'sku_name' },
                { label: 'หมวดหมู่', value: (r) => r.category || '—' },
                { label: 'หน่วยนับ', key: 'unit' },
                { label: 'บาร์โค้ด', value: (r) => r.barcode || '—', mono: true },
                { label: 'ตำแหน่งที่ใช้', value: (r) => fmtNum(r.locations_used), num: true },
                { label: 'จำนวนรวม', value: (r) => `${fmtNum(r.qty_in_stock)} ${r.unit}`, num: true },
                { label: 'สถานะ', value: (r) => pill(r.status === 'ACTIVE' ? 'ใช้งาน' : 'ปิด', r.status === 'ACTIVE' ? 'green' : 'gray') },
              ], skus));
            return;
          }
        } catch {}
      }

      results.replaceChildren(h('div', { class: 'empty-state' },
        h('p', {}, `ไม่พบสินค้าที่ตรงกับ "${q}"`),
        h('p', { style: 'font-size:13px' },
          filtered ? 'ลองผ่อนเงื่อนไขตัวกรอง หรือกด "ล้างตัวกรอง"' : 'ลองพิมพ์ชื่อสินค้าบางส่วน, รหัสสินค้า, Lot หรือรหัสตำแหน่ง')));
    }
  }

  async function detail(r) {
    const { item, history } = await api.get(`/api/items/${r.item_id}`);
    const kv = (k, v) => h('div', {}, h('div', { class: 'muted', style: 'font-size:12px' }, k), h('div', { style: 'font-weight:600' }, v ?? '—'));
    const m = modal(item.sku_name,
      h('div', {},
        h('div', { class: 'grid g2' },
          kv('ตำแหน่ง', item.location_code), kv('รหัสสินค้า', item.sku_code),
          kv('Lot / รุ่นการผลิต', item.lot_no), kv('จำนวน', `${fmtNum(item.quantity)} ${item.unit}`),
          kv('วันหมดอายุ', item.exp_date ? `${item.exp_date} (${item.expiry.label})` : '—'),
          kv('จัดเก็บเมื่อ', fmtDateTime(item.stored_at))),
        h('h2', { style: 'margin-top:16px' }, 'ประวัติของรายการนี้'),
        table([
          { label: 'เวลา', value: (x) => fmtDateTime(x.moved_at) },
          { label: 'รายการ', value: (x) => ({ STORE: 'จัดเก็บเข้า', REMOVE: 'หยิบออก', MOVE: 'ย้ายตำแหน่ง', EDIT: 'แก้ไขข้อมูล' }[x.movement_type]) },
          { label: 'จาก', key: 'from_code', mono: true },
          { label: 'ไป', key: 'to_code', mono: true },
          { label: 'จำนวน', value: (x) => fmtNum(x.quantity), num: true },
          { label: 'ผู้ทำรายการ', key: 'user_name' },
          { label: 'หมายเหตุ', key: 'note' },
        ], history)),
      [
        h('a', { class: 'btn', href: `#/map/${item.rag_id}?loc=${item.location_code}` }, '🗺️ ดูบนแผนผัง'),
        ...itemActions(item, () => { m.close(); run(); }),
      ]);
  }

  run();
  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'ค้นหาสินค้าในคลัง'),
        h('p', {}, `คลัง: ${wh.label} — ค้นหาว่าสินค้าอยู่ชั้นวางไหน ชั้นใด ตอนที่เท่าไร`)),
      h('div', { class: 'actions' },
        h('a', { class: 'btn', href: '#/pick' }, '📤 วางแผนหยิบสินค้า'),
        h('button', { class: 'btn', onclick: () => download('/api/export/stock.csv', query()) }, '⬇️ ดาวน์โหลด Excel (CSV)'))),
    h('div', { class: 'card' },
      h('div', { class: 'row scan' }, h('div', { style: 'flex:3' }, input), h('div', { style: 'flex:1' }, zoneSel)),
      filterRow,
      summary, results));
}
