// การทำรายการกับสินค้าที่จัดเก็บอยู่ — ใช้ร่วมกันทั้งหน้าค้นหาและหน้าแผนผัง
import { api, auth } from './api.js?v=42';
import { h, field, modal, toast, fmtNum } from './ui.js?v=42';

/** หยิบสินค้าออกจากตำแหน่ง (ทั้งหมดหรือบางส่วน) */
export function removeItemDialog(item, onDone) {
  const qty = h('input', { type: 'number', min: '1', max: String(item.quantity), value: String(item.quantity) });
  const note = h('input', { placeholder: 'เช่น เบิกผลิต / ส่งลูกค้า / เลขที่เอกสาร' });

  const m = modal(`หยิบสินค้าออก — ${item.sku_name}`,
    h('div', {},
      h('p', { class: 'muted' }, `ตำแหน่ง ${item.location_code} · คงเหลือ ${fmtNum(item.quantity)} ${item.unit}`),
      field('จำนวนที่หยิบออก', qty, 'ถ้าหยิบออกทั้งหมด ตำแหน่งนี้จะกลับเป็นช่องว่าง'),
      field('หมายเหตุ', note)),
    [
      h('button', { class: 'btn', onclick: () => m.close() }, 'ยกเลิก'),
      h('button', { class: 'btn primary', title: 'ตัดสต๊อกออกตามจำนวนที่ระบุและบันทึกลงประวัติ — ถ้าหยิบครบทั้งหมด ตำแหน่งนี้จะกลับเป็นช่องว่างทันที', onclick: async () => {
        try {
          const r = await api.post(`/api/items/${item.item_id}/remove`, { quantity: Number(qty.value), note: note.value.trim() });
          toast(r.remaining ? `หยิบออก ${fmtNum(r.removed)} ${item.unit} · เหลือ ${fmtNum(r.remaining)}` : `หยิบสินค้าออกจาก ${item.location_code} แล้ว`);
          m.close(); onDone?.();
        } catch (err) { toast(err.message, 'err'); }
      } }, 'ยืนยันหยิบออก'),
    ]);
}

/** ย้ายสินค้าไปตำแหน่งอื่น */
export async function moveItemDialog(item, onDone) {
  const input = h('input', { placeholder: 'พิมพ์หรือสแกนรหัสตำแหน่ง เช่น FG-A01-L1-D2', autocomplete: 'off' });
  const list = h('div', { class: 'pick-list' });
  const empties = await api.get('/api/locations', { limit: 300 });

  const renderList = () => {
    const term = input.value.trim().toUpperCase();
    const rows = empties.filter((l) => l.location_code.includes(term)).slice(0, 12);
    list.replaceChildren(...rows.map((l) =>
      h('button', { class: 'chip', onclick: () => { input.value = l.location_code; renderList(); } }, l.location_code)));
  };
  input.addEventListener('input', renderList);
  input.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
  renderList();
  setTimeout(() => input.focus(), 60);

  const submit = async () => {
    try {
      await api.post(`/api/items/${item.item_id}/move`, { to_location_code: input.value.trim().toUpperCase() });
      toast(`ย้ายไปที่ ${input.value.trim().toUpperCase()} เรียบร้อย`);
      m.close(); onDone?.();
    } catch (err) { toast(err.message, 'err'); }
  };

  const m = modal(`ย้ายสินค้า — ${item.sku_name}`,
    h('div', {},
      h('p', { class: 'muted' }, `ตำแหน่งปัจจุบัน ${item.location_code}`),
      field('ย้ายไปที่', input, 'เลือกจากตำแหน่งว่างด้านล่าง หรือสแกนป้ายตำแหน่งได้เลย'),
      list),
    [
      h('button', { class: 'btn', onclick: () => m.close() }, 'ยกเลิก'),
      h('button', { class: 'btn primary', title: 'ย้ายพาเลทนี้ไปยังตำแหน่งปลายทางที่ระบุ — ตำแหน่งเดิมจะว่างลง และปลายทางต้องเป็นช่องว่างเท่านั้น', onclick: submit }, 'ยืนยันการย้าย'),
    ]);
}

/** แก้ไขข้อมูลสินค้าที่จัดเก็บอยู่ */
export function editItemDialog(item, onDone) {
  const qty = h('input', { type: 'number', min: '0', value: String(item.quantity) });
  const lot = h('input', { value: item.lot_no ?? '' });
  const mfg = h('input', { type: 'date', value: item.mfg_date ?? '' });
  const exp = h('input', { type: 'date', value: item.exp_date ?? '' });
  const note = h('input', { placeholder: 'เหตุผลในการแก้ไข (ถ้ามี)' });

  const m = modal(`แก้ไขข้อมูล — ${item.sku_name}`,
    h('div', {},
      h('p', { class: 'muted' }, `ตำแหน่ง ${item.location_code} · การแก้ไขจะถูกบันทึกไว้ในประวัติ`),
      h('div', { class: 'row' }, field('จำนวน', qty), field('Lot / รุ่นการผลิต', lot)),
      h('div', { class: 'row' }, field('วันผลิต (MFG)', mfg), field('วันหมดอายุ (EXP)', exp)),
      field('หมายเหตุ', note)),
    [
      h('button', { class: 'btn', onclick: () => m.close() }, 'ยกเลิก'),
      h('button', { class: 'btn primary', title: 'บันทึกจำนวน/Lot/วันที่ที่แก้ไข — การแก้ไขจะถูกเก็บในประวัติและลบไม่ได้ ต้องแก้ด้วยรายการย้อนกลับเท่านั้น', onclick: async () => {
        try {
          await api.put(`/api/items/${item.item_id}`, {
            quantity: Number(qty.value), lot_no: lot.value.trim(), mfg_date: mfg.value, exp_date: exp.value, note: note.value.trim(),
          });
          toast('บันทึกการแก้ไขแล้ว'); m.close(); onDone?.();
        } catch (err) { toast(err.message, 'err'); }
      } }, 'บันทึก'),
    ]);
}

/** ปุ่มทำรายการมาตรฐาน (แสดงเฉพาะผู้มีสิทธิ์) */
export const itemActions = (item, onDone) =>
  auth.can('move')
    ? [
        h('button', { class: 'btn', title: 'แก้จำนวน Lot วันผลิต/วันหมดอายุ ของสินค้าที่วางอยู่ตำแหน่งนี้ ใช้เมื่อคีย์ผิดหรือข้อมูลไม่ตรงกับฉลาก — ทุกการแก้ถูกบันทึกในประวัติ', onclick: () => editItemDialog(item, onDone) }, '✏️ แก้ไข'),
        h('button', { class: 'btn', title: 'ย้ายพาเลทนี้ไปตำแหน่งว่างอื่น เช่น ย้ายออกเพื่อเข้าถึงของที่อยู่ลึกกว่า (D2 ขึ้นไป) — จำนวนคงเดิม เปลี่ยนแค่ตำแหน่ง', onclick: () => moveItemDialog(item, onDone) }, '🔄 ย้าย'),
        h('button', { class: 'btn primary', title: 'เบิก/จ่ายสินค้าออกจากตำแหน่งนี้ ระบุได้ทั้งบางส่วนหรือทั้งหมด — สต๊อกจะลดลงทันทีและบันทึกลงประวัติ', onclick: () => removeItemDialog(item, onDone) }, '📤 หยิบออก'),
      ]
    : [];
