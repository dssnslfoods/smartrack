// รับสินค้าเข้าคลัง (GRN) — หลายรายการ/หลาย Lot ต่อใบ + QC + อ้างอิงเลข PO
import { api, auth } from '../api.js';
import { h, field, table, pill, toast, fmtNum, fmtDateTime, modal, DOC_LABEL, locationPickerModal } from '../ui.js?v=26';

export async function inboundView() {
  const [skus, zones] = await Promise.all([api.get('/api/skus'), api.get('/api/zones')]);
  const skuById = new Map(skus.map((s) => [String(s.sku_id), s]));
  let empties = [];
  api.get('/api/locations', { limit: 500 }).then((r) => { empties = r; });

  // ---------------- หัวเอกสาร ----------------
  const refNo = h('input', { placeholder: 'เลขที่ PO อ้างอิง (ถ้ามี)' });
  const party = h('input', { placeholder: 'ชื่อผู้ขาย / Supplier' });
  const qcSel = h('select', {},
    h('option', { value: '' }, '— ยังไม่บันทึกผล QC —'),
    h('option', { value: 'PASS' }, '✅ ผ่าน (PASS)'),
    h('option', { value: 'QUARANTINE' }, '⚠️ กักกัน (QUARANTINE) — เก็บเข้าโซน QR'),
    h('option', { value: 'FAIL' }, '❌ ไม่ผ่าน (FAIL)'));
  const qcNote = h('input', { placeholder: 'บันทึกผลตรวจ เช่น สภาพกล่อง/ฉลาก/อุณหภูมิ' });
  const note = h('input', { placeholder: 'หมายเหตุเอกสาร (ถ้ามี)' });

  // ---------------- บรรทัดสินค้า ----------------
  const linesBox = h('div', {});
  const lines = [];

  function addLine() {
    const sel = h('select', {}, h('option', { value: '' }, '— เลือกสินค้า —'),
      ...skus.filter((s) => s.status === 'ACTIVE').map((s) => h('option', { value: s.sku_id }, `${s.sku_code} — ${s.sku_name}`)));
    const unitSel = h('select', {}, h('option', { value: '' }, 'หน่วยฐาน'));
    sel.onchange = async () => {
      const s = skuById.get(sel.value);
      unitSel.replaceChildren(h('option', { value: '' }, s ? `${s.unit} (หน่วยฐาน)` : 'หน่วยฐาน'));
      if (s) {
        try {
          const units = await api.get(`/api/skus/${s.sku_id}/units`);
          units.forEach((u) => unitSel.appendChild(h('option', { value: u.unit_name }, `${u.unit_name} (×${fmtNum(u.factor)})`)));
        } catch {}
      }
    };
    const qty = h('input', { type: 'number', min: '1', value: '1', style: 'width:90px' });
    const lot = h('input', { placeholder: 'Lot', style: 'width:120px' });
    const mfg = h('input', { type: 'date', title: 'วันผลิต (MFG)' });
    const exp = h('input', { type: 'date', title: 'วันหมดอายุ (EXP)' });
    const loc = h('input', { placeholder: 'ตำแหน่ง เช่น FG-A01-L1-D1', style: 'width:170px', autocomplete: 'off' });
    const sugg = h('div', { class: 'pick-list', style: 'grid-column:1/-1' });
    loc.addEventListener('input', () => {
      const term = loc.value.trim().toUpperCase();
      if (!term) { sugg.replaceChildren(); return; }
      const rows = empties.filter((l) => l.location_code.includes(term)).slice(0, 8);
      sugg.replaceChildren(...rows.map((l) =>
        h('button', { class: 'chip', onclick: () => { loc.value = l.location_code; sugg.replaceChildren(); } }, l.location_code)));
    });

    const pickBtn = h('button', {
      class: 'btn', type: 'button', style: 'white-space:nowrap',
      title: 'เลือกตำแหน่งจากแผนผังชั้นวาง',
      onclick: () => locationPickerModal((url, params) => api.get(url, params), (code) => { loc.value = code; sugg.replaceChildren(); }),
    }, '🗺️ เลือกจากแผนผัง');

    const line = { sel, unitSel, qty, lot, mfg, exp, loc };
    const row = h('div', { class: 'card', style: 'padding:12px;margin-bottom:10px' },
      h('div', { class: 'grid g2' }, field('สินค้า *', sel),
        field('ตำแหน่งจัดเก็บ *', h('div', { style: 'display:flex;gap:6px' }, loc, pickBtn))),
      h('div', { class: 'row', style: 'flex-wrap:wrap' },
        field('จำนวน *', qty), field('หน่วย', unitSel), field('Lot', lot),
        field('วันผลิต (MFG)', mfg), field('วันหมดอายุ (EXP)', exp),
        h('div', { style: 'flex:0;align-self:flex-end' },
          h('button', { class: 'btn ghost', onclick: () => { lines.splice(lines.indexOf(line), 1); row.remove(); } }, '🗑️'))),
      sugg);
    lines.push(line);
    linesBox.append(row);
  }
  addLine();

  // ---------------- บันทึก ----------------
  const recent = h('div', {});
  async function loadRecent() {
    const rows = await api.get('/api/docs', { type: 'GRN', limit: 20 });
    recent.replaceChildren(table([
      { label: 'เลขที่', key: 'doc_no', mono: true },
      { label: 'วันที่', value: (r) => fmtDateTime(r.created_at) },
      { label: 'PO อ้างอิง', value: (r) => r.ref_no || '—', mono: true },
      { label: 'Supplier', value: (r) => r.party || '—' },
      { label: 'QC', value: (r) => (r.qc_status ? pill({ PASS: 'ผ่าน', FAIL: 'ไม่ผ่าน', QUARANTINE: 'กักกัน' }[r.qc_status], { PASS: 'green', FAIL: 'red', QUARANTINE: 'amber' }[r.qc_status]) : '—') },
      { label: 'รายการ', key: 'line_count', num: true },
      { label: 'จำนวนรวม', value: (r) => fmtNum(r.total_qty), num: true },
      { label: 'ผู้บันทึก', key: 'created_by_name' },
      { label: '', value: (r) => h('button', { class: 'btn ghost', onclick: () => showDoc(r.doc_id) }, 'ดู') },
    ], rows, { empty: 'ยังไม่มีใบรับเข้า' }));
  }

  async function showDoc(docId) {
    const { doc, movements } = await api.get(`/api/docs/${docId}`);
    modal(`${DOC_LABEL[doc.doc_type]} ${doc.doc_no}`,
      h('div', {},
        h('p', { class: 'muted' },
          `${fmtDateTime(doc.created_at)} · ${doc.party ?? ''} ${doc.ref_no ? `· อ้างอิง ${doc.ref_no}` : ''} · ผู้บันทึก ${doc.created_by_name ?? '-'}`),
        doc.qc_note ? h('p', {}, `QC: ${doc.qc_note}`) : null,
        table([
          { label: 'สินค้า', key: 'sku_name' },
          { label: 'Lot', key: 'lot_no', mono: true },
          { label: 'จำนวน', value: (m) => `${fmtNum(m.quantity)} ${m.unit}`, num: true },
          { label: 'เข้าตำแหน่ง', key: 'to_code', mono: true },
          { label: 'หมายเหตุ', key: 'note' },
        ], movements)),
      [h('button', { class: 'btn', onclick: (e) => e.target.closest('.modal-bg').remove() }, 'ปิด')]);
  }

  async function submit() {
    const items = [];
    for (const l of lines) {
      if (!l.sel.value) continue;
      if (!l.loc.value.trim()) { toast('กรุณาระบุตำแหน่งจัดเก็บให้ครบทุกบรรทัด', 'err'); return; }
      items.push({
        sku_id: Number(l.sel.value), location_code: l.loc.value.trim().toUpperCase(),
        quantity: Number(l.qty.value), unit_name: l.unitSel.value || null,
        lot_no: l.lot.value.trim() || null, mfg_date: l.mfg.value || null, exp_date: l.exp.value || null,
      });
    }
    if (!items.length) { toast('กรุณาเพิ่มรายการสินค้าอย่างน้อย 1 บรรทัด', 'err'); return; }
    try {
      const res = await api.post('/api/docs/grn', {
        ref_no: refNo.value, party: party.value,
        qc_status: qcSel.value || null, qc_note: qcNote.value, note: note.value,
        lines: items,
      });
      toast(`บันทึกใบรับเข้า ${res.doc_no} — จัดเก็บ ${res.stored} รายการเรียบร้อย`);
      lines.length = 0;
      linesBox.replaceChildren();
      addLine();
      [refNo, party, qcNote, note].forEach((el) => { el.value = ''; });
      qcSel.value = '';
      empties = await api.get('/api/locations', { limit: 500 });
      loadRecent();
    } catch (err) { toast(err.message, 'err'); }
  }

  loadRecent();
  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'รับสินค้าเข้าคลัง (GRN)'),
        h('p', {}, 'บันทึกหลายรายการ/หลาย Lot ในใบเดียว พร้อมผลตรวจ QC และอ้างอิงเลข PO'))),
    auth.can('move') ? h('div', {},
      h('div', { class: 'card' },
        h('h2', {}, '1. ข้อมูลเอกสาร'),
        h('div', { class: 'grid g2' }, field('เลขที่ PO อ้างอิง', refNo), field('ผู้ขาย / Supplier', party)),
        h('div', { class: 'grid g2' }, field('ผลตรวจ QC ก่อนรับเข้า', qcSel, 'สินค้าที่กักกันควรเลือกตำแหน่งในโซน QR'), field('บันทึก QC', qcNote)),
        field('หมายเหตุ', note)),
      h('div', { class: 'card' },
        h('div', { class: 'card-head' },
          h('h2', {}, '2. รายการสินค้า'),
          h('button', { class: 'btn', onclick: addLine }, '+ เพิ่มบรรทัด')),
        linesBox),
      h('div', { style: 'margin:14px 0;text-align:right' },
        h('button', { class: 'btn primary', style: 'padding:12px 32px;font-size:16px', onclick: submit }, '📥 บันทึกใบรับเข้า'))) : null,
    h('div', { class: 'card' },
      h('h2', {}, 'ใบรับเข้าล่าสุด'),
      recent));
}
