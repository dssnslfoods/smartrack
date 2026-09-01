// โครงสร้างตำแหน่งจัดเก็บ: สร้างรหัสตำแหน่งอัตโนมัติ และแผนผังชั้นวาง
import { all, get, run, tx } from '../lib/db.js';
import { conflict, notFound } from '../lib/http.js';

export const locationCode = (zoneCode, ragNo, level, depth) => `${zoneCode}-${ragNo}-L${level}-D${depth}`;

/** รหัสช่องวางบนพื้นราบ — ไม่มีชั้น/ตอน ใช้เลขช่องล้วน เช่น FLR-01 */
export const floorCode = (zoneCode, slot) => `${zoneCode}-${String(slot).padStart(2, '0')}`;

/**
 * สร้าง/ปรับช่องวางของโซนพื้นราบ (FLOOR) หรือพื้นที่เศษ (BREAK) ให้ตรงกับจำนวนช่องที่ตั้งไว้
 * โซนพวกนี้ไม่มีชั้นวาง จึงผูกตำแหน่งกับโซนตรง ๆ และใช้ slot_no แทน level/depth
 * ช่องที่ถูกตัดออกจะลบได้เฉพาะเมื่อไม่มีสินค้าอยู่ (กติกาเดียวกับชั้นวาง)
 */
export async function syncFloorLocations(zoneId, slots) {
  const zone = await get('SELECT * FROM zones WHERE zone_id = ?', Number(zoneId));
  if (!zone) throw notFound('ไม่พบโซน');
  if (zone.zone_type === 'RACK') throw conflict('โซนแบบชั้นวางต้องสร้างตำแหน่งผ่านชั้นวาง ไม่ใช่ช่องพื้นราบ');

  const want = Math.max(0, Number(slots) || 0);
  const existing = await all('SELECT * FROM locations WHERE zone_id = ? AND rag_id IS NULL ORDER BY slot_no', Number(zoneId));

  const toRemove = existing.filter((l) => l.slot_no > want);
  const occupied = toRemove.filter((l) => l.status === 'OCCUPIED');
  if (occupied.length)
    throw conflict(`ลดจำนวนช่องไม่ได้ — ยังมีสินค้าอยู่ที่ ${occupied.map((l) => l.location_code).join(', ')}`);

  await tx(async () => {
    for (const l of toRemove) await run('DELETE FROM locations WHERE location_id = ?', l.location_id);
    const have = new Set(existing.filter((l) => l.slot_no <= want).map((l) => l.slot_no));
    for (let n = 1; n <= want; n++) {
      if (have.has(n)) continue;
      await run('INSERT INTO locations (location_code, rag_id, zone_id, level, depth, slot_no) VALUES (?,NULL,?,0,0,?)',
        floorCode(zone.zone_code, n), Number(zoneId), n);
    }
    // เปลี่ยนรหัสโซนแล้วรหัสช่องต้องตามไปด้วย
    for (const l of await all('SELECT * FROM locations WHERE zone_id = ? AND rag_id IS NULL', Number(zoneId))) {
      const code = floorCode(zone.zone_code, l.slot_no);
      if (code !== l.location_code) await run('UPDATE locations SET location_code = ? WHERE location_id = ?', code, l.location_id);
    }
  });
  return await all('SELECT * FROM locations WHERE zone_id = ? AND rag_id IS NULL ORDER BY slot_no', Number(zoneId));
}

/**
 * สร้าง/ปรับตำแหน่งของชั้นวางให้ตรงกับจำนวนชั้น × ความลึกปัจจุบัน
 * เช่น 4 ชั้น × 6 ตอน → 24 ตำแหน่ง (FG-A01-L1-D1 … FG-A01-L4-D6)
 * ตำแหน่งที่ถูกตัดออกจะลบได้เฉพาะเมื่อไม่มีสินค้าอยู่
 */
export async function syncRagLocations(ragId) {
  const rag = await get(
    'SELECT r.*, z.zone_code FROM rags r JOIN zones z ON z.zone_id = r.zone_id WHERE r.rag_id = ?',
    ragId,
  );
  if (!rag) throw notFound('ไม่พบชั้นวาง');

  const existing = await all('SELECT * FROM locations WHERE rag_id = ?', ragId);
  const wanted = new Set();
  for (let lv = 1; lv <= rag.total_levels; lv++)
    for (let dp = 1; dp <= rag.total_depths; dp++) wanted.add(`${lv}:${dp}`);

  const toRemove = existing.filter((l) => !wanted.has(`${l.level}:${l.depth}`));
  const occupied = toRemove.filter((l) => l.status === 'OCCUPIED');
  if (occupied.length)
    throw conflict(`ลดขนาดชั้นวางไม่ได้ — ยังมีสินค้าอยู่ที่ ${occupied.map((l) => l.location_code).join(', ')}`);

  const have = new Set(existing.map((l) => `${l.level}:${l.depth}`));
  const toCreate = [...wanted].filter((k) => !have.has(k)).map((k) => k.split(':').map(Number));

  await tx(async () => {
    for (const l of toRemove) await run('DELETE FROM locations WHERE location_id = ?', l.location_id);
    for (const [lv, dp] of toCreate)
      await run('INSERT INTO locations (location_code, rag_id, zone_id, level, depth) VALUES (?,?,?,?,?)',
        locationCode(rag.zone_code, rag.rag_no, lv, dp), ragId, rag.zone_id, lv, dp);
    // โซนของชั้นวางอาจถูกย้าย — ตำแหน่งต้องตามไปด้วย ไม่งั้นค้นหาตามโซนจะผิด
    await run('UPDATE locations SET zone_id = ? WHERE rag_id = ?', rag.zone_id, ragId);
    // ปรับรหัสตำแหน่งเมื่อเปลี่ยนรหัสโซนหรือเลขชั้นวาง
    for (const l of await all('SELECT * FROM locations WHERE rag_id = ?', ragId)) {
      const code = locationCode(rag.zone_code, rag.rag_no, l.level, l.depth);
      if (code !== l.location_code) await run('UPDATE locations SET location_code = ? WHERE location_id = ?', code, l.location_id);
    }
  });

  return { created: toCreate.length, removed: toRemove.length, total: wanted.size };
}

