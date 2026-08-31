// วางแผนหยิบสินค้า — ระบุสินค้า + จำนวน + เงื่อนไขอายุคงเหลือ
// ระบบคำนวณให้เองว่าไปหยิบตำแหน่งไหน ตำแหน่งละเท่าไร ตามลำดับ FEFO
import { api, auth, wh, download } from '../api.js';
import { h, field, table, pill, expiryPill, fmtNum, fmtDate, toast, confirmBox, modal } from '../ui.js?v=35';

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
            h('button', { class: 'btn', onclick: printPickup }, '🖨️ พิมพ์'),
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
        h('div', { class: 'grid g2' }, field('เลขที่ SO / MO', soRef, null, 'เลขที่ใบสั่งขาย (Sales Order) หรือใบสั่งผลิต (MO) — ไม่บังคับ'), field('ลูกค้า', customer, null, 'ชื่อลูกค้าหรือปลายทางที่จะส่งสินค้า')),
        field('ช่องทางขาย', chSel, 'ระบบจะตรวจ % อายุคงเหลือขั้นต่ำของช่องทางให้อัตโนมัติ', 'ช่องทางขายที่สั่งสินค้า เช่น MT, GT, Online — แต่ละช่องทางมีเกณฑ์อายุขั้นต่ำต่างกัน')),
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

  function printPickup() {
    if (!plan || !plan.lines.length) return;
    const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const now = new Date();
    const dateStr = `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear() + 543}`;
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    const rows = plan.lines.map((l) => `
      <tr>
        <td class="c">${l.seq}</td>
        <td class="mono">${esc(l.location_code)}</td>
        <td class="c">L${l.level} / D${l.depth}</td>
        <td class="mono">${esc(l.lot_no ?? '-')}</td>
        <td>${l.exp_date ? esc(fmtDate(l.exp_date)) : '-'}</td>
        <td class="n">${Number(l.quantity).toLocaleString('th-TH')}</td>
        <td class="n take">${Number(l.take).toLocaleString('th-TH')}</td>
        <td class="n">${Number(l.remaining_after).toLocaleString('th-TH')}</td>
        <td class="c">${l.needs_forklift ? '🚜' : ''}</td>
        <td class="check"></td>
      </tr>`).join('');
    const total = plan.lines.reduce((s, l) => s + l.take, 0);
    const html = `<!doctype html><html lang="th"><head><meta charset="utf-8">
<title>ใบเบิกสินค้า — ${esc(plan.sku.sku_name)}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:'TH Sarabun New','Sarabun',sans-serif;font-size:15px;margin:20px 28px;color:#111}
  h1{font-size:22px;margin:0;text-align:center}
  .sub{text-align:center;color:#555;margin:0 0 12px;font-size:13px}
  .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px}
  .logo{font-weight:700;font-size:14px}
  .logo small{display:block;font-weight:400;color:#555;font-size:12px}
  .doc-no{text-align:right;font-size:13px;color:#555}
  .info{display:grid;grid-template-columns:1fr 1fr;gap:2px 20px;margin:10px 0;font-size:14px;border:1px solid #ccc;padding:8px 12px;border-radius:4px}
  .info b{min-width:100px;display:inline-block}
  table{border-collapse:collapse;width:100%;margin-top:8px;font-size:13px}
  th,td{border:1px solid #888;padding:4px 7px;text-align:left}
  th{background:#e8e8e8;font-weight:700;font-size:12px}
  .c{text-align:center} .n{text-align:right} .mono{font-family:'Courier New',monospace;font-size:12px}
  .take{font-weight:700;color:#0f766e;font-size:14px}
  .check{width:36px}
  tfoot th{font-size:13px}
  tfoot .take{font-size:15px}
  .note-box{margin-top:12px;border:1px solid #ccc;border-radius:4px;padding:8px 12px;min-height:48px}
  .note-box b{font-size:13px}
  .sign{display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px;margin-top:40px;text-align:center;font-size:14px}
  .sign div{padding-top:6px}
  .sign .line{border-top:1px solid #333;margin-top:40px;padding-top:4px}
  .sign .role{font-weight:700;margin-bottom:2px}
  .sign small{display:block;color:#777;font-size:12px}
  .footer{margin-top:16px;text-align:center;font-size:11px;color:#999;border-top:1px solid #ddd;padding-top:6px}
  @media print{body{margin:12px 16px} button{display:none!important} .no-print{display:none!important}}
</style></head><body>
<button onclick="print()" style="float:right;padding:8px 20px;cursor:pointer" class="no-print">🖨️ พิมพ์</button>
<div class="header">
  <div class="logo">EVERYDAYHAPPY CO., LTD.<small>De Leaf — ระบบจัดการคลังสินค้า</small></div>
  <div class="doc-no">วันที่พิมพ์: ${dateStr} ${timeStr}</div>
</div>
<h1>ใบเบิกสินค้า / Pickup Order</h1>
<p class="sub">เอกสารนี้ใช้ประกอบการหยิบสินค้าจากคลัง — กรุณาตรวจสอบและลงนามเมื่อหยิบครบ</p>
<div class="info">
  <div><b>สินค้า:</b> ${esc(plan.sku.sku_name)}</div>
  <div><b>รหัสสินค้า:</b> ${esc(plan.sku.sku_code)}</div>
  <div><b>จำนวนที่เบิก:</b> <strong>${total.toLocaleString('th-TH')} ${esc(plan.sku.unit)}</strong></div>
  <div><b>ลำดับการหยิบ:</b> ${esc(plan.strategy)}</div>
  <div><b>คลัง:</b> ${esc(wh.name ?? wh.label ?? 'ทุกคลัง')}</div>
  <div><b>จำนวนตำแหน่ง:</b> ${plan.lines.length} ตำแหน่ง</div>
</div>
<table>
  <thead><tr>
    <th class="c" style="width:30px">#</th>
    <th>ตำแหน่ง</th><th class="c">ชั้น/ตอน</th><th>Lot</th><th>วันหมดอายุ</th>
    <th class="n">มีอยู่</th><th class="n">หยิบ</th><th class="n">เหลือ</th>
    <th class="c" style="width:28px">ยก</th><th class="c">✓</th>
  </tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr>
    <th colspan="5" class="n">รวมทั้งสิ้น</th>
    <th class="n">${plan.lines.reduce((s, l) => s + l.quantity, 0).toLocaleString('th-TH')}</th>
    <th class="n take">${total.toLocaleString('th-TH')} ${esc(plan.sku.unit)}</th>
    <th colspan="3"></th>
  </tr></tfoot>
</table>
<div class="note-box"><b>หมายเหตุ:</b></div>
<div class="sign">
  <div><div class="role">ผู้เบิกสินค้า</div><div class="line">ลงชื่อ ................................................</div><small>วันที่ ........../............/............</small></div>
  <div><div class="role">ผู้อนุมัติ</div><div class="line">ลงชื่อ ................................................</div><small>วันที่ ........../............/............</small></div>
  <div><div class="role">ผู้จ่ายสินค้า</div><div class="line">ลงชื่อ ................................................</div><small>วันที่ ........../............/............</small></div>
</div>
<div class="footer">พิมพ์จากระบบ RACK Management — De Leaf WMS · ${dateStr} ${timeStr}</div>
</body></html>`;
    const w = window.open('', '_blank');
    w.document.write(html);
    w.document.close();
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
        field('จำนวนที่ต้องการ *', qty, null, 'จำนวนสินค้าที่ต้องการหยิบออกจากคลัง'),
        field('อายุคงเหลืออย่างน้อย', h('div', { style: 'display:flex;gap:4px' }, minDays, minUnit), 'จำนวนวัน — เว้นว่างคือไม่กำหนด', 'สินค้าต้องเหลืออายุอย่างน้อยเท่านี้ถึงจะหยิบได้ — ป้องกันส่งของใกล้หมดอายุ'),
        field('อายุคงเหลือไม่เกิน', h('div', { style: 'display:flex;gap:4px' }, maxDays, maxUnit), 'จำนวนวัน — เว้นว่างคือไม่กำหนด', 'จำกัดไม่ให้หยิบของที่อายุยาวเกินไป เพื่อเก็บไว้ขายทีหลัง')),
      h('div', { class: 'row' },
        field('เฉพาะโซน', zoneSel, null, 'กรองเฉพาะโซนที่ต้องการ เช่น FG, RM — เว้นว่างคือค้นทุกโซน'),
        field('ลำดับการหยิบ', strategy, null, 'FEFO = หมดอายุก่อนหยิบก่อน, FIFO = เข้าคลังก่อนหยิบก่อน')),
      h('div', { style: 'margin-top:14px;text-align:right' },
        h('button', { class: 'btn primary', style: 'padding:12px 32px;font-size:16px', onclick: calculate },
          '🧮 คำนวณแผนการหยิบ'))),

    out);
}
