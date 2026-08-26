// โหลดค่าจากไฟล์ .env — ต้อง import ไฟล์นี้ "ก่อน" db.js เสมอ
// (ESM รัน import ตามลำดับที่เขียน จึงมั่นใจได้ว่าค่าถูกตั้งก่อนต่อฐานข้อมูล)
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const file = process.env.RAG_ENV_FILE || join(ROOT, '.env');

if (existsSync(file)) {
  try {
    process.loadEnvFile(file);   // Node 22+ มีให้ในตัว ไม่ต้องลงไลบรารีเพิ่ม
  } catch (err) {
    console.error(`อ่านไฟล์ .env ไม่สำเร็จ (${file}):`, err.message);
  }
}
