// ข้อมูลตัวอย่างสำหรับทดลองใช้งาน
import './lib/env.js';
import { all, get, run, tx, nowStr, close } from './lib/db.js';
import { hashSecret } from './lib/auth.js';
import { syncRagLocations } from './services/locations.js';

let s = 20260820;
const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const dateAdd = (d) => new Date(Date.now() + d * 86400_000).toISOString().slice(0, 10);

if ((await get('SELECT COUNT(*) AS n FROM users')).n) {
  console.log('มีข้อมูลอยู่แล้ว — ข้ามการสร้างข้อมูลตัวอย่าง (ใช้ `npm run reset` เพื่อเริ่มใหม่)');
  process.exit(0);
}

await tx(async () => {
  for (const [username, name, role, pw] of [
    ['admin', 'ผู้ดูแลระบบ', 'ADMIN', 'admin123'],
    ['staff', 'สมหญิง พนักงานคลัง', 'STAFF', 'staff123'],
    ['staff2', 'ประยุทธ พนักงานคลัง', 'STAFF', 'staff123'],
    ['viewer', 'ฝ่ายซัพพลายเชน', 'VIEWER', 'viewer123'],
  ]) await run('INSERT INTO users (username, full_name, role, password_hash) VALUES (?,?,?,?)', username, name, role, hashSecret(pw));

  for (const [code, name, address, cols, rows] of [
    ['WH1', 'คลังสินค้าหลัก (บางนา)', 'บางนา กรุงเทพฯ', 10, 8],
    ['WH2', 'คลังสำรอง (ลำลูกกา)', 'ลำลูกกา ปทุมธานี', 8, 5],
  ]) await run('INSERT INTO warehouses (wh_code, wh_name, address, grid_cols, grid_rows) VALUES (?,?,?,?,?)',
    code, name, address, cols, rows);

  const whId = Object.fromEntries((await all('SELECT wh_code, warehouse_id FROM warehouses')).map((w) => [w.wh_code, w.warehouse_id]));

  for (const [code, name, wc, color] of [
    ['FG', 'สินค้าสำเร็จรูป', 'WH1', '#2563eb'],
    ['RM', 'วัตถุดิบ', 'WH1', '#16a34a'],
    ['PK', 'บรรจุภัณฑ์', 'WH1', '#d97706'],
    ['FG2', 'สินค้าสำเร็จรูป (สำรอง)', 'WH2', '#7c3aed'],
  ]) await run('INSERT INTO zones (zone_code, zone_name, warehouse_id, color) VALUES (?,?,?,?)', code, name, whId[wc], color);

  const zoneId = Object.fromEntries((await all('SELECT zone_code, zone_id FROM zones')).map((z) => [z.zone_code, z.zone_id]));

  // [หมายเลข, โซน, ชั้น, ตอน, ตำแหน่งบนผังพื้น x, y]  — ตำแหน่งเว้นที่ตามขนาด span
  for (const [no, zc, lv, dp, x, y] of [
    ['A01', 'FG', 4, 6, 0, 0], ['A02', 'FG', 4, 6, 2, 0], ['A03', 'FG', 4, 6, 4, 0], ['A04', 'FG', 3, 5, 6, 0],
    ['B01', 'FG', 4, 6, 0, 2], ['B02', 'FG', 4, 6, 2, 2],
    ['R01', 'RM', 4, 5, 6, 2], ['R02', 'RM', 4, 5, 8, 2],
    ['P01', 'PK', 4, 6, 6, 4], ['P02', 'PK', 4, 6, 8, 4],
  ]) await run('INSERT INTO rags (rag_no, zone_id, total_levels, total_depths, pos_x, pos_y) VALUES (?,?,?,?,?,?)',
    no, zoneId[zc], lv, dp, x, y);

  for (const [code, name, cat, unit, zc] of [
    ['FG-CRM-SPF50', 'ครีมกันแดด de leaf thanaka SPF50 50g', 'ครีม', 'หลอด', 'FG'],
    ['FG-CRM-TNK100', 'ครีมทานาคาบำรุงผิว 100g', 'ครีม', 'กระปุก', 'FG'],
    ['FG-SOP-TNK100', 'สบู่ทานาคา 100g', 'สบู่', 'ก้อน', 'FG'],
    ['FG-SOP-CLY100', 'สบู่โคลนทานาคา 100g', 'สบู่', 'ก้อน', 'FG'],
    ['FG-SHP-HRB300', 'แชมพูสมุนไพร 300ml', 'แชมพู', 'ขวด', 'FG'],
    ['FG-LOT-BDY200', 'โลชั่นบำรุงผิวกาย 200ml', 'โลชั่น', 'ขวด', 'FG'],
    ['FG-SER-VTC30', 'เซรั่มวิตามินซี 30ml', 'เซรั่ม', 'ขวด', 'FG'],
    ['RM-EXT-TNK25', 'สารสกัดทานาคา 25kg', 'วัตถุดิบ', 'ถัง', 'RM'],
    ['RM-OIL-COC20', 'น้ำมันมะพร้าวสกัดเย็น 20L', 'วัตถุดิบ', 'ถัง', 'RM'],
    ['PK-BTL-300CL', 'ขวดพลาสติกใส 300ml', 'บรรจุภัณฑ์', 'ใบ', 'PK'],
    ['PK-TUB-50WH', 'หลอดครีม 50g สีขาว', 'บรรจุภัณฑ์', 'ใบ', 'PK'],
    ['PK-BOX-STD', 'กล่องกระดาษมาตรฐาน', 'บรรจุภัณฑ์', 'ใบ', 'PK'],
  ]) await run('INSERT INTO skus (sku_code, sku_name, category, unit, barcode) VALUES (?,?,?,?,?)',
    code, name, cat, unit, '885' + String(1000000 + Math.floor(rnd() * 8999999)));
});

