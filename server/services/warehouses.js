// คลังสินค้า + ผังพื้น (floor plan) — วางตำแหน่ง RACK บนตารางพื้นของแต่ละคลัง
import { all, get, run, tx } from '../lib/db.js';
import { badRequest, conflict, notFound } from '../lib/http.js';

/** รายการคลังสินค้าทั้งหมด พร้อมสถิติการใช้พื้นที่ */
export const listWarehouses = async () =>
  (await all(
    `SELECT w.*,
            (SELECT COUNT(*) FROM zones z WHERE z.warehouse_id = w.warehouse_id) AS zone_count,
            (SELECT COUNT(*) FROM rags r JOIN zones z ON z.zone_id = r.zone_id
              WHERE z.warehouse_id = w.warehouse_id) AS rack_count,
            (SELECT COUNT(*) FROM locations l JOIN rags r ON r.rag_id = l.rag_id
               JOIN zones z ON z.zone_id = r.zone_id
              WHERE z.warehouse_id = w.warehouse_id) AS total_locations,
            (SELECT COUNT(*) FROM locations l JOIN rags r ON r.rag_id = l.rag_id
               JOIN zones z ON z.zone_id = r.zone_id
              WHERE z.warehouse_id = w.warehouse_id AND l.status = 'OCCUPIED') AS occupied,
            (SELECT COUNT(*) FROM locations l JOIN rags r ON r.rag_id = l.rag_id
               JOIN zones z ON z.zone_id = r.zone_id
              WHERE z.warehouse_id = w.warehouse_id AND l.status = 'DISABLED') AS disabled
       FROM warehouses w ORDER BY w.wh_code`,
  )).map(withUsage);

function withUsage(w) {
  const usable = w.total_locations - w.disabled;
  return { ...w, usable, empty: usable - w.occupied, usage_pct: usable ? Math.round((w.occupied / usable) * 1000) / 10 : 0 };
}

export async function getWarehouse(id) {
  const w = await get('SELECT * FROM warehouses WHERE warehouse_id = ?', id);
  if (!w) throw notFound('ไม่พบคลังสินค้า');
  return w;
}

export async function createWarehouse(body) {
  requireFields(body, ['wh_code', 'wh_name']);
  const code = String(body.wh_code).trim().toUpperCase();
  if (await get('SELECT 1 FROM warehouses WHERE wh_code = ?', code)) throw conflict('รหัสคลังนี้ถูกใช้แล้ว');
  const r = await run(
    'INSERT INTO warehouses (wh_code, wh_name, address, grid_cols, grid_rows, note) VALUES (?,?,?,?,?,?)',
    code, String(body.wh_name).trim(), body.address?.trim() || null,
    clampGrid(body.grid_cols ?? 10), clampGrid(body.grid_rows ?? 8), body.note?.trim() || null,
  );
  return await getWarehouse(Number(r.lastInsertRowid));
}

export async function updateWarehouse(id, body) {
  const w = await getWarehouse(id);
  const code = String(body.wh_code ?? w.wh_code).trim().toUpperCase();
  const dup = await get('SELECT 1 FROM warehouses WHERE wh_code = ? AND warehouse_id <> ?', code, id);
  if (dup) throw conflict('รหัสคลังนี้ถูกใช้แล้ว');

  const cols = clampGrid(body.grid_cols ?? w.grid_cols);
  const rows = clampGrid(body.grid_rows ?? w.grid_rows);
  // ถ้าย่อขนาดผัง ต้องไม่มี RACK ตกขอบ (คำนึงถึงขนาดที่กินหลายช่อง)
  const placed = await all(
    `SELECT r.rag_no, r.pos_x, r.pos_y, r.total_levels, r.total_depths
       FROM rags r JOIN zones z ON z.zone_id = r.zone_id
      WHERE z.warehouse_id = ? AND r.pos_x IS NOT NULL`, id,
  );
  const outside = placed.filter((r) => {
    const s = rackSpan(r);
    return r.pos_x + s.cols > cols || r.pos_y + s.rows > rows;
  });
  if (outside.length)
    throw conflict(`ย่อขนาดผังไม่ได้ — มีชั้นวางอยู่นอกพื้นที่: ${outside.map((r) => r.rag_no).join(', ')}`);

  await run(
    'UPDATE warehouses SET wh_code=?, wh_name=?, address=?, grid_cols=?, grid_rows=?, note=?, status=? WHERE warehouse_id=?',
    code, String(body.wh_name ?? w.wh_name).trim(), body.address !== undefined ? body.address?.trim() || null : w.address,
    cols, rows, body.note !== undefined ? body.note?.trim() || null : w.note, body.status ?? w.status, id,
  );
  return await getWarehouse(id);
}

