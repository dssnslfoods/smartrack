// ผู้ให้บริการขนส่ง + แนะนำขนส่งจากที่อยู่ลูกค้า
//
// ลำดับการเดา (จากแม่นที่สุดลงไป) — ทุกชั้นคำนวณจากฐานข้อมูลล้วน ไม่ใช้ AI
//   1. รหัสลูกค้าตรงกัน            → เจ้าที่ลูกค้ารายนี้เคยใช้
//   2. ชื่อลูกค้าตรงกัน             → เช่นเดียวกัน (เผื่อไม่ได้กรอกรหัส)
//   3. กฎพื้นที่ จังหวัด+อำเภอ      → priority น้อยสุดชนะ
//   4. กฎพื้นที่ ทั้งจังหวัด
// ถ้ายังไม่เจอ ค่อยให้ AI ช่วยเดาโดยอ้างอิงพื้นที่ให้บริการที่มีอยู่จริงเป็นหลัก
// (ดู suggestCarrierAI ใน services/ai.js) — AI แนะนำได้ แต่ไม่บันทึกอะไรเอง
import { all, get, run, tx } from '../lib/db.js';
import { badRequest, conflict, notFound } from '../lib/http.js';
import { normProvince, normDistrict } from '../import-carriers.js';

export { normProvince, normDistrict };

export const listCarriers = () =>
  all(`SELECT c.*,
              (SELECT COUNT(*) FROM carrier_customers cc WHERE cc.carrier_id = c.carrier_id) AS customer_count,
              (SELECT COUNT(*) FROM carrier_areas a WHERE a.carrier_id = c.carrier_id) AS area_count
         FROM carriers c ORDER BY c.status, c.carrier_name`);

export async function carrierDetail(id) {
  const carrier = await get('SELECT * FROM carriers WHERE carrier_id = ?', Number(id));
  if (!carrier) throw notFound('ไม่พบผู้ให้บริการขนส่ง');
  return {
    carrier,
    areas: await all('SELECT * FROM carrier_areas WHERE carrier_id = ? ORDER BY province, district NULLS FIRST', Number(id)),
    customers: await all('SELECT * FROM carrier_customers WHERE carrier_id = ? ORDER BY province, district, customer_name', Number(id)),
  };
}

export async function createCarrier(body) {
  const code = String(body.carrier_code ?? '').trim().toUpperCase();
  const name = String(body.carrier_name ?? '').trim();
  if (!code || !name) throw badRequest('กรุณากรอกรหัสและชื่อผู้ให้บริการขนส่ง');
  if (await get('SELECT 1 FROM carriers WHERE carrier_code = ?', code)) throw conflict('รหัสนี้ถูกใช้แล้ว');
  const r = await run('INSERT INTO carriers (carrier_code, carrier_name, phone, note) VALUES (?,?,?,?)',
    code, name, body.phone?.trim() || null, body.note?.trim() || null);
  return await get('SELECT * FROM carriers WHERE carrier_id = ?', Number(r.lastInsertRowid));
}

export async function updateCarrier(id, body) {
  const c = await get('SELECT * FROM carriers WHERE carrier_id = ?', Number(id));
  if (!c) throw notFound('ไม่พบผู้ให้บริการขนส่ง');
  const code = String(body.carrier_code ?? c.carrier_code).trim().toUpperCase();
  if (await get('SELECT 1 FROM carriers WHERE carrier_code = ? AND carrier_id <> ?', code, Number(id)))
    throw conflict('รหัสนี้ถูกใช้แล้ว');
  await run('UPDATE carriers SET carrier_code=?, carrier_name=?, phone=?, note=?, status=? WHERE carrier_id=?',
    code, String(body.carrier_name ?? c.carrier_name).trim(),
    body.phone !== undefined ? (body.phone?.trim() || null) : c.phone,
    body.note !== undefined ? (body.note?.trim() || null) : c.note,
    body.status ?? c.status, Number(id));
  return await get('SELECT * FROM carriers WHERE carrier_id = ?', Number(id));
}

