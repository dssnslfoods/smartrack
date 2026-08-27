// นับสต็อก (Cycle Count) — เปิดรอบ → สแกนตำแหน่ง+กรอกจำนวน → เทียบผลต่าง → อนุมัติปรับยอด
import { api, auth } from '../api.js';
import { h, field, table, pill, toast, fmtNum, fmtDateTime, modal, confirmBox, scanInput } from '../ui.js?v=26';

const RSTATUS = { OPEN: ['กำลังนับ', 'blue'], APPROVED: ['อนุมัติแล้ว', 'green'], CANCELLED: ['ยกเลิก', 'gray'] };

export async function countView({ match }) {
  const roundId = match[1] ? Number(match[1]) : null;
  return roundId ? await roundDetail(roundId) : await roundList();
}

// ================= รายการรอบนับ =================
async function roundList() {
  const listBox = h('div', {});

  async function load() {
    const rows = await api.get('/api/counts');
    listBox.replaceChildren(table([
      { label: 'รอบนับ', value: (r) => h('a', { href: `#/count/${r.round_id}` }, r.round_no), mono: true },
      { label: 'วันที่', value: (r) => fmtDateTime(r.created_at) },
      { label: 'ขอบเขต', value: (r) => [r.wh_code, r.zone_code].filter(Boolean).join(' · ') || 'ทุกคลัง' },
      { label: 'ความคืบหน้า', value: (r) => `${fmtNum(r.counted_lines)} / ${fmtNum(r.total_lines)} ตำแหน่ง` },
      { label: 'ผลต่าง', value: (r) => (r.variance_lines > 0 ? pill(`${r.variance_lines} ตำแหน่ง`, 'amber') : pill('ตรง', 'green')) },
      { label: 'สถานะ', value: (r) => pill(...RSTATUS[r.status]) },
      { label: 'ผู้เปิดรอบ', key: 'created_by_name' },
      { label: 'ผู้อนุมัติ', value: (r) => r.approved_by_name || '—' },
    ], rows, { empty: 'ยังไม่มีรอบนับ — เปิดรอบใหม่เพื่อเริ่มนับสต็อก' }));
  }

  async function newRound() {
    const [whs, zones] = await Promise.all([api.get('/api/warehouses'), api.get('/api/zones')]);
    const whSel = h('select', {}, h('option', { value: '' }, 'ทุกคลัง'),
      ...whs.map((w) => h('option', { value: w.warehouse_id }, `${w.wh_code} — ${w.wh_name}`)));
    const zoneSel = h('select', {}, h('option', { value: '' }, 'ทุกโซน'));
    whSel.onchange = () => {
      zoneSel.replaceChildren(h('option', { value: '' }, 'ทุกโซน'),
        ...zones.filter((z) => !whSel.value || String(z.warehouse_id) === whSel.value)
          .map((z) => h('option', { value: z.zone_id }, `${z.zone_code} — ${z.zone_name}`)));
    };
    whSel.onchange();
    const ptypeSel = h('select', {},
      h('option', { value: '' }, 'สินค้าทุกประเภท'),
      h('option', { value: 'FG' }, 'FG — สำเร็จรูป (นับประจำวัน)'),
      h('option', { value: 'RM' }, 'RM — วัตถุดิบ'),
      h('option', { value: 'PM' }, 'PM — บรรจุภัณฑ์'),
      h('option', { value: 'POSM' }, 'POSM'));
    const incEmpty = h('input', { type: 'checkbox' });
    const note = h('input', { placeholder: 'เช่น นับ FG ประจำวัน / นับใหญ่สิ้นเดือน' });

    const m = modal('เปิดรอบนับใหม่',
      h('div', {},
        h('div', { class: 'grid g2' }, field('คลัง', whSel), field('โซน', zoneSel)),
        field('ประเภทสินค้า', ptypeSel, 'นับ FG ประจำวันหลัง pick เสร็จ · นับทุกประเภททุกคลังตอนสิ้นเดือน'),
        h('label', { style: 'display:flex;gap:8px;align-items:center;margin:10px 0' }, incEmpty,
          'รวมตำแหน่งว่างด้วย (จับกรณีระบบว่างแต่ของจริงมี)'),
        field('หมายเหตุ', note)),
      [
        h('button', { class: 'btn', onclick: () => m.close() }, 'ยกเลิก'),
        h('button', { class: 'btn primary', onclick: async () => {
          try {
            const res = await api.post('/api/counts', {
              warehouse_id: whSel.value || null, zone_id: zoneSel.value || null,
              product_type: ptypeSel.value || null, include_empty: incEmpty.checked, note: note.value,
            });
            toast(`เปิดรอบนับ ${res.round.round_no} — ${res.lines.length} ตำแหน่ง`);
            m.close();
            location.hash = `#/count/${res.round.round_id}`;
          } catch (err) { toast(err.message, 'err'); }
        } }, 'เปิดรอบนับ'),
      ]);
  }

  await load();
  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'นับสต็อก (Cycle Count)'),
        h('p', {}, 'FG นับทุกวันหลัง pick เสร็จ · นับใหญ่ทุกคลังรายเดือน — ระบบเทียบผลต่างให้อัตโนมัติ')),
      auth.can('move') ? h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onclick: newRound }, '+ เปิดรอบนับใหม่')) : null),
    h('div', { class: 'card' }, listBox));
}

