// ใส่/เปลี่ยนรหัสผ่านฐานข้อมูลใน .env อย่างปลอดภัย
//
// ใช้งาน:  npm run set-password
//
// - พิมพ์รหัสผ่านแบบไม่แสดงบนหน้าจอ และไม่ตกไปอยู่ใน shell history
// - เข้ารหัสอักขระพิเศษ (@ : / # ? ฯลฯ) ให้อัตโนมัติ
// - ทดสอบเชื่อมต่อทันทีก่อนบันทึกจริง — ถ้าต่อไม่ได้จะไม่แก้ไฟล์
import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

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

/** อ่านรหัสผ่านโดยไม่แสดงตัวอักษรบนหน้าจอ */
const askHidden = (prompt) => new Promise((resolve) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const onData = (ch) => {
    // ระหว่างพิมพ์ ให้ลบสิ่งที่ echo ออกมาทิ้ง
    if (![`\n`, `\r`, ``].includes(ch.toString())) {
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
      process.stdout.write(prompt);
    }
  };
  process.stdin.on('data', onData);
  rl.question(prompt, (answer) => {
    process.stdin.removeListener('data', onData);
    rl.close();
    process.stdout.write('\n');
    resolve(answer);
  });
});

const pw = (await askHidden('รหัสผ่านฐานข้อมูลใหม่: ')).trim();
if (!pw) {
  console.error('❌ ไม่ได้กรอกรหัสผ่าน — ยกเลิก');
  process.exit(1);
}

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
    console.error('\n➜ รหัสผ่านไม่ถูกต้อง — ไม่ได้แก้ไฟล์ .env ลองใหม่อีกครั้ง');
  process.exit(1);
}

writeFileSync(ENV, env.replace(line, `DATABASE_URL=${url}`));
chmodSync(ENV, 0o600);
console.log('บันทึกลง .env เรียบร้อย — รัน `npm start` ได้เลย');
