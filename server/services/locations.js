// โครงสร้างตำแหน่งจัดเก็บ: สร้างรหัสตำแหน่งอัตโนมัติ และแผนผังชั้นวาง
import { all, get, run, tx } from '../lib/db.js';
import { conflict, notFound } from '../lib/http.js';

export const locationCode = (zoneCode, ragNo, level, depth) => `${zoneCode}-${ragNo}-L${level}-D${depth}`;

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
      await run('INSERT INTO locations (location_code, rag_id, level, depth) VALUES (?,?,?,?)',
        locationCode(rag.zone_code, rag.rag_no, lv, dp), ragId, lv, dp);
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
    `SELECT l.*, r.rag_no, r.rag_id, z.zone_id, z.zone_code, z.zone_name
       FROM locations l JOIN rags r ON r.rag_id = l.rag_id JOIN zones z ON z.zone_id = r.zone_id
      WHERE UPPER(l.location_code) = UPPER(?)`,
    code,
  );

/** ตำแหน่งว่างที่พร้อมจัดเก็บ (ใช้ในหน้าจัดเก็บสินค้า) */
export const emptyLocations = async ({ zoneId = null, ragId = null, limit = 300 } = {}) =>
  await all(
    `SELECT l.location_id, l.location_code, l.level, l.depth,
            r.rag_id, r.rag_no, z.zone_id, z.zone_code, z.zone_name
       FROM locations l
       JOIN rags r ON r.rag_id = l.rag_id AND r.status = 'ACTIVE'
       JOIN zones z ON z.zone_id = r.zone_id AND z.status = 'ACTIVE'
      WHERE l.status = 'EMPTY'
        ${zoneId ? 'AND z.zone_id = ?' : ''} ${ragId ? 'AND r.rag_id = ?' : ''}
      ORDER BY z.zone_code, r.rag_no, l.level, l.depth
      LIMIT ?`,
    ...[zoneId, ragId].filter(Boolean),
    limit,
  );
