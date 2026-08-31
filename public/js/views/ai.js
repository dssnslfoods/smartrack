// ผู้ช่วย AI + หน้าวิเคราะห์เชิงลึก
// ตัวเลขทั้งหมดมาจาก /api/insights/* (คำนวณล้วน) ส่วนคำแนะนำมาจาก /api/ai/* (ต้องเปิด AI)
import { api, auth, wh } from '../api.js';
import { h, field, table, pill, toast, fmtNum, fmtDate, pctPill, expiryPill } from '../ui.js?v=36';

const RISK = {
  EXPIRED: { label: 'หมดอายุแล้ว', color: 'red' },
  WILL_EXPIRE: { label: 'จะขายไม่ทัน', color: 'red' },
  NO_DEMAND: { label: 'ไม่มียอดขาย', color: 'amber' },
  TIGHT: { label: 'เฉียดฉิว', color: 'amber' },
  OK: { label: 'ปกติ', color: 'green' },
};
const FC = {
  OUT_OF_STOCK: { label: 'ของหมด', color: 'red' },
  REORDER_NOW: { label: 'ต้องสั่งเติมทันที', color: 'red' },
  REORDER_SOON: { label: 'ใกล้ต้องสั่ง', color: 'amber' },
  OVERSTOCK: { label: 'ของล้น', color: 'blue' },
  IDLE: { label: 'ไม่มีการเคลื่อนไหว', color: 'gray' },
  OK: { label: 'ปกติ', color: 'green' },
};
const SEV = { HIGH: { label: 'สูง', color: 'red' }, MEDIUM: { label: 'ปานกลาง', color: 'amber' }, LOW: { label: 'ต่ำ', color: 'gray' } };
const PRIO = { 'ด่วน': 'red', 'ควรทำสัปดาห์นี้': 'amber', 'เฝ้าดู': 'blue' };
const TREND = { UP: '📈 ขาขึ้น', DOWN: '📉 ขาลง', FLAT: '➡️ ทรงตัว' };

const kpi = (label, value, sub, tone) =>
  h('div', { class: `card kpi ${tone ?? ''}` },
    h('div', { class: 'label' }, label),
    h('div', { class: 'value' }, value),
    sub ? h('div', { class: 'sub' }, sub) : null);

/** ข้อความจาก AI — รองรับ **ตัวหนา** และขึ้นบรรทัดใหม่ */
function richText(s) {
  const box = h('div', {});
  String(s ?? '').split('\n').forEach((line, i) => {
    if (i) box.append(h('br'));
    line.split(/(\*\*[^*]+\*\*)/g).forEach((part) => {
      if (/^\*\*[^*]+\*\*$/.test(part)) box.append(h('strong', {}, part.slice(2, -2)));
      else if (part) box.append(document.createTextNode(part));
    });
  });
  return box;
}

/** กล่องคำแนะนำจาก AI (ใช้ร่วมกันทุกหน้า) */
function briefCard(brief, { title = '🧠 สรุปจาก AI' } = {}) {
  if (!brief) return null;
  return h('div', { class: 'card', style: 'border-left:4px solid var(--brand)' },
    h('h2', {}, title),
    h('p', { style: 'font-size:16px;font-weight:600;margin:6px 0 14px' }, richText(brief.headline)),
    ...(brief.actions ?? []).map((a) =>
      h('div', { style: 'padding:10px 0;border-top:1px solid var(--line)' },
        h('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:4px' },
          pill(a.priority, PRIO[a.priority] ?? 'gray'),
          h('strong', {}, a.title)),
        a.why ? h('div', { class: 'muted', style: 'font-size:14px' }, richText(a.why)) : null,
        a.how ? h('div', { style: 'font-size:13px;margin-top:3px' }, '👉 ', richText(a.how)) : null)),
    (brief.watch ?? []).length
      ? h('div', { style: 'margin-top:12px;padding-top:10px;border-top:1px solid var(--line)' },
          h('div', { class: 'muted', style: 'font-size:13px;font-weight:700;margin-bottom:4px' }, 'เรื่องที่ควรจับตา'),
          h('ul', { style: 'margin:0;padding-left:20px;font-size:13.5px' },
            ...brief.watch.map((w) => h('li', {}, w))))
      : null);
}

