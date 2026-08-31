// เอกสารคลัง — โอนย้าย / รับคืนลูกค้า / ส่งคืนผู้ขาย / ตัดเสีย + ประวัติเอกสารทั้งหมด
import { api, auth } from '../api.js?v=42';
import { h, field, table, pill, toast, fmtNum, fmtDateTime, modal, DOC_LABEL, DOC_COLOR, locationPickerModal } from '../ui.js?v=42';

// ---------- ตัวช่วย: สแกน/พิมพ์รหัสตำแหน่งเพื่อดึงรายการสินค้าในตำแหน่งนั้น ----------
function itemPicker(onAdd) {
  const input = h('input', { placeholder: 'สแกน/พิมพ์รหัสตำแหน่งที่มีสินค้า เช่น FG-A01-L1-D1 แล้วกด Enter', autocomplete: 'off' });
  const info = h('div', { class: 'muted', style: 'font-size:13px;margin-top:6px' });
  input.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const code = input.value.trim().toUpperCase();
    if (!code) return;
    try {
      const { location, item } = await api.get(`/api/locations/${encodeURIComponent(code)}`);
      if (!item) { info.textContent = `ตำแหน่ง ${location.location_code} ว่าง — ไม่มีสินค้าให้เลือก`; return; }
      onAdd({ ...item, location_code: location.location_code });
      info.textContent = '';
      input.value = '';
    } catch (err) { info.textContent = err.message; }
  });
  return { el: h('div', {}, input, info), input };
}

