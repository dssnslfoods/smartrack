// UI helper ขนาดเล็ก (ไม่ใช้ framework — เปิดเร็ว เหมาะกับแท็บเล็ตในคลัง)
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(3)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);

export function toast(message, type = 'ok', ms = 4000) {
  const node = h('div', { class: `toast ${type}` }, message);
  document.getElementById('toasts').append(node);
  setTimeout(() => node.remove(), ms);
}

export function modal(title, content, actions = []) {
  const bg = h('div', { class: 'modal-bg', onclick: (e) => e.target === bg && close() });
  const close = () => bg.remove();
  bg.append(h('div', { class: 'modal' },
    h('h2', {}, title, h('button', { class: 'btn ghost close', onclick: close }, '✕')),
    content,
    actions.length ? h('div', { class: 'modal-actions' }, ...actions) : null));
  document.body.append(bg);
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
  });
  return { close, el: bg };
}

export const confirmBox = (title, message, okLabel = 'ยืนยัน') =>
  new Promise((resolve) => {
    const m = modal(title, h('p', {}, message), [
      h('button', { class: 'btn', onclick: () => { m.close(); resolve(false); } }, 'ยกเลิก'),
      h('button', { class: 'btn primary', onclick: () => { m.close(); resolve(true); } }, okLabel),
    ]);
  });

export const field = (label, input, hint) =>
  h('div', { class: 'field' }, h('label', {}, label), input, hint ? h('div', { class: 'hint' }, hint) : null);

export function table(columns, rows, { onRow, empty = 'ไม่พบข้อมูล' } = {}) {
  if (!rows.length) return h('div', { class: 'empty-state' }, empty);
  return h('div', { class: 'table-wrap' },
    h('table', {},
      h('thead', {}, h('tr', {}, ...columns.map((c) => h('th', { class: c.num ? 'num' : null }, c.label)))),
      h('tbody', {}, ...rows.map((r) =>
        h('tr', onRow ? { style: 'cursor:pointer', onclick: () => onRow(r) } : {},
          ...columns.map((c) => {
            const v = typeof c.value === 'function' ? c.value(r) : r[c.key];
            return h('td', { class: [c.num ? 'num' : '', c.mono ? 'mono' : ''].join(' ').trim() || null },
              v instanceof Node ? v : (v ?? '—'));
          }))))));
}

export const pill = (text, color = 'gray') => h('span', { class: `pill ${color}` }, text);
export const expiryPill = (expiry) => (expiry ? pill(expiry.label, expiry.color) : null);

export const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const fmtDateTime = (d) => (d ? new Date(String(d).replace(' ', 'T')).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '—');
export const fmtNum = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('th-TH'));

export const MOVE_LABEL = { STORE: 'จัดเก็บเข้า', REMOVE: 'หยิบออก', MOVE: 'ย้ายตำแหน่ง', EDIT: 'แก้ไขข้อมูล' };
export const MOVE_COLOR = { STORE: 'green', REMOVE: 'amber', MOVE: 'blue', EDIT: 'gray' };
export const STATUS_LABEL = {
  EMPTY: 'ว่าง', OCCUPIED: 'มีสินค้า', DISABLED: 'ปิดใช้งาน',
  ACTIVE: 'ใช้งาน', INACTIVE: 'ปิดใช้งาน', IN_STOCK: 'อยู่ในคลัง', REMOVED: 'หยิบออกแล้ว',
};
export const ROLE_LABEL = { ADMIN: 'ผู้ดูแลระบบ', STAFF: 'พนักงานคลัง', VIEWER: 'ผู้ดูข้อมูล' };

