// ผู้ช่วย AI + หน้าวิเคราะห์เชิงลึก
// ตัวเลขทั้งหมดมาจาก /api/insights/* (คำนวณล้วน) ส่วนคำแนะนำมาจาก /api/ai/* (ต้องเปิด AI)
import { api, auth, wh } from '../api.js?v=47';
import { h, field, table, pill, toast, fmtNum, fmtDate, pctPill, expiryPill, progress } from '../ui.js?v=47';

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

// ══════════════════════════════════════════════════════════════
//  น้องสต๊อค — มาสคอตประจำคลัง (กล่องพัสดุที่มีใบไม้งอก โยงกับแบรนด์ de leaf)
// ══════════════════════════════════════════════════════════════
const NONG = 'น้องสต๊อค';

/** ท่าทางของน้องสต๊อค: happy = ปกติ · think = กำลังค้นข้อมูล · oops = มีปัญหา */
const MASCOT_SVG = (mood = 'happy') => {
  const eyes = mood === 'think'
    // กำลังคิด — เหลือบมองขึ้น
    ? `<ellipse cx="24" cy="38" rx="3.4" ry="4" fill="#3f2a14"/>
       <ellipse cx="40" cy="38" rx="3.4" ry="4" fill="#3f2a14"/>
       <circle cx="25.4" cy="36.2" r="1.3" fill="#fff"/>
       <circle cx="41.4" cy="36.2" r="1.3" fill="#fff"/>`
    : mood === 'oops'
      // เอ๊ะ — ตาโตกังวล
      ? `<ellipse cx="24" cy="39" rx="3.8" ry="4.4" fill="#3f2a14"/>
         <ellipse cx="40" cy="39" rx="3.8" ry="4.4" fill="#3f2a14"/>
         <circle cx="25.3" cy="37.4" r="1.4" fill="#fff"/>
         <circle cx="41.3" cy="37.4" r="1.4" fill="#fff"/>`
      : `<ellipse cx="24" cy="39" rx="3.4" ry="4" fill="#3f2a14"/>
         <ellipse cx="40" cy="39" rx="3.4" ry="4" fill="#3f2a14"/>
         <circle cx="25.2" cy="37.5" r="1.2" fill="#fff"/>
         <circle cx="41.2" cy="37.5" r="1.2" fill="#fff"/>`;
  const mouth = mood === 'oops'
    ? `<ellipse cx="32" cy="47" rx="3" ry="2.6" fill="#3f2a14"/>`
    : `<path d="M27.5 46.2c1.8 2.4 7.2 2.4 9 0" stroke="#3f2a14" stroke-width="2" stroke-linecap="round" fill="none"/>`;
  return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${NONG}">
    <path d="M32 21V11" stroke="#15803d" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M32 13.5c0-4.2 3.6-7 7.5-7 0 4.2-3.3 7-7.5 7z" fill="#22c55e"/>
    <path d="M32 16.5c0-3.6-3.2-5.8-6.4-5.8 0 3.6 2.8 5.8 6.4 5.8z" fill="#4ade80"/>
    <path d="M7 20.5h50l-3.5 7.5h-43z" fill="#c98f52"/>
    <rect x="10.5" y="27" width="43" height="31" rx="4.5" fill="#e8b887"/>
    <rect x="28.5" y="20.5" width="7" height="8" rx="1.2" fill="#f7e3c2"/>
    <ellipse cx="18.5" cy="45" rx="4" ry="2.6" fill="#f4948f" opacity=".6"/>
    <ellipse cx="45.5" cy="45" rx="4" ry="2.6" fill="#f4948f" opacity=".6"/>
    ${eyes}${mouth}
  </svg>`;
};

/** รูปน้องสต๊อค — ใส่ class 'bob' เพื่อให้ขยับเบา ๆ */
const mascot = (size = 40, mood = 'happy', cls = '') =>
  h('div', { class: `nong-face ${cls}`, style: `width:${size}px;height:${size}px`, html: MASCOT_SVG(mood) });

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
function briefCard(brief, { title = `📦 ${NONG} สรุปให้` } = {}) {
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
  const btn = h('button', { class: 'btn', title: 'ให้น้องสต๊อคอ่านตัวเลขในตารางนี้แล้วสรุปเป็นภาษาคนว่าควรทำอะไรก่อน — เป็นคำแนะนำเท่านั้น ไม่แก้ไขข้อมูลใด ๆ', onclick: async () => {
    btn.disabled = true; btn.textContent = '📦 น้องสต๊อคกำลังคิด…';
    const prog = progress('', {
      steps: [`${NONG} กำลังอ่านตัวเลขในหน้านี้…`, 'กำลังเรียบเรียงคำแนะนำ…', 'ใกล้เสร็จแล้ว…'],
    });
    mount.replaceChildren(prog.el);
    try {
      const r = await api.get('/api/ai/explain', { topic, warehouse_id: wh.id });
      mount.replaceChildren(briefCard(r.brief, { title: `📦 ${NONG} แนะนำว่า` }) ?? h('div'));
    } catch (err) {
      mount.replaceChildren(h('div', { class: 'note bad' }, `ขออภัยครับ สรุปไม่สำเร็จ: ${err.message}`));
      toast(err.message, 'err');
    } finally {
      prog.stop();
      btn.disabled = false; btn.textContent = '📦 ให้น้องสต๊อคอธิบาย';
    }
  } }, '📦 ให้น้องสต๊อคอธิบาย');
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
  const sendBtn = h('button', { class: 'btn primary', style: 'padding:10px 26px', title: 'ส่งคำถามให้น้องสต๊อคไปค้นข้อมูลจริงจากระบบมาตอบ (กด Enter ก็ได้) — ดูข้อมูลได้อย่างเดียว แก้ไขอะไรไม่ได้', onclick: () => send() }, 'ถาม');

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });

  function bubble(role, content, mood = 'happy') {
    const mine = role === 'user';
    if (mine) {
      return h('div', { class: 'chat-row mine' },
        h('div', { class: 'chat-bubble mine' }, typeof content === 'string' ? richText(content) : content));
    }
    // ฝั่งน้องสต๊อค — มีหน้าตัวเองกำกับทุกข้อความ จะได้รู้ว่าใครพูด
    return h('div', { class: 'chat-row' },
      mascot(34, mood, 'sm'),
      h('div', { style: 'min-width:0' },
        h('div', { class: 'chat-name' }, NONG),
        h('div', { class: 'chat-bubble' }, typeof content === 'string' ? richText(content) : content)));
  }

  function renderLog() {
    log.replaceChildren(...(history.length
      ? history.map((m) => bubble(m.role, m.content, m.mood))
      : [h('div', { class: 'nong-hello' },
          mascot(76, 'happy', 'bob'),
          h('div', {},
            h('div', { class: 'nong-hi' }, `สวัสดีครับ ผม${NONG} 📦`),
            h('p', {},
              'ถามเรื่องคลังได้ทุกอย่างเลยครับ — ของเหลือเท่าไร อยู่ชั้นไหน Lot ไหนใกล้หมดอายุ'),
            h('p', { class: 'muted', style: 'font-size:12.5px;margin:6px 0 0' },
              '🔒 ผมดึงตัวเลขจริงจากระบบมาตอบ และดูข้อมูลได้อย่างเดียว — แก้ไขอะไรไม่ได้ครับ')))]));
    log.scrollTop = log.scrollHeight;
  }

  async function send(preset) {
    const text = (preset ?? input.value).trim();
    if (!text) return;
    input.value = '';
    history.push({ role: 'user', content: text });
    renderLog();

    // นับเวลาที่รอไปด้วย — คำถามที่ต้องเรียกเครื่องมือหลายรอบใช้เวลาได้ถึงครึ่งนาที
    const waited = h('span', { class: 'muted', style: 'font-size:11.5px;margin-left:6px' }, '');
    let secs = 0;
    const tick = setInterval(() => { waited.textContent = `(${++secs} วินาที)`; }, 1000);
    const thinking = bubble('assistant',
      h('span', { class: 'muted nong-typing' }, 'ขอค้นข้อมูลแป๊บนะครับ', h('i'), h('i'), h('i'), waited), 'think');
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
      history.push({ role: 'assistant', content: `ขออภัยครับ ผมดึงข้อมูลไม่สำเร็จ 😢\n${err.message}`, mood: 'oops' });
      renderLog();
    } finally {
      clearInterval(tick);
    }
    sendBtn.disabled = false; input.disabled = false;
    input.focus();
    log.scrollTop = log.scrollHeight;
  }

  renderLog();

  return h('div', {},
    h('div', { class: 'page-head nong-head' },
      mascot(52, 'happy', 'bob'),
      h('div', {}, h('h1', {}, NONG),
        h('p', {}, `ผู้ช่วยประจำคลัง ${wh.label} — ถามเป็นภาษาไทยได้เลยครับ ผมดึงข้อมูลจริงจากระบบมาตอบ`))),

    enabled ? null : h('div', { class: 'note bad' },
      `⚠️ ${NONG} ยังไม่พร้อมทำงาน — ผู้ดูแลระบบต้องใส่ API Key ที่หน้า ตั้งค่า → ตั้งค่า AI ก่อนครับ`),

    h('div', { class: 'card' }, log),

    h('div', { class: 'card' },
      h('div', { style: 'display:flex;gap:8px;align-items:flex-end' },
        h('div', { style: 'flex:1' }, input), sendBtn),
      h('div', { class: 'muted', style: 'font-size:12px;margin-top:10px;margin-bottom:4px' }, '💡 ลองถามแบบนี้ดูครับ'),
      h('div', { class: 'row', style: 'flex-wrap:wrap;gap:6px' },
        ...SUGGESTIONS.map((s) =>
          h('button', { class: 'chip', style: 'font-family:inherit;font-weight:500',
            title: 'กดเพื่อส่งคำถามตัวอย่างนี้ให้น้องสต๊อคทันที โดยไม่ต้องพิมพ์เอง',
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
    { key: 'brief', label: '📋 สรุปภาพรวม', hint: 'รวมเรื่องเร่งด่วนจากทุกมุมไว้หน้าเดียว — เหมาะดูตอนเริ่มงานเช้าว่าวันนี้ควรจัดการอะไรก่อน', render: renderBrief },
    { key: 'expiry', label: '⏳ ความเสี่ยงหมดอายุ', hint: 'เทียบยอดจ่ายออกจริงกับคิวหยิบ FEFO เพื่อหา Lot ที่จะขายไม่ทันก่อนหมดอายุ', render: renderExpiry },
    { key: 'forecast', label: '📈 พยากรณ์ & สั่งเติม', hint: 'ประเมินยอดใช้ต่อสัปดาห์และวันที่ของจะหมด เพื่อบอกว่าควรสั่งเติมตัวไหนเท่าไร', render: renderForecast },
    { key: 'slotting', label: '🎯 จัดตำแหน่งใหม่', hint: 'จัดกลุ่ม ABC ตามความถี่หยิบ แล้วเสนอย้ายของหมุนเร็วมาไว้ตำแหน่งที่หยิบง่ายกว่า', render: renderSlotting },
    { key: 'anomaly', label: '🔍 ความผิดปกติ', hint: 'ตรวจหาเรื่องน่าสงสัย เช่น นับไม่ตรงซ้ำ แก้ไขถี่ผิดปกติ งานค้าง หรือการข้ามลำดับ FEFO', render: renderAnomaly },
    { key: 'labor', label: '👥 ภาระงาน', hint: 'ดูว่างานหนักวันไหน ช่วงเวลาใด และควรจัดกะกี่คน พร้อมผลงานรายบุคคล', render: renderLabor },
  ];
  let active = 'brief';

  function paint() {
    tabsBox.replaceChildren(...TABS.map((t) =>
      h('button', { class: `chip ${t.key === active ? 'active' : ''}`, style: 'font-family:inherit;font-weight:600',
        title: t.hint,
        onclick: () => { active = t.key; paint(); } }, t.label)));
    // แท็บสรุปภาพรวมต้องเรียก AI ด้วย จึงช้ากว่าแท็บอื่นที่คำนวณล้วน — บอกให้ชัดว่ารออะไรอยู่
    const prog = progress('', active === 'brief'
      ? { steps: ['กำลังรวบรวมตัวเลขจากทุกมุม…', `${NONG} กำลังสรุปว่าควรทำอะไรก่อน…`, 'ใกล้เสร็จแล้ว…'] }
      : { steps: ['กำลังคำนวณจากข้อมูลจริง…'], hint: 'คำนวณจากฐานข้อมูลโดยตรง ปกติใช้เวลาไม่กี่วินาที' });
    body.replaceChildren(prog.el);
    const cur = active;
    TABS.find((t) => t.key === active).render()
      .then((el) => { if (active === cur) body.replaceChildren(el); })
      .catch((err) => { if (active === cur) body.replaceChildren(
        h('div', { class: 'card' }, h('h2', {}, 'วิเคราะห์ไม่สำเร็จ'), h('p', {}, err.message))); })
      .finally(() => prog.stop());
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
        ? h('div', { class: 'note bad' }, `⚠️ ${NONG} ยังไม่พร้อม — ตัวเลขวิเคราะห์ยังดูได้ปกติ แต่ยังไม่มีคำแนะนำสรุปครับ`)
        : briefCard(r.brief, { title: `📦 ${NONG} บอกว่าวันนี้ควรทำ` }),
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
          { label: '', value: (x) => h('a', { class: 'btn ghost', title: 'ไปหน้าเอกสารคลังเพื่อเปิดใบโอนย้ายตามข้อเสนอนี้ — ต้องกรอกและยืนยันเอง ระบบไม่ย้ายของให้อัตโนมัติ', href: '#/docs' }, 'สร้างใบโอน') },
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
    h('div', { class: 'page-head nong-head' },
      mascot(46, 'think'),
      h('div', {}, h('h1', {}, 'วิเคราะห์เชิงลึก'),
        h('p', {}, `คลัง: ${wh.label} — ตัวเลขคำนวณจากข้อมูลจริง พร้อมคำแนะนำจาก${NONG}ว่าควรทำอะไรต่อ`))),
    enabled ? null : h('div', { class: 'note bad' },
      `⚠️ ${NONG} ยังไม่พร้อม — ตัวเลขวิเคราะห์ยังใช้ได้ปกติ แต่จะไม่มีคำแนะนำสรุปครับ`),
    h('div', { class: 'card', style: 'padding:12px' }, tabsBox),
    body);
}