export async function deleteWarehouse(id) {
  await getWarehouse(id);
  const zones = (await get('SELECT COUNT(*) AS n FROM zones WHERE warehouse_id = ?', id)).n;
  if (zones) throw conflict('ลบคลังไม่ได้ — ยังมีโซนอยู่ในคลังนี้ กรุณาลบโซนก่อน');
  await run('DELETE FROM warehouses WHERE warehouse_id = ?', id);
  return { ok: true };
}

/**
 * ผังพื้นคลัง: ตารางพื้น + โซนของคลังนี้ + ชั้นวางพร้อมตำแหน่งบนผัง
 * ชั้นวางที่ยังไม่เคยกำหนดตำแหน่ง จะถูกวางลงช่องว่างอัตโนมัติ
 */
export async function warehouseLayout(id) {
  const warehouse = await getWarehouse(id);
  const zones = await all(
    `SELECT z.*, (SELECT COUNT(*) FROM rags r WHERE r.zone_id = z.zone_id) AS rack_count
       FROM zones z WHERE z.warehouse_id = ? ORDER BY z.zone_code`,
    id,
  );

  const racks = await all(
    `SELECT r.rag_id, r.rag_no, r.total_levels, r.total_depths, r.note, r.status, r.pos_x, r.pos_y,
            z.zone_id, z.zone_code, z.zone_name, z.color,
            (SELECT COUNT(*) FROM locations l WHERE l.rag_id = r.rag_id) AS total,
            (SELECT COUNT(*) FROM locations l WHERE l.rag_id = r.rag_id AND l.status='OCCUPIED') AS occupied,
            (SELECT COUNT(*) FROM locations l WHERE l.rag_id = r.rag_id AND l.status='DISABLED') AS disabled
       FROM rags r JOIN zones z ON z.zone_id = r.zone_id
      WHERE z.warehouse_id = ? ORDER BY z.zone_code, r.rag_no`,
    id,
  );

  autoPlace(racks, warehouse);

  for (const r of racks) {
    const usable = r.total - r.disabled;
    r.usable = usable;
    r.usage_pct = usable ? Math.round((r.occupied / usable) * 1000) / 10 : 0;
  }

  const allCells = await all(
    `SELECT l.rag_id, l.level, l.depth, l.status
       FROM locations l JOIN rags r ON r.rag_id = l.rag_id
       JOIN zones z ON z.zone_id = r.zone_id WHERE z.warehouse_id = ?`, id,
  );
  const cellsByRack = {};
  for (const c of allCells) (cellsByRack[c.rag_id] ??= []).push(c);
  for (const r of racks) r.cells = cellsByRack[r.rag_id] ?? [];

  return { warehouse, zones, racks };
}

/** วางชั้นวางที่ยังไม่มีตำแหน่ง ลงช่องว่างแรกที่พอดี (คำนึงถึงขนาดที่กินหลายช่อง) */
async function autoPlace(racks, warehouse) {
  const pending = racks.filter((r) => r.pos_x === null || r.pos_y === null);
  if (!pending.length) return;

  const taken = new Set();
  for (const r of racks) {
    if (r.pos_x === null || r.pos_y === null) continue;
    const s = rackSpan(r);
    for (let dy = 0; dy < s.rows; dy++)
      for (let dx = 0; dx < s.cols; dx++)
        taken.add(`${r.pos_x + dx}:${r.pos_y + dy}`);
  }

  await tx(async () => {
    for (const r of pending) {
      const s = rackSpan(r);
      let placed = false;
      for (let y = 0; !placed && y <= warehouse.grid_rows - s.rows; y++) {
        for (let x = 0; !placed && x <= warehouse.grid_cols - s.cols; x++) {
          let ok = true;
          for (let dy = 0; ok && dy < s.rows; dy++)
            for (let dx = 0; ok && dx < s.cols; dx++)
              if (taken.has(`${x + dx}:${y + dy}`)) ok = false;
          if (ok) {
            for (let dy = 0; dy < s.rows; dy++)
              for (let dx = 0; dx < s.cols; dx++)
                taken.add(`${x + dx}:${y + dy}`);
            r.pos_x = x; r.pos_y = y;
            await run('UPDATE rags SET pos_x=?, pos_y=? WHERE rag_id=?', x, y, r.rag_id);
            placed = true;
          }
        }
      }
    }
  });
}