export const DOC_LABEL = {
  GRN: 'รับเข้า (GRN)', ISSUE: 'จ่ายออก', TRANSFER: 'โอนย้าย',
  RETURN_IN: 'รับคืนลูกค้า', RETURN_OUT: 'ส่งคืนผู้ขาย', SCRAP: 'ตัดเสีย', ADJUST: 'ปรับยอด',
};
export const DOC_COLOR = {
  GRN: 'green', ISSUE: 'amber', TRANSFER: 'blue',
  RETURN_IN: 'blue', RETURN_OUT: 'amber', SCRAP: 'red', ADJUST: 'gray',
};
export const SHIP_LABEL = { PICKED: 'หยิบแล้ว', PACKED: 'แพ็คแล้ว', SHIPPED: 'จัดส่งแล้ว', DELIVERED: 'ถึงปลายทาง' };
export const SHIP_COLOR = { PICKED: 'amber', PACKED: 'blue', SHIPPED: 'blue', DELIVERED: 'green' };
export const PTYPE_LABEL = { RM: 'วัตถุดิบ (RM)', PM: 'บรรจุภัณฑ์ (PM)', SEMI: 'กึ่งสำเร็จรูป', FG: 'สำเร็จรูป (FG)', POSM: 'POSM' };
export const ACTION_LABEL = {
  EXPIRED: 'หมดอายุแล้ว', CUTOFF: 'ต้องตัดออก', MOVE: 'ย้ายเข้าโปรโมชัน', WATCH: 'ขายได้บางช่องทาง', OK: 'ปกติ',
};
export const ACTION_COLOR = { EXPIRED: 'red', CUTOFF: 'red', MOVE: 'amber', WATCH: 'blue', OK: 'green' };

/** ป้าย % อายุคงเหลือ */
export const pctPill = (pct) => {
  if (pct === null || pct === undefined) return h('span', { class: 'muted' }, '—');
  const color = pct >= 80 ? 'green' : pct >= 50 ? 'blue' : pct >= 25 ? 'amber' : 'red';
  return pill(`${pct}%`, color);
};

/**
 * Popup เลือกตำแหน่งว่างจากแผนผังชั้นวาง
 * กดปุ่ม → เลือก RACK → ดู Grid → คลิกตำแหน่งว่าง → ส่ง location_code กลับ
 */
