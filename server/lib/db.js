// การเชื่อมต่อฐานข้อมูล PostgreSQL (Supabase)
//
// คงหน้าตา API เดิมไว้ทั้งหมด — all / get / run / tx — แต่เปลี่ยนเป็น async
// จึงไม่ต้องแก้ตรรกะ SQL ที่มีอยู่ (JOIN, GROUP BY, subquery, view ใช้ได้เหมือนเดิม)
//
// สองอย่างที่จัดการให้อัตโนมัติ:
//   1. แปลง placeholder จาก ? เป็น $1 $2 ... ให้เอง (โค้ดเดิมใช้ ? ได้ต่อ)
//   2. tx() ส่ง connection เดียวกันให้ทุกคำสั่งข้างในผ่าน AsyncLocalStorage
//      จึงไม่ต้องส่ง client ผ่านพารามิเตอร์ไปทุกฟังก์ชัน
import pg from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(__dirname, '..', '..');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.warn('[DB] ⚠️ ไม่พบ DATABASE_URL — ระบบจะต่อฐานข้อมูลไม่ได้จนกว่าจะตั้งค่า');
}

// ---------- แปลงชนิดข้อมูลให้เหมือนของเดิม เพื่อไม่ให้ API เปลี่ยนรูปแบบ ----------
const { types } = pg;
types.setTypeParser(20, (v) => (v === null ? null : Number(v)));    // int8 — COUNT()/SUM() ปกติคืนเป็น string
types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));  // numeric — AVG()
types.setTypeParser(1082, (v) => v);                                // date      → 'YYYY-MM-DD'
types.setTypeParser(1114, (v) => (v ? String(v).slice(0, 19) : v)); // timestamp → 'YYYY-MM-DD HH:MM:SS'

// Supabase บังคับ SSL ส่วน PostgreSQL บนเครื่องตัวเองมักไม่ได้เปิดไว้ — เลือกให้อัตโนมัติ
const isLocal = DATABASE_URL && /@(localhost|127\.0\.0\.1|\[::1\])[:/]|host=\/|sslmode=disable/.test(DATABASE_URL);

export const pool = DATABASE_URL
  ? new pg.Pool({
      connectionString: DATABASE_URL,
      ssl: isLocal ? false : { rejectUnauthorized: false },
      max: Number(process.env.RAG_DB_POOL || 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 15_000,
    })
  : null;

if (pool) pool.on('error', (err) => console.error('[DB] connection error:', err.message));

// เวลาไทยแบบไม่พึ่ง session timezone — ให้ผลเท่ากันเสมอไม่ว่าต่อผ่าน pooler แบบไหน
export const NOW_TH = "(now() AT TIME ZONE 'Asia/Bangkok')";
export const TODAY_TH = "(now() AT TIME ZONE 'Asia/Bangkok')::date";

// ---------- แปลง ? เป็น $1 $2 ... (ข้ามที่อยู่ในเครื่องหมายคำพูด) ----------
function toPg(sql) {
  let out = '';
  let n = 0;
  let quote = null;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (quote) {
      out += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') { quote = c; out += c; continue; }
    out += c === '?' ? `$${++n}` : c;
  }
  return out;
}

const txStore = new AsyncLocalStorage();

async function exec(sql, params) {
  if (!pool) throw new Error('DATABASE_URL ไม่ได้ตั้งค่า — ต่อฐานข้อมูลไม่ได้');
  const client = txStore.getStore();
  const text = toPg(sql);
  return client ? client.query(text, params) : pool.query(text, params);
}

/** SELECT หลายแถว */
export const all = async (sql, ...params) => (await exec(sql, params)).rows;

/** SELECT แถวเดียว (ไม่พบ = null) */
export const get = async (sql, ...params) => (await exec(sql, params)).rows[0] ?? null;

/**
 * INSERT / UPDATE / DELETE
 * คืน lastInsertRowid ให้เหมือน SQLite เดิม โดยเติม RETURNING * ให้อัตโนมัติเมื่อเป็น INSERT
 */
export async function run(sql, ...params) {
  const isInsert = /^\s*INSERT\b/i.test(sql) && !/\bRETURNING\b/i.test(sql);
  const res = await exec(isInsert ? `${sql} RETURNING *` : sql, params);
  const row = res.rows[0];
  return {
    rowCount: res.rowCount,
    rows: res.rows,
    row: row ?? null,
    // คีย์หลักของทุกตารางลงท้ายด้วย _id (ยกเว้น sessions ที่ใช้ token)
    lastInsertRowid: row
      ? row[Object.keys(row).find((k) => k.endsWith('_id')) ?? Object.keys(row)[0]]
      : undefined,
  };
}

/**
 * ครอบหลายคำสั่งไว้ใน Transaction เดียว (สำเร็จทั้งหมด หรือไม่สำเร็จเลย)
 * คำสั่งทุกตัวที่เรียกภายใน fn จะวิ่งบน connection เดียวกันโดยอัตโนมัติ
 */
export async function tx(fn) {
  if (txStore.getStore()) return await fn();   // อยู่ใน Transaction อยู่แล้ว — ใช้ต่อได้เลย ไม่เปิดซ้อน
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await txStore.run(client, fn);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** สร้างตาราง/view/index ถ้ายังไม่มี — เรียกครั้งเดียวตอนระบบเริ่มทำงาน */
export async function migrate() {
  const sql = readFileSync(join(__dirname, '..', 'schema.postgres.sql'), 'utf8');
  const client = await pool.connect();
  try {
    await client.query(sql);
  } finally {
    client.release();
  }
}

export const close = () => pool.end();

export const nowStr = () =>
  new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 19).replace('T', ' ');
export const todayStr = () => nowStr().slice(0, 10);
