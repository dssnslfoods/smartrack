// นำเข้าข้อมูลผู้ให้บริการขนส่งจากไฟล์ Excel ที่ทีมขายใช้จริง
//
//   node server/import-carriers.js "/path/to/ร้าน focus ใช้ขนส่งนอก.xlsx"
//
// คอลัมน์ที่ต้องมี (ตรวจจากหัวตาราง ไม่ยึดตำแหน่งคอลัมน์ตายตัว):
//   รหัสลูกค้า · ร้าน · จังหวัด · อำเภอ · ขนส่ง
//
// รันซ้ำได้ — ล้างเฉพาะข้อมูลที่มาจากการนำเข้า (source='IMPORT') แล้วใส่ใหม่
// ข้อมูลที่ผู้ใช้เพิ่มเองในระบบ (source='MANUAL') จะไม่ถูกแตะต้อง
import './lib/env.js';
import { readFileSync } from 'node:fs';
import { all, get, run, tx, close } from './lib/db.js';

// ---------------------------------------------------------------- อ่าน .xlsx
// อ่านเองด้วย unzip + parse XML เพื่อไม่ต้องเพิ่ม dependency ให้ระบบ production
import { execFileSync } from 'node:child_process';

function readSheet(path) {
  const xml = (name) => execFileSync('unzip', ['-p', path, name], { maxBuffer: 64 * 1024 * 1024 }).toString('utf8');

  // sharedStrings เก็บข้อความทั้งหมด เซลล์ชนิด s จะอ้างเป็น index
  let shared = [];
  try {
    const ss = xml('xl/sharedStrings.xml');
    shared = [...ss.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
      [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''));
  } catch { /* บางไฟล์ฝังข้อความไว้ในเซลล์เลย ไม่มี sharedStrings */ }

  const unesc = (s) => s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

  const sheet = xml('xl/worksheets/sheet1.xml');
  const rows = [];
  for (const rm of sheet.matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = {};
    for (const cm of rm[2].matchAll(/<c[^>]*r="([A-Z]+)\d+"([^>]*)>([\s\S]*?)<\/c>/g)) {
      const [, col, attrs, body] = cm;
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      const inline = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('');
      let val = inline || v || '';
      if (/t="s"/.test(attrs) && v !== undefined) val = shared[Number(v)] ?? '';
      cells[col] = unesc(String(val)).trim();
    }
    rows.push(cells);
  }
  return rows;
}

// ---------------------------------------------------------------- ทำความสะอาดข้อมูล
/** ชื่อจังหวัดในไฟล์เขียนย่อบ้าง — เทียบให้ตรงกับชื่อเต็มที่คนทั่วไปกรอก */
const PROVINCE_FIX = {
  'นครศรี': 'นครศรีธรรมราช',
  'สุราษ': 'สุราษฎร์ธานี',
  'อยุธยา': 'พระนครศรีอยุธยา',
  'กทม': 'กรุงเทพมหานคร',
  'กรุงเทพ': 'กรุงเทพมหานคร',
};
export const normProvince = (s) => {
  const t = String(s ?? '').replace(/^จ\.?\s*|^จังหวัด\s*/g, '').trim();
  return PROVINCE_FIX[t] ?? t;
};
export const normDistrict = (s) =>
  String(s ?? '').replace(/^อ\.?\s*|^อำเภอ\s*|^เขต\s*/g, '').trim();

/** สร้างรหัสย่อจากชื่อขนส่ง เช่น "ขนส่ง B&W" → BW · "ขนส่ง อ่าวไทย" → AOTHAI */
const TH2EN = {
  'อ่าวไทย': 'AOTHAI', 'โกโลด': 'KOLOD', 'โกหมาย': 'KOMAI',
  'ซุปเปอร์ชีป': 'SUPERCHEAP', 'นิ่มซี่เส็ง': 'NIM', 'เคอรี่': 'KERRY', 'แฟลช': 'FLASH',
};
function carrierCode(name) {
  const core = String(name).replace(/^ขนส่ง\s*/, '').trim();
  if (TH2EN[core]) return TH2EN[core];
  const ascii = core.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (ascii) return ascii.slice(0, 20);
  // ชื่อไทยล้วนที่ไม่รู้จัก — ใช้ตัวอักษรไทยไปก่อน ผู้ใช้แก้รหัสเองได้ภายหลัง
  return core.replace(/\s+/g, '').slice(0, 20);
}

