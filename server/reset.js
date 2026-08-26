// ⚠️ ลบข้อมูลทั้งหมดแล้วสร้างใหม่ — ใช้เฉพาะตอนทดสอบเท่านั้น
import './lib/env.js';
import { pool, migrate, close } from './lib/db.js';

if (process.env.RAG_ALLOW_RESET !== 'yes') {
  console.error('ยกเลิก — คำสั่งนี้ลบข้อมูลทั้งหมด ถ้าแน่ใจให้ตั้ง RAG_ALLOW_RESET=yes');
  process.exit(1);
}
await pool.query(`
  DROP VIEW IF EXISTS v_stock CASCADE;
  DROP TABLE IF EXISTS movements, stock_items, locations, rags, zones, warehouses, sessions, skus, users CASCADE;
  DROP FUNCTION IF EXISTS trg_movements_immutable() CASCADE;
`);
await migrate();
console.log('ล้างและสร้างโครงสร้างใหม่เรียบร้อย — รัน `npm run seed` ต่อได้');
await close();