// ================= หน้านับของรอบหนึ่ง ๆ =================
async function roundDetail(roundId) {
  let data = await api.get(`/api/counts/${roundId}`);
  const progressEl = h('div', { class: 'grid g4', style: 'margin-bottom:14px' });
  const tbl = h('div', {});
  const onlyPending = h('input', { type: 'checkbox', onchange: () => render() });
  const onlyVariance = h('input', { type: 'checkbox', onchange: () => render() });

  const kpi = (label, value, tone) =>
    h('div', { class: `card kpi ${tone ?? ''}` },
      h('div', { class: 'label' }, label), h('div', { class: 'value' }, fmtNum(value)));

  function render() {
    const { round, lines, progress } = data;
    progressEl.replaceChildren(
      kpi('ตำแหน่งทั้งหมด', progress.total),
      kpi('นับแล้ว', progress.counted, progress.counted === progress.total ? 'ok' : ''),
      kpi('ยังไม่ได้นับ', progress.total - progress.counted, progress.total - progress.counted ? 'warn' : 'ok'),
      kpi('มีผลต่าง', progress.variance, progress.variance ? 'bad' : 'ok'));

    let rows = lines;
    if (onlyPending.checked) rows = rows.filter((l) => l.counted_qty === null);
    if (onlyVariance.checked) rows = rows.filter((l) => l.counted_qty !== null && l.variance !== 0);

    tbl.replaceChildren(table([
      { label: 'ตำแหน่ง', key: 'location_code', mono: true },
      { label: 'สินค้า', value: (l) => l.sku_name || h('span', { class: 'muted' }, '(ว่างตามระบบ)') },
      { label: 'Lot', value: (l) => l.lot_no || '—', mono: true },
      { label: 'ตามระบบ', value: (l) => fmtNum(l.expected_qty), num: true },
      { label: 'นับได้', value: (l) => (l.counted_qty === null ? h('span', { class: 'muted' }, 'ยังไม่นับ') : fmtNum(l.counted_qty)), num: true },
      { label: 'ผลต่าง', value: (l) => (l.counted_qty === null ? '—'
          : l.variance === 0 ? pill('ตรง', 'green')
          : pill(`${l.variance > 0 ? '+' : ''}${fmtNum(l.variance)}`, 'red')), num: true },
      { label: 'หมายเหตุ', value: (l) => l.note || '—' },
    ], rows, { empty: 'ไม่มีบรรทัดตามตัวกรอง' }));
  }

  async function refresh() {
    data = await api.get(`/api/counts/${roundId}`);
    render();
  }

  // ---- ช่องนับเร็ว: สแกนตำแหน่ง → กรอกจำนวน ----
  const qtyInput = h('input', { type: 'number', min: '0', placeholder: 'จำนวนที่นับได้', style: 'font-size:18px' });
  const noteInput = h('input', { placeholder: 'หมายเหตุ (ถ้ามี)' });
  const locInput = scanInput('สแกน/พิมพ์รหัสตำแหน่ง แล้วกด Enter', () => qtyInput.focus(), { autofocus: true });
  qtyInput.addEventListener('keydown', (e) => e.key === 'Enter' && submitCount());

  async function submitCount() {
    const code = locInput.value.trim();
    if (!code || qtyInput.value === '') { toast('กรอกตำแหน่งและจำนวนก่อน', 'err'); return; }
    try {
      const r = await api.post(`/api/counts/${roundId}/record`, {
        location_code: code, counted_qty: Number(qtyInput.value), note: noteInput.value,
      });
      toast(r.variance === 0
        ? `✅ ${code} ตรงตามระบบ (${fmtNum(r.counted_qty)})`
        : `⚠️ ${code} ต่าง ${r.variance > 0 ? '+' : ''}${fmtNum(r.variance)} (ระบบ ${fmtNum(r.expected_qty)} / นับได้ ${fmtNum(r.counted_qty)})`,
        r.variance === 0 ? 'ok' : 'err');
      locInput.value = ''; qtyInput.value = ''; noteInput.value = '';
      locInput.focus();
      await refresh();
    } catch (err) { toast(err.message, 'err'); }
  }

  async function approve() {
    const ok = await confirmBox('อนุมัติรอบนับ',
      `ระบบจะปรับยอดทุกตำแหน่งที่มีผลต่าง (${data.progress.variance} ตำแหน่ง) เป็นเอกสารปรับยอด และปิดรอบนับนี้`,
      'อนุมัติและปรับยอด');
    if (!ok) return;
    try {
      const res = await api.post(`/api/counts/${roundId}/approve`);
      toast(res.doc_no ? `อนุมัติแล้ว — ปรับยอด ${res.adjusted} ตำแหน่ง (เอกสาร ${res.doc_no})` : 'อนุมัติแล้ว — ไม่มีผลต่างต้องปรับ');
      await refresh();
    } catch (err) { toast(err.message, 'err'); }
  }

  render();
  const { round } = data;
  const isOpen = round.status === 'OPEN';
  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, `รอบนับ ${round.round_no}`),
        h('p', {}, [`${[round.wh_name, round.zone_name].filter(Boolean).join(' · ') || 'ทุกคลัง'}`,
          round.note, `เปิดโดย ${round.created_by_name ?? '-'}`].filter(Boolean).join(' — '))),
      h('div', { class: 'actions' },
        pill(...RSTATUS[round.status]),
        isOpen && auth.can('manage') ? h('button', { class: 'btn danger', onclick: async () => {
          if (await confirmBox('ยกเลิกรอบนับ', 'ผลนับที่บันทึกไว้จะไม่ถูกนำไปปรับยอด', 'ยกเลิกรอบนับ')) {
            await api.post(`/api/counts/${roundId}/cancel`); location.hash = '#/count';
          }
        } }, 'ยกเลิกรอบ') : null,
        isOpen && auth.can('manage') ? h('button', { class: 'btn primary', onclick: approve }, '✅ อนุมัติ + ปรับยอด') : null,
        h('a', { class: 'btn', href: '#/count' }, '← รอบนับทั้งหมด'))),
    progressEl,
    isOpen && auth.can('move') ? h('div', { class: 'card' },
      h('h2', {}, '⚡ นับเร็ว'),
      h('div', { class: 'row' },
        h('div', { style: 'flex:2' }, field('ตำแหน่ง', locInput)),
        h('div', { style: 'flex:1' }, field('นับได้', qtyInput)),
        h('div', { style: 'flex:2' }, field('หมายเหตุ', noteInput)),
        h('div', { style: 'flex:0;align-self:flex-end' },
          h('button', { class: 'btn primary', onclick: submitCount }, 'บันทึก')))) : null,
    h('div', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h2', {}, 'บรรทัดนับทั้งหมด'),
        h('div', { class: 'actions', style: 'gap:14px' },
          h('label', { style: 'display:flex;gap:6px;align-items:center;font-size:13px' }, onlyPending, 'เฉพาะที่ยังไม่นับ'),
          h('label', { style: 'display:flex;gap:6px;align-items:center;font-size:13px' }, onlyVariance, 'เฉพาะที่มีผลต่าง'))),
      tbl));
}
