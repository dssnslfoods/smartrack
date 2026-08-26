// สำรองฐานข้อมูล — ใช้ VACUUM INTO จึงสำรองได้แม้ระบบกำลังทำงานอยู่ (ไม่ต้องปิดเซิร์ฟเวอร์)
// ใช้งาน:  node server/backup.js [ปลายทาง]
//         RAG_DB=/data/rag.db node server/backup.js /data/backups/rag-2026-08-26.db
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

const src = process.env.RAG_DB || join(process.cwd(), 'data', 'rag.db');
if (!existsSync(src)) {
  console.error(`ไม่พบฐานข้อมูลที่ ${src}`);
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
const out = process.argv[2] || join(dirname(src), 'backups', `rag-${stamp}.db`);
mkdirSync(dirname(out), { recursive: true });

const db = new DatabaseSync(src, { readOnly: true });
db.exec(`VACUUM INTO '${out.replaceAll("'", "''")}'`);
db.close();

const mb = (statSync(out).size / 1024 / 1024).toFixed(2);
console.log(`สำรองข้อมูลเรียบร้อย: ${out} (${mb} MB)`);
