// งานจ่ายออก — ติดตามสถานะ Picked → Packed → Shipped → Delivered + ใบส่งสินค้า + Tracking
import { api, auth, openLabels } from '../api.js?v=52';
import { h, field, table, pill, toast, fmtNum, fmtDateTime, modal, SHIP_LABEL, SHIP_COLOR } from '../ui.js?v=52';

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
      { label: 'ขนส่ง', value: (r) => r.carrier || '—' },
      { label: 'Tracking', value: (r) => r.tracking_no || '—', mono: true },
      { label: '', value: (r) => h('button', { class: 'btn ghost', title: 'เปิดใบจ่ายสินค้าใบนี้ เพื่อดูรายการของ ใส่เลข Tracking และเลื่อนสถานะการจัดส่งขั้นถัดไป', onclick: () => showDoc(r.doc_id) }, 'จัดการ') },
    ], rows, { empty: 'ไม่มีใบจ่ายสินค้า — สร้างได้จากหน้า "วางแผนหยิบสินค้า"' }));
  }

  async function showDoc(docId) {
    const [{ doc, movements }, carriers] = await Promise.all([
      api.get(`/api/docs/${docId}`),
      api.get('/api/carriers').catch(() => []),
    ]);
    const timeline = h('div', { class: 'row', style: 'flex-wrap:wrap;gap:6px;margin:10px 0' },
      ...['PICKED', 'PACKED', 'SHIPPED', 'DELIVERED'].map((s) => {
        const at = doc[{ PICKED: 'picked_at', PACKED: 'packed_at', SHIPPED: 'shipped_at', DELIVERED: 'delivered_at' }[s]];
        return h('div', { class: 'card', style: `padding:8px 14px;flex:1;min-width:130px;${at ? '' : 'opacity:.45'}` },
          h('div', { style: 'font-weight:700;font-size:13px' }, SHIP_LABEL[s]),
          h('div', { class: 'muted', style: 'font-size:12px' }, at ? fmtDateTime(at) : 'รอดำเนินการ'));
      }));

    const tracking = h('input', { value: doc.tracking_no ?? '', placeholder: 'เลข Tracking' });

    // ---- เลือกขนส่ง + ให้ระบบแนะนำจากที่อยู่ปลายทาง ----
    // ชั้นแรกดูจากทะเบียนจริง (ลูกค้ารายนี้เคยใช้เจ้าไหน / เจ้าไหนวิ่งพื้นที่นี้)
    // ถ้าไม่เจอค่อยให้น้องสต๊อคช่วยเดา โดยอ้างอิงพื้นที่ให้บริการที่มีอยู่จริงเท่านั้น
    const active = carriers.filter((c) => c.status === 'ACTIVE' || c.carrier_id === doc.carrier_id);
    const carrierSel = h('select', {},
      h('option', { value: '' }, '— ยังไม่ระบุ —'),
      ...active.map((c) => h('option', { value: String(c.carrier_id), selected: c.carrier_id === doc.carrier_id }, c.carrier_name)));
    const prov = h('input', { value: doc.ship_province ?? '', placeholder: 'เช่น สงขลา' });
    const dist = h('input', { value: doc.ship_district ?? '', placeholder: 'เช่น หาดใหญ่' });
    const suggestBox = h('div', {});

    const CONF = { HIGH: ['green', 'มั่นใจสูง'], MEDIUM: ['amber', 'พอเป็นไปได้'], LOW: ['gray', 'เดาจากพื้นที่ใกล้เคียง'] };
    const pickBtn = (id, label) => h('button', { class: 'btn ghost', title: `เลือก ${label} เป็นขนส่งของใบนี้ — ยังต้องกดบันทึกอีกครั้ง`, onclick: () => { carrierSel.value = String(id); toast(`เลือก ${label} แล้ว`); } }, 'เลือก');

    async function runSuggest() {
      suggestBox.replaceChildren(h('div', { class: 'muted', style: 'padding:8px 0' }, 'กำลังหาขนส่งที่เหมาะสม…'));
      try {
        const r = await api.get('/api/carriers/suggest', {
          customer_name: doc.party ?? '', province: prov.value.trim(), district: dist.value.trim(),
        });
        if (r.matched) {
          suggestBox.replaceChildren(
            h('div', { class: 'muted', style: 'font-size:12px;margin:8px 0 4px' }, 'จากทะเบียนขนส่งจริง:'),
            ...r.candidates.map((c) => h('div', { class: 'row', style: 'align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border,#e2e8f0)' },
              pill(CONF[c.confidence]?.[1] ?? c.confidence, CONF[c.confidence]?.[0] ?? 'gray'),
              h('strong', {}, c.carrier_name),
              h('span', { class: 'muted', style: 'flex:1;font-size:12px' }, c.reason),
              pickBtn(c.carrier_id, c.carrier_name))));
          return;
        }
        // ไม่มีในทะเบียน — ให้ AI ช่วยเดาจากพื้นที่ใกล้เคียงที่มีข้อมูลจริง
        suggestBox.replaceChildren(h('div', { class: 'muted', style: 'padding:8px 0' },
          'ไม่พบพื้นที่นี้ในทะเบียน — กำลังให้น้องสต๊อคช่วยดูจากพื้นที่ใกล้เคียง…'));
        const a = await api.post('/api/ai/suggest-carrier', {
          customer_name: doc.party ?? '', province: prov.value.trim(), district: dist.value.trim(),
        });
        suggestBox.replaceChildren(a.carrier_id
          ? h('div', {},
            h('div', { class: 'muted', style: 'font-size:12px;margin:8px 0 4px' }, '🐿️ น้องสต๊อคช่วยเดา (ยังไม่มีข้อมูลจริงในพื้นที่นี้ — โปรดตรวจก่อนใช้):'),
            h('div', { class: 'row', style: 'align-items:center;gap:8px;padding:6px 0' },
              pill(CONF[a.confidence]?.[1] ?? a.confidence, CONF[a.confidence]?.[0] ?? 'gray'),
              h('strong', {}, a.carrier_name),
              h('span', { class: 'muted', style: 'flex:1;font-size:12px' }, a.reason),
              pickBtn(a.carrier_id, a.carrier_name)))
          : h('div', { class: 'muted', style: 'padding:8px 0' }, a.reason || 'ยังแนะนำไม่ได้ — เลือกขนส่งเองได้จากรายการด้านบน'));
      } catch (err) {
        suggestBox.replaceChildren(h('div', { class: 'muted', style: 'padding:8px 0' }, err.message));
      }
    }

    const shipFields = auth.can('move') ? h('div', {},
      h('div', { class: 'row' },
        field('Tracking No.', tracking, null, 'เลขพัสดุสำหรับติดตามสถานะการจัดส่ง'),
        field('จังหวัดปลายทาง', prov, null, 'จังหวัดของลูกค้า — ระบบใช้หาว่าขนส่งเจ้าไหนวิ่งพื้นที่นี้'),
        field('อำเภอ', dist, null, 'อำเภอของลูกค้า — ใส่แล้วคำแนะนำจะแม่นขึ้น')),
      h('div', { class: 'row', style: 'align-items:flex-end' },
        field('ขนส่ง', carrierSel, null, 'เลือกจากทะเบียนขนส่ง — เพิ่ม/แก้ไขได้ที่ ตั้งค่าระบบ › ขนส่ง'),
        h('button', { class: 'btn', title: 'ให้ระบบแนะนำขนส่งจากที่อยู่ปลายทาง โดยดูจากเจ้าที่ลูกค้ารายนี้เคยใช้และเจ้าที่วิ่งพื้นที่นั้นจริง', onclick: runSuggest }, '🔎 แนะนำขนส่ง')),
      suggestBox) : null;

    const shipBody = () => ({
      tracking_no: tracking.value,
      carrier_id: carrierSel.value ? Number(carrierSel.value) : null,
      ship_province: prov.value, ship_district: dist.value,
    });

    const m = modal(`ใบจ่ายสินค้า ${doc.doc_no}`,
      h('div', {},
        h('p', { class: 'muted' },
          `${doc.party ?? '-'} ${doc.channel_code ? `· ช่องทาง ${doc.channel_code}` : ''} ${doc.ref_no ? `· SO ${doc.ref_no}` : ''}`),
        timeline,
        shipFields,
        h('h2', { style: 'margin-top:10px' }, 'รายการสินค้า'),
        table([
          { label: 'สินค้า', key: 'sku_name' },
          { label: 'Lot', key: 'lot_no', mono: true },
          { label: 'จำนวน', value: (x) => `${fmtNum(x.quantity)} ${x.unit}`, num: true },
          { label: 'จากตำแหน่ง', key: 'from_code', mono: true },
        ], movements)),
      [
        h('button', { class: 'btn', onclick: () => m.close() }, 'ปิด'),
        h('button', { class: 'btn', title: 'พิมพ์ใบส่งสินค้าของใบจ่ายนี้ ให้แนบไปกับพัสดุหรือให้ลูกค้าเซ็นรับตอนส่งมอบ', onclick: () => openLabels('/labels/delivery', { doc_id: doc.doc_id }).catch((e) => toast(e.message, 'err')) }, '🖨️ ใบส่งสินค้า'),
        auth.can('move') ? h('button', { class: 'btn', title: 'บันทึกเลข Tracking ขนส่ง และที่อยู่ปลายทางไว้กับใบจ่ายนี้ โดยยังไม่เลื่อนสถานะการจัดส่ง', onclick: async () => {
          try {
            await api.patch(`/api/docs/${doc.doc_id}/ship`, shipBody());
            toast('บันทึกข้อมูลจัดส่งแล้ว'); m.close(); load();
          } catch (err) { toast(err.message, 'err'); }
        } }, '💾 บันทึกข้อมูลจัดส่ง') : null,
        auth.can('move') && NEXT[doc.ship_status] ? h('button', { class: 'btn primary', title: `เลื่อนสถานะจาก "${SHIP_LABEL[doc.ship_status]}" เป็น "${SHIP_LABEL[NEXT[doc.ship_status]]}" พร้อมบันทึกเวลาไว้ในไทม์ไลน์ — เลื่อนแล้วถอยกลับเองไม่ได้`, onclick: async () => {
          try {
            await api.patch(`/api/docs/${doc.doc_id}/ship`, { ...shipBody(), ship_status: NEXT[doc.ship_status] });
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