export async function deleteCarrier(id) {
  const c = await get('SELECT * FROM carriers WHERE carrier_id = ?', Number(id));
  if (!c) throw notFound('ไม่พบผู้ให้บริการขนส่ง');
  const used = await get('SELECT COUNT(*) AS n FROM documents WHERE carrier_id = ?', Number(id));
  if (Number(used.n) > 0)
    throw conflict(`ลบไม่ได้ — มีเอกสารจ่ายออก ${used.n} ใบใช้ขนส่งเจ้านี้อยู่ ปิดใช้งานแทนได้`);
  await run('DELETE FROM carriers WHERE carrier_id = ?', Number(id));
  return { ok: true };
}

// ---------------------------------------------------------------- พื้นที่ให้บริการ
export async function saveArea(body) {
  const carrierId = Number(body.carrier_id);
  if (!await get('SELECT 1 FROM carriers WHERE carrier_id = ?', carrierId)) throw notFound('ไม่พบผู้ให้บริการขนส่ง');
  const province = normProvince(body.province);
  if (!province) throw badRequest('กรุณาระบุจังหวัด');
  const district = normDistrict(body.district) || null;

  const dup = await get(
    `SELECT area_id FROM carrier_areas WHERE carrier_id = ? AND province = ?
      AND district IS NOT DISTINCT FROM ?`, carrierId, province, district);
  if (dup) {
    await run('UPDATE carrier_areas SET priority=?, note=?, source=? WHERE area_id=?',
      Number(body.priority) || 100, body.note?.trim() || null, 'MANUAL', dup.area_id);
    return await get('SELECT * FROM carrier_areas WHERE area_id = ?', dup.area_id);
  }
  const r = await run(
    `INSERT INTO carrier_areas (carrier_id, province, district, priority, source, note)
     VALUES (?,?,?,?,'MANUAL',?)`,
    carrierId, province, district, Number(body.priority) || 100, body.note?.trim() || null);
  return await get('SELECT * FROM carrier_areas WHERE area_id = ?', Number(r.lastInsertRowid));
}

export async function deleteArea(id) {
  const a = await get('SELECT * FROM carrier_areas WHERE area_id = ?', Number(id));
  if (!a) throw notFound('ไม่พบพื้นที่ให้บริการ');
  await run('DELETE FROM carrier_areas WHERE area_id = ?', Number(id));
  return { ok: true };
}

/** จังหวัด/อำเภอที่มีข้อมูลอยู่แล้ว — ใช้เติมช่องกรอกที่อยู่ให้พิมพ์น้อยลง */
export const knownAreas = () =>
  all(`SELECT province, district, COUNT(*) AS n FROM carrier_customers
        GROUP BY province, district ORDER BY province, district`);

// ---------------------------------------------------------------- แนะนำขนส่ง
/**
 * แนะนำผู้ให้บริการขนส่งจากที่อยู่ผู้รับ — คำนวณจากฐานข้อมูลล้วน
 * คืน candidates เรียงจากมั่นใจมากไปน้อย พร้อมเหตุผลว่าทำไมถึงเสนอเจ้านั้น
 * ไม่พบเลยจะได้ candidates ว่าง แล้วให้ชั้น AI ช่วยต่อ
 */