export async function docsView() {
  const skus = await api.get('/api/skus');

  // ---------------- รายการเอกสาร ----------------
  const typeSel = h('select', { onchange: () => load() },
    h('option', { value: '' }, 'เอกสารทุกประเภท'),
    ...Object.entries(DOC_LABEL).map(([v, l]) => h('option', { value: v }, l)));
  const q = h('input', { placeholder: 'ค้นหา เลขเอกสาร / อ้างอิง / คู่ค้า', autocomplete: 'off' });
  q.addEventListener('keydown', (e) => e.key === 'Enter' && load());
  const listBox = h('div', {});

  async function load() {
    listBox.replaceChildren(h('div', { class: 'empty-state' }, 'กำลังโหลด…'));
    const rows = await api.get('/api/docs', { type: typeSel.value, q: q.value.trim(), limit: 200 });
    listBox.replaceChildren(table([
      { label: 'เลขที่', key: 'doc_no', mono: true },
      { label: 'ประเภท', value: (r) => pill(DOC_LABEL[r.doc_type] ?? r.doc_type, DOC_COLOR[r.doc_type] ?? 'gray') },
      { label: 'วันที่', value: (r) => fmtDateTime(r.created_at) },
      { label: 'อ้างอิง', value: (r) => r.ref_no || '—', mono: true },
      { label: 'คู่ค้า/เหตุผล', value: (r) => r.party || r.reason || '—' },
      { label: 'รายการ', key: 'line_count', num: true },
      { label: 'จำนวนรวม', value: (r) => fmtNum(r.total_qty), num: true },
      { label: 'ผู้บันทึก', key: 'created_by_name' },
      { label: '', value: (r) => h('button', { class: 'btn ghost', title: 'เปิดดูรายละเอียดทุกบรรทัดของเอกสารนี้ — สินค้า Lot จำนวน และตำแหน่งต้นทาง/ปลายทาง', onclick: () => showDoc(r.doc_id) }, 'ดู') },
    ], rows, { empty: 'ยังไม่มีเอกสาร' }));
  }

  async function showDoc(docId) {
    const { doc, movements } = await api.get(`/api/docs/${docId}`);
    modal(`${DOC_LABEL[doc.doc_type]} ${doc.doc_no}`,
      h('div', {},
        h('p', { class: 'muted' },
          [fmtDateTime(doc.created_at), doc.party, doc.ref_no ? `อ้างอิง ${doc.ref_no}` : null,
           doc.reason ? `เหตุผล: ${doc.reason}` : null, `ผู้บันทึก ${doc.created_by_name ?? '-'}`]
            .filter(Boolean).join(' · ')),
        table([
          { label: 'ประเภท', value: (m) => ({ STORE: 'เข้า', REMOVE: 'ออก', MOVE: 'ย้าย', EDIT: 'ปรับ' }[m.movement_type]) },
          { label: 'สินค้า', key: 'sku_name' },
          { label: 'Lot', key: 'lot_no', mono: true },
          { label: 'จำนวน', value: (m) => `${fmtNum(m.quantity)} ${m.unit}`, num: true },
          { label: 'จาก', value: (m) => m.from_code || '—', mono: true },
          { label: 'ไป', value: (m) => m.to_code || '—', mono: true },
          { label: 'หมายเหตุ', key: 'note' },
        ], movements)),
      [h('button', { class: 'btn', onclick: (e) => e.target.closest('.modal-bg').remove() }, 'ปิด')]);
  }

  // ---------------- โอนย้าย ----------------
  function transferForm() {
    const items = [];
    const listEl = h('div', {});
    const note = h('input', { placeholder: 'เหตุผล/หมายเหตุการโอน เช่น ย้ายเข้าโซนโปรโมชัน' });
    const picker = itemPicker((item) => {
      if (items.find((x) => x.item_id === item.item_id)) return;
      const to = h('input', { placeholder: 'ตำแหน่งปลายทาง', autocomplete: 'off', style: 'width:130px' });
      const toPick = h('button', {
        class: 'btn ghost', type: 'button', style: 'padding:4px 8px;font-size:12px;white-space:nowrap',
        title: 'เปิดผังคลังเพื่อเลือกตำแหน่งปลายทางจากช่องที่ว่างจริง — แทนการพิมพ์รหัสเอง',
        onclick: () => locationPickerModal((url, params) => api.get(url, params), (code) => { to.value = code; }),
      }, '🗺️');
      items.push({ item, to, toPick });
      render();
    });
    function render() {
      listEl.replaceChildren(...items.map((x) =>
        h('div', { class: 'row', style: 'align-items:center;gap:10px;border-bottom:1px solid #eee;padding:6px 0' },
          h('div', { style: 'flex:2' },
            h('div', { style: 'font-weight:600' }, x.item.sku_name),
            h('div', { class: 'mono muted', style: 'font-size:12px' }, `${x.item.location_code} · Lot ${x.item.lot_no ?? '-'} · ${fmtNum(x.item.quantity)} ${x.item.unit}`)),
          h('div', {}, '→'), x.to, x.toPick,
          h('button', { class: 'btn ghost', title: 'เอาบรรทัดนี้ออกจากใบโอน — สินค้ายังอยู่ที่ตำแหน่งเดิม ไม่กระทบสต๊อกจริง', onclick: () => { items.splice(items.indexOf(x), 1); render(); } }, '🗑️'))));
    }
    const m = modal('สร้างใบโอนย้าย',
      h('div', {},
        field('เพิ่มรายการจากตำแหน่ง', picker.el, null, 'สแกนหรือพิมพ์รหัสตำแหน่งต้นทางที่จะย้ายสินค้าออก'),
        listEl,
        field('หมายเหตุ', note, null, 'รายละเอียดเพิ่มเติมเกี่ยวกับการโอนย้ายครั้งนี้')),
      [
        h('button', { class: 'btn', onclick: () => m.close() }, 'ยกเลิก'),
        h('button', { class: 'btn primary', title: 'ยืนยันย้ายสินค้าทุกบรรทัดที่ระบุตำแหน่งปลายทางแล้ว — สต๊อกจะเปลี่ยนตำแหน่งทันทีและออกเลขเอกสารบันทึกลงประวัติ (แก้ไขภายหลังต้องทำรายการย้อนกลับ)', onclick: async () => {
          const lines = items
            .filter((x) => x.to.value.trim())
            .map((x) => ({ item_id: x.item.item_id, to_location_code: x.to.value.trim().toUpperCase() }));
          if (!lines.length) { toast('เพิ่มรายการและระบุตำแหน่งปลายทางก่อน', 'err'); return; }
          try {
            const res = await api.post('/api/docs/transfer', { note: note.value, lines });
            toast(`โอนย้ายเรียบร้อย — เอกสาร ${res.doc_no}`); m.close(); load();
          } catch (err) { toast(err.message, 'err'); }
        } }, 'ยืนยันโอนย้าย'),
      ]);
  }

  // ---------------- รับคืนลูกค้า (ของกลับเข้าคลัง) ----------------
  function returnInForm() {
    const party = h('input', { placeholder: 'ชื่อลูกค้าที่คืน' });
    const refNo = h('input', { placeholder: 'เลข SO/ใบส่งของเดิม (ถ้ามี)' });
    const reason = h('input', { placeholder: 'เหตุผลการคืน เช่น สินค้าเสียหายจากขนส่ง *' });
    const note = h('input', { placeholder: 'หมายเหตุ' });
    const lines = [];
    const linesBox = h('div', {});
    function addLine() {
      const sel = h('select', {}, h('option', { value: '' }, '— สินค้า —'),
        ...skus.map((s) => h('option', { value: s.sku_id }, `${s.sku_code} — ${s.sku_name}`)));
      const qty = h('input', { type: 'number', min: '1', value: '1', style: 'width:80px' });
      const lot = h('input', { placeholder: 'Lot', style: 'width:110px' });
      const exp = h('input', { type: 'date' });
      const loc = h('input', { placeholder: 'ตำแหน่งเก็บ', style: 'width:120px' });
      const locPick = h('button', {
        class: 'btn ghost', type: 'button', style: 'padding:4px 8px;font-size:12px;white-space:nowrap',
        title: 'เปิดผังคลังเพื่อเลือกตำแหน่งว่างที่จะเก็บสินค้าคืน — แทนการพิมพ์รหัสเอง',
        onclick: () => locationPickerModal((url, params) => api.get(url, params), (code) => { loc.value = code; }),
      }, '🗺️');
      const line = { sel, qty, lot, exp, loc };
      lines.push(line);
      linesBox.append(h('div', { class: 'row', style: 'flex-wrap:wrap;border-bottom:1px solid #eee;padding:6px 0' },
        field('สินค้า', sel, null, 'เลือกรหัสสินค้า (SKU) ที่ลูกค้าคืนกลับมา'), field('จำนวน', qty, null, 'จำนวนสินค้าที่รับคืน'), field('Lot', lot, null, 'เลข Lot/Batch ของสินค้าที่คืน'), field('EXP', exp, null, 'วันหมดอายุของสินค้าที่คืน'),
        field('เก็บที่', h('div', { style: 'display:flex;gap:4px' }, loc, locPick), null, 'ตำแหน่งบนชั้นวางที่จะนำสินค้าคืนไปจัดเก็บ')));
    }
    addLine();
    const m = modal('รับคืนสินค้าจากลูกค้า',
      h('div', {},
        h('div', { class: 'grid g2' }, field('ลูกค้า', party, null, 'ชื่อลูกค้าที่ส่งสินค้าคืนกลับมา'), field('อ้างอิง', refNo, null, 'เลขที่เอกสารอ้างอิง เช่น เลขที่ใบส่งของเดิม')),
        field('เหตุผลการคืน *', reason, null, 'เหตุผลของการคืนสินค้า เช่น สินค้าเสียหาย ส่งผิดรุ่น'),
        linesBox,
        h('button', { class: 'btn', title: 'เพิ่มช่องกรอกอีก 1 บรรทัด สำหรับสินค้าคนละรายการหรือคนละ Lot ในใบคืนใบเดียวกัน', onclick: addLine }, '+ เพิ่มบรรทัด'),
        field('หมายเหตุ', note, null, 'รายละเอียดเพิ่มเติม')),
      [
        h('button', { class: 'btn', onclick: () => m.close() }, 'ยกเลิก'),
        h('button', { class: 'btn primary', title: 'ยืนยันรับสินค้ากลับเข้าคลัง — สต๊อกจะเพิ่มขึ้นที่ตำแหน่งที่ระบุทันที ต้องกรอกเหตุผลการคืนก่อน', onclick: async () => {
          const items = lines.filter((l) => l.sel.value && l.loc.value.trim()).map((l) => ({
            sku_id: Number(l.sel.value), quantity: Number(l.qty.value),
            lot_no: l.lot.value.trim() || null, exp_date: l.exp.value || null,
            location_code: l.loc.value.trim().toUpperCase(),
          }));
          if (!items.length) { toast('กรอกสินค้าและตำแหน่งอย่างน้อย 1 บรรทัด', 'err'); return; }
          try {
            const res = await api.post('/api/docs/return-in', {
              party: party.value, ref_no: refNo.value, reason: reason.value, note: note.value, lines: items,
            });
            toast(`รับคืนเรียบร้อย — เอกสาร ${res.doc_no}`); m.close(); load();
          } catch (err) { toast(err.message, 'err'); }
        } }, 'ยืนยันรับคืน'),
      ]);
  }

  // ---------------- ส่งคืนผู้ขาย / ตัดเสีย (โครงเดียวกัน: เลือกของออกจากคลัง) ----------------
  function outForm(kind) {
    const isScrap = kind === 'scrap';
    const party = isScrap ? null : h('input', { placeholder: 'ชื่อผู้ขาย / Supplier' });
    const refNo = h('input', { placeholder: isScrap ? 'เอกสารอ้างอิง (ถ้ามี)' : 'เลข PO เดิม (ถ้ามี)' });
    const reason = h('input', { placeholder: isScrap ? 'เหตุผล เช่น หมดอายุ / แตกหัก *' : 'เหตุผลการส่งคืน *' });
    const items = [];
    const listEl = h('div', {});
    const picker = itemPicker((item) => {
      if (items.find((x) => x.item_id === item.item_id)) return;
      const qty = h('input', { type: 'number', min: '1', max: String(item.quantity), value: String(item.quantity), style: 'width:90px' });
      items.push({ item_id: item.item_id, item, qty });
      render();
    });
    function render() {
      listEl.replaceChildren(...items.map((x) =>
        h('div', { class: 'row', style: 'align-items:center;gap:10px;border-bottom:1px solid #eee;padding:6px 0' },
          h('div', { style: 'flex:2' },
            h('div', { style: 'font-weight:600' }, x.item.sku_name),
            h('div', { class: 'mono muted', style: 'font-size:12px' }, `${x.item.location_code} · Lot ${x.item.lot_no ?? '-'} · มี ${fmtNum(x.item.quantity)} ${x.item.unit}`)),
          x.qty,
          h('button', { class: 'btn ghost', title: 'เอาบรรทัดนี้ออกจากเอกสาร — สินค้ายังอยู่ในคลังตามเดิม ไม่กระทบสต๊อกจริง', onclick: () => { items.splice(items.indexOf(x), 1); render(); } }, '🗑️'))));
    }
    const m = modal(isScrap ? 'ตัดของเสีย (Scrap)' : 'ส่งคืนผู้ขาย (Supplier Return)',
      h('div', {},
        h('div', { class: 'grid g2' }, party ? field('Supplier', party, null, 'ชื่อผู้ขาย/Supplier ที่จะส่งคืนสินค้าให้') : null, field('อ้างอิง', refNo, null, 'เลขที่เอกสารอ้างอิง เช่น เลข PO หรือใบคืนสินค้า')),
        field('เหตุผล *', reason, null, 'เหตุผลของการส่งคืน/ตัดเสีย เช่น สินค้าเสียหาย หมดอายุ'),
        field('เพิ่มรายการจากตำแหน่ง', picker.el, null, 'สแกนหรือพิมพ์รหัสตำแหน่งที่มีสินค้าที่ต้องการดำเนินการ'),
        listEl),
      [
        h('button', { class: 'btn', onclick: () => m.close() }, 'ยกเลิก'),
        h('button', { class: 'btn primary', title: isScrap ? 'ยืนยันตัดของเสียออกจากคลัง — สต๊อกจะถูกหักตามจำนวนที่ระบุทันทีและลบไม่ได้ ต้องระบุเหตุผลกำกับเสมอ' : 'ยืนยันส่งสินค้าคืนผู้ขาย — สต๊อกจะถูกตัดออกจากตำแหน่งที่เลือกทันทีและบันทึกลงประวัติแบบลบไม่ได้', onclick: async () => {
          const lines = items.map((x) => ({ item_id: x.item_id, quantity: Number(x.qty.value) }));
          if (!lines.length) { toast('เพิ่มรายการอย่างน้อย 1 บรรทัด', 'err'); return; }
          try {
            const res = await api.post(isScrap ? '/api/docs/scrap' : '/api/docs/return-out', {
              party: party?.value, ref_no: refNo.value, reason: reason.value, lines,
            });
            toast(`บันทึกเรียบร้อย — เอกสาร ${res.doc_no}`); m.close(); load();
          } catch (err) { toast(err.message, 'err'); }
        } }, 'ยืนยัน'),
      ]);
  }

  load();
  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'เอกสารคลัง'),
        h('p', {}, 'โอนย้าย · รับคืนลูกค้า · ส่งคืนผู้ขาย · ตัดเสีย — ทุกเอกสารผูกกับประวัติสินค้าตรวจย้อนได้')),
      auth.can('move') ? h('div', { class: 'actions' },
        h('button', { class: 'btn', title: 'สร้างใบโอนย้ายสินค้าระหว่างตำแหน่งในคลัง — จำนวนรวมไม่เปลี่ยน เปลี่ยนแค่ตำแหน่งจัดเก็บ', onclick: transferForm }, '🔄 โอนย้าย'),
        h('button', { class: 'btn', title: 'บันทึกสินค้าที่ลูกค้าส่งกลับเข้าคลัง — ต้องระบุ Lot วันหมดอายุ และตำแหน่งที่จะเก็บคืน', onclick: returnInForm }, '↩️ รับคืนลูกค้า'),
        h('button', { class: 'btn', title: 'สร้างใบส่งสินค้ากลับไปยังผู้ขาย — สินค้าจะถูกตัดออกจากคลังตามจำนวนที่เลือก', onclick: () => outForm('return-out') }, '📦 ส่งคืนผู้ขาย'),
        h('button', { class: 'btn danger', title: 'ตัดสินค้าเสีย/หมดอายุออกจากสต๊อกถาวร — ใช้เมื่อของใช้ไม่ได้แล้ว ต้องระบุเหตุผลและแก้ไขภายหลังไม่ได้', onclick: () => outForm('scrap') }, '🗑️ ตัดเสีย')) : null),
    h('div', { class: 'card' },
      h('div', { class: 'row scan' }, h('div', { style: 'flex:3' }, q), h('div', { style: 'flex:1' }, typeSel)),
      listBox));
}