export function locationPickerModal(apiGet, onSelect, { warehouseId } = {}) {
  const content = h('div', {});
  const m = modal('📍 เลือกตำแหน่งจัดเก็บจากแผนผัง', content, []);

  async function loadRacks() {
    content.replaceChildren(h('div', { class: 'empty-state' }, 'กำลังโหลดชั้นวาง…'));
    try {
      const data = await apiGet('/api/overview', { warehouse_id: warehouseId || '' });
      const allWh = data.warehouses ?? [];
      if (!allWh.length) { content.replaceChildren(h('div', { class: 'empty-state' }, 'ไม่พบคลังสินค้า')); return; }

      const cards = [];
      for (const w of allWh) {
        for (const z of (w.zones || [])) {
          if (!z.rags?.length) continue;
          const rackBtns = z.rags
            .filter((r) => r.empty > 0)
            .map((r) => h('button', {
              class: 'btn', style: 'text-align:left;padding:8px 12px;display:flex;justify-content:space-between;gap:12px',
              onclick: () => loadGrid(r.rag_id, `${r.zone_code}-${r.rag_no}`),
            },
              h('span', { style: 'font-weight:600' }, `${r.zone_code}-${r.rag_no}`),
              h('span', { class: 'muted', style: 'font-size:12px' }, `ว่าง ${r.empty} / ${r.usable} ตำแหน่ง`)));
          if (rackBtns.length) {
            cards.push(h('div', { style: 'margin-bottom:14px' },
              h('div', { style: 'font-weight:600;margin-bottom:6px;color:#0f766e' },
                `${z.zone_code} — ${z.zone_name}${w.wh_code ? ` (${w.wh_code})` : ''}`),
              h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:6px' },
                ...rackBtns)));
          }
        }
      }
      if (!cards.length) { content.replaceChildren(h('div', { class: 'empty-state' }, 'ไม่มีชั้นวางที่มีตำแหน่งว่าง')); return; }
      content.replaceChildren(
        h('p', { class: 'muted', style: 'margin-bottom:10px' }, 'เลือกชั้นวางที่ต้องการ — แสดงเฉพาะชั้นวางที่มีตำแหน่งว่าง'),
        ...cards);
    } catch (err) { content.replaceChildren(h('div', { class: 'empty-state' }, err.message)); }
  }

  async function loadGrid(ragId, ragLabel) {
    content.replaceChildren(h('div', { class: 'empty-state' }, 'กำลังโหลดแผนผัง…'));
    try {
      const data = await apiGet(`/api/rags/${ragId}/map`);
      const { rag, cells } = data;
      const byLevel = new Map();
      for (const c of cells) {
        if (!byLevel.has(c.level)) byLevel.set(c.level, []);
        byLevel.get(c.level).push(c);
      }
      const levels = [...byLevel.keys()].sort((a, b) => b - a);

      const cellColor = (c) => {
        if (c.status === 'DISABLED') return '#e2e8f0';
        if (!c.item_id) return '#bbf7d0';
        return c.expiry?.color === 'red' ? '#fecaca' : c.expiry?.color === 'amber' ? '#fde68a' : '#bfdbfe';
      };

      const grid = h('div', { style: 'overflow-x:auto' },
        h('table', { style: 'border-collapse:collapse;width:100%' },
          h('thead', {}, h('tr', {},
            h('th', { style: 'width:50px;font-size:12px;color:#64748b' }, ''),
            ...Array.from({ length: rag.total_depths }, (_, i) =>
              h('th', { style: 'text-align:center;font-size:11px;color:#64748b;padding:4px' }, `D${i + 1}`)))),
          h('tbody', {}, ...levels.map((lv) =>
            h('tr', {},
              h('td', { style: 'font-weight:600;font-size:12px;color:#64748b;padding:4px' }, `L${lv}`),
              ...byLevel.get(lv).sort((a, b) => a.depth - b.depth).map((c) => {
                const isEmpty = !c.item_id && c.status !== 'DISABLED';
                return h('td', {
                  style: `padding:3px;text-align:center;cursor:${isEmpty ? 'pointer' : 'default'}`,
                  onclick: isEmpty ? () => { onSelect(c.location_code); m.close(); } : null,
                },
                  h('div', {
                    style: `background:${cellColor(c)};border-radius:6px;padding:6px 4px;min-height:48px;
                            border:${isEmpty ? '2px solid #22c55e' : '1px solid #e2e8f0'};
                            ${isEmpty ? 'box-shadow:0 0 0 1px #22c55e33' : ''}`,
                    title: isEmpty ? `คลิกเพื่อเลือก ${c.location_code}` : (c.sku_name || c.status),
                  },
                    h('div', { style: 'font-size:10px;font-weight:600;color:#334155' },
                      c.location_code.split('-').slice(-2).join('-')),
                    isEmpty
                      ? h('div', { style: 'font-size:11px;color:#16a34a;font-weight:600' }, 'ว่าง')
                      : c.item_id
                        ? h('div', { style: 'font-size:9px;color:#475569;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:90px' }, c.sku_name)
                        : h('div', { style: 'font-size:9px;color:#94a3b8' }, 'ปิด')));
              }))))));

      const legend = h('div', { style: 'display:flex;gap:14px;margin-top:8px;font-size:11px;color:#64748b' },
        lgSpan('#bbf7d0', '#22c55e', 'ว่าง (คลิกเลือก)'), lgSpan('#bfdbfe', '#e2e8f0', 'มีสินค้า'),
        lgSpan('#fde68a', '#e2e8f0', 'ใกล้หมดอายุ'), lgSpan('#fecaca', '#e2e8f0', 'หมดอายุ'));

      content.replaceChildren(
        h('div', { style: 'display:flex;align-items:center;gap:10px;margin-bottom:10px' },
          h('button', { class: 'btn ghost', onclick: loadRacks, style: 'padding:4px 10px' }, '← กลับ'),
          h('span', { style: 'font-weight:600;font-size:16px' }, `RACK ${ragLabel}`),
          h('span', { class: 'muted', style: 'font-size:13px' },
            `${rag.total_levels} ชั้น × ${rag.total_depths} ตอน — คลิกช่องเขียวเพื่อเลือกตำแหน่ง`)),
        grid, legend);
    } catch (err) { content.replaceChildren(h('div', { class: 'empty-state' }, err.message)); }
  }

  function lgSpan(bg, border, text) {
    return h('span', { style: 'display:flex;align-items:center;gap:4px' },
      h('i', { style: `display:inline-block;width:14px;height:14px;border-radius:3px;background:${bg};border:1px solid ${border}` }), text);
  }

  loadRacks();
  return m;
}

/** ช่องกรอกที่รองรับเครื่องสแกนบาร์โค้ด (สแกนแล้วกด Enter อัตโนมัติ) */
export function scanInput(placeholder, onScan, { autofocus = true } = {}) {
  const input = h('input', {
    placeholder, autocomplete: 'off', spellcheck: 'false',
    onkeydown: (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const v = input.value.trim();
      if (v) onScan(v, input);
    },
  });
  if (autofocus) setTimeout(() => input.focus(), 60);
  return input;
}