export async function suggestCarrier({ customer_code, customer_name, province, district } = {}) {
  const prov = normProvince(province);
  const dist = normDistrict(district) || null;
  // ชื่อลูกค้าในเอกสารเก็บเป็น "ชื่อร้าน (รหัส)" — แยกรหัสออกมาใช้ด้วย จะได้แม่นขึ้น
  const raw = String(customer_name ?? '').trim();
  const embedded = /\(([A-Za-z]{1,4}\d{3,})\)\s*$/.exec(raw);
  const code = String(customer_code ?? '').trim() || embedded?.[1] || null;
  const name = (embedded ? raw.slice(0, embedded.index).trim() : raw) || null;

  const found = new Map();   // carrier_id → รายการที่ดีที่สุดของเจ้านั้น
  const add = (row, confidence, reason, score) => {
    const cur = found.get(row.carrier_id);
    if (cur && cur.score <= score) return;
    found.set(row.carrier_id, {
      carrier_id: row.carrier_id, carrier_code: row.carrier_code, carrier_name: row.carrier_name,
      confidence, reason, score,
    });
  };

  const sel = `SELECT c.carrier_id, c.carrier_code, c.carrier_name`;

  // 1) ลูกค้ารายนี้เคยส่งด้วยเจ้าไหน — แม่นที่สุด
  if (code) {
    for (const r of await all(
      `${sel}, cc.customer_name FROM carrier_customers cc JOIN carriers c ON c.carrier_id = cc.carrier_id
        WHERE cc.customer_code = ? AND c.status = 'ACTIVE'`, code))
      add(r, 'HIGH', `ลูกค้ารหัส ${code} เคยส่งด้วยเจ้านี้`, 1);
  }
  if (!found.size && name) {
    for (const r of await all(
      `${sel} FROM carrier_customers cc JOIN carriers c ON c.carrier_id = cc.carrier_id
        WHERE cc.customer_name = ? AND c.status = 'ACTIVE'`, name))
      add(r, 'HIGH', `ร้าน "${name}" เคยส่งด้วยเจ้านี้`, 2);
  }

  // 2) กฎพื้นที่ — อำเภอเจาะจงก่อน แล้วค่อยทั้งจังหวัด
  // เจ้าที่มีลูกค้าจริงในพื้นที่นั้นมากกว่า ควรถูกเสนอก่อนเมื่อ priority เท่ากัน
  // (เช่น สงขลา: B&W ส่งอยู่ 5 ร้าน ส่วนโกหมาย 1 ร้าน — ควรเสนอ B&W ก่อน)
  const evidence = `(SELECT COUNT(*) FROM carrier_customers cc
                      WHERE cc.carrier_id = c.carrier_id AND cc.province = a.province
                        AND (a.district IS NULL OR cc.district = a.district)) AS uses`;
  if (prov) {
    if (dist) {
      for (const r of await all(
        `${sel}, a.priority, a.note, ${evidence}
           FROM carrier_areas a JOIN carriers c ON c.carrier_id = a.carrier_id
          WHERE a.province = ? AND a.district = ? AND c.status = 'ACTIVE'
          ORDER BY a.priority, uses DESC`, prov, dist))
        add(r, 'HIGH', `ให้บริการ ${dist} ${prov}${r.note ? ` (${r.note})` : ''}`,
          10 + (r.priority ?? 100) / 1000 - Math.min(Number(r.uses) || 0, 999) / 1e6);
    }
    for (const r of await all(
      `${sel}, a.priority, a.note, ${evidence}
         FROM carrier_areas a JOIN carriers c ON c.carrier_id = a.carrier_id
        WHERE a.province = ? AND a.district IS NULL AND c.status = 'ACTIVE'
        ORDER BY a.priority, uses DESC`, prov))
      add(r, dist ? 'MEDIUM' : 'HIGH', `ให้บริการทั่วจังหวัด${prov}${r.note ? ` (${r.note})` : ''}`,
        20 + (r.priority ?? 100) / 1000 - Math.min(Number(r.uses) || 0, 999) / 1e6);
  }

  const candidates = [...found.values()].sort((a, b) => a.score - b.score)
    .map(({ score, ...rest }) => rest);

  return {
    query: { customer_code: code, customer_name: name, province: prov, district: dist },
    candidates,
    matched: candidates.length > 0,
  };
}

/**
 * สรุปพื้นที่ให้บริการทั้งหมดเป็นข้อความสั้น ๆ — ใช้เป็นบริบทให้ AI ตอนต้องเดาพื้นที่ใหม่
 * ต้องมาจากฐานข้อมูลจริงเท่านั้น AI จะได้ไม่แต่งชื่อขนส่งที่ไม่มีอยู่
 */
export async function coverageSummary() {
  const rows = await all(
    `SELECT c.carrier_id, c.carrier_code, c.carrier_name,
            a.province, a.district, a.note
       FROM carrier_areas a JOIN carriers c ON c.carrier_id = a.carrier_id
      WHERE c.status = 'ACTIVE'
      ORDER BY c.carrier_name, a.province, a.district NULLS FIRST`);

  const byCarrier = new Map();
  for (const r of rows) {
    const cur = byCarrier.get(r.carrier_id) ?? {
      carrier_id: r.carrier_id, carrier_code: r.carrier_code, carrier_name: r.carrier_name, areas: [],
    };
    cur.areas.push(r.district ? `${r.district} ${r.province}` : `ทั่วจังหวัด${r.province}`);
    byCarrier.set(r.carrier_id, cur);
  }
  return [...byCarrier.values()];
}