/** สถานะวันหมดอายุ — ใช้แสดงสีบนแผนผังและในผลค้นหา (เว้นว่างได้ถ้าไม่ระบุวันหมดอายุ) */
export function expiryState(days) {
  if (days === null || days === undefined) return null;
  if (days < 0) return { code: 'EXPIRED', label: 'หมดอายุแล้ว', color: 'red' };
  if (days < 30) return { code: 'CRITICAL', label: `เหลือ ${days} วัน`, color: 'red' };
  if (days < 90) return { code: 'WARNING', label: `เหลือ ${days} วัน`, color: 'amber' };
  return { code: 'OK', label: `เหลือ ${days} วัน`, color: 'blue' };
}

/** แผนผังชั้นวาง 1 ตัว: ตารางชั้น × ความลึก พร้อมสินค้าที่อยู่ในแต่ละช่อง */
export async function rackMap(ragId) {
  const rag = await get(
    `SELECT r.*, z.zone_code, z.zone_name, z.zone_id FROM rags r
       JOIN zones z ON z.zone_id = r.zone_id WHERE r.rag_id = ?`,
    ragId,
  );
  if (!rag) throw notFound('ไม่พบชั้นวาง');

  const cells = (await all(
    `SELECT l.location_id, l.location_code, l.level, l.depth, l.status,
            i.item_id, i.lot_no, i.exp_date, i.quantity, i.stored_at, i.note,
            s.sku_code, s.sku_name, s.unit,
            CASE WHEN i.exp_date IS NULL THEN NULL
                 ELSE (i.exp_date::date - (now() AT TIME ZONE 'Asia/Bangkok')::date) END AS days_to_expiry
       FROM locations l
       LEFT JOIN stock_items i ON i.location_id = l.location_id AND i.status = 'IN_STOCK'
       LEFT JOIN skus s ON s.sku_id = i.sku_id
      WHERE l.rag_id = ?
      ORDER BY l.level DESC, l.depth ASC`,
    ragId,
  )).map((c) => ({ ...c, expiry: expiryState(c.days_to_expiry) }));

  return { rag, cells, stats: countStats(cells) };
}

export function countStats(cells) {
  const usable = cells.filter((c) => c.status !== 'DISABLED').length;
  const occupied = cells.filter((c) => c.status === 'OCCUPIED').length;
  return {
    total: cells.length,
    usable,
    occupied,
    empty: cells.filter((c) => c.status === 'EMPTY').length,
    usage_pct: usable ? Math.round((occupied / usable) * 1000) / 10 : 0,
  };
}

export const locationByCode = async (code) =>
  await get(
    `SELECT l.*, r.rag_no, r.rag_id, z.zone_id, z.zone_code, z.zone_name, z.zone_type
       FROM locations l
       JOIN zones z ON z.zone_id = l.zone_id
       LEFT JOIN rags r ON r.rag_id = l.rag_id
      WHERE UPPER(l.location_code) = UPPER(?)`,
    code,
  );

/** ตำแหน่งว่างที่พร้อมจัดเก็บ (ใช้ในหน้าจัดเก็บสินค้า) */
// ตำแหน่งว่างมีได้ทั้งบนชั้นวางและพื้นราบ จึง LEFT JOIN rags และเอาโซนจาก locations ตรง ๆ
export const emptyLocations = async ({ zoneId = null, ragId = null, limit = 300 } = {}) =>
  await all(
    `SELECT l.location_id, l.location_code, l.level, l.depth, l.slot_no,
            r.rag_id, r.rag_no, z.zone_id, z.zone_code, z.zone_name, z.zone_type
       FROM locations l
       JOIN zones z ON z.zone_id = l.zone_id AND z.status = 'ACTIVE'
       LEFT JOIN rags r ON r.rag_id = l.rag_id
      WHERE l.status = 'EMPTY'
        AND (l.rag_id IS NULL OR r.status = 'ACTIVE')
        ${zoneId ? 'AND z.zone_id = ?' : ''} ${ragId ? 'AND r.rag_id = ?' : ''}
      ORDER BY z.zone_code, r.rag_no NULLS FIRST, l.slot_no, l.level, l.depth
      LIMIT ?`,
    ...[zoneId, ragId].filter(Boolean),
    limit,
  );