for (const r of await all('SELECT rag_id FROM rags')) await syncRagLocations(r.rag_id);

// ปิดใช้งานบางตำแหน่ง (จำลองช่องที่ชำรุด)
await run("UPDATE locations SET status='DISABLED' WHERE location_code IN ('FG-A01-L4-D5','FG-A01-L4-D6')");

// จัดเก็บสินค้าตัวอย่าง
const skus = await all('SELECT * FROM skus');
const staff = (await get("SELECT user_id FROM users WHERE username='staff'")).user_id;
const zonePrefix = { FG: 'FG', RM: 'RM', PK: 'PK' };
let lot = 100;

await tx(async () => {
  for (const loc of await all(
    `SELECT l.*, z.zone_code FROM locations l JOIN rags r ON r.rag_id = l.rag_id
       JOIN zones z ON z.zone_id = r.zone_id WHERE l.status = 'EMPTY'`,
  )) {
    if (rnd() > 0.5) continue;                       // เว้นบางช่องให้ว่าง
    const candidates = skus.filter((k) => k.sku_code.startsWith(zonePrefix[loc.zone_code]));
    const sku = pick(candidates);
    lot += 1;
    const roll = rnd();
    const expDays = roll < 0.05 ? -Math.floor(rnd() * 30) - 1
      : roll < 0.15 ? Math.floor(rnd() * 80)
      : 150 + Math.floor(rnd() * 700);
    const qty = 20 * (5 + Math.floor(rnd() * 25));
    const res = await run(
      `INSERT INTO stock_items (sku_id, location_id, lot_no, exp_date, quantity, stored_at)
       VALUES (?,?,?,?,?,?)`,
      sku.sku_id, loc.location_id, `2569-${lot}`, dateAdd(expDays), qty, nowStr(),
    );
    await run("UPDATE locations SET status='OCCUPIED' WHERE location_id = ?", loc.location_id);
    await run(`INSERT INTO movements (movement_type, item_id, sku_id, lot_no, quantity, to_location_id, user_id, note)
         VALUES ('STORE',?,?,?,?,?,?,'ข้อมูลตัวอย่างเริ่มต้นระบบ')`,
      Number(res.lastInsertRowid), sku.sku_id, `2569-${lot}`, qty, loc.location_id, staff);
  }
});

console.log(`ตำแหน่งจัดเก็บทั้งหมด ${(await get('SELECT COUNT(*) AS n FROM locations')).n} ตำแหน่ง`);
console.log(`มีสินค้าอยู่ ${(await get("SELECT COUNT(*) AS n FROM locations WHERE status='OCCUPIED'")).n} ตำแหน่ง`);
console.log('\nบัญชีทดสอบ:  admin/admin123 · staff/staff123 · viewer/viewer123');
if (process.argv[1]?.endsWith('seed.js')) await close();
