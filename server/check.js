// ตรวจการเชื่อมต่อฐานข้อมูล พร้อมบอกวิธีแก้เมื่อต่อไม่ได้
import './lib/env.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('❌ ไม่พบ DATABASE_URL — ตรวจว่ามีไฟล์ .env ที่โฟลเดอร์หลักหรือยัง');
  process.exit(1);
}
if (url.includes('<รหัสผ่าน>') || url.includes('<password>')) {
  console.error(`
❌ ยังไม่ได้ใส่รหัสผ่านใน .env

   เปิดไฟล์ .env แล้วแทนที่ <รหัสผ่าน> ด้วยรหัสผ่านจริง
   หาได้จาก Supabase Dashboard → Settings → Database
   (ถ้าจำไม่ได้ กด "Reset database password" เพื่อตั้งใหม่)
`);
  process.exit(1);
}

// แสดง host ที่จะต่อ โดยไม่เปิดเผยรหัสผ่าน
const safe = url.replace(/:\/\/([^:]+):[^@]*@/, '://$1:••••••@');
console.log(`กำลังต่อไปที่  ${safe}\n`);

const { pool, close } = await import('./lib/db.js');
try {
  const t0 = Date.now();
  const r = await pool.query('SELECT current_database() AS db, version() AS v');
  const ms = Date.now() - t0;
  console.log(`✅ ต่อสำเร็จ (${ms} ms)`);
  console.log(`   ฐานข้อมูล : ${r.rows[0].db}`);
  console.log(`   เวอร์ชัน   : ${r.rows[0].v.split(' ').slice(0, 2).join(' ')}`);

  const t = await pool.query(`
    SELECT COUNT(*) FILTER (WHERE table_type='BASE TABLE') AS tables,
           COUNT(*) FILTER (WHERE table_type='VIEW') AS views
      FROM information_schema.tables WHERE table_schema='public'`);
  const { tables, views } = t.rows[0];
  console.log(`   ตารางที่มี : ${tables} ตาราง · ${views} view`);
  console.log(Number(tables) === 0
    ? '\n➜ ยังไม่มีตาราง — รัน `npm run migrate` เพื่อสร้าง'
    : '\n➜ พร้อมใช้งาน — รัน `npm start` ได้เลย');
} catch (err) {
  const m = err.message;
  console.error(`❌ ต่อไม่สำเร็จ: ${m}\n`);
  if (/password authentication failed/i.test(m))
    console.error('➜ รหัสผ่านไม่ถูกต้อง — ตั้งใหม่ได้ที่ Settings → Database → Reset database password');
  else if (/ENOTFOUND|EAI_AGAIN/i.test(m))
    console.error('➜ หาที่อยู่เซิร์ฟเวอร์ไม่เจอ — ตรวจว่าพิมพ์ project ref ถูกต้อง และเครื่องต่ออินเทอร์เน็ตอยู่');
  else if (/ENETUNREACH|ECONNREFUSED|ETIMEDOUT|timeout/i.test(m))
    console.error(`➜ ต่อไม่ถึงเซิร์ฟเวอร์ — โปรเจกต์ Supabase ใหม่มักไม่เปิดให้ต่อตรงผ่าน IPv4
   ให้ใช้แบบ Connection Pooler แทน: Dashboard → ปุ่ม Connect → Session pooler
   แล้วคัดลอก URI มาวางทับบรรทัด DATABASE_URL ใน .env`);
  else if (/does not exist/i.test(m))
    console.error('➜ ไม่พบฐานข้อมูลที่ระบุ — ปกติชื่อฐานข้อมูลของ Supabase คือ postgres');
  else if (/SSL|certificate/i.test(m))
    console.error('➜ ปัญหาเรื่อง SSL — ตรวจว่า URL ไม่ได้ใส่ sslmode=disable ไว้');
  process.exitCode = 1;
} finally {
  await close();
}
