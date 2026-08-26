// ใส่/เปลี่ยนรหัสผ่านฐานข้อมูลใน .env อย่างปลอดภัย
//
// ใช้งาน:  npm run set-password
//
// - พิมพ์รหัสผ่านแบบไม่แสดงตัวอักษร (ขึ้น * แทน) และไม่ตกไปอยู่ใน shell history
// - เข้ารหัสอักขระพิเศษ (@ : / # ? ฯลฯ) ให้อัตโนมัติ
// - ทดสอบเชื่อมต่อทันทีก่อนบันทึกจริง — ถ้าต่อไม่ได้จะไม่แก้ไฟล์
import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

const ENV = join(process.cwd(), '.env');
if (!existsSync(ENV)) {
  console.error('❌ ไม่พบไฟล์ .env — คัดลอกจาก .env.example ก่อน');
  process.exit(1);
}

const env = readFileSync(ENV, 'utf8');
const line = env.split('\n').find((l) => l.startsWith('DATABASE_URL='));
if (!line) {
  console.error('❌ ไม่พบบรรทัด DATABASE_URL= ในไฟล์ .env');
  process.exit(1);
}

// แยกส่วนประกอบของ URL เดิมไว้ เพื่อเปลี่ยนเฉพาะรหัสผ่าน
const m = line.slice('DATABASE_URL='.length).match(/^(postgresql:\/\/)([^:]+):([^@]*)@(.+)$/);
if (!m) {
  console.error('❌ รูปแบบ DATABASE_URL ไม่ถูกต้อง — ต้องเป็น postgresql://user:pass@host:port/db');
  process.exit(1);
}
const [, scheme, user, , rest] = m;
console.log(`จะเปลี่ยนรหัสผ่านของ  ${scheme}${user}:••••••@${rest}\n`);

const ETX = String.fromCharCode(3);      // Ctrl+C
const DEL = String.fromCharCode(127);    // Backspace

/**
 * อ่านรหัสผ่านแบบไม่แสดงตัวอักษร — ใช้ raw mode อ่านทีละปุ่ม
 * (เชื่อถือได้กว่าการใช้ readline แล้วลบสิ่งที่ echo ออกมา ซึ่งทำให้ตัวอักษรตกหล่น)
 */
const askHidden = (prompt) => new Promise((resolve, reject) => {
  // รองรับการส่งค่ามาทาง pipe:  echo 'รหัส' | npm run set-password
  if (!process.stdin.isTTY) {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => { buf += d; });
    process.stdin.on('end', () => resolve(buf.split('\n')[0]));
    return;
  }

  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  let pw = '';
  const finish = (fn, arg) => {
    process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdin.removeListener('data', onKey);
    process.stdout.write('\n');
    fn(arg);
  };
  const onKey = (key) => {
    for (const ch of key) {
      if (ch === '\r' || ch === '\n') return finish(resolve, pw);
      if (ch === ETX) return finish(reject, new Error('ยกเลิกแล้ว — ไม่ได้แก้ไฟล์ .env'));
      if (ch === DEL || ch === '\b') {
        if (pw.length) { pw = pw.slice(0, -1); process.stdout.write('\b \b'); }
        continue;
      }
      if (ch < ' ') continue;                 // ข้ามอักขระควบคุมอื่น ๆ
      pw += ch;
      process.stdout.write('*');              // แสดง * ให้เห็นว่าพิมพ์ติดกี่ตัว
    }
  };
  process.stdin.on('data', onKey);
});

let pw;
try {
  pw = (await askHidden('รหัสผ่านฐานข้อมูลใหม่: ')).trim();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
if (!pw) {
  console.error('❌ ไม่ได้กรอกรหัสผ่าน — ยกเลิก');
  process.exit(1);
}
console.log(`(รับมา ${pw.length} ตัวอักษร)`);

const encoded = encodeURIComponent(pw);
const url = `${scheme}${user}:${encoded}@${rest}`;
if (encoded !== pw) console.log('(มีอักขระพิเศษ — เข้ารหัสให้แล้ว)');

// ทดสอบก่อนบันทึก
process.stdout.write('\nกำลังทดสอบเชื่อมต่อ… ');
const pg = (await import('pg')).default;
const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15_000,
});
try {
  await client.connect();
  await client.query('SELECT 1');
  await client.end();
  console.log('สำเร็จ ✅');
} catch (err) {
  console.log('ไม่สำเร็จ ❌');
  console.error(`   ${err.message}`);
  if (/password authentication failed/i.test(err.message))
    console.error(`
➜ รหัสผ่านไม่ถูกต้อง — ไม่ได้แก้ไฟล์ .env

   ตรวจสอบว่า:
   • คัดลอกรหัสจาก Supabase มาครบ ไม่มีช่องว่างหน้า/หลัง
   • ถ้าเพิ่งกด Reset password ต้องรอสักครู่ให้ระบบอัปเดต แล้วลองใหม่
   • จำนวนตัวอักษรที่ระบบรับมา (แสดงไว้ด้านบน) ตรงกับรหัสจริงหรือไม่`);
  process.exit(1);
}

writeFileSync(ENV, env.replace(line, `DATABASE_URL=${url}`));
chmodSync(ENV, 0o600);
console.log('บันทึกลง .env เรียบร้อย — รัน `npm start` ได้เลย');
