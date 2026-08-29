// เชื่อมต่อ Claude API — ใช้ fetch ของ Node 22 ตรงๆ ไม่ต้องลง SDK เพิ่ม
// ต้องตั้งตัวแปรแวดล้อม ANTHROPIC_API_KEY ก่อนใช้งาน
import { badRequest } from './http.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const VERSION = '2023-06-01';

/** รุ่นที่ใช้ — งานคิดหนักใช้ SMART, งานเร็ว/ถูกใช้ FAST */
export const MODEL = {
  SMART: process.env.AI_MODEL_SMART || 'claude-sonnet-4-5-20250929',
  FAST: process.env.AI_MODEL_FAST || 'claude-haiku-4-5-20251001',
};

export const aiEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY);

/** โยน error ภาษาไทยถ้ายังไม่ได้ตั้งค่า API key */
function requireKey() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw badRequest('ยังไม่ได้เปิดใช้งาน AI — กรุณาตั้งค่า ANTHROPIC_API_KEY ที่เซิร์ฟเวอร์', 'AI_DISABLED');
  return key;
}

/**
 * เรียก Claude Messages API
 * @param {object} o
 * @param {Array}  o.messages  ประวัติสนทนา
 * @param {string} o.system    system prompt
 * @param {Array}  o.tools     เครื่องมือให้ AI เรียกใช้ (optional)
 * @param {string} o.model
 * @param {number} o.maxTokens
 */
export async function callClaude({ messages, system, tools, model = MODEL.SMART, maxTokens = 2048, temperature } = {}) {
  const key = requireKey();
  const body = { model, max_tokens: maxTokens, messages };
  if (system) body.system = system;
  if (tools?.length) body.tools = tools;
  if (temperature !== undefined) body.temperature = temperature;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90_000);
  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': VERSION },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw badRequest('AI ใช้เวลานานเกินไป — กรุณาลองใหม่อีกครั้ง', 'AI_TIMEOUT');
    throw badRequest(`เชื่อมต่อ AI ไม่สำเร็จ: ${err.message}`, 'AI_NETWORK');
  }
  clearTimeout(timer);

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let msg = `AI ตอบกลับผิดพลาด (${res.status})`;
    try { msg = JSON.parse(text)?.error?.message ?? msg; } catch {}
    if (res.status === 401) msg = 'ANTHROPIC_API_KEY ไม่ถูกต้อง';
    if (res.status === 429) msg = 'เรียกใช้ AI ถี่เกินไป — กรุณารอสักครู่แล้วลองใหม่';
    throw badRequest(msg, 'AI_ERROR');
  }
  return await res.json();
}

/** ดึงเฉพาะข้อความตัวอักษรจากคำตอบ */
export const textOf = (reply) =>
  (reply?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();

/** ดึงคำสั่งเรียกเครื่องมือจากคำตอบ */
export const toolUsesOf = (reply) => (reply?.content ?? []).filter((c) => c.type === 'tool_use');

/**
 * ขอคำตอบเป็น JSON ตาม schema ที่กำหนด — บังคับผ่าน tool use จึงไม่ต้อง parse ข้อความเอง
 * คืนค่า object ที่ผ่านการตรวจรูปแบบจากฝั่ง API แล้ว
 */
export async function callClaudeJSON({ messages, system, schema, name = 'result', description = 'ส่งผลลัพธ์', model = MODEL.SMART, maxTokens = 4096 }) {
  const reply = await callClaude({
    messages, system, model, maxTokens,
    tools: [{ name, description, input_schema: schema }],
  });
  const use = toolUsesOf(reply).find((t) => t.name === name);
  if (!use) throw badRequest('AI ไม่ได้ส่งผลลัพธ์ตามรูปแบบที่กำหนด — กรุณาลองใหม่', 'AI_NO_RESULT');
  return { data: use.input, usage: reply.usage };
}

/** สร้าง content block รูปภาพจาก data URL หรือ base64 */
export function imageBlock(dataUrl) {
  const m = /^data:([^;]+);base64,(.+)$/s.exec(String(dataUrl ?? ''));
  if (!m) throw badRequest('รูปภาพไม่ถูกต้อง — ต้องเป็น data URL แบบ base64');
  const [, media_type, data] = m;
  if (!/^image\/(jpeg|png|gif|webp)$/.test(media_type))
    throw badRequest('รองรับเฉพาะไฟล์ JPG, PNG, GIF, WEBP');
  return { type: 'image', source: { type: 'base64', media_type, data } };
}

/** สร้าง content block เอกสาร PDF */
export function pdfBlock(dataUrl) {
  const m = /^data:application\/pdf;base64,(.+)$/s.exec(String(dataUrl ?? ''));
  if (!m) throw badRequest('ไฟล์ PDF ไม่ถูกต้อง');
  return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: m[1] } };
}