/** ปุ่ม "ให้ AI อธิบาย" — เรียกได้เมื่อเปิด AI เท่านั้น */
function explainButton(topic, mount, enabled) {
  if (!enabled) return null;
  const btn = h('button', { class: 'btn', onclick: async () => {
    btn.disabled = true; btn.textContent = '🧠 กำลังวิเคราะห์…';
    try {
      const r = await api.get('/api/ai/explain', { topic, warehouse_id: wh.id });
      mount.replaceChildren(briefCard(r.brief, { title: '🧠 คำแนะนำจาก AI' }) ?? h('div'));
    } catch (err) { toast(err.message, 'err'); }
    btn.disabled = false; btn.textContent = '🧠 ให้ AI อธิบาย';
  } }, '🧠 ให้ AI อธิบาย');
  return btn;
}

// ══════════════════════════════════════════════════════════════
//  ผู้ช่วย AI — ถาม-ตอบ
// ══════════════════════════════════════════════════════════════
const SUGGESTIONS = [
  'สินค้าอะไรใกล้หมดอายุบ้าง ควรรีบระบายตัวไหนก่อน',
  'ตอนนี้พื้นที่คลังใช้ไปกี่เปอร์เซ็นต์ โซนไหนเต็มที่สุด',
  'สินค้าตัวไหนกำลังจะขาด ควรสั่งเติมเท่าไร',
  'เดือนนี้จ่ายออกไปเท่าไร เทียบกับเดือนที่แล้ว',
  'มีใบจ่ายสินค้าค้างสถานะอยู่ไหม',
];

export async function copilotView() {
  const { enabled } = await api.get('/api/ai/status').catch(() => ({ enabled: false }));
  const history = [];

  const log = h('div', { style: 'display:flex;flex-direction:column;gap:12px;min-height:220px' });
  const input = h('textarea', {
    placeholder: 'พิมพ์คำถามเกี่ยวกับคลังสินค้า เช่น "ครีมทานาคาเหลือกี่กระปุก Lot ไหนใกล้หมดอายุสุด"',
    rows: '2', style: 'resize:vertical;width:100%',
  });
  const sendBtn = h('button', { class: 'btn primary', style: 'padding:10px 26px', onclick: () => send() }, 'ถาม');

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });

  function bubble(role, content) {
    const mine = role === 'user';
    return h('div', { style: `display:flex;${mine ? 'justify-content:flex-end' : ''}` },
      h('div', {
        class: 'card',
        style: `max-width:min(760px,88%);padding:12px 16px;margin:0;${mine
          ? 'background:var(--brand);color:#fff;border-color:var(--brand)'
          : 'border-left:3px solid var(--brand)'}`,
      }, typeof content === 'string' ? richText(content) : content));
  }

  function renderLog() {
    log.replaceChildren(...(history.length
      ? history.map((m) => bubble(m.role, m.content))
      : [h('div', { class: 'empty-state' },
          h('p', {}, '💬 ถามอะไรก็ได้เกี่ยวกับคลังสินค้า'),
          h('p', { style: 'font-size:13px' }, 'ผู้ช่วยจะดึงข้อมูลจริงจากระบบมาตอบ — อ่านข้อมูลอย่างเดียว ไม่แก้ไขอะไร'))]));
    log.scrollTop = log.scrollHeight;
  }

  async function send(preset) {
    const text = (preset ?? input.value).trim();
    if (!text) return;
    input.value = '';
    history.push({ role: 'user', content: text });
    renderLog();

    const thinking = bubble('assistant', h('span', { class: 'muted' }, '🧠 กำลังค้นข้อมูล…'));
    log.append(thinking);
    log.scrollTop = log.scrollHeight;
    sendBtn.disabled = true; input.disabled = true;

    try {
      const r = await api.post('/api/ai/ask', {
        messages: history, warehouse_id: wh.id, warehouse_name: wh.name ?? wh.label,
      });
      history.push({ role: 'assistant', content: r.answer });
      renderLog();
      if (r.tools_used?.length) {
        const names = [...new Set(r.tools_used.map((t) => t.name))].join(', ');
        log.lastChild?.querySelector('.card')?.append(
          h('div', { class: 'muted', style: 'font-size:11.5px;margin-top:8px;padding-top:6px;border-top:1px solid var(--line)' },
            `📊 ดึงข้อมูลจาก: ${names}`));
      }
    } catch (err) {
      thinking.remove();
      history.push({ role: 'assistant', content: `⚠️ ${err.message}` });
      renderLog();
    }
    sendBtn.disabled = false; input.disabled = false;
    input.focus();
    log.scrollTop = log.scrollHeight;
  }

  renderLog();

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'ผู้ช่วย AI'),
        h('p', {}, `คลัง: ${wh.label} — ถามเป็นภาษาไทยได้เลย ผู้ช่วยจะดึงข้อมูลจริงจากระบบมาตอบ`))),

    enabled ? null : h('div', { class: 'note bad' },
      '⚠️ ยังไม่ได้เปิดใช้งาน AI — ผู้ดูแลระบบต้องตั้งค่า ANTHROPIC_API_KEY ที่เซิร์ฟเวอร์ก่อน'),

    h('div', { class: 'card' }, log),

    h('div', { class: 'card' },
      h('div', { style: 'display:flex;gap:8px;align-items:flex-end' },
        h('div', { style: 'flex:1' }, input), sendBtn),
      h('div', { class: 'row', style: 'flex-wrap:wrap;gap:6px;margin-top:10px' },
        ...SUGGESTIONS.map((s) =>
          h('button', { class: 'chip', style: 'font-family:inherit;font-weight:500',
            onclick: () => send(s) }, s)))));
}

