// Helper สำหรับ HTTP layer: parse body, ส่ง JSON, ข้อผิดพลาดมาตรฐาน
export class HttpError extends Error {
  constructor(status, message, code = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export const badRequest = (m, code) => new HttpError(400, m, code);
export const unauthorized = (m = 'กรุณาเข้าสู่ระบบ') => new HttpError(401, m);
export const forbidden = (m = 'ไม่มีสิทธิ์ใช้งานฟังก์ชันนี้') => new HttpError(403, m);
export const notFound = (m = 'ไม่พบข้อมูล') => new HttpError(404, m);
export const conflict = (m, code) => new HttpError(409, m, code);

export function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

export async function readBody(req, limit = 2 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw badRequest('ข้อมูลที่ส่งมามีขนาดใหญ่เกินไป');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw badRequest('รูปแบบ JSON ไม่ถูกต้อง');
  }
}

/** ตรวจสอบ field ที่จำเป็น */
export function require_(obj, fields) {
  const missing = fields.filter((f) => obj[f] === undefined || obj[f] === null || obj[f] === '');
  if (missing.length) throw badRequest(`ข้อมูลไม่ครบ: ${missing.join(', ')}`);
  return obj;
}

export const int = (v, def = null) => {
  if (v === undefined || v === null || v === '') return def;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
};
