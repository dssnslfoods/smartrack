// วางแผนหยิบสินค้า — ระบุสินค้า + จำนวน + เงื่อนไขอายุคงเหลือ
// ระบบคำนวณให้เองว่าไปหยิบตำแหน่งไหน ตำแหน่งละเท่าไร ตามลำดับ FEFO
import { api, auth, wh, download } from '../api.js';
import { h, field, table, pill, expiryPill, fmtNum, fmtDate, toast, confirmBox, modal } from '../ui.js?v=29';

export async function pickView() {
  const [skus, zones, channels] = await Promise.all([
    api.get('/api/skus', { warehouse_id: wh.id }),
    api.get('/api/zones', { warehouse_id: wh.id }),
    api.get('/api/channels').catch(() => []),
  ]);

  let sku = null;
  let plan = null;

  // ---------------- 1. เลือกสินค้า ----------------
  const skuSearch = h('input', { placeholder: 'พิมพ์ชื่อสินค้า หรือรหัสสินค้า เช่น แป้ง, FG-CRM' });
  const skuList = h('div', { class: 'pick-list' });

  function renderSkus() {
    const term = skuSearch.value.trim().toLowerCase();
    const rows = skus
      .filter((s) => !term || s.sku_code.toLowerCase().includes(term) || s.sku_name.toLowerCase().includes(term))
      .slice(0, 8);

    if (!rows.length) {
      skuList.replaceChildren(h('div', { class: 'empty-state' }, 'ไม่พบสินค้าที่ตรงกับคำค้นหา'));
      return;
    }
    skuList.replaceChildren(...rows.map((s) =>
      h('button', {
        class: `sku-option ${sku?.sku_id === s.sku_id ? 'active' : ''}`,
        onclick: () => { sku = s; renderSkus(); qty.focus(); },
      },
        h('div', {},
          h('div', { style: 'font-weight:700' }, s.sku_name),
          h('div', { class: 'mono muted', style: 'font-size:12px' }, s.sku_code)),
        h('div', { style: 'text-align:right' },
          h('div', { style: 'font-weight:700' }, `${fmtNum(s.qty_in_stock)} ${s.unit}`),
          h('div', { class: 'muted', style: 'font-size:12px' }, `${fmtNum(s.locations_used)} ตำแหน่ง`)))));
  }
  skuSearch.addEventListener('input', renderSkus);

  // ---------------- 2. เงื่อนไขการหยิบ ----------------
  const qty = h('input', { type: 'number', min: '1', placeholder: 'เช่น 500' });
  const minDays = h('input', { type: 'number', min: '0', placeholder: 'เช่น 90' });
  const minUnit = h('select', { style: 'width:80px' },
    h('option', { value: 'days' }, 'วัน'), h('option', { value: 'pct' }, '%'));
  const maxDays = h('input', { type: 'number', min: '0', placeholder: 'ไม่จำกัด' });
  const maxUnit = h('select', { style: 'width:80px' },
    h('option', { value: 'days' }, 'วัน'), h('option', { value: 'pct' }, '%'));
  const syncHint = (inp, unit, base) => {
    const hint = inp.closest('.field')?.querySelector('.hint');
    if (hint) hint.textContent = unit.value === 'pct' ? `% ของอายุทั้งหมด — เว้นว่างคือไม่กำหนด` : `จำนวนวัน — เว้นว่างคือไม่กำหนด`;
    inp.placeholder = unit.value === 'pct' ? (base === 'min' ? 'เช่น 50' : 'ไม่จำกัด') : (base === 'min' ? 'เช่น 90' : 'ไม่จำกัด');
  };
  minUnit.onchange = () => syncHint(minDays, minUnit, 'min');
  maxUnit.onchange = () => syncHint(maxDays, maxUnit, 'max');
  const zoneSel = h('select', {}, h('option', { value: '' }, 'ทุกโซน'),
    ...zones.map((z) => h('option', { value: z.zone_id }, `${z.zone_code} — ${z.zone_name}`)));
  const strategy = h('select', {},
    h('option', { value: 'FEFO' }, 'FEFO — หมดอายุก่อน หยิบก่อน (แนะนำ)'),
    h('option', { value: 'FIFO' }, 'FIFO — เข้าคลังก่อน หยิบก่อน'));

  [qty, minDays, maxDays].forEach((el) =>
    el.addEventListener('keydown', (e) => e.key === 'Enter' && calculate()));

  const out = h('div', {});

  const params = () => ({
    sku_id: sku?.sku_id, quantity: qty.value,
    min_days: minUnit.value === 'days' ? minDays.value : '',
    max_days: maxUnit.value === 'days' ? maxDays.value : '',
    min_pct: minUnit.value === 'pct' ? minDays.value : '',
    max_pct: maxUnit.value === 'pct' ? maxDays.value : '',
    zone_id: zoneSel.value, warehouse_id: wh.id, strategy: strategy.value,
  });

  async function calculate() {
    if (!sku) { toast('กรุณาเลือกสินค้าที่ต้องการหยิบ', 'err'); return; }
    if (!qty.value || Number(qty.value) <= 0) { toast('กรุณาระบุจำนวนที่ต้องการ', 'err'); return; }

    out.replaceChildren(h('div', { class: 'empty-state' }, 'กำลังคำนวณแผนการหยิบ…'));
    try {
      plan = await api.get('/api/pick/plan', params());
      renderPlan();
    } catch (err) {
      plan = null;
      out.replaceChildren(h('div', { class: 'card' }, h('h2', {}, 'คำนวณไม่สำเร็จ'), h('p', {}, err.message)));
    }
  }

  // ---------------- 3. ผลลัพธ์ ----------------
  function renderPlan() {
    const kpi = (label, value, sub, tone) =>
      h('div', { class: `card kpi ${tone ?? ''}` },
        h('div', { class: 'label' }, label),
        h('div', { class: 'value' }, value),
        sub ? h('div', { class: 'sub' }, sub) : null);

    const head = h('div', { class: 'grid g4' },
      kpi('ต้องการ', `${fmtNum(plan.requested)}`, plan.sku.unit),
      kpi('จัดสรรได้', `${fmtNum(plan.allocated)}`, plan.sku.unit, plan.complete ? 'ok' : 'warn'),
      kpi('ยังขาด', `${fmtNum(plan.shortfall)}`, plan.shortfall ? plan.sku.unit : 'ครบตามจำนวน', plan.shortfall ? 'bad' : 'ok'),
      kpi('ต้องเดินหยิบ', `${fmtNum(plan.lines.length)}`, 'ตำแหน่ง'));

    const banner = plan.complete
      ? h('div', { class: 'note ok' },
          `✅ จัดสรรครบ ${fmtNum(plan.requested)} ${plan.sku.unit} จาก ${plan.lines.length} ตำแหน่ง — เรียงลำดับตาม ${plan.strategy} แล้ว`)
      : h('div', { class: 'note bad' },
          `⚠️ ของไม่พอตามเงื่อนไข — ต้องการ ${fmtNum(plan.requested)} แต่หยิบได้ ${fmtNum(plan.allocated)} ${plan.sku.unit} (ขาดอีก ${fmtNum(plan.shortfall)})`);

    const list = plan.lines.length
      ? table([
          { label: 'ลำดับ', value: (r) => h('span', { class: 'seq' }, r.seq), num: true },
          { label: 'ไปหยิบที่', value: (r) => h('a', { href: `#/map/${r.rag_id}?loc=${r.location_code}` }, r.location_code), mono: true },
          { label: 'ชั้น / ตอน', value: (r) => `L${r.level} / D${r.depth}` },
          { label: 'Lot', key: 'lot_no', mono: true },
          { label: 'วันหมดอายุ', value: (r) => (r.exp_date ? h('div', {}, fmtDate(r.exp_date), ' ', expiryPill(r.expiry)) : '—') },
          { label: 'มีอยู่', value: (r) => `${fmtNum(r.quantity)} ${r.unit}`, num: true },
          { label: 'หยิบ', value: (r) => h('strong', { class: 'take' }, `${fmtNum(r.take)} ${r.unit}`), num: true },
          { label: 'เหลือไว้', value: (r) => fmtNum(r.remaining_after), num: true },
          { label: 'หมายเหตุ', value: (r) => (r.needs_forklift ? pill('ชั้นสูง — ใช้รถยก', 'blue') : null) },
        ], plan.lines)
      : h('div', { class: 'empty-state' },
          h('p', {}, 'ไม่มี Lot ที่เข้าเงื่อนไขให้หยิบ'),
          h('p', { style: 'font-size:13px' }, 'ลองลดเกณฑ์อายุคงเหลือขั้นต่ำ หรือเลือกโซนอื่น'));

    const skipped = plan.skipped.length
      ? h('details', { class: 'card', style: 'margin-top:14px' },
          h('summary', {}, `ไม่ถูกเลือก ${plan.skipped.length} ตำแหน่ง — กดเพื่อดูเหตุผล`),
          table([
            { label: 'ตำแหน่ง', value: (r) => h('a', { href: `#/map/${r.rag_id}?loc=${r.location_code}` }, r.location_code), mono: true },
            { label: 'Lot', key: 'lot_no', mono: true },
            { label: 'วันหมดอายุ', value: (r) => (r.exp_date ? fmtDate(r.exp_date) : '—') },
            { label: 'จำนวน', value: (r) => `${fmtNum(r.quantity)} ${r.unit}`, num: true },
            { label: 'เหตุผลที่ไม่หยิบ', value: (r) => h('span', { class: 'muted' }, r.reason) },
          ], plan.skipped))
      : null;

    out.replaceChildren(
      head, banner,
      h('div', { class: 'card', style: 'margin-top:14px' },
        h('div', { class: 'card-head' },
          h('h2', {}, `ใบสั่งหยิบ — ${plan.sku.sku_name}`),
          h('div', { class: 'actions' },
            h('button', { class: 'btn', onclick: () => download('/api/export/picklist.csv', params()) }, '⬇️ CSV'),
            h('button', { class: 'btn', onclick: () => window.print() }, '🖨️ พิมพ์'),
            plan.lines.length && auth.can('move')
              ? h('button', { class: 'btn primary', onclick: confirmPick }, '✅ ยืนยันหยิบตามแผน')
              : null)),
        list),
      skipped);
  }

  // ---------------- ยืนยันหยิบจริง — สร้างใบจ่ายสินค้า (ISSUE) พร้อมอ้างอิง SO/ลูกค้า ----------------
  async function confirmPick() {
    const soRef = h('input', { placeholder: 'เลขที่ SO / MO (ถ้ามี)' });
    const customer = h('input', { placeholder: 'ชื่อลูกค้า / ปลายทาง' });
    const chSel = h('select', {}, h('option', { value: '' }, '— ไม่ระบุช่องทาง —'),
      ...channels.filter((c) => c.status === 'ACTIVE').map((c) =>
        h('option', { value: c.channel_id },
          `${c.channel_code} — ${c.channel_name}${c.min_pct_remaining !== null ? ` (อายุ ≥${c.min_pct_remaining}%)` : ''}`)));

    const doIssue = async (force) => {
      const res = await api.post('/api/docs/issue', {
        ref_no: soRef.value, party: customer.value, channel_id: chSel.value || null, force,
        so_note: `หยิบตามแผน ${plan.strategy} — ${plan.sku.sku_code}`,
        lines: plan.lines.map((l) => ({ item_id: l.item_id, take: l.take, location_code: l.location_code })),
      });
      toast(`จ่ายออกสำเร็จ ${fmtNum(res.total)} ${plan.sku.unit} — ใบจ่ายสินค้า ${res.doc_no}`);
      m.close();
      skus.splice(0, skus.length, ...await api.get('/api/skus', { warehouse_id: wh.id }));
      renderSkus();
      calculate();
    };

    const m = modal('ยืนยันหยิบ + สร้างใบจ่ายสินค้า',
      h('div', {},
        h('p', { class: 'muted' },
          `หยิบ ${plan.sku.sku_name} รวม ${fmtNum(plan.allocated)} ${plan.sku.unit} จาก ${plan.lines.length} ตำแหน่ง — ระบบจะตัดสต๊อกและเปิดใบจ่ายสินค้าให้ติดตามสถานะต่อได้`),
        h('div', { class: 'grid g2' }, field('เลขที่ SO / MO', soRef), field('ลูกค้า', customer)),
        field('ช่องทางขาย', chSel, 'ระบบจะตรวจ % อายุคงเหลือขั้นต่ำของช่องทางให้อัตโนมัติ')),
      [
        h('button', { class: 'btn', onclick: () => m.close() }, 'ยกเลิก'),
        h('button', { class: 'btn primary', onclick: async () => {
          try { await doIssue(false); } catch (err) {
            if (err.code === 'CHANNEL_PCT') {
              const ok = await confirmBox('อายุคงเหลือต่ำกว่าเกณฑ์ช่องทาง',
                `${err.message} — ยืนยันจ่ายออกทั้งที่ต่ำกว่าเกณฑ์หรือไม่?`, 'ยืนยันจ่ายออก');
              if (ok) { try { await doIssue(true); } catch (e2) { toast(e2.message, 'err'); } }
            } else toast(err.message, 'err');
          }
        } }, '✅ ยืนยันหยิบ'),
      ]);
  }

  renderSkus();

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'วางแผนหยิบสินค้า'),
        h('p', {}, `คลัง: ${wh.label} — ระบุสินค้าและจำนวน ระบบจะคำนวณให้ว่าไปหยิบที่ไหน เท่าไร ตามลำดับ FEFO`))),

    h('div', { class: 'card' },
      h('h2', {}, '1. เลือกสินค้าที่ต้องการหยิบ'),
      skuSearch,
      skuList),

    h('div', { class: 'card' },
      h('h2', {}, '2. ระบุจำนวนและเงื่อนไข'),
      h('div', { class: 'row' },
        field('จำนวนที่ต้องการ *', qty),
        field('อายุคงเหลืออย่างน้อย', h('div', { style: 'display:flex;gap:4px' }, minDays, minUnit), 'จำนวนวัน — เว้นว่างคือไม่กำหนด'),
        field('อายุคงเหลือไม่เกิน', h('div', { style: 'display:flex;gap:4px' }, maxDays, maxUnit), 'จำนวนวัน — เว้นว่างคือไม่กำหนด')),
      h('div', { class: 'row' },
        field('เฉพาะโซน', zoneSel),
        field('ลำดับการหยิบ', strategy)),
      h('div', { style: 'margin-top:14px;text-align:right' },
        h('button', { class: 'btn primary', style: 'padding:12px 32px;font-size:16px', onclick: calculate },
          '🧮 คำนวณแผนการหยิบ'))),

    out);
}