// ══════════════════════════════════════════════════════════════
//  AI Insights — วิเคราะห์เชิงลึก 5 มุม
// ══════════════════════════════════════════════════════════════
export async function insightsView() {
  const { enabled } = await api.get('/api/ai/status').catch(() => ({ enabled: false }));
  const tabsBox = h('div', { class: 'row', style: 'flex-wrap:wrap;gap:6px' });
  const body = h('div', {});

  const TABS = [
    { key: 'brief', label: '📋 สรุปภาพรวม', render: renderBrief },
    { key: 'expiry', label: '⏳ ความเสี่ยงหมดอายุ', render: renderExpiry },
    { key: 'forecast', label: '📈 พยากรณ์ & สั่งเติม', render: renderForecast },
    { key: 'slotting', label: '🎯 จัดตำแหน่งใหม่', render: renderSlotting },
    { key: 'anomaly', label: '🔍 ความผิดปกติ', render: renderAnomaly },
    { key: 'labor', label: '👥 ภาระงาน', render: renderLabor },
  ];
  let active = 'brief';

  function paint() {
    tabsBox.replaceChildren(...TABS.map((t) =>
      h('button', { class: `chip ${t.key === active ? 'active' : ''}`, style: 'font-family:inherit;font-weight:600',
        onclick: () => { active = t.key; paint(); } }, t.label)));
    body.replaceChildren(h('div', { class: 'empty-state' }, 'กำลังวิเคราะห์…'));
    TABS.find((t) => t.key === active).render()
      .then((el) => { if (active === TABS.find((t) => t.key === active).key) body.replaceChildren(el); })
      .catch((err) => body.replaceChildren(
        h('div', { class: 'card' }, h('h2', {}, 'วิเคราะห์ไม่สำเร็จ'), h('p', {}, err.message))));
  }

  // ---------- สรุปภาพรวม ----------
  async function renderBrief() {
    const r = await api.get('/api/ai/brief', { warehouse_id: wh.id, warehouse_name: wh.name ?? wh.label });
    const s = r.snapshot;
    return h('div', {},
      h('div', { class: 'grid g4' },
        kpi('Lot เสี่ยงหมดอายุ', fmtNum(s.expiry.summary.lots_at_risk),
          `จาก ${fmtNum(s.expiry.summary.lots_checked)} Lot ที่ตรวจ`, s.expiry.summary.lots_at_risk ? 'bad' : 'ok'),
        kpi('ต้องสั่งเติมด่วน', fmtNum(s.forecast.summary.reorder_now), 'รายการ',
          s.forecast.summary.reorder_now ? 'bad' : 'ok'),
        kpi('ความผิดปกติ', fmtNum(s.anomalies.summary.total),
          `รุนแรง ${fmtNum(s.anomalies.summary.high)} รายการ`, s.anomalies.summary.high ? 'bad' : 'ok'),
        kpi('เที่ยวเดินที่ลดได้', fmtNum(s.slotting.potential_trips_saved_per_month), 'เที่ยว/เดือน', 'ok')),
      r.ai_disabled
        ? h('div', { class: 'note bad' }, '⚠️ ยังไม่ได้เปิดใช้งาน AI — แสดงเฉพาะตัวเลขวิเคราะห์ ยังไม่มีคำแนะนำสรุป')
        : briefCard(r.brief, { title: '🧠 สิ่งที่ควรทำวันนี้' }),
      s.expiry.top.length ? h('div', { class: 'card' },
        h('h2', {}, 'Lot ที่ต้องรีบจัดการ'),
        table([
          { label: 'สินค้า', key: 'sku_name' },
          { label: 'Lot', key: 'lot_no', mono: true },
          { label: 'ตำแหน่ง', value: (r2) => h('a', { href: `#/map/${r2.rag_id}?loc=${r2.location_code}` }, r2.location_code), mono: true },
          { label: 'คงเหลือ', value: (r2) => `${fmtNum(r2.quantity)} ${r2.unit}`, num: true },
          { label: 'หมดอายุใน', value: (r2) => `${fmtNum(r2.days_to_expiry)} วัน`, num: true },
          { label: 'อายุคงเหลือ', value: (r2) => pctPill(r2.pct_remaining) },
          { label: 'สถานะ', value: (r2) => pill(RISK[r2.risk]?.label ?? r2.risk, RISK[r2.risk]?.color ?? 'gray') },
        ], s.expiry.top)) : null);
  }

  // ---------- ความเสี่ยงหมดอายุ ----------
  async function renderExpiry() {
    const r = await api.get('/api/insights/expiry', { warehouse_id: wh.id });
    const mount = h('div', {});
    const s = r.summary;
    return h('div', {},
      h('div', { class: 'grid g4' },
        kpi('Lot ที่ตรวจ', fmtNum(s.lots_checked), `มองไปข้างหน้า ${s.horizon_days} วัน`),
        kpi('Lot เสี่ยง', fmtNum(s.lots_at_risk), 'ขายไม่ทันหมดอายุ', s.lots_at_risk ? 'bad' : 'ok'),
        kpi('จำนวนเสี่ยง', fmtNum(s.qty_at_risk), 'หน่วย', s.qty_at_risk ? 'warn' : 'ok'),
        kpi('มูลค่าเสี่ยง', s.value_at_risk === null ? '—' : `฿${fmtNum(s.value_at_risk)}`,
          s.value_at_risk === null ? 'ยังไม่ได้ใส่ต้นทุนต่อหน่วย' : 'บาท', s.value_at_risk ? 'bad' : '')),
      h('div', { class: 'card' },
        h('div', { class: 'card-head' },
          h('h2', {}, `Lot ที่เสี่ยง (${r.at_risk.length})`),
          explainButton('expiry', mount, enabled)),
        h('p', { class: 'muted', style: 'font-size:13.5px;margin-top:0' },
          `คำนวณจากอัตราจ่ายออกจริงย้อนหลัง ${s.lookback_days} วัน เทียบกับคิวการหยิบตามลำดับ FEFO`),
        mount,
        r.at_risk.length ? table([
          { label: 'สินค้า', value: (x) => h('div', {}, x.sku_name, h('div', { class: 'mono muted', style: 'font-size:12px' }, x.sku_code)) },
          { label: 'Lot', key: 'lot_no', mono: true },
          { label: 'ตำแหน่ง', value: (x) => h('a', { href: `#/map/${x.rag_id}?loc=${x.location_code}` }, x.location_code), mono: true },
          { label: 'คงเหลือ', value: (x) => `${fmtNum(x.quantity)} ${x.unit}`, num: true },
          { label: 'หมดอายุ', value: (x) => h('div', {}, fmtDate(x.exp_date),
              h('div', { class: 'muted', style: 'font-size:12px' }, `อีก ${fmtNum(x.days_to_expiry)} วัน`)) },
          { label: 'อายุคงเหลือ', value: (x) => pctPill(x.pct_remaining) },
          { label: 'ขายได้', value: (x) => (x.demand_per_day ? `${fmtNum(x.demand_per_day)}/วัน` : '—'), num: true },
          { label: 'กว่าจะถึงคิวนี้', value: (x) => (x.days_to_clear === null ? '—' : `${fmtNum(x.days_to_clear)} วัน`), num: true },
          { label: 'เสี่ยงเหลือ', value: (x) => (x.qty_at_risk === null ? '—' : h('strong', { style: 'color:#b91c1c' }, fmtNum(x.qty_at_risk))), num: true },
          { label: 'สถานะ', value: (x) => pill(RISK[x.risk]?.label ?? x.risk, RISK[x.risk]?.color ?? 'gray') },
          { label: 'ช่องทางที่ยังรับได้', value: (x) => (x.eligible_now.length
              ? h('div', { style: 'display:flex;gap:4px;flex-wrap:wrap' }, ...x.eligible_now.map((c) => pill(c, 'green')))
              : pill('ไม่มีช่องทางรับ', 'red')) },
        ], r.at_risk) : h('div', { class: 'empty-state' }, '✅ ไม่มี Lot ที่เสี่ยงขายไม่ทันหมดอายุ')));
  }

  // ---------- พยากรณ์ & สั่งเติม ----------
  async function renderForecast() {
    const r = await api.get('/api/insights/forecast', { warehouse_id: wh.id });
    const mount = h('div', {});
    const s = r.summary;
    const spark = (hist) => {
      const max = Math.max(...hist, 1);
      return h('div', { style: 'display:flex;align-items:flex-end;gap:2px;height:26px', title: hist.join(' → ') },
        ...hist.map((v) => h('div', {
          style: `width:5px;background:var(--brand);opacity:.75;border-radius:1px;height:${Math.max(2, (v / max) * 26)}px`,
        })));
    };
    return h('div', {},
      h('div', { class: 'grid g4' },
        kpi('สินค้าที่วิเคราะห์', fmtNum(s.skus_analyzed), `ย้อนหลัง ${r.weeks} สัปดาห์`),
        kpi('ต้องสั่งเติมทันที', fmtNum(s.reorder_now), `Lead time ${r.lead_time_days} วัน`, s.reorder_now ? 'bad' : 'ok'),
        kpi('ใกล้ต้องสั่ง', fmtNum(s.reorder_soon), 'รายการ', s.reorder_soon ? 'warn' : 'ok'),
        kpi('ของล้น / ไม่เคลื่อนไหว', `${fmtNum(s.overstock)} / ${fmtNum(s.idle_skus)}`, 'รายการ')),
      h('div', { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', {}, 'พยากรณ์รายสินค้า'), explainButton('forecast', mount, enabled)),
        mount,
        table([
          { label: 'สินค้า', value: (x) => h('div', {}, x.sku_name, h('div', { class: 'mono muted', style: 'font-size:12px' }, x.sku_code)) },
          { label: '12 สัปดาห์ล่าสุด', value: (x) => spark(x.history_weekly) },
          { label: 'เฉลี่ย/สัปดาห์', value: (x) => fmtNum(x.avg_weekly), num: true },
          { label: 'พยากรณ์', value: (x) => h('strong', {}, fmtNum(x.forecast_weekly)), num: true },
          { label: 'แนวโน้ม', value: (x) => TREND[x.trend] ?? x.trend },
          { label: 'คงเหลือ', value: (x) => `${fmtNum(x.on_hand)} ${x.unit}`, num: true },
          { label: 'พอใช้อีก', value: (x) => (x.days_of_stock === null ? '—' : `${fmtNum(x.days_of_stock)} วัน`), num: true },
          { label: 'คาดหมดวันที่', value: (x) => (x.stockout_date ? fmtDate(x.stockout_date) : '—') },
          { label: 'ควรสั่งเพิ่ม', value: (x) => (x.suggested_order_qty ? h('strong', { style: 'color:#b45309' }, fmtNum(x.suggested_order_qty)) : '—'), num: true },
          { label: 'สถานะ', value: (x) => pill(FC[x.status]?.label ?? x.status, FC[x.status]?.color ?? 'gray') },
        ], r.items, { empty: 'ยังไม่มีประวัติการจ่ายออกพอให้พยากรณ์' })));
  }

  // ---------- จัดตำแหน่งใหม่ ----------
  async function renderSlotting() {
    const r = await api.get('/api/insights/slotting', { warehouse_id: wh.id });
    const mount = h('div', {});
    return h('div', {},
      h('div', { class: 'grid g4' },
        kpi('การหยิบทั้งหมด', fmtNum(r.total_picks), `ย้อนหลัง ${r.days} วัน`),
        kpi('ข้อเสนอย้าย', fmtNum(r.recommendations.length), 'รายการ'),
        kpi('เที่ยวเดินที่ลดได้', fmtNum(r.potential_trips_saved_per_month), 'เที่ยว/เดือน', 'ok'),
        kpi('สินค้ากลุ่ม A', fmtNum(r.abc.find((a) => a.class === 'A')?.sku_count ?? 0),
          `คิดเป็น ${fmtNum(r.abc.find((a) => a.class === 'A')?.pick_share_pct ?? 0)}% ของการหยิบ`)),
      h('div', { class: 'card' },
        h('h2', {}, 'การจัดกลุ่ม ABC ตามความถี่หยิบ'),
        table([
          { label: 'กลุ่ม', value: (x) => pill(`กลุ่ม ${x.class}`, x.class === 'A' ? 'green' : x.class === 'B' ? 'blue' : 'gray') },
          { label: 'จำนวนสินค้า', value: (x) => fmtNum(x.sku_count), num: true },
          { label: 'สัดส่วนการหยิบ', value: (x) => `${fmtNum(x.pick_share_pct)}%`, num: true },
          { label: 'ตำแหน่งที่วางอยู่', value: (x) => fmtNum(x.items_placed), num: true },
          { label: 'ต้นทุนเข้าถึงเฉลี่ย', value: (x) => (x.avg_access_cost === null ? '—' : fmtNum(x.avg_access_cost)), num: true },
        ], r.abc),
        h('p', { class: 'muted', style: 'font-size:13px;margin-bottom:0' },
          'ต้นทุนเข้าถึง = (ชั้น−1)×3 + (ตอน−1)×2 — ยิ่งน้อยยิ่งหยิบง่าย กลุ่ม A ควรมีค่านี้ต่ำที่สุด')),
      h('div', { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', {}, 'ข้อเสนอย้ายตำแหน่ง'), explainButton('slotting', mount, enabled)),
        mount,
        r.recommendations.length ? table([
          { label: 'แบบ', value: (x) => pill(x.type === 'SWAP' ? 'สลับที่' : 'ย้ายไปที่ว่าง', x.type === 'SWAP' ? 'blue' : 'green') },
          { label: 'สินค้าหมุนเร็ว', value: (x) => {
              const it = x.hot ?? x.item;
              return h('div', {}, it.sku_name, h('div', { class: 'mono muted', style: 'font-size:12px' }, `${it.lot_no ?? '-'} · หยิบ ${fmtNum(it.pick_count)} ครั้ง`));
            } },
          { label: 'จากตำแหน่ง', value: (x) => (x.hot ?? x.item).location_code, mono: true },
          { label: 'ไปตำแหน่ง', value: (x) => (x.cold ? x.cold.location_code : x.to.location_code), mono: true },
          { label: 'สินค้าที่ถูกสลับออก', value: (x) => (x.cold
              ? h('div', {}, x.cold.sku_name, h('div', { class: 'muted', style: 'font-size:12px' }, `หยิบ ${fmtNum(x.cold.pick_count)} ครั้ง`))
              : h('span', { class: 'muted' }, 'ตำแหน่งว่าง')) },
          { label: 'ลดเที่ยวเดิน', value: (x) => `${fmtNum(x.trips_saved_per_month)}/เดือน`, num: true },
          { label: '', value: (x) => h('a', { class: 'btn ghost', href: '#/docs' }, 'สร้างใบโอน') },
        ], r.recommendations) : h('div', { class: 'empty-state' }, '✅ ตำแหน่งจัดเก็บเหมาะสมดีแล้ว ไม่มีข้อเสนอย้าย')));
  }

  // ---------- ความผิดปกติ ----------
  async function renderAnomaly() {
    const r = await api.get('/api/insights/anomalies', { warehouse_id: wh.id });
    const mount = h('div', {});
    const s = r.summary;
    return h('div', {},
      h('div', { class: 'grid g4' },
        kpi('พบทั้งหมด', fmtNum(s.total), `ย้อนหลัง ${r.days} วัน`, s.total ? 'warn' : 'ok'),
        kpi('รุนแรงสูง', fmtNum(s.high), 'ต้องรีบตรวจ', s.high ? 'bad' : 'ok'),
        kpi('ปานกลาง', fmtNum(s.medium), 'ควรดู'),
        kpi('ต่ำ', fmtNum(s.low), 'เฝ้าดู')),
      h('div', { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', {}, 'สิ่งที่ตรวจพบ'), explainButton('anomaly', mount, enabled)),
        mount,
        r.findings.length
          ? h('div', {}, ...r.findings.map((f) =>
              h('div', { style: 'padding:12px 0;border-top:1px solid var(--line)' },
                h('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:3px' },
                  pill(SEV[f.severity]?.label ?? f.severity, SEV[f.severity]?.color ?? 'gray'),
                  h('strong', {}, f.title)),
                h('div', { style: 'font-size:14px' }, f.detail),
                h('div', { class: 'muted', style: 'font-size:13px;margin-top:2px' }, `💡 ${f.hint}`))))
          : h('div', { class: 'empty-state' }, '✅ ไม่พบความผิดปกติในช่วงที่ตรวจ')));
  }

  // ---------- ภาระงาน ----------
  async function renderLabor() {
    const r = await api.get('/api/insights/labor', { warehouse_id: wh.id });
    const mount = h('div', {});
    const maxDow = Math.max(...r.by_day_of_week.map((d) => d.avg_actions), 1);
    return h('div', {},
      h('div', { class: 'grid g4' },
        kpi('กำลังเฉลี่ยต่อคน', fmtNum(r.avg_actions_per_person_per_day), 'รายการ/คน/วัน'),
        kpi('พนักงานที่มีงาน', fmtNum(r.staff.length), `ย้อนหลัง ${r.days} วัน`),
        kpi('ช่วงเวลาที่งานหนัก', r.peak_hours.length ? `${r.peak_hours[0].hour}:00–${r.peak_hours[r.peak_hours.length - 1].hour + 1}:00` : '—', 'น.'),
        kpi('วันที่งานหนักสุด', r.by_day_of_week.slice().sort((a, b) => b.avg_actions - a.avg_actions)[0]?.dow_name ?? '—', 'ของสัปดาห์')),
      h('div', { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', {}, 'ภาระงานตามวันในสัปดาห์'), explainButton('labor', mount, enabled)),
        mount,
        table([
          { label: 'วัน', key: 'dow_name' },
          { label: 'เฉลี่ย', value: (d) => h('div', { style: 'display:flex;align-items:center;gap:8px' },
              h('div', { style: `height:14px;border-radius:3px;background:var(--brand);opacity:.8;width:${(d.avg_actions / maxDow) * 130}px;min-width:3px` }),
              h('span', {}, `${fmtNum(d.avg_actions)} รายการ`)) },
          { label: 'รวมทั้งช่วง', value: (d) => fmtNum(d.total), num: true },
          { label: 'ควรจัดคน', value: (d) => (d.suggested_staff === null ? '—' : h('strong', {}, `${d.suggested_staff} คน`)), num: true },
        ], r.by_day_of_week)),
      h('div', { class: 'card' },
        h('h2', {}, 'ผลงานรายคน'),
        table([
          { label: 'พนักงาน', key: 'full_name' },
          { label: 'บทบาท', key: 'role' },
          { label: 'รายการทั้งหมด', value: (u) => fmtNum(u.actions), num: true },
          { label: 'วันที่ทำงาน', value: (u) => fmtNum(u.active_days), num: true },
          { label: 'เฉลี่ย/วัน', value: (u) => h('strong', {}, fmtNum(u.actions_per_day)), num: true },
        ], r.staff, { empty: 'ยังไม่มีข้อมูลการทำงาน' })));
  }

  paint();
  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'AI Insights'),
        h('p', {}, `คลัง: ${wh.label} — วิเคราะห์เชิงลึกจากข้อมูลจริง พร้อมคำแนะนำว่าควรทำอะไรต่อ`))),
    enabled ? null : h('div', { class: 'note bad' },
      '⚠️ ยังไม่ได้เปิดใช้งาน AI — ตัวเลขวิเคราะห์ยังใช้ได้ปกติ แต่จะไม่มีคำแนะนำสรุปจาก AI'),
    h('div', { class: 'card', style: 'padding:12px' }, tabsBox),
    body);
}