/** ย้ายชั้นวางไปช่องอื่นบนผัง — ตรวจสอบการทับกันตามขนาดจริง */
export async function moveRack(ragId, { pos_x, pos_y }) {
  const rack = await get(
    `SELECT r.*, z.warehouse_id FROM rags r JOIN zones z ON z.zone_id = r.zone_id WHERE r.rag_id = ?`,
    ragId,
  );
  if (!rack) throw notFound('ไม่พบชั้นวาง');
  if (!rack.warehouse_id) throw badRequest('ชั้นวางนี้ยังไม่ได้อยู่ในคลังสินค้าใด');

  const w = await getWarehouse(rack.warehouse_id);
  const x = Number(pos_x);
  const y = Number(pos_y);
  const s = rackSpan(rack);
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 ||
      x + s.cols > w.grid_cols || y + s.rows > w.grid_rows)
    throw badRequest('ตำแหน่งอยู่นอกพื้นที่ผังคลัง');

  const others = await all(
    `SELECT r.rag_id, r.rag_no, r.pos_x, r.pos_y, r.total_levels, r.total_depths
       FROM rags r JOIN zones z ON z.zone_id = r.zone_id
      WHERE z.warehouse_id = ? AND r.rag_id <> ? AND r.pos_x IS NOT NULL`,
    rack.warehouse_id, ragId,
  );
  const conflicts = others.filter((o) => {
    const os = rackSpan(o);
    return x < o.pos_x + os.cols && x + s.cols > o.pos_x &&
           y < o.pos_y + os.rows && y + s.rows > o.pos_y;
  });

  if (conflicts.length > 1)
    throw conflict(`ตำแหน่งนี้ทับกับชั้นวางหลายตัว: ${conflicts.map((c) => c.rag_no).join(', ')}`);

  await tx(async () => {
    if (conflicts.length === 1) {
      const occ = conflicts[0];
      const os = rackSpan(occ);
      if (rack.pos_x + os.cols > w.grid_cols || rack.pos_y + os.rows > w.grid_rows)
        throw conflict(`สลับกับ ${occ.rag_no} ไม่ได้ — ไม่มีพื้นที่พอ`);
      await run('UPDATE rags SET pos_x=?, pos_y=? WHERE rag_id=?', rack.pos_x, rack.pos_y, occ.rag_id);
    }
    await run('UPDATE rags SET pos_x=?, pos_y=? WHERE rag_id=?', x, y, ragId);
  });

  return { rag_id: ragId, pos_x: x, pos_y: y, swapped_with: conflicts[0]?.rag_id ?? null };
}

/** ลบชั้นวาง — ได้เฉพาะเมื่อไม่มีสินค้าอยู่ */
export async function deleteRack(ragId) {
  const rack = await get('SELECT * FROM rags WHERE rag_id = ?', ragId);
  if (!rack) throw notFound('ไม่พบชั้นวาง');
  const occupied = (await get(
    "SELECT COUNT(*) AS n FROM locations WHERE rag_id = ? AND status = 'OCCUPIED'", ragId,
  )).n;
  if (occupied) throw conflict(`ลบชั้นวางไม่ได้ — ยังมีสินค้าอยู่ ${occupied} ตำแหน่ง`);

  // ประวัติการเคลื่อนย้ายลบไม่ได้ตามกฎของระบบ จึงลบตำแหน่งที่เคยมีประวัติไม่ได้ด้วย
  const used = (await get(
    `SELECT COUNT(*) AS n FROM movements m
      WHERE m.from_location_id IN (SELECT location_id FROM locations WHERE rag_id = ?)
         OR m.to_location_id   IN (SELECT location_id FROM locations WHERE rag_id = ?)`,
    ragId, ragId,
  )).n;
  if (used)
    throw conflict(
      `ลบชั้นวางไม่ได้ — มีประวัติการเคลื่อนย้าย ${used} รายการผูกอยู่ และประวัติลบไม่ได้ ` +
      'ถ้าไม่ใช้ชั้นวางนี้แล้ว ให้เปลี่ยนสถานะเป็น "ปิดใช้งาน" แทน',
    );

  await tx(async () => {
    await run('DELETE FROM locations WHERE rag_id = ?', ragId);
    await run('DELETE FROM rags WHERE rag_id = ?', ragId);
  });
  return { ok: true };
}

/** ลบโซน — ได้เฉพาะเมื่อไม่มีชั้นวางอยู่ */
export async function deleteZone(zoneId) {
  const z = await get('SELECT * FROM zones WHERE zone_id = ?', zoneId);
  if (!z) throw notFound('ไม่พบโซน');
  const racks = (await get('SELECT COUNT(*) AS n FROM rags WHERE zone_id = ?', zoneId)).n;
  if (racks) throw conflict('ลบโซนไม่ได้ — ยังมีชั้นวางอยู่ในโซนนี้');
  await run('DELETE FROM zones WHERE zone_id = ?', zoneId);
  return { ok: true };
}

const clampGrid = (v) => Math.max(1, Math.min(40, Number(v) || 1));

/** ขนาดบนผัง — ชั้นวาง 1 ตัว กินพื้นที่กี่ช่องกว้าง × สูง */
export function rackSpan(r) {
  return {
    cols: Math.max(1, Math.min(4, Math.ceil(r.total_depths / 3))),
    rows: Math.max(1, Math.min(3, Math.ceil(r.total_levels / 3))),
  };
}

function requireFields(body, fields) {
  const missing = fields.filter((f) => body[f] === undefined || body[f] === null || body[f] === '');
  if (missing.length) throw badRequest(`กรุณากรอกข้อมูลให้ครบ: ${missing.join(', ')}`);
}
