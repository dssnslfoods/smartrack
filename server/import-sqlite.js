// ย้ายข้อมูลจากฐานข้อมูล SQLite เดิม → PostgreSQL (Supabase)
//
// ใช้งาน:  node server/import-sqlite.js [ไฟล์.db]        (ค่าเริ่มต้น: data/rag.db)
//          node server/import-sqlite.js --force          ทับข้อมูลเดิมที่มีอยู่
//
// คงเลข id เดิมไว้ทุกตาราง เพื่อให้ความสัมพันธ์ระหว่างตารางไม่เพี้ยน
// แล้วรีเซ็ต sequence ให้เริ่มนับต่อจากเลขสูงสุด
import './lib/env.js';
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { pool, migrate, close } from './lib/db.js';

const args = process.argv.slice(2);
const force = args.includes('--force');
const src = args.find((a) => !a.startsWith('--')) || 'data/rag.db';

if (!existsSync(src)) {
  console.error(`❌ ไม่พบไฟล์ ${src}`);
  process.exit(1);
}

// ลำดับสำคัญ — ตารางแม่ต้องมาก่อนตารางลูก (foreign key)
const TABLES = ['users', 'warehouses', 'zones', 'rags', 'locations', 'skus', 'stock_items', 'movements'];
// คอลัมน์ที่เป็นคีย์หลัก ใช้รีเซ็ต sequence
const PK = {
  users: 'user_id', warehouses: 'warehouse_id', zones: 'zone_id', rags: 'rag_id',
  locations: 'location_id', skus: 'sku_id', stock_items: 'item_id', movements: 'movement_id',
};

const sqlite = new DatabaseSync(src, { readOnly: true });
await migrate();

// ---------- กันเผลอเขียนทับข้อมูลที่มีอยู่ ----------
const existing = {};
for (const t of TABLES) {
  existing[t] = Number((await pool.query(`SELECT COUNT(*) AS n FROM ${t}`)).rows[0].n);
}
const nonEmpty = TABLES.filter((t) => existing[t] > 0 && t !== 'users');
if (nonEmpty.length && !force) {
  console.error(`
❌ ปลายทางมีข้อมูลอยู่แล้ว — ยกเลิกเพื่อความปลอดภัย
   ${nonEmpty.map((t) => `${t}=${existing[t]}`).join(' · ')}

   ถ้าต้องการล้างแล้วนำเข้าใหม่ ให้ใส่ --force
`);
  await close();
  process.exit(1);
}

console.log(`ย้ายข้อมูลจาก  ${src}  →  Supabase\n`);

const client = await pool.connect();
try {
  await client.query('BEGIN');

  // ปิด trigger ห้ามลบประวัติชั่วคราว เพื่อให้ --force ล้างข้อมูลเก่าได้
  await client.query('ALTER TABLE movements DISABLE TRIGGER trg_movement_no_delete');
  // sessions เป็น token ล็อกอินชั่วคราว ไม่ต้องย้าย แต่ต้องล้างก่อนเพราะอ้างถึง users
  await client.query('DELETE FROM sessions');
  for (const t of [...TABLES].reverse()) await client.query(`DELETE FROM ${t}`);
  await client.query('ALTER TABLE movements ENABLE TRIGGER trg_movement_no_delete');

  for (const table of TABLES) {
    // เอาเฉพาะคอลัมน์ที่มีอยู่จริงทั้งสองฝั่ง
    const pgCols = (await client.query(
      'SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2',
      ['public', table],
    )).rows.map((r) => r.column_name);

    const rows = sqlite.prepare(`SELECT * FROM ${table}`).all();
    if (!rows.length) { console.log(`  ${table.padEnd(13)} 0 แถว`); continue; }

    const cols = Object.keys(rows[0]).filter((c) => pgCols.includes(c));
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(',');
    const stmt = `INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(',')}) VALUES (${placeholders})`;

    for (const r of rows) {
      const vals = cols.map((c) => {
        const v = r[c];
        // SQLite เก็บวันที่เป็นข้อความ — ช่องว่างต้องกลายเป็น NULL ไม่ใช่สตริงว่าง
        if (v === '' && /(_at|_date)$/.test(c)) return null;
        return v === undefined ? null : v;
      });
      await client.query(stmt, vals);
    }

    // ให้ sequence เริ่มนับต่อจากเลขสูงสุด ไม่งั้นเพิ่มข้อมูลใหม่แล้ว id ชนกัน
    const pk = PK[table];
    if (pk) {
      await client.query(
        `SELECT setval(pg_get_serial_sequence($1, $2), COALESCE((SELECT MAX(${pk}) FROM ${table}), 0) + 1, false)`,
        [table, pk],
      );
    }
    console.log(`  ${table.padEnd(13)} ${rows.length} แถว`);
  }

  await client.query('COMMIT');
  console.log('\n✅ ย้ายข้อมูลสำเร็จ');
} catch (err) {
  await client.query('ROLLBACK').catch(() => {});
  await client.query('ALTER TABLE movements ENABLE TRIGGER trg_movement_no_delete').catch(() => {});
  console.error(`\n❌ ย้ายไม่สำเร็จ — ยกเลิกทั้งหมดแล้ว (ข้อมูลปลายทางไม่ถูกแตะ)\n   ${err.message}`);
  process.exitCode = 1;
} finally {
  client.release();
  sqlite.close();
  await close();
}
