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
