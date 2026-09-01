// รับสินค้าเข้าคลัง (GRN) — หลายรายการ/หลาย Lot ต่อใบ + QC + อ้างอิงเลข PO
import { api, auth } from '../api.js?v=49';
import { h, field, table, pill, toast, fmtNum, fmtDateTime, modal, DOC_LABEL, locationPickerModal, pickFiles , progress } from '../ui.js?v=49';

export async function inboundView() {
  const [skus, zones, aiStatus] = await Promise.all([
    api.get('/api/skus'), api.get('/api/zones'),
    api.get('/api/ai/status').catch(() => ({ enabled: false })),
  ]);
  const aiOn = aiStatus.enabled;
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
      title: 'เลือกตำแหน่งจากแผนผังชั้นวาง (เลือกได้หลายตำแหน่ง)',
      onclick: () => locationPickerModal((url, params) => api.get(url, params), (codes) => {
        if (!Array.isArray(codes)) { loc.value = codes; sugg.replaceChildren(); return; }
        loc.value = codes[0]; sugg.replaceChildren();
        for (let i = 1; i < codes.length; i++) {
          addLine();
          const newLine = lines[lines.length - 1];
          newLine.sel.value = sel.value; newLine.sel.dispatchEvent(new Event('change'));
          newLine.qty.value = qty.value;
          newLine.lot.value = lot.value;
          newLine.mfg.value = mfg.value;
          newLine.exp.value = exp.value;
          newLine.loc.value = codes[i];
        }
      }, { multi: true }),
    }, '🗺️ เลือกหลายตำแหน่ง');

    // แถบบอกที่มาของข้อมูลเมื่อบรรทัดนี้มาจากการสแกนเอกสารด้วย AI
    const hint = h('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:12.5px;margin-bottom:8px' });

    const line = { sel, unitSel, qty, lot, mfg, exp, loc, hint };
    const row = h('div', { class: 'card', style: 'padding:12px;margin-bottom:10px' },
      hint,
      h('div', { class: 'grid g2' }, field('สินค้า *', sel, null, 'เลือกรายการสินค้าที่รับเข้า (Stock Keeping Unit)'),
        field('ตำแหน่งจัดเก็บ *', h('div', { style: 'display:flex;gap:6px' }, loc, pickBtn), null, 'ตำแหน่งบนชั้นวางที่จะนำสินค้าไปวาง เช่น FG-A01-L1-D1')),
      h('div', { class: 'row', style: 'flex-wrap:wrap' },
        field('จำนวน *', qty, null, 'จำนวนสินค้าที่รับเข้าจริง (นับเป็นหน่วยฐาน)'), field('หน่วย', unitSel, null, 'หน่วยนับที่ใช้รับเข้า เช่น หน่วยฐานหรือหน่วยแปลง (กล่อง/ลัง)'), field('Lot', lot, null, 'รหัสรอบการผลิต (Batch Number) ดูจากฉลากสินค้า'),
        field('วันผลิต (MFG)', mfg, null, 'วันที่ผลิตสินค้า (Manufacturing Date) ดูจากฉลาก'), field('วันหมดอายุ (EXP)', exp, null, 'วันที่สินค้าหมดอายุ (Expiry Date) ดูจากฉลาก'),
        h('div', { style: 'flex:0;align-self:flex-end' },
          h('button', { class: 'btn ghost', title: 'ลบบรรทัดสินค้านี้ออกจากใบรับเข้า (ยังไม่บันทึก จึงไม่กระทบสต๊อก)', onclick: () => { lines.splice(lines.indexOf(line), 1); row.remove(); } }, '🗑️'))),
      sugg);
    line.row = row;
    lines.push(line);
    linesBox.append(row);
  }
  addLine();

  // ---------------- สแกนใบส่งของด้วย AI ----------------
  // AI อ่านเอกสารแล้วเติมฟอร์มให้เท่านั้น — ไม่บันทึกอะไร คนต้องตรวจและกดบันทึกเอง
  const scanStatus = h('div', {});
  // ปิดปุ่มสแกนระหว่างที่ AI ทำงาน กันกดซ้ำแล้วยิงซ้อนกันหลายรอบ
  const scanBtns = [];

  async function scanDoc(capture) {
    let files;
    try {
      files = await pickFiles({ accept: 'image/*,application/pdf', multiple: true, capture });
    } catch (err) { toast(err.message, 'err'); return; }
    if (!files.length) return;

    // อ่านเอกสารใช้เวลาหลายสิบวินาที ต้องมีสถานะค้างไว้ให้เห็นตลอด ไม่ใช่ข้อความนิ่ง ๆ
    const prog = progress('', {
      steps: [
        `กำลังอัปโหลดเอกสาร ${files.length} ไฟล์…`,
        'AI กำลังอ่านข้อความบนเอกสาร…',
        'กำลังจับคู่ชื่อสินค้ากับรหัสในระบบ…',
        'กำลังตรวจ Lot และวันหมดอายุ…',
        'ใกล้เสร็จแล้ว…',
      ],
    });
    scanStatus.replaceChildren(prog.el);
    for (const b of scanBtns) b.disabled = true;
    try {
      const r = await api.post('/api/ai/scan-receiving', { files });
      applyScan(r);
    } catch (err) {
      scanStatus.replaceChildren(h('div', { class: 'note bad' }, `อ่านเอกสารไม่สำเร็จ: ${err.message}`));
    } finally {
      prog.stop();
      for (const b of scanBtns) b.disabled = false;
    }
  }

  /** สรุปพาเลทที่เพิ่งสร้าง พร้อมปุ่มพิมพ์ป้ายไปติดพาเลทจริง */
  function showPallets(res, items) {
    const bySku = new Map(skus.map((s) => [String(s.sku_id), s]));
    const rows = res.pallets.map((p) => {
      const s = bySku.get(String(p.sku_id));
      // รวมจำนวนของทุกบรรทัดที่ใช้พาเลทใบนี้ (Lot เดียวกันแต่กระจายหลายตำแหน่ง)
      const qty = items
        .filter((l) => String(l.sku_id) === String(p.sku_id) && (l.lot_no?.trim() || null) === p.lot_no)
        .reduce((sum, l) => sum + Number(l.quantity || 0), 0);
      const locs = items
        .filter((l) => String(l.sku_id) === String(p.sku_id) && (l.lot_no?.trim() || null) === p.lot_no)
        .map((l) => l.location_code);
      return { ...p, sku_code: s?.sku_code, sku_name: s?.sku_name, unit: s?.unit, qty, locs };
    });

    const m = modal(`🟫 พาเลทที่สร้างจากใบรับเข้า ${res.doc_no}`,
      h('div', {},
        h('p', { class: 'muted', style: 'margin-top:0' },
          '1 พาเลท = 1 สินค้า + 1 Lot — เขียนเลขพาเลทติดไว้ที่พาเลทจริงก่อนนำไปจัดเก็บ'),
        table([
          { label: 'เลขพาเลท', key: 'pallet_no', mono: true },
          { label: 'สินค้า', value: (p) => h('div', {}, p.sku_name ?? '—',
              h('div', { class: 'mono muted', style: 'font-size:12px' }, p.sku_code ?? '')) },
          { label: 'Lot', value: (p) => p.lot_no ?? '—', mono: true },
          { label: 'จำนวน', value: (p) => `${fmtNum(p.qty)} ${p.unit ?? ''}`, num: true },
          { label: 'เก็บที่', value: (p) => p.locs.join(', '), mono: true },
        ], rows)),
      [h('button', { class: 'btn primary', title: 'ปิดหน้าต่าง — ดูเลขพาเลทย้อนหลังได้จากหน้าค้นหา โดยพิมพ์เลขพาเลทลงช่องค้นหา', onclick: () => m.close() }, 'รับทราบ')]);
  }

  function applyScan(r) {
    if (r.ref_no && !refNo.value) refNo.value = r.ref_no;
    if (r.party && !party.value) party.value = r.party;

    // ล้างบรรทัดว่างที่ยังไม่ได้กรอก แล้วเติมจากผลอ่าน
    if (r.lines.length) {
      const blank = lines.filter((l) => !l.sel.value && !l.qty.value.replace(/^1$/, '') && !l.lot.value);
      blank.forEach((l) => { lines.splice(lines.indexOf(l), 1); l.row?.remove(); });

      for (const src of r.lines) {
        addLine();
        const ln = lines[lines.length - 1];
        if (src.sku_id) { ln.sel.value = String(src.sku_id); ln.sel.dispatchEvent(new Event('change')); }
        if (src.quantity) ln.qty.value = String(src.quantity);
        if (src.lot_no) ln.lot.value = src.lot_no;
        if (src.mfg_date) ln.mfg.value = src.mfg_date;
        if (src.exp_date) ln.exp.value = src.exp_date;
        if (src.needs_review) ln.row?.classList.add('needs-review');
        ln.hint.replaceChildren(...[
          h('span', { class: 'muted' }, `📄 อ่านจากเอกสาร: "${src.raw_text}"`),
          src.confidence !== 'HIGH' ? pill(`ความมั่นใจ ${src.confidence === 'LOW' ? 'ต่ำ' : 'ปานกลาง'}`, src.confidence === 'LOW' ? 'red' : 'amber') : null,
          src.note ? h('span', { style: 'color:#b45309' }, `⚠️ ${src.note}`) : null,
        ].filter(Boolean));
      }
    }

    scanStatus.replaceChildren(
      h('div', { class: r.stats.needs_review ? 'note' : 'note ok',
        style: r.stats.needs_review ? 'background:#fffbeb;border-color:#fcd34d;color:#92400e' : '' },
        `${r.stats.needs_review ? '⚠️' : '✅'} อ่านได้ ${r.stats.total} รายการ · จับคู่สินค้าได้ ${r.stats.matched} รายการ`
        + (r.stats.needs_review ? ` · ต้องตรวจ ${r.stats.needs_review} รายการ` : '')),
      ...(r.warnings ?? []).map((w) => h('div', { class: 'muted', style: 'font-size:13px;margin-top:6px' }, `• ${w}`)),
      h('div', { class: 'muted', style: 'font-size:13px;margin-top:8px' },
        'ℹ️ ระบบยังไม่ได้บันทึกอะไร — กรุณาตรวจทุกบรรทัด เลือกตำแหน่งจัดเก็บ แล้วกดบันทึกใบรับเข้าเอง'));
  }

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
      { label: '', value: (r) => h('button', { class: 'btn ghost', title: 'เปิดดูรายละเอียดใบรับเข้าใบนี้ — รายการสินค้า Lot จำนวน และตำแหน่งที่จัดเก็บเข้าไป', onclick: () => showDoc(r.doc_id) }, 'ดู') },
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
      // พาเลทถูกสร้างให้อัตโนมัติตอนรับเข้า (1 พาเลท = 1 SKU + 1 Lot)
      // ต้องแสดงเลขให้เห็นทันที เพราะพนักงานต้องเขียนติดพาเลทจริงก่อนนำไปเก็บ
      if (res.pallets?.length) showPallets(res, items);
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
      aiOn ? h('div', { class: 'card', style: 'border-left:4px solid var(--brand)' },
        h('div', { class: 'card-head' },
          h('div', {},
            h('h2', {}, '📷 สแกนใบส่งของด้วย AI'),
            h('p', { class: 'muted', style: 'margin:2px 0 0;font-size:13.5px' },
              'ถ่ายรูปหรือแนบไฟล์ใบส่งของ/PO แล้ว AI จะอ่านรายการมาเติมให้ — ตรวจก่อนบันทึกเสมอ')),
          h('div', { class: 'actions' },
            scanBtns[0] = h('button', { class: 'btn', title: 'เปิดกล้องถ่ายรูปใบส่งของ/PO ให้ AI อ่านรายการมาเติมฟอร์มให้ — ระบบยังไม่บันทึก ต้องตรวจทุกบรรทัดก่อนกดบันทึกเสมอ', onclick: () => scanDoc('environment') }, '📷 ถ่ายรูป'),
            scanBtns[1] = h('button', { class: 'btn primary', title: 'แนบไฟล์รูปหรือ PDF ของใบส่งของ/PO ให้ AI อ่านรายการมาเติมฟอร์มให้ (แนบได้หลายไฟล์) — ต้องตรวจก่อนบันทึกเสมอ', onclick: () => scanDoc(null) }, '📎 แนบไฟล์'))),
        scanStatus) : null,
      h('div', { class: 'card' },
        h('h2', {}, '1. ข้อมูลเอกสาร'),
        h('div', { class: 'grid g2' }, field('เลขที่ PO อ้างอิง', refNo, null, 'เลขที่ใบสั่งซื้อ (Purchase Order) อ้างอิงจากฝ่ายจัดซื้อ'), field('ผู้ขาย / Supplier', party, null, 'บริษัทหรือแหล่งที่ส่งสินค้ามา')),
        h('div', { class: 'grid g2' }, field('ผลตรวจ QC ก่อนรับเข้า', qcSel, 'สินค้าที่กักกันควรเลือกตำแหน่งในโซน QR', 'ผลการตรวจสอบคุณภาพสินค้าก่อนรับเข้าคลัง เลือก PASS/QUARANTINE/FAIL'), field('บันทึก QC', qcNote, null, 'รายละเอียดผลตรวจ QC เช่น สภาพกล่อง ฉลาก อุณหภูมิขนส่ง')),
        field('หมายเหตุ', note, null, 'บันทึกเพิ่มเติม เช่น สภาพสินค้า ปัญหาที่พบ')),
      h('div', { class: 'card' },
        h('div', { class: 'card-head' },
          h('h2', {}, '2. รายการสินค้า'),
          h('button', { class: 'btn', title: 'เพิ่มบรรทัดสินค้าอีก 1 รายการในใบรับเข้าใบนี้ — ใช้เมื่อรับหลายสินค้าหรือหลาย Lot ในการส่งของครั้งเดียว', onclick: addLine }, '+ เพิ่มบรรทัด')),
        linesBox),
      h('div', { style: 'margin:14px 0;text-align:right' },
        h('button', { class: 'btn primary', style: 'padding:12px 32px;font-size:16px', title: 'ออกเลขที่ใบรับเข้าและนำสินค้าทุกบรรทัดเข้าตำแหน่งที่ระบุ — สต๊อกเพิ่มทันทีและบันทึกลงประวัติซึ่งลบไม่ได้ ตรวจให้ครบก่อนกด', onclick: submit }, '📥 บันทึกใบรับเข้า'))) : null,
    h('div', { class: 'card' },
      h('h2', {}, 'ใบรับเข้าล่าสุด'),
      recent));
}
