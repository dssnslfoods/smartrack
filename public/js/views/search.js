// ค้นหาสินค้า — ตอบคำถามหลัก "สินค้าตัวนี้อยู่ที่ไหน"
import { api, auth, wh, download } from '../api.js?v=52';
import { h, table, pill, expiryPill, field, fmtNum, fmtDateTime, scanInput, modal, MOVE_LABEL, MOVE_COLOR, pctPill, PTYPE_LABEL } from '../ui.js?v=52';
import { itemActions } from '../actions.js?v=52';

// ---- สเกลสีตามอายุคงเหลือ — ยิ่งแดงยิ่งต้องรีบระบาย ----
const EXP_SCALE = [
  { max: 0, color: '#b91c1c', label: 'หมดอายุแล้ว' },
  { max: 30, color: '#ea580c', label: 'ไม่ถึง 30 วัน' },
  { max: 90, color: '#f59e0b', label: '30–90 วัน' },
  { max: 180, color: '#ca8a04', label: '90–180 วัน' },
  { max: 365, color: '#65a30d', label: '180 วัน–1 ปี' },
  { max: Infinity, color: '#15803d', label: 'มากกว่า 1 ปี' },
];
const NO_EXP = { color: '#64748b', label: 'ไม่ระบุวันหมดอายุ' };
const expColor = (days) => (days === null || days === undefined
  ? NO_EXP.color
  : (EXP_SCALE.find((s) => days < s.max) ?? EXP_SCALE.at(-1)).color);

// ---- ชนิดที่จัดเก็บ: ชั้นวาง / พื้นราบ / พื้นที่เศษ ----
const ZT_LABEL = { RACK: 'ชั้นวาง', FLOOR: 'พื้นราบ', BREAK: 'พื้นที่เศษ' };
const ZT_COLOR = { RACK: 'gray', FLOOR: 'amber', BREAK: 'blue' };
const ZT_TITLE = { FLOOR: '🟧 พื้นราบ', BREAK: '📦 พื้นที่เศษ (แกะลังแล้ว)' };
const ztPill = (t) => pill(ZT_LABEL[t] ?? t ?? '—', ZT_COLOR[t] ?? 'gray');

/**
 * รหัสตำแหน่ง — ลิงก์ไปแผนผังชั้นวางได้เฉพาะของที่อยู่บนชั้นวางเท่านั้น
 * ของบนพื้นราบ/พื้นที่เศษไม่มี rag_id ถ้าลิงก์ไปจะกลายเป็น #/map/null แล้วเปิดไม่ได้
 */
