// งานจ่ายออก — ติดตามสถานะ Picked → Packed → Shipped → Delivered + ใบส่งสินค้า + Tracking
import { api, auth, openLabels } from '../api.js';
import { h, field, table, pill, toast, fmtNum, fmtDateTime, modal, SHIP_LABEL, SHIP_COLOR } from '../ui.js?v=35';

const NEXT = { PICKED: 'PACKED', PACKED: 'SHIPPED', SHIPPED: 'DELIVERED' };
const NEXT_LABEL = { PICKED: '📦 แพ็คเสร็จ', PACKED: '🚚 ส่งออกแล้ว', SHIPPED: '✅ ถึงปลายทาง' };

export async function outboundView() {
  const statusSel = h('select', { onchange: () => load() },
    h('option', { value: '' }, 'ทุกสถานะ'),
    ...Object.entries(SHIP_LABEL).map(([v, l]) => h('option', { value: v }, l)));
  const q = h('input', { placeholder: 'ค้นหา เลขเอกสาร / SO / ลูกค้า / Tracking', autocomplete: 'off' });
  q.addEventListener('keydown', (e) => e.key === 'Enter' && load());

  const summary = h('div', { class: 'grid g4', style: 'margin-bottom:14px' });
  const listBox = h('div', {});

  async function load() {
    listBox.replaceChildren(h('div', { class: 'empty-state' }, 'กำลังโหลด…'));
    const rows = await api.get('/api/docs', { type: 'ISSUE', ship_status: statusSel.value, q: q.value.trim(), limit: 200 });

    const counts = { PICKED: 0, PACKED: 0, SHIPPED: 0, DELIVERED: 0 };
    const allRows = statusSel.value || q.value.trim() ? await api.get('/api/docs', { type: 'ISSUE', limit: 500 }) : rows;
    allRows.forEach((r) => { if (counts[r.ship_status] !== undefined) counts[r.ship_status]++; });
    summary.replaceChildren(...Object.entries(counts).map(([s, n]) =>
      h('div', { class: 'card kpi' },
        h('div', { class: 'label' }, SHIP_LABEL[s]),
        h('div', { class: 'value' }, fmtNum(n)),
        h('div', { class: 'sub' }, 'รายการ'))));

    listBox.replaceChildren(table([
      { label: 'เลขที่', key: 'doc_no', mono: true },
      { label: 'วันที่', value: (r) => fmtDateTime(r.created_at) },
      { label: 'SO อ้างอิง', value: (r) => r.ref_no || '—', mono: true },
      { label: 'ลูกค้า', value: (r) => r.party || '—' },
      { label: 'ช่องทาง', value: (r) => r.channel_code || '—' },
      { label: 'จำนวนรวม', value: (r) => fmtNum(r.total_qty), num: true },
      { label: 'สถานะ', value: (r) => pill(SHIP_LABEL[r.ship_status] ?? r.ship_status, SHIP_COLOR[r.ship_status] ?? 'gray') },
      { label: 'Tracking', value: (r) => r.tracking_no || '—', mono: true },
      { label: '', value: (r) => h('button', { class: 'btn ghost', onclick: () => showDoc(r.doc_id) }, 'จัดการ') },
    ], rows, { empty: 'ไม่มีใบจ่ายสินค้า — สร้างได้จากหน้า "วางแผนหยิบสินค้า"' }));
  }

  async function showDoc(docId) {
    const { doc, movements } = await api.get(`/api/docs/${docId}`);
    const timeline = h('div', { class: 'row', style: 'flex-wrap:wrap;gap:6px;margin:10px 0' },
      ...['PICKED', 'PACKED', 'SHIPPED', 'DELIVERED'].map((s) => {
        const at = doc[{ PICKED: 'picked_at', PACKED: 'packed_at', SHIPPED: 'shipped_at', DELIVERED: 'delivered_at' }[s]];
        return h('div', { class: 'card', style: `padding:8px 14px;flex:1;min-width:130px;${at ? '' : 'opacity:.45'}` },
          h('div', { style: 'font-weight:700;font-size:13px' }, SHIP_LABEL[s]),
          h('div', { class: 'muted', style: 'font-size:12px' }, at ? fmtDateTime(at) : 'รอดำเนินการ'));
      }));

    const tracking = h('input', { value: doc.tracking_no ?? '', placeholder: 'เลข Tracking' });
    const carrier = h('input', { value: doc.carrier ?? '', placeholder: 'ขนส่ง เช่น Kerry / Flash' });

    const m = modal(`ใบจ่ายสินค้า ${doc.doc_no}`,
      h('div', {},
        h('p', { class: 'muted' },
          `${doc.party ?? '-'} ${doc.channel_code ? `· ช่องทาง ${doc.channel_code}` : ''} ${doc.ref_no ? `· SO ${doc.ref_no}` : ''}`),
        timeline,
        auth.can('move') ? h('div', { class: 'row' }, field('Tracking No.', tracking, null, 'เลขพัสดุสำหรับติดตามสถานะการจัดส่ง เช่น Kerry, Flash, ไปรษณีย์'), field('ขนส่ง', carrier, null, 'ชื่อบริษัทขนส่งที่ใช้จัดส่งสินค้า เช่น Kerry Express, Flash, J&T')) : null,
        h('h2', { style: 'margin-top:10px' }, 'รายการสินค้า'),
        table([
          { label: 'สินค้า', key: 'sku_name' },
          { label: 'Lot', key: 'lot_no', mono: true },
          { label: 'จำนวน', value: (x) => `${fmtNum(x.quantity)} ${x.unit}`, num: true },
          { label: 'จากตำแหน่ง', key: 'from_code', mono: true },
        ], movements)),
      [
        h('button', { class: 'btn', onclick: () => m.close() }, 'ปิด'),
        h('button', { class: 'btn', onclick: () => openLabels('/labels/delivery', { doc_id: doc.doc_id }).catch((e) => toast(e.message, 'err')) }, '🖨️ ใบส่งสินค้า'),
        auth.can('move') ? h('button', { class: 'btn', onclick: async () => {
          try {
            await api.patch(`/api/docs/${doc.doc_id}/ship`, { tracking_no: tracking.value, carrier: carrier.value });
            toast('บันทึก Tracking แล้ว'); m.close(); load();
          } catch (err) { toast(err.message, 'err'); }
        } }, '💾 บันทึก Tracking') : null,
        auth.can('move') && NEXT[doc.ship_status] ? h('button', { class: 'btn primary', onclick: async () => {
          try {
            await api.patch(`/api/docs/${doc.doc_id}/ship`, {
              ship_status: NEXT[doc.ship_status], tracking_no: tracking.value, carrier: carrier.value,
            });
            toast(`อัปเดตสถานะเป็น "${SHIP_LABEL[NEXT[doc.ship_status]]}" แล้ว`);
            m.close(); load();
          } catch (err) { toast(err.message, 'err'); }
        } }, NEXT_LABEL[doc.ship_status]) : null,
      ].filter(Boolean));
  }

  load();
  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'งานจ่ายออก'),
        h('p', {}, 'ติดตามทุกใบจ่ายสินค้า: หยิบ → แพ็ค → จัดส่ง → ถึงปลายทาง พร้อมเวลาแต่ละขั้นตอน'))),
    summary,
    h('div', { class: 'card' },
      h('div', { class: 'row scan' }, h('div', { style: 'flex:3' }, q), h('div', { style: 'flex:1' }, statusSel)),
      listBox));
}
