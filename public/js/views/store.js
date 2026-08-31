// จัดเก็บสินค้าเข้าตำแหน่งว่าง
import { api } from '../api.js';
import { h, field, toast, scanInput, fmtNum } from '../ui.js?v=36';

export async function storeView() {
  const [skus, zones] = await Promise.all([api.get('/api/skus'), api.get('/api/zones')]);

  const skuSel = h('select', {},
    h('option', { value: '' }, '— เลือกสินค้า —'),
    ...skus.map((s) => h('option', { value: s.sku_id }, `${s.sku_code} — ${s.sku_name} (${s.unit})`)));
  const qty = h('input', { type: 'number', min: '1', value: '1' });
  const lot = h('input', { placeholder: 'เช่น L2026-08-01' });
  const exp = h('input', { type: 'date' });
  const note = h('input', { placeholder: 'หมายเหตุ (ถ้ามี)' });

  const locInput = scanInput('พิมพ์หรือสแกนรหัสตำแหน่ง เช่น FG-A01-L1-D1', () => {}, { autofocus: false });

  const zoneSel = h('select', { onchange: loadEmpties },
    h('option', { value: '' }, 'ทุกโซน'),
    ...zones.map((z) => h('option', { value: z.zone_id }, `${z.zone_code} — ${z.zone_name}`)));

  const pickList = h('div', { class: 'pick-list' });
  let empties = [];

  async function loadEmpties() {
    empties = await api.get('/api/locations', { zone_id: zoneSel.value, limit: 300 });
    renderPick();
  }

  function renderPick() {
    const term = locInput.value.trim().toUpperCase();
    const rows = empties.filter((l) => l.location_code.includes(term)).slice(0, 24);
    pickList.replaceChildren(
      rows.length
        ? h('div', { class: 'pick-grid' },
            ...rows.map((l) =>
              h('button', {
                class: `chip ${locInput.value.toUpperCase() === l.location_code ? 'active' : ''}`,
                onclick: () => { locInput.value = l.location_code; renderPick(); },
              }, l.location_code)))
        : h('div', { class: 'muted' }, empties.length ? 'ไม่พบตำแหน่งที่ตรงกัน' : 'กำลังโหลด…'));
  }

  locInput.addEventListener('input', renderPick);
  loadEmpties();

  const result = h('div', {});

  async function submit() {
    if (!skuSel.value) { toast('กรุณาเลือกสินค้า', 'err'); return; }
    if (!locInput.value.trim()) { toast('กรุณาระบุตำแหน่งจัดเก็บ', 'err'); return; }

    try {
      const item = await api.post('/api/items', {
        sku_id: Number(skuSel.value),
        location_code: locInput.value.trim().toUpperCase(),
        quantity: Number(qty.value),
        lot_no: lot.value.trim() || null,
        exp_date: exp.value || null,
        note: note.value.trim() || null,
      });
      toast(`จัดเก็บ ${item.sku_name} ที่ ${item.location_code} เรียบร้อย`);
      result.replaceChildren(
        h('div', { class: 'card', style: 'background:#f0fdf4;border-color:#86efac' },
          h('h3', {}, 'จัดเก็บสำเร็จ'),
          h('p', {}, `${item.sku_name} จำนวน ${fmtNum(item.quantity)} ${item.unit}`),
          h('p', {}, `ตำแหน่ง `, h('a', { href: `#/map/${item.rag_id}?loc=${item.location_code}` }, item.location_code)),
          h('button', { class: 'btn primary', onclick: reset }, 'จัดเก็บรายการถัดไป')));
      locInput.value = '';
      loadEmpties();
    } catch (err) { toast(err.message, 'err'); }
  }

  function reset() {
    result.replaceChildren();
    skuSel.value = '';
    qty.value = '1';
    lot.value = '';
    exp.value = '';
    note.value = '';
    locInput.value = '';
    renderPick();
  }

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'จัดเก็บสินค้าเข้าคลัง'),
        h('p', {}, '1 ตำแหน่ง = 1 รายการสินค้า — เลือกสินค้า กรอกจำนวน แล้วเลือกตำแหน่งว่าง'))),
    result,
    h('div', { class: 'card' },
      h('h2', {}, 'ข้อมูลสินค้า'),
      h('div', { class: 'grid g2' },
        field('สินค้า *', skuSel, 'เลือกรายการสินค้าจากฐานข้อมูล', 'เลือกสินค้าที่ต้องการจัดเก็บเข้าคลัง'),
        field('จำนวน *', qty, null, 'จำนวนสินค้าที่จัดเก็บ ตามหน่วยนับของสินค้านั้น')),
      h('div', { class: 'grid g2' },
        field('Lot / รุ่นการผลิต', lot, null, 'รหัส Lot หรือรุ่นการผลิต — ใช้ติดตามย้อนกลับได้'),
        field('วันหมดอายุ', exp, null, 'วันหมดอายุ — ระบบจะใช้คำนวณ FEFO และแจ้งเตือนสินค้าใกล้หมดอายุ')),
      field('หมายเหตุ', note, null, 'บันทึกเพิ่มเติม เช่น สาเหตุที่จัดเก็บ, เลข GRN')),
    h('div', { class: 'card' },
      h('h2', {}, 'เลือกตำแหน่งจัดเก็บ'),
      h('div', { class: 'row', style: 'gap:12px;margin-bottom:12px' },
        h('div', { style: 'flex:2' }, locInput),
        h('div', { style: 'flex:1' }, zoneSel)),
      pickList),
    h('div', { style: 'margin-top:16px;text-align:right' },
      h('button', { class: 'btn primary', style: 'padding:12px 32px;font-size:16px', onclick: submit }, '📥 จัดเก็บสินค้า')));
}