const locCode = (r) => (r.rag_id
  ? h('a', {
      class: 'mono',
      title: 'เปิดแผนผังชั้นวางแล้วเน้นช่องนี้ให้ — ใช้ดูว่าของอยู่ชั้นไหน ตอนไหน',
      href: `#/map/${r.rag_id}?loc=${r.location_code}`,
    }, r.location_code)
  : h('span', { class: 'mono', title: 'ตำแหน่งนี้ไม่ได้อยู่บนชั้นวาง จึงไม่มีแผนผังให้เปิด' }, r.location_code));

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
          h('div', {}, h('div', { class: 'muted', style: 'font-size:12px' }, 'ชั้นวาง'), h('div', { style: 'font-weight:600' }, loc.rag_no ?? ztPill(loc.zone_type))),
          h('div', {}, h('div', { class: 'muted', style: 'font-size:12px' }, 'โซน'), h('div', { style: 'font-weight:600' }, `${loc.zone_code} — ${loc.zone_name}`)),
          h('div', {}, h('div', { class: 'muted', style: 'font-size:12px' }, 'ชั้น / ตอน'), h('div', { style: 'font-weight:600' },
            loc.rag_id ? `L${loc.level} / D${loc.depth}` : (loc.slot_no ? `ช่อง ${loc.slot_no}` : '—')))),
        // ตำแหน่งพื้นราบ/พื้นที่เศษไม่มีชั้นวาง จึงไม่มีแผนผังให้เปิด
        loc.rag_id
          ? h('a', { class: 'btn primary', title: 'เปิดแผนผังชั้นวางแล้วเน้นช่องนี้ให้ — ใช้ดูว่าตำแหน่งอยู่ชั้นไหน ตอนไหน และรอบ ๆ มีของอะไรอยู่', href: `#/map/${loc.rag_id}?loc=${loc.location_code}` }, '🗺️ ดูบนแผนผัง')
          : h('div', { class: 'muted', style: 'font-size:13px' }, 'ตำแหน่งนี้ไม่ได้อยู่บนชั้นวาง จึงไม่มีแผนผังให้เปิด')),
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

  // ---- ตัวกรองเพิ่มเติม ----
  const skus = await api.get('/api/skus', { warehouse_id: wh.id }).catch(() => []);
  const allRags = await api.get('/api/rags', { warehouse_id: wh.id }).catch(() => []);
  const categories = [...new Set(skus.map((s) => s.category).filter(Boolean))].sort();

  const opt = (v, label, sel) => h('option', { value: v, ...(sel ? { selected: true } : {}) }, label);
  const num = (ph) => h('input', { type: 'number', min: '0', placeholder: ph });

  const skuSel = h('select', {},
    opt('', '— ทุกสินค้า —'),
    ...skus.map((s) => opt(s.sku_id, `${s.sku_code} — ${s.sku_name}`)));
  const ragSel = h('select', {}, opt('', '— ทุกชั้นวาง —'));
  const ptypeSel = h('select', {},
    opt('', '— ทุกประเภท —'),
    ...Object.entries(PTYPE_LABEL).map(([k, v]) => opt(k, v)));
  const catSel = h('select', {},
    opt('', '— ทุกหมวดหมู่ —'), ...categories.map((c) => opt(c, c)));
  const expStatusSel = h('select', {},
    opt('', '— ทุกสถานะ —'),
    opt('EXPIRED', '🔴 หมดอายุแล้ว'),
    opt('CRITICAL', '🟠 วิกฤต — เหลือไม่ถึง 30 วัน'),
    opt('WARNING', '🟡 เฝ้าระวัง — เหลือ 30–90 วัน'),
    opt('OK', '🟢 ปกติ — เหลือเกิน 90 วัน'),
    opt('NONE', '⚪ ไม่ระบุวันหมดอายุ'));
  const zoneTypeSel = h('select', {},
    opt('', '— ทุกที่จัดเก็บ —'),
    opt('RACK', '🗄️ ชั้นวาง'),
    opt('FLOOR', '🟧 พื้นราบ'),
    opt('BREAK', '📦 พื้นที่เศษ (แกะลังแล้ว)'));
  // ช่องซ่อน — ตั้งค่าได้จากปุ่มลัดอย่างเดียว แต่ต้องถูกนับและถูกล้างเหมือนตัวกรองอื่น
  const looseSel = h('select', { hidden: true },
    opt('', '— ทั้งลังเต็มและเศษ —'),
    opt('1', 'เฉพาะของที่แกะลังแล้ว'),
    opt('0', 'เฉพาะลังที่ยังไม่แกะ'));
  const levelSel = h('select', {},
    opt('', '— ทุกชั้น —'),
    opt('ground', '🙌 ชั้นล่าง (L1) — หยิบด้วยมือ'),
    opt('high', '🏗️ ชั้นสูง (L2+) — ต้องใช้รถยก'),
    opt('1', 'เฉพาะ L1'), opt('2', 'เฉพาะ L2'), opt('3', 'เฉพาะ L3'), opt('4', 'เฉพาะ L4'));
  const sortSel = h('select', {},
    opt('fefo', 'FEFO — ใกล้หมดอายุก่อน'),
    opt('expiry_desc', 'อายุเหลือมากก่อน'),
    opt('qty_desc', 'จำนวนมาก → น้อย'),
    opt('qty_asc', 'จำนวนน้อย → มาก'),
    opt('location', 'ตามตำแหน่งในคลัง'),
    opt('sku', 'ตามรหัสสินค้า'),
    opt('newest', 'จัดเก็บล่าสุดก่อน'));

  const minDays = num('เช่น 90');
  const maxDays = num('ไม่จำกัด');
  const minQty = num('เช่น 100');
  const maxQty = num('ไม่จำกัด');
  const minPct = num('เช่น 50');
  const maxPct = num('ไม่จำกัด');
  const expFrom = h('input', { type: 'date' });
  const expTo = h('input', { type: 'date' });
  const lotInput = h('input', { placeholder: 'เช่น 2569-158' });

  // ชั้นวางขึ้นกับโซนที่เลือก — เลือกโซนแล้วรายการชั้นวางต้องแคบลงตาม
  function syncRags() {
    const zid = zoneSel.value;
    const list = zid ? allRags.filter((r) => String(r.zone_id) === String(zid)) : allRags;
    const keep = ragSel.value;
    ragSel.replaceChildren(opt('', '— ทุกชั้นวาง —'),
      ...list.map((r) => opt(r.rag_id, `${r.zone_code}-${r.rag_no}`)));
    if (list.some((r) => String(r.rag_id) === keep)) ragSel.value = keep;
  }
  syncRags();
  zoneSel.addEventListener('change', syncRags);

  const selects = [zoneSel, skuSel, ragSel, ptypeSel, catSel, expStatusSel, levelSel, zoneTypeSel, looseSel, sortSel];
  const inputs = [minDays, maxDays, minQty, maxQty, minPct, maxPct, expFrom, expTo, lotInput];
  selects.forEach((el) => el.addEventListener('change', () => run()));
  inputs.forEach((el) => {
    el.addEventListener('change', () => run());
    el.addEventListener('keydown', (e) => e.key === 'Enter' && run());
  });

  const activeCount = () =>
    [...selects.filter((el) => el !== sortSel), ...inputs].filter((el) => el.value).length;

  const clearFilters = h('button', {
    class: 'btn ghost',
    title: 'ล้างเงื่อนไขกรองทุกช่องกลับเป็นค่าเริ่มต้น (เรียงแบบ FEFO) แล้วค้นใหม่ — คำค้นในช่องบนสุดยังอยู่เหมือนเดิม',
    onclick: () => {
      [...selects.filter((el) => el !== sortSel), ...inputs].forEach((el) => { el.value = ''; });
      sortSel.value = 'fefo';
      syncRags();
      run();
    },
  }, '✕ ล้างตัวกรองทั้งหมด');

  // ปุ่มลัดสำหรับงานที่ทำบ่อย — กดครั้งเดียวได้ชุดเงื่อนไขที่ใช้จริงหน้างาน
  const preset = (label, tip, apply) => h('button', {
    class: 'btn ghost', style: 'font-size:12px;padding:5px 10px', title: tip,
    onclick: () => {
      [...selects.filter((el) => el !== sortSel), ...inputs].forEach((el) => { el.value = ''; });
      syncRags(); apply(); run();
    },
  }, label);

  const presets = h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px' },
    h('span', { class: 'muted', style: 'font-size:12px;align-self:center;margin-right:2px' }, 'ลัด:'),
    preset('🔴 หมดอายุแล้ว', 'ของที่เลยวันหมดอายุ ต้องตัดออกจากระบบ',
      () => { expStatusSel.value = 'EXPIRED'; }),
    preset('🟠 ต้องรีบระบาย (< 30 วัน)', 'ของที่เหลืออายุไม่ถึง 30 วัน',
      () => { expStatusSel.value = 'CRITICAL'; sortSel.value = 'fefo'; }),
    preset('🟡 เฝ้าระวัง (30–90 วัน)', 'ของที่ควรวางแผนระบายภายใน 3 เดือน',
      () => { expStatusSel.value = 'WARNING'; }),
    preset('⚪ ไม่ระบุวันหมดอายุ', 'Lot ที่ยังไม่ได้กรอกวันหมดอายุ — ควรตามแก้ข้อมูล',
      () => { expStatusSel.value = 'NONE'; }),
    preset('🙌 หยิบง่าย (ชั้น L1)', 'ของที่อยู่ชั้นล่าง หยิบด้วยมือได้ ไม่ต้องใช้รถยก',
      () => { levelSel.value = 'ground'; }),
    preset('📦 ของเยอะ (500+)', 'ตำแหน่งที่มีของตั้งแต่ 500 หน่วยขึ้นไป',
      () => { minQty.value = '500'; sortSel.value = 'qty_desc'; }),
    preset('📦 เฉพาะของที่แกะลังแล้ว', 'ของที่แกะออกจากลังแล้วเหลือเป็นเศษ — ควรระบายก่อนลังเต็ม',
      () => { looseSel.value = '1'; }));

  const filterRow = h('details', { class: 'filter-box' },
    h('summary', {}, '⚙️ ตัวกรองเพิ่มเติม — สินค้า · ตำแหน่ง · อายุ · จำนวน'),
    h('div', { style: 'margin-top:12px' },
      presets,
      h('div', { class: 'row' },
        field('สินค้า (SKU)', skuSel, null, 'เจาะจงสินค้าตัวเดียว — ใช้เมื่ออยากดูทุก Lot ของสินค้านั้น'),
        field('ประเภทสินค้า', ptypeSel, null, 'วัตถุดิบ / บรรจุภัณฑ์ / สำเร็จรูป — ตามที่ตั้งไว้ในข้อมูลสินค้า'),
        field('หมวดหมู่', catSel, null, 'หมวดย่อยของสินค้า เช่น ครีม สบู่ แชมพู')),
      h('div', { class: 'row' },
        field('ที่จัดเก็บ', zoneTypeSel, null, 'ชั้นวาง = เก็บบน RACK · พื้นราบ = วางพาเลทกับพื้น · พื้นที่เศษ = ของที่แกะลังแล้ว'),
        field('ชั้นวาง (RACK)', ragSel, null, 'เจาะจงชั้นวาง — รายการจะแคบลงตามโซนที่เลือกไว้ด้านบน'),
        field('ชั้น (Level)', levelSel, null, 'ชั้นล่างหยิบด้วยมือได้ ชั้นสูงต้องใช้รถยก — ใช้วางแผนกำลังคน'),
        field('Lot / รุ่นการผลิต', lotInput, null, 'ค้นเฉพาะ Lot ที่ต้องการ เช่น ตอนเรียกคืนสินค้า (recall)')),
      h('div', { class: 'row' },
        field('สถานะอายุ', expStatusSel, null, 'กรองตามระดับความเร่งด่วน ใช้เกณฑ์เดียวกับป้ายสีในตาราง'),
        field('อายุคงเหลืออย่างน้อย (วัน)', minDays, null, 'แสดงเฉพาะสินค้าที่เหลืออายุอย่างน้อยกี่วัน — เว้นว่างคือไม่กำหนด'),
        field('อายุคงเหลือไม่เกิน (วัน)', maxDays, null, 'แสดงเฉพาะสินค้าที่เหลืออายุไม่เกินกี่วัน — ใช้หาของใกล้หมดอายุ')),
      h('div', { class: 'row' },
        field('% อายุคงเหลืออย่างน้อย', minPct, null, 'ใช้ตอนเช็คว่าของพอส่งช่องทางที่กำหนด % ขั้นต่ำไว้หรือไม่ เช่น MT = 80%'),
        field('% อายุคงเหลือไม่เกิน', maxPct, null, 'ใช้หาของที่ % อายุตกลงมาแล้ว ควรย้ายไปช่องทางลดราคา'),
        field('หมดอายุตั้งแต่วันที่', expFrom, null, 'กรองตามวันหมดอายุจริง — ใช้คู่กับช่องถัดไปเป็นช่วงวันที่')),
      h('div', { class: 'row' },
        field('หมดอายุถึงวันที่', expTo, null, 'กรองตามวันหมดอายุจริง เช่น ดูของที่หมดอายุภายในเดือนนี้'),
        field('จำนวนคงเหลืออย่างน้อย', minQty, null, 'แสดงเฉพาะตำแหน่งที่มีสินค้าอย่างน้อยเท่านี้'),
        field('จำนวนคงเหลือไม่เกิน', maxQty, null, 'ใช้หาตำแหน่งที่ของใกล้หมด ควรเติมหรือรวมพาเลท')),
      h('div', { class: 'row' },
        field('เรียงลำดับ', sortSel, null, 'FEFO = ของที่หมดอายุก่อนขึ้นก่อน ซึ่งเป็นลำดับที่ควรหยิบไปใช้'),
        h('div', { style: 'flex:2' }),
        h('div', { style: 'flex:0;align-self:flex-end;padding-bottom:2px' }, clearFilters))));

  const query = () => ({
    q, zone_id: zoneSel.value, warehouse_id: wh.id,
    sku_id: skuSel.value, rag_id: ragSel.value,
    product_type: ptypeSel.value, category: catSel.value,
    level: levelSel.value, lot: lotInput.value.trim(),
    zone_type: zoneTypeSel.value, loose: looseSel.value,
    expiry_status: expStatusSel.value,
    min_days: minDays.value, max_days: maxDays.value,
    min_pct: minPct.value, max_pct: maxPct.value,
    exp_from: expFrom.value, exp_to: expTo.value,
    min_qty: minQty.value, max_qty: maxQty.value,
    sort: sortSel.value,
  });

  const summary = h('div', { class: 'muted', style: 'margin:10px 0' });
  const results = h('div', {});

  // ---- สลับมุมมอง: ตาราง / แผนผังชั้นวาง ----
  let mode = localStorage.getItem('searchView') === 'map' ? 'map' : 'table';
  let lastRows = [];
  const tabBtn = h('button', { title: 'แสดงผลค้นหาเป็นตาราง — เห็น Lot วันหมดอายุ และจำนวนครบทุกคอลัมน์', onclick: () => setMode('table') }, '📋 ตาราง');
  const mapBtn = h('button', { title: 'แสดงผลค้นหาเป็นแผนผังชั้นวาง — เห็นว่าของวางอยู่ช่องไหนจริง ๆ สีบอกอายุคงเหลือ', onclick: () => setMode('map') }, '🗺️ แผนผัง');
  const viewToggle = h('div', { class: 'view-toggle' }, tabBtn, mapBtn);
  const syncToggle = () => {
    tabBtn.classList.toggle('on', mode === 'table');
    mapBtn.classList.toggle('on', mode === 'map');
  };
  function setMode(next) {
    if (mode === next) return;
    mode = next;
    localStorage.setItem('searchView', next);
    syncToggle();
    if (lastRows.length) paint();
  }
  syncToggle();

  async function paint() {
    if (mode === 'map') {
      results.replaceChildren(h('div', { class: 'empty-state' }, 'กำลังวาดแผนผัง…'));
      results.replaceChildren(await renderMap(lastRows));
    } else {
      results.replaceChildren(renderTable(lastRows));
    }
  }

  const renderTable = (rows) => table([
    { label: 'ตำแหน่ง', value: (r) => h('div', {},
        locCode(r),
        h('div', { style: 'margin-top:3px' }, ztPill(r.zone_type))) },
    { label: 'สินค้า', value: (r) => h('div', {},
        h('div', { style: 'font-weight:600' }, r.sku_name),
        h('div', { class: 'mono muted', style: 'font-size:12px' }, r.sku_code)) },
    // พื้นราบ/พื้นที่เศษไม่มีชั้นกับตอน (เป็น 0/ว่าง) — ใช้เลขช่องแทนไม่ให้อ่านผิด
    { label: 'ชั้น / ตอน', value: (r) => (r.rag_id ? `L${r.level} / D${r.depth}` : (r.slot_no ? `ช่อง ${r.slot_no}` : '—')) },
    { label: 'Lot', key: 'lot_no', mono: true },
    { label: 'พาเลท', value: (r) => h('div', { style: 'display:flex;align-items:center;gap:6px;flex-wrap:wrap' },
        h('span', { class: 'mono' }, r.pallet_no ?? '—'),
        r.is_loose ? pill('เศษ', 'amber') : null) },
    { label: 'จำนวน', value: (r) => `${fmtNum(r.quantity)} ${r.unit}`, num: true },
    { label: 'วันหมดอายุ', value: (r) => (r.exp_date ? h('div', {}, r.exp_date, ' ', expiryPill(r.expiry)) : '—') },
    { label: '% อายุ', value: (r) => pctPill(r.pct_remaining) },
    { label: 'หมายเหตุ', value: (r) => (r.needs_forklift ? pill('ชั้นสูง — ใช้รถยก', 'blue') : null) },
    { label: '', value: (r) => h('button', { class: 'btn ghost', title: 'ดูข้อมูลเต็มของรายการนี้ พร้อมประวัติการจัดเก็บ/หยิบ/ย้าย และปุ่มสั่งย้ายหรือหยิบออก', onclick: () => detail(r) }, 'รายละเอียด') },
  ], rows);

  // ---- แผนผังชั้นวาง: วาดทุก RACK ที่พบสินค้า ช่องที่ตรงผลค้นหาจะเน้นสีตามอายุคงเหลือ ----
  async function renderMap(rows) {
    // ของบนพื้นราบ/พื้นที่เศษไม่มีชั้นวาง จึงวาดลงตารางชั้นวางไม่ได้ — แยกไปแสดงเป็นรายการด้านล่าง
    const rackRows = rows.filter((r) => r.rag_id);
    const flatRows = rows.filter((r) => !r.rag_id);

    const ragIds = [...new Set(rackRows.map((r) => r.rag_id))];
    const maps = await Promise.all(ragIds.map((id) =>
      api.get(`/api/rags/${id}/map`).catch(() => null)));

    const panels = maps.map((data, i) => {
      const hits = rackRows.filter((r) => r.rag_id === ragIds[i]);
      if (!data) return fallbackPanel(hits);
      return rackPanel(data, hits);
    });

    const flatPanels = ['FLOOR', 'BREAK']
      .map((t) => { const hits = flatRows.filter((r) => r.zone_type === t); return hits.length ? flatPanel(t, hits) : null; })
      .filter(Boolean);
    // เผื่อมีที่จัดเก็บชนิดใหม่ที่หน้านี้ยังไม่รู้จัก — ต้องยังเห็น ห้ามหายเงียบ ๆ
    const other = flatRows.filter((r) => r.zone_type !== 'FLOOR' && r.zone_type !== 'BREAK');
    if (other.length) flatPanels.push(flatPanel(null, other));

    const legend = h('div', { class: 'smap-legend' },
      h('b', { style: 'margin-right:2px' }, 'สีบอกอายุคงเหลือ:'),
      ...EXP_SCALE.map((s) => h('span', {}, h('i', { style: `background:${s.color}` }), s.label)),
      h('span', {}, h('i', { style: `background:${NO_EXP.color}` }), NO_EXP.label),
      h('span', { style: 'color:#94a3b8' }, h('i', { style: 'background:#fff;border:2px solid #e2e8f0' }), 'ช่องอื่นในชั้นวาง (ไม่ตรงผลค้นหา)'));

    // ยอดรวมด้านบนนับทุกที่จัดเก็บ (ส่ง rows ทั้งชุด) ไม่ใช่เฉพาะของบนชั้นวาง
    return h('div', { class: 'smap' }, skuSummary(rows), ...panels, ...flatPanels, legend);
  }

  // ---- ของที่ไม่ได้อยู่บนชั้นวาง — แสดงเป็นการ์ดรายตำแหน่ง แทนที่จะยัดลงตารางชั้นวาง ----
  function flatPanel(zoneType, hits) {
    const totalQty = hits.reduce((sum, r) => sum + Number(r.quantity || 0), 0);
    const unit = hits[0]?.unit ?? '';

    const card = (r) => h('div', {
      style: `border:1px solid var(--line);border-left:5px solid ${expColor(r.days_to_expiry)};border-radius:10px;`
        + 'padding:10px 12px;min-width:190px;background:#fff;cursor:pointer',
      title: `${r.location_code} · ${r.sku_name} — คลิกเพื่อดูรายละเอียดและประวัติของรายการนี้`,
      onclick: () => detail(r),
    },
      h('div', { class: 'mono', style: 'font-weight:800' }, r.location_code),
      h('div', { class: 'muted', style: 'font-size:11px' }, r.slot_no ? `ช่อง ${r.slot_no}` : '—'),
      h('div', { style: 'font-weight:800;margin-top:5px' }, `${fmtNum(r.quantity)} ${r.unit}`),
      h('div', { class: 'muted', style: 'font-size:12px' }, `Lot ${r.lot_no ?? '—'}`),
      h('div', { class: 'mono muted', style: 'font-size:11px' }, r.pallet_no ?? 'ไม่มีเลขพาเลท'),
      h('div', { style: 'display:flex;gap:5px;flex-wrap:wrap;margin-top:5px' },
        r.exp_date ? expiryPill(r.expiry) : pill('ไม่ระบุ EXP', 'gray'),
        r.is_loose ? pill('เศษ', 'amber') : null));

    return h('div', { class: 'smap-rack' },
      h('div', { class: 'smap-head' },
        h('h3', {}, ZT_TITLE[zoneType] ?? '📍 ที่จัดเก็บอื่น'),
        pill(`พบ ${hits.length} ตำแหน่ง`, 'blue'),
        pill(`รวม ${fmtNum(totalQty)} ${unit}`, 'green'),
        h('span', { class: 'muted', style: 'font-size:12px' }, 'ไม่ได้อยู่บนชั้นวาง จึงไม่มีผังชั้น/ตอน')),
      h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap' }, ...hits.map(card)));
  }

  // ---- สรุปสินค้าที่ค้นเจอ — ชื่อเต็ม รหัส และยอดรวมทุกตำแหน่ง ----
  function skuSummary(rows) {
    const bySku = new Map();
    for (const r of rows) {
      const cur = bySku.get(r.sku_code) ?? { name: r.sku_name, code: r.sku_code, unit: r.unit, qty: 0, locs: 0 };
      cur.qty += Number(r.quantity || 0);
      cur.locs += 1;
      bySku.set(r.sku_code, cur);
    }
    return h('div', { class: 'smap-sku' },
      ...[...bySku.values()].map((s) =>
        h('div', { class: 'smap-sku-row' },
          h('span', { class: 'n' }, s.name),
          h('span', { class: 'c' }, s.code),
          pill(`${s.locs} ตำแหน่ง`, 'blue'),
          pill(`รวม ${fmtNum(s.qty)} ${s.unit}`, 'green'))),
      h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' },
        h('button', { class: 'btn', title: 'เปิดผังพื้นคลังทั้งคลัง โดยเน้นสีเฉพาะชั้นวางที่มีสินค้าตัวนี้ — ใช้ดูว่าของกระจายอยู่กี่จุดก่อนเดินไปหยิบ', onclick: () => showFloorOverview(rows) }, '🏭 ดูภาพรวมทั้งคลัง — สินค้านี้อยู่ชั้นวางไหนบ้าง')));
  }

  // ---- ผังพื้นคลังทั้งคลัง เน้นชั้นวางที่มีสินค้าตัวนี้ — เปิดเป็นหน้าต่างซ้อน ไม่ต้องออกจากหน้าค้นหา ----
  const rackSpan = (r) => ({
    cols: Math.max(1, Math.min(4, Math.ceil(r.total_depths / 3))),
    rows: Math.max(1, Math.min(3, Math.ceil(r.total_levels / 3))),
  });

  async function showFloorOverview(rows, focusRagId = null) {
    const body = h('div', { class: 'smap-ovw' }, h('div', { class: 'empty-state' }, 'กำลังโหลดผังคลัง…'));
    const m = modal('ภาพรวมทั้งคลัง — ตำแหน่งของสินค้าที่ค้นหา', body,
      [h('button', { class: 'btn primary', onclick: () => m.close() }, 'ปิด')]);

    const whIds = [...new Set(rows.map((r) => r.warehouse_id).filter(Boolean))];
    const layouts = await Promise.all(whIds.map((id) =>
      api.get(`/api/warehouses/${id}/layout`).catch(() => null)));

    const panels = layouts.map((data, i) => (data ? floorPanel(data, rows, focusRagId) : null)).filter(Boolean);
    // ผังนี้วางได้เฉพาะชั้นวาง — ต้องบอกตรง ๆ ว่ายังมีของอีกกี่ตำแหน่งที่ไม่ได้อยู่บนผัง
    const offRack = rows.filter((r) => !r.rag_id);
    if (panels.length && offRack.length) {
      panels.push(h('div', { class: 'muted', style: 'font-size:12px' },
        `หมายเหตุ: อีก ${offRack.length} ตำแหน่งอยู่บนพื้นราบ/พื้นที่เศษ ซึ่งไม่ได้วางอยู่บนผังชั้นวาง — ดูได้จากรายการด้านหลัง`));
    }
    body.replaceChildren(...(panels.length
      ? [...panels, h('div', { class: 'smap-legend' },
          h('b', {}, 'ชั้นวางที่เน้นสี = มีสินค้าตัวนี้อยู่'),
          ...EXP_SCALE.map((s) => h('span', {}, h('i', { style: `background:${s.color}` }), s.label)),
          h('span', { style: 'color:#94a3b8' }, 'ชั้นวางที่จางลง = ไม่มีสินค้าตัวนี้'))]
      : [h('div', { class: 'empty-state' }, 'คลังนี้ยังไม่ได้จัดวางผังพื้น — ดูตำแหน่งได้จากแผนผังชั้นวางด้านหลัง')]));
  }

  function floorPanel(data, rows, focusRagId) {
    const { warehouse: info, racks } = data;
    // สรุปว่าแต่ละชั้นวางมีสินค้าที่ค้นหาอยู่เท่าไร และ Lot ที่ใกล้หมดอายุที่สุดคือกี่วัน
    const hitBy = new Map();
    for (const r of rows) {
      const cur = hitBy.get(r.rag_id) ?? { locs: 0, qty: 0, unit: r.unit, minDays: null };
      cur.locs += 1;
      cur.qty += Number(r.quantity || 0);
      if (r.days_to_expiry !== null && r.days_to_expiry !== undefined)
        cur.minDays = cur.minDays === null ? r.days_to_expiry : Math.min(cur.minDays, r.days_to_expiry);
      hitBy.set(r.rag_id, cur);
    }

    const board = h('div', { class: 'floor find' });
    board.style.gridTemplateColumns = `repeat(${info.grid_cols}, minmax(48px, 1fr))`;
    board.style.gridTemplateRows = `repeat(${info.grid_rows}, minmax(48px, auto))`;

    const covered = new Map();
    for (const r of racks) {
      if (r.pos_x === null) continue;
      const s = rackSpan(r);
      for (let dy = 0; dy < s.rows; dy++)
        for (let dx = 0; dx < s.cols; dx++) covered.set(`${r.pos_x + dx}:${r.pos_y + dy}`, r);
    }

    const cells = [];
    for (let y = 0; y < info.grid_rows; y++) {
      for (let x = 0; x < info.grid_cols; x++) {
        const r = racks.find((k) => k.pos_x === x && k.pos_y === y);
        if (r) {
          const s = rackSpan(r);
          const hit = hitBy.get(r.rag_id);
          const hc = hit ? expColor(hit.minDays) : '#2563eb';
          cells.push(h('div', {
            class: `floor-rack ${hit ? 'hit' : ''} ${focusRagId === r.rag_id ? 'selected' : ''}`,
            style: `--zc:${r.color || '#2563eb'}; --hc:${hc}; grid-column:${r.pos_x + 1}/span ${s.cols}; grid-row:${r.pos_y + 1}/span ${s.rows}`,
            title: hit
              ? `${r.zone_code}-${r.rag_no} — พบ ${hit.locs} ตำแหน่ง รวม ${fmtNum(hit.qty)} ${hit.unit}`
              : `${r.zone_code}-${r.rag_no} — ไม่มีสินค้าตัวนี้`,
          },
            h('div', { class: 'fr-header' },
              h('div', {}, h('div', { class: 'fr-no' }, r.rag_no), h('div', { class: 'fr-zone' }, r.zone_code)),
              h('div', { class: 'fr-use' }, `${r.occupied}/${r.total - r.disabled}`)),
            hit ? h('div', { class: 'fr-badge' }, `${fmtNum(hit.qty)} ${hit.unit}`) : null));
        } else if (!covered.has(`${x}:${y}`)) {
          cells.push(h('div', { class: 'floor-cell', style: `grid-column:${x + 1}; grid-row:${y + 1}; cursor:default` }));
        }
      }
    }
    board.replaceChildren(...cells);

    const found = racks.filter((r) => hitBy.has(r.rag_id));
    return h('div', {},
      h('div', { class: 'wh-band' },
        h('h2', { style: 'margin:0;font-size:15px' }, `🏭 ${info.wh_code} — ${info.wh_name}`),
        pill(`พบใน ${found.length} ชั้นวาง`, found.length ? 'green' : 'gray'),
        h('span', { class: 'muted', style: 'font-size:12px' },
          found.length ? found.map((r) => `${r.zone_code}-${r.rag_no}`).join(' · ') : 'ไม่พบในคลังนี้')),
      h('div', { class: 'floor-wrap' }, board));
  }

  function rackPanel(data, hits) {
    const { rag, cells } = data;
    const hitBy = new Map(hits.map((r) => [r.location_code, r]));
    const totalQty = hits.reduce((sum, r) => sum + Number(r.quantity || 0), 0);
    const unit = hits[0]?.unit ?? '';

    const byLevel = new Map();
    for (const c of cells) {
      if (!byLevel.has(c.level)) byLevel.set(c.level, []);
      byLevel.get(c.level).push(c);
    }
    const levels = [...byLevel.keys()].sort((a, b) => b - a);

    const cellEl = (c) => {
      const hit = hitBy.get(c.location_code);
      if (hit) {
        return h('div', {
          class: 'smap-cell hit',
          style: `background:${expColor(hit.days_to_expiry)}`,
          title: `${hit.location_code} · ${hit.sku_name}\nLot ${hit.lot_no ?? '—'} · ${fmtNum(hit.quantity)} ${hit.unit}\n${hit.exp_date ? `หมดอายุ ${hit.exp_date} (${hit.expiry?.label ?? ''})` : 'ไม่ระบุวันหมดอายุ'}\nคลิกเพื่อดูรายละเอียด`,
          onclick: () => detail(hit),
        },
          h('div', { class: 'lc' }, `L${c.level}/D${c.depth}`),
          h('div', { class: 'nm' }, hit.sku_name),
          h('div', { class: 'q' }, fmtNum(hit.quantity)),
          h('div', { class: 'u' }, hit.unit),
          h('div', { class: 'd' }, hit.exp_date ? (hit.expiry?.label ?? '') : 'ไม่ระบุ EXP'));
      }
      const occupied = !!c.item_id;
      const disabled = c.status === 'DISABLED';
      return h('div', {
        class: `smap-cell ${disabled ? 'dis' : occupied ? 'occ' : ''}`,
        title: `${c.location_code} — ${disabled ? 'ปิดใช้งาน' : occupied ? `มีสินค้าอื่น: ${c.sku_name}` : 'ว่าง'}`,
      },
        h('div', { class: 'lc' }, `L${c.level}/D${c.depth}`),
        h('div', {}, disabled ? '🚫' : occupied ? '▪' : '·'));
    };

    // ถ้าทั้งชั้นวางเจอสินค้าตัวเดียว แสดงชื่อเต็มไว้บนหัวเลย ไม่ต้องอ่านจากในช่อง
    const names = [...new Set(hits.map((r) => r.sku_name))];

    return h('div', { class: 'smap-rack' },
      h('div', { class: 'smap-head' },
        h('h3', {}, `RACK ${rag.zone_code}-${rag.rag_no}`),
        names.length === 1 ? h('span', { style: 'font-weight:700;font-size:13px' }, names[0]) : null,
        pill(`พบ ${hits.length} ตำแหน่ง`, 'blue'),
        pill(`รวม ${fmtNum(totalQty)} ${unit}`, 'green'),
        h('button', {
          class: 'btn ghost sp', style: 'font-size:12px;padding:4px 10px',
          title: 'เปิดผังพื้นคลังแล้วชี้ตำแหน่งของชั้นวางนี้ — ใช้ดูว่าต้องเดินไปทางไหนในคลัง',
          onclick: () => showFloorOverview(lastRows, rag.rag_id),
        }, '🏭 ดูในผังคลัง')),
      h('div', { class: 'smap-grid' },
        h('div', { class: 'smap-dhead' },
          ...Array.from({ length: rag.total_depths }, (_, i) => h('div', {}, `D${i + 1}`))),
        ...levels.map((lv) =>
          h('div', { class: 'smap-row' },
            h('div', { class: 'lv' }, `L${lv}`),
            ...byLevel.get(lv).sort((a, b) => a.depth - b.depth).map(cellEl)))));
  }

  // ถ้าโหลดแผนผังชั้นวางไม่ได้ ยังต้องเห็นว่าเจอของที่ไหนบ้าง
  function fallbackPanel(hits) {
    return h('div', { class: 'smap-rack' },
      h('div', { class: 'smap-head' },
        h('h3', {}, `RACK ${hits[0]?.zone_code ?? ''}-${hits[0]?.rag_no ?? ''}`),
        pill('โหลดแผนผังไม่สำเร็จ', 'amber')),
      h('div', { class: 'smap-row' },
        ...hits.map((r) => h('div', {
          class: 'smap-cell hit', style: `background:${expColor(r.days_to_expiry)}`,
          onclick: () => detail(r),
        },
          h('div', { class: 'lc' }, `L${r.level}/D${r.depth}`),
          h('div', { class: 'q' }, fmtNum(r.quantity)),
          h('div', { class: 'u' }, r.unit)))));
  }

  async function run() {
    results.replaceChildren(h('div', { class: 'empty-state' }, 'กำลังค้นหา…'));
    const t0 = performance.now();
    const rows = await api.get('/api/stock', { ...query(), limit: 500 });
    const ms = Math.round(performance.now() - t0);
    const n = activeCount();
    const filtered = n > 0;
    const badge = filtered ? ` · กรองอยู่ ${n} เงื่อนไข` : '';
    summary.textContent = q
      ? (rows.length ? `พบ ${rows.length} รายการ (${ms} ms)${badge}` : `ไม่พบสินค้าที่ตรงกับ "${q}"${filtered ? ' ตามตัวกรองที่เลือก' : ''}`)
      : `แสดงสินค้า${filtered ? 'ตามตัวกรอง' : 'ทั้งหมดในคลัง'} ${rows.length} รายการ (${ms} ms)${badge}`;
    // ให้เห็นจากหัวข้อที่ยังพับอยู่ว่ามีตัวกรองทำงานอยู่กี่ข้อ
    filterRow.querySelector('summary').textContent =
      `⚙️ ตัวกรองเพิ่มเติม — สินค้า · ตำแหน่ง · อายุ · จำนวน${filtered ? `  (ใช้อยู่ ${n})` : ''}`;
    if (filtered) filterRow.open = true;

    if (rows.length) {
      lastRows = rows;
      await paint();
    } else {
      lastRows = [];
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
          kv('จัดเก็บเมื่อ', fmtDateTime(item.stored_at)),
          // ข้อมูลรายการอาจยังไม่มีเลขพาเลท — ใช้ค่าจากผลค้นหาที่กดมาเป็นตัวสำรอง
          kv('พาเลท', h('div', { style: 'display:flex;align-items:center;gap:6px;flex-wrap:wrap' },
            h('span', { class: 'mono' }, item.pallet_no ?? r.pallet_no ?? '—'),
            (item.is_loose ?? r.is_loose) ? pill('เศษ', 'amber') : null))),
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
        // ของบนพื้นราบ/พื้นที่เศษไม่มี rag_id — ถ้าใส่ลิงก์จะกลายเป็น #/map/null แล้วเปิดไม่ได้
        ...(item.rag_id
          ? [h('a', { class: 'btn', title: 'เปิดแผนผังชั้นวางแล้วเน้นช่องที่เก็บรายการนี้ — ใช้ตอนจะเดินไปหยิบของจริง', href: `#/map/${item.rag_id}?loc=${item.location_code}` }, '🗺️ ดูบนแผนผัง')]
          : []),
        ...itemActions(item, () => { m.close(); run(); }),
      ]);
  }

  run();
  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'ค้นหาสินค้าในคลัง'),
        h('p', {}, `คลัง: ${wh.label} — ค้นหาว่าสินค้าอยู่ชั้นวางไหน ชั้นใด ตอนที่เท่าไร`)),
      h('div', { class: 'actions' },
        h('a', { class: 'btn', title: 'ไปหน้าวางแผนหยิบสินค้า — ระบุจำนวนที่ต้องการแล้วระบบจัดคิวหยิบตามลำดับ FEFO ให้', href: '#/pick' }, '📤 วางแผนหยิบสินค้า'),
        h('button', { class: 'btn', title: 'บันทึกผลค้นหาตามตัวกรองปัจจุบันเป็นไฟล์ CSV เปิดใน Excel ได้ — ไม่กระทบข้อมูลในระบบ', onclick: () => download('/api/export/stock.csv', query()) }, '⬇️ ดาวน์โหลด Excel (CSV)'))),
    h('div', { class: 'card' },
      h('div', { class: 'row scan' }, h('div', { style: 'flex:3' }, input), h('div', { style: 'flex:1' }, zoneSel)),
      filterRow,
      h('div', { style: 'display:flex;align-items:center;gap:12px;flex-wrap:wrap' }, summary, h('div', { style: 'margin-left:auto' }, viewToggle)),
      results));
}