// ---------------------------------------------------------------- นำเข้า
export async function importCarriers(path) {
  const rows = readSheet(path);
  if (!rows.length) throw new Error('ไม่พบข้อมูลในไฟล์');

  // หาแถวหัวตารางแล้วจับคอลัมน์จากชื่อ ไม่ยึดว่าต้องเป็น A B C ตายตัว
  const want = { code: 'รหัสลูกค้า', name: 'ร้าน', province: 'จังหวัด', district: 'อำเภอ', carrier: 'ขนส่ง' };
  let head = null;
  let headIdx = -1;
  for (const [i, r] of rows.entries()) {
    const hit = {};
    for (const [key, label] of Object.entries(want))
      for (const [col, val] of Object.entries(r)) if (val === label) hit[key] = col;
    if (Object.keys(hit).length >= 4) { head = hit; headIdx = i; break; }
  }
  if (!head) throw new Error(`ไม่พบหัวตาราง — ต้องมีคอลัมน์: ${Object.values(want).join(', ')}`);

  const data = rows.slice(headIdx + 1)
    .map((r) => ({
      customer_code: (r[head.code] ?? '').trim() || null,
      customer_name: (r[head.name] ?? '').trim(),
      province: normProvince(r[head.province]),
      district: normDistrict(r[head.district]) || null,
      carrier_name: (r[head.carrier] ?? '').trim(),
    }))
    .filter((r) => r.customer_name && r.province && r.carrier_name);

  if (!data.length) throw new Error('อ่านหัวตารางได้ แต่ไม่มีแถวข้อมูลที่ครบถ้วน');

  const names = [...new Set(data.map((r) => r.carrier_name))];

  const result = await tx(async () => {
    // ล้างเฉพาะของที่นำเข้ามา ไม่แตะข้อมูลที่ผู้ใช้เพิ่มเอง
    await run("DELETE FROM carrier_customers WHERE source = 'IMPORT'");
    await run("DELETE FROM carrier_areas WHERE source = 'IMPORT'");

    const idOf = new Map();
    for (const name of names) {
      const code = carrierCode(name);
      const exist = await get('SELECT carrier_id FROM carriers WHERE carrier_name = ? OR carrier_code = ?', name, code);
      if (exist) {
        idOf.set(name, exist.carrier_id);
      } else {
        const r = await run('INSERT INTO carriers (carrier_code, carrier_name, note) VALUES (?,?,?)',
          code, name, 'นำเข้าจากไฟล์ Excel ของทีมขาย');
        idOf.set(name, Number(r.lastInsertRowid));
      }
    }

    for (const r of data) {
      await run(
        `INSERT INTO carrier_customers (customer_code, customer_name, province, district, carrier_id, source)
         VALUES (?,?,?,?,?,'IMPORT')`,
        r.customer_code, r.customer_name, r.province, r.district, idOf.get(r.carrier_name));
    }

    // สรุปเป็นกฎพื้นที่: จังหวัด+อำเภอไหนใช้เจ้าไหนบ่อยสุด priority ยิ่งน้อยยิ่งถูกเลือกก่อน
    // อำเภอเจาะจงกว่าจังหวัด จึงให้ priority ต่ำกว่า
    const byArea = new Map();
    for (const r of data) {
      for (const [key, district, prio] of [
        [`${r.province}|${r.district ?? ''}`, r.district, 10],
        [`${r.province}|`, null, 50],
      ]) {
        const k = `${key}|${idOf.get(r.carrier_name)}`;
        const cur = byArea.get(k) ?? { province: r.province, district, carrier_id: idOf.get(r.carrier_name), prio, n: 0 };
        cur.n += 1;
        byArea.set(k, cur);
      }
    }
    for (const a of byArea.values()) {
      if (a.district === null && !a.province) continue;
      await run(
        `INSERT INTO carrier_areas (carrier_id, province, district, priority, source, note)
         VALUES (?,?,?,?,'IMPORT',?)`,
        a.carrier_id, a.province, a.district, a.prio, `จากข้อมูลจริง ${a.n} ร้าน`);
    }

    return {
      carriers: names.length,
      customers: data.length,
      areas: byArea.size,
    };
  });

  return { ...result, carrier_names: names };
}

// ---------------------------------------------------------------- เรียกจาก CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2];
  if (!path) {
    console.error('ใช้: node server/import-carriers.js "<ไฟล์ .xlsx>"');
    process.exit(1);
  }
  readFileSync(path);   // ให้ error ชัดถ้าไฟล์ไม่มีจริง
  const r = await importCarriers(path);
  console.log(`นำเข้าเรียบร้อย — ขนส่ง ${r.carriers} เจ้า · ลูกค้า ${r.customers} ร้าน · กฎพื้นที่ ${r.areas} ข้อ`);
  console.log('ขนส่ง:', r.carrier_names.join(', '));
  const rows = await all(
    `SELECT c.carrier_name, COUNT(*) AS n FROM carrier_customers cc
       JOIN carriers c ON c.carrier_id = cc.carrier_id GROUP BY c.carrier_name ORDER BY n DESC`);
  for (const x of rows) console.log(`  ${x.carrier_name}: ${x.n} ร้าน`);
  await close();
}
