// สินค้าที่ต้องจัดการ — กฎอายุคงเหลือรายช่องทาง + คำแนะนำ (ย้ายเข้าโปรโมชัน/ตัดออก) + Recall ราย Lot
import { api, wh } from '../api.js';
import { h, field, table, pill, toast, fmtNum, fmtDate, fmtDateTime, pctPill, ACTION_LABEL, ACTION_COLOR, MOVE_LABEL, MOVE_COLOR } from '../ui.js?v=33';

export async function expiryView({ params }) {
  const tab = params.get('tab') ?? 'actions';

  const tabBar = h('div', { class: 'tab-bar' },
    h('button', { class: `tab ${tab === 'actions' ? 'active' : ''}`, onclick: () => { location.hash = '#/expiry'; } }, '⚠️ สินค้าที่ต้องจัดการ'),
    h('button', { class: `tab ${tab === 'recall' ? 'active' : ''}`, onclick: () => { location.hash = '#/expiry?tab=recall'; } }, '🔎 ตรวจสอบ/เรียกคืนราย Lot'));

  const content = h('div', {});

  // ================= ศูนย์จัดการอายุสินค้า =================
  async function loadActions() {
    content.replaceChildren(h('div', { class: 'empty-state' }, 'กำลังโหลด…'));
    const data = await api.get('/api/expiry/actions', { warehouse_id: wh.id });
    const { settings, channels, summary, items } = data;

    const kpi = (label, value, tone) =>
      h('div', { class: `card kpi ${tone ?? ''}` },
        h('div', { class: 'label' }, label), h('div', { class: 'value' }, fmtNum(value)), h('div', { class: 'sub' }, 'รายการ'));

    const filterSel = h('select', { onchange: () => renderRows() },
      h('option', { value: '' }, 'แสดงทุกสถานะ'),
      ...Object.entries(ACTION_LABEL).map(([v, l]) => h('option', { value: v }, l)));

    const tbl = h('div', {});
    function renderRows() {
      const rows = filterSel.value ? items.filter((i) => i.action === filterSel.value) : items;
      tbl.replaceChildren(table([
        { label: 'สถานะ', value: (r) => pill(ACTION_LABEL[r.action], ACTION_COLOR[r.action]) },
        { label: 'สินค้า', value: (r) => h('div', {},
            h('div', { style: 'font-weight:600' }, r.sku_name),
            h('div', { class: 'mono muted', style: 'font-size:12px' }, r.sku_code)) },
        { label: 'Lot', key: 'lot_no', mono: true },
        { label: 'ตำแหน่ง', value: (r) => h('a', { href: `#/map/${r.rag_id}?loc=${r.location_code}` }, r.location_code), mono: true },
        { label: 'จำนวน', value: (r) => `${fmtNum(r.quantity)} ${r.unit}`, num: true },
        { label: 'หมดอายุ', value: (r) => fmtDate(r.exp_date) },
        { label: 'เหลือ (เดือน)', value: (r) => (r.months_left < 0 ? '—' : fmtNum(r.months_left)), num: true },
        { label: '% อายุคงเหลือ', value: (r) => pctPill(r.pct_remaining) },
        { label: 'ขายได้ช่องทาง', value: (r) => (r.channels_ok.length
            ? h('span', {}, ...r.channels_ok.map((c) => pill(c, 'green')))
            : pill('ขายไม่ได้', 'red')) },
      ], rows, { empty: 'ไม่มีรายการในสถานะนี้' }));
    }

    content.replaceChildren(
      h('div', { class: 'grid g4', style: 'margin-bottom:14px' },
        kpi('หมดอายุแล้ว', summary.EXPIRED, 'bad'),
        kpi(`ต้องตัดออก (<${settings.expiry_cutoff_months} ด.)`, summary.CUTOFF, 'bad'),
        kpi(`ย้ายเข้าโปรโมชัน (<${settings.expiry_move_months} ด.)`, summary.MOVE, 'warn'),
        kpi('ขายได้บางช่องทาง', summary.WATCH)),
      h('div', { class: 'card' },
        h('div', { class: 'card-head' },
          h('h2', {}, 'รายการตามลำดับความเร่งด่วน'),
          h('div', { class: 'actions' }, filterSel)),
        h('p', { class: 'muted', style: 'font-size:13px' },
          `เกณฑ์ช่องทาง: ${channels.map((c) => `${c.channel_code} ≥${c.min_pct_remaining ?? 0}%`).join(' · ')} — แก้เกณฑ์ได้ที่ ข้อมูลหลัก → ช่องทางขาย`),
        tbl));
    renderRows();
  }

  // ================= Recall ราย Lot =================
  function loadRecall() {
    const lotInput = h('input', { placeholder: 'พิมพ์/สแกนหมายเลข Lot เช่น L2026-01 แล้วกด Enter', autocomplete: 'off' });
    const out = h('div', {});
    async function run() {
      const lot = lotInput.value.trim();
      if (!lot) { toast('กรุณาระบุ Lot', 'err'); return; }
      out.replaceChildren(h('div', { class: 'empty-state' }, 'กำลังตรวจสอบ…'));
      try {
        const r = await api.get('/api/recall', { lot });
        out.replaceChildren(
          h('div', { class: 'grid g2', style: 'margin:14px 0' },
            h('div', { class: 'card kpi' },
              h('div', { class: 'label' }, 'ยังอยู่ในคลัง'),
              h('div', { class: 'value' }, fmtNum(r.total_in_stock)),
              h('div', { class: 'sub' }, `${r.in_stock.length} ตำแหน่ง`)),
            h('div', { class: 'card kpi warn' },
              h('div', { class: 'label' }, 'จ่ายออกไปแล้ว'),
              h('div', { class: 'value' }, fmtNum(r.total_issued)),
              h('div', { class: 'sub' }, `${r.issued.length} ครั้ง`))),
          h('div', { class: 'card' },
            h('h2', {}, `📍 Lot ${r.lot_no} ที่ยังอยู่ในคลัง — ต้องไปเก็บที่:`),
            table([
              { label: 'ตำแหน่ง', value: (x) => h('a', { href: `#/map/${x.rag_id}?loc=${x.location_code}` }, x.location_code), mono: true },
              { label: 'สินค้า', key: 'sku_name' },
              { label: 'จำนวน', value: (x) => `${fmtNum(x.quantity)} ${x.unit}`, num: true },
              { label: 'หมดอายุ', value: (x) => fmtDate(x.exp_date) },
              { label: 'คลัง', key: 'wh_code' },
            ], r.in_stock, { empty: 'ไม่มีของ Lot นี้เหลือในคลัง' })),
          h('div', { class: 'card', style: 'margin-top:14px' },
            h('h2', {}, '📤 เคยจ่ายออกไปให้ใคร'),
            table([
              { label: 'เวลา', value: (x) => fmtDateTime(x.moved_at) },
              { label: 'เอกสาร', value: (x) => x.doc_no || '—', mono: true },
              { label: 'SO', value: (x) => x.so_ref || '—', mono: true },
              { label: 'ลูกค้า', value: (x) => x.customer || '—' },
              { label: 'สินค้า', key: 'sku_name' },
              { label: 'จำนวน', value: (x) => fmtNum(x.quantity), num: true },
            ], r.issued, { empty: 'ยังไม่เคยจ่าย Lot นี้ออกทางใบจ่ายสินค้า' })),
          h('details', { class: 'card', style: 'margin-top:14px' },
            h('summary', {}, `ประวัติการเคลื่อนไหวทั้งหมดของ Lot นี้ (${r.movements.length} รายการ)`),
            table([
              { label: 'เวลา', value: (x) => fmtDateTime(x.moved_at) },
              { label: 'รายการ', value: (x) => pill(MOVE_LABEL[x.movement_type], MOVE_COLOR[x.movement_type]) },
              { label: 'สินค้า', key: 'sku_name' },
              { label: 'จำนวน', value: (x) => fmtNum(x.quantity), num: true },
              { label: 'จาก', value: (x) => x.from_code || '—', mono: true },
              { label: 'ไป', value: (x) => x.to_code || '—', mono: true },
              { label: 'เอกสาร', value: (x) => x.doc_no || '—', mono: true },
              { label: 'ผู้ทำรายการ', key: 'user_name' },
            ], r.movements)));
      } catch (err) {
        out.replaceChildren(h('div', { class: 'card' }, h('p', {}, err.message)));
      }
    }
    lotInput.addEventListener('keydown', (e) => e.key === 'Enter' && run());
    content.replaceChildren(
      h('div', { class: 'card' },
        h('h2', {}, 'ตรวจสอบ/เรียกคืนสินค้าราย Lot (Recall)'),
        h('p', { class: 'muted', style: 'font-size:13px' }, 'ตอบ 2 คำถามในหน้าเดียว: Lot นี้เหลืออยู่ที่ไหนบ้าง และเคยจ่ายออกไปให้ลูกค้ารายไหนแล้ว'),
        h('div', { class: 'row' }, h('div', { style: 'flex:3' }, lotInput),
          h('button', { class: 'btn primary', onclick: run }, 'ตรวจสอบ'))),
      out);
    setTimeout(() => lotInput.focus(), 60);
  }

  if (tab === 'recall') loadRecall(); else loadActions();

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'อายุสินค้า & Recall'),
        h('p', {}, `คลัง: ${wh.label} — ระบบตรวจกฎอายุคงเหลือให้อัตโนมัติ แทนการไล่ดูใน Excel`))),
    tabBar, content);
}
