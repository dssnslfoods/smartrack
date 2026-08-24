// ตัวเชื่อมต่อ REST API + จัดการ Token
const TOKEN_KEY = 'rag.token';
const USER_KEY = 'rag.user';

export const auth = {
  get token() { return localStorage.getItem(TOKEN_KEY); },
  get user() { try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; } },
  set(token, user) { localStorage.setItem(TOKEN_KEY, token); localStorage.setItem(USER_KEY, JSON.stringify(user)); },
  clear() { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); },
  can(perm) {
    const p = this.user?.permissions ?? [];
    return p.includes('*') || p.includes(perm);
  },
};

const WH_KEY = 'rag.warehouse';
const WH_NAME_KEY = 'rag.warehouse_name';
export const wh = {
  get id() { const v = localStorage.getItem(WH_KEY); return v ? Number(v) : null; },
  set id(v) { v ? localStorage.setItem(WH_KEY, v) : localStorage.removeItem(WH_KEY); },
  get name() { return localStorage.getItem(WH_NAME_KEY) || null; },
  set name(v) { v ? localStorage.setItem(WH_NAME_KEY, v) : localStorage.removeItem(WH_NAME_KEY); },
  get label() {
    if (this.name) return this.name;
    const sel = document.getElementById('whSelect');
    if (sel && sel.value && sel.selectedIndex > 0) {
      const text = sel.options[sel.selectedIndex].text;
      this.name = text;
      return text;
    }
    return this.id ? `คลัง #${this.id}` : 'ทุกคลัง';
  },
};

export class ApiError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}

async function request(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(auth.token ? { Authorization: `Bearer ${auth.token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const fromCache = res.headers.get('X-From-Cache') === '1';
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) {
    if (res.status === 401 && !path.includes('/auth/login')) { auth.clear(); location.hash = '#/login'; }
    throw new ApiError(data?.error ?? `เกิดข้อผิดพลาด (${res.status})`, res.status, data?.code);
  }
  if (fromCache && data && typeof data === 'object' && !Array.isArray(data)) data.__cached = true;
  if (fromCache && Array.isArray(data)) Object.defineProperty(data, '__cached', { value: true });
  return data;
}

export const api = {
  get: (p, params) => request('GET', params ? `${p}?${new URLSearchParams(clean(params))}` : p),
  post: (p, b) => request('POST', p, b ?? {}),
  put: (p, b) => request('PUT', p, b),
  patch: (p, b) => request('PATCH', p, b),
  del: (p) => request('DELETE', p),
};

const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));

export const download = (path, params) => {
  const url = params ? `${path}?${new URLSearchParams(clean(params))}` : path;
  fetch(url, { headers: { Authorization: `Bearer ${auth.token}` } })
    .then((r) => r.blob())
    .then((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = url.split('/').pop().split('?')[0];
      a.click();
      URL.revokeObjectURL(a.href);
    });
};

/** เปิดหน้าพิมพ์ป้าย (ต้องแนบ Token จึงใช้ blob URL) */
export const openLabels = async (path, params) => {
  const url = `${path}?${new URLSearchParams(clean(params))}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${auth.token}` } });
  if (!res.ok) throw new ApiError((await res.json()).error, res.status);
  const html = await res.text();
  const w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
};
