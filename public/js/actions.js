// การทำรายการกับสินค้าที่จัดเก็บอยู่ — ใช้ร่วมกันทั้งหน้าค้นหาและหน้าแผนผัง
import { api, auth } from './api.js?v=49';
import { h, field, modal, toast, fmtNum } from './ui.js?v=49';

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
/**
 * แกะลัง — แยกของบางส่วนไปวางที่พื้นที่เศษ
 * พื้นที่เศษห้ามคละ Lot ระบบจึงเสนอเฉพาะช่องว่างในโซนแบบ BREAK
 * และช่องที่มีของ Lot เดียวกันอยู่แล้ว (รวมกองได้)
 */
export async function breakCartonDialog(item, onDone) {
  const qty = h('input', { type: 'number', min: '1', max: String(item.quantity), placeholder: 'จำนวนที่แกะออกมา' });
  const input = h('input', { placeholder: 'พิมพ์หรือสแกนช่องในพื้นที่เศษ เช่น BRK-01', autocomplete: 'off' });
  const list = h('div', { class: 'pick-list' });

  const [empties, sameLot] = await Promise.all([
    api.get('/api/locations', { limit: 300 }).catch(() => []),
    api.get('/api/stock', { zone_type: 'BREAK', limit: 300 }).catch(() => []),
  ]);
  // ช่องที่ใช้ได้ = ช่องว่างในโซนเศษ + ช่องที่มีสินค้าและ Lot เดียวกันอยู่แล้ว
  const usable = [
    ...empties.filter((l) => l.zone_type === 'BREAK').map((l) => ({ code: l.location_code, note: 'ว่าง' })),
    ...sameLot
      .filter((s) => s.sku_id === item.sku_id && (s.lot_no ?? '') === (item.lot_no ?? ''))
      .map((s) => ({ code: s.location_code, note: `มี Lot เดียวกันอยู่ ${fmtNum(s.quantity)}` })),
  ];

  const renderList = () => {
    const term = input.value.trim().toUpperCase();
    const rows = usable.filter((l) => l.code.includes(term)).slice(0, 12);
    list.replaceChildren(...(rows.length
      ? rows.map((l) => h('button', {
          class: 'chip', title: l.note,
          onclick: () => { input.value = l.code; renderList(); },
        }, `${l.code} · ${l.note}`))
      : [h('span', { class: 'muted', style: 'font-size:13px' },
          'ไม่มีช่องที่ใช้ได้ — ต้องมีโซนแบบ "พื้นที่เศษ" และมีช่องว่างก่อน')]));
  };
  input.addEventListener('input', renderList);
  renderList();
  setTimeout(() => qty.focus(), 60);

  const submit = async () => {
    const n = Number(qty.value);
    if (!n || n <= 0) { toast('ระบุจำนวนที่แกะออกมา', 'err'); qty.focus(); return; }
    if (n > item.quantity) { toast(`ตำแหน่งนี้มีแค่ ${fmtNum(item.quantity)} ${item.unit}`, 'err'); return; }
    if (!input.value.trim()) { toast('เลือกช่องในพื้นที่เศษก่อน', 'err'); input.focus(); return; }
    try {
      const r = await api.post(`/api/items/${item.item_id}/break`, {
        quantity: n, location_code: input.value.trim().toUpperCase(),
      });
      toast(`แกะ ${fmtNum(r.moved)} ${item.unit} ไปที่ ${r.to.location_code} — ต้นทางเหลือ ${fmtNum(r.from.remaining)}`);
      m.close(); onDone?.();
    } catch (err) { toast(err.message, 'err'); }
  };

  const m = modal(`📦 แกะลัง — ${item.sku_name}`,
    h('div', {},
      h('p', { class: 'muted', style: 'margin-top:0' },
        `${item.location_code} · Lot ${item.lot_no ?? '—'} · มีอยู่ ${fmtNum(item.quantity)} ${item.unit}`),
      field('จำนวนที่แกะออกมา *', qty, null, 'จำนวนที่แกะออกจากลังเพื่อนำไปวางที่พื้นที่เศษ — ส่วนที่เหลืออยู่ที่เดิม'),
      field('นำไปวางที่ *', input, 'เลือกจากช่องด้านล่าง หรือสแกนป้ายช่องได้เลย', 'ช่องในโซนแบบ "พื้นที่เศษ" เท่านั้น — ห้ามคละ Lot ในช่องเดียวกัน'),
      list),
    [
      h('button', { class: 'btn', onclick: () => m.close() }, 'ยกเลิก'),
      h('button', { class: 'btn primary', title: 'ย้ายของตามจำนวนที่ระบุไปยังพื้นที่เศษ — สต๊อกรวมเท่าเดิม เปลี่ยนแค่ที่เก็บ และบันทึกลงประวัติ', onclick: submit }, '📦 แกะไปพื้นที่เศษ'),
    ]);
}

export const itemActions = (item, onDone) =>
  auth.can('move')
    ? [
        h('button', { class: 'btn', title: 'แก้จำนวน Lot วันผลิต/วันหมดอายุ ของสินค้าที่วางอยู่ตำแหน่งนี้ ใช้เมื่อคีย์ผิดหรือข้อมูลไม่ตรงกับฉลาก — ทุกการแก้ถูกบันทึกในประวัติ', onclick: () => editItemDialog(item, onDone) }, '✏️ แก้ไข'),
        h('button', { class: 'btn', title: 'ย้ายพาเลทนี้ไปตำแหน่งว่างอื่น เช่น ย้ายออกเพื่อเข้าถึงของที่อยู่ลึกกว่า (D2 ขึ้นไป) — จำนวนคงเดิม เปลี่ยนแค่ตำแหน่ง', onclick: () => moveItemDialog(item, onDone) }, '🔄 ย้าย'),
        // ของที่แกะแล้วไม่ต้องแกะซ้ำ — ปุ่มนี้แสดงเฉพาะของที่ยังเป็นลังเต็ม
        item.is_loose ? null
          : h('button', { class: 'btn', title: 'แยกของบางส่วนออกจากลังไปวางที่พื้นที่เศษ — ใช้เมื่อเบิกไม่เต็มลัง พื้นที่เศษห้ามคละ Lot กัน', onclick: () => breakCartonDialog(item, onDone) }, '📦 แกะลัง'),
        h('button', { class: 'btn primary', title: 'เบิก/จ่ายสินค้าออกจากตำแหน่งนี้ ระบุได้ทั้งบางส่วนหรือทั้งหมด — สต๊อกจะลดลงทันทีและบันทึกลงประวัติ', onclick: () => removeItemDialog(item, onDone) }, '📤 หยิบออก'),
      ].filter(Boolean)
    : [];
