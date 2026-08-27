// เฟส 5: รอบนับสต็อก (Cycle Count) — แทนการกระทบยอด Excel 3 แหล่ง
// สร้างรอบ → นับทีละตำแหน่ง (สแกนได้) → ระบบเทียบผลต่าง → ผู้มีสิทธิ์อนุมัติ → ปรับยอดเป็นเอกสาร ADJUST
import { all, get, run, tx } from '../lib/db.js';
import { badRequest, conflict, notFound } from '../lib/http.js';
import { editItem, storeItem } from './inventory.js';

async function nextRoundNo() {
  const now = new Date(Date.now() + 7 * 3600_000);
  const yy = String((now.getUTCFullYear() + 543) % 100).padStart(2, '0');
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const prefix = `CC-${yy}${mm}-`;
  const row = await get(
    `SELECT COALESCE(MAX(CAST(RIGHT(round_no, 4) AS INTEGER)), 0) AS n
       FROM count_rounds WHERE round_no LIKE ?`,
    `${prefix}%`,
  );
  return `${prefix}${String(row.n + 1).padStart(4, '0')}`;
}

/**
 * เปิดรอบนับใหม่ — ดึงทุกตำแหน่งในขอบเขต (คลัง/โซน/ประเภทสินค้า) มาเป็นบรรทัดนับ
 * รวมตำแหน่งว่างด้วย เพื่อจับกรณี "ระบบว่างแต่ของจริงมี"
 */
export async function createRound({ warehouse_id, zone_id, product_type, include_empty, note }, user) {
  const params = [];
  const where = ["l.status <> 'DISABLED'"];
  if (zone_id) { where.push('z.zone_id = ?'); params.push(Number(zone_id)); }
  else if (warehouse_id) { where.push('z.warehouse_id = ?'); params.push(Number(warehouse_id)); }
  if (product_type) { where.push("(s.product_type = ? OR i.item_id IS NULL)"); params.push(product_type); }
  if (!include_empty) where.push('i.item_id IS NOT NULL');

  const locs = await all(
    `SELECT l.location_id, i.item_id, i.sku_id, i.lot_no, COALESCE(i.quantity, 0) AS expected_qty
       FROM locations l
       JOIN rags r ON r.rag_id = l.rag_id
       JOIN zones z ON z.zone_id = r.zone_id
       LEFT JOIN stock_items i ON i.location_id = l.location_id AND i.status = 'IN_STOCK'
       LEFT JOIN skus s ON s.sku_id = i.sku_id
      WHERE ${where.join(' AND ')}
      ORDER BY l.location_code`,
    ...params,
  );
  if (!locs.length) throw badRequest('ไม่มีตำแหน่งในขอบเขตที่เลือก');

  return await tx(async () => {
    const round_no = await nextRoundNo();
    const r = await run(
      'INSERT INTO count_rounds (round_no, warehouse_id, zone_id, note, created_by) VALUES (?,?,?,?,?)',
      round_no, warehouse_id ? Number(warehouse_id) : null, zone_id ? Number(zone_id) : null,
      note?.trim() || null, user.user_id,
    );
    const roundId = Number(r.lastInsertRowid);
    for (const l of locs)
      await run(
        'INSERT INTO count_lines (round_id, location_id, item_id, sku_id, lot_no, expected_qty) VALUES (?,?,?,?,?,?)',
        roundId, l.location_id, l.item_id, l.sku_id, l.lot_no, l.expected_qty,
      );
    return await roundDetail(roundId);
  });
}

export async function listRounds({ limit = 100 } = {}) {
  return await all(
    `SELECT cr.*, w.wh_code, z.zone_code, u.full_name AS created_by_name, ua.full_name AS approved_by_name,
            (SELECT COUNT(*) FROM count_lines cl WHERE cl.round_id = cr.round_id) AS total_lines,
            (SELECT COUNT(*) FROM count_lines cl WHERE cl.round_id = cr.round_id AND cl.counted_qty IS NOT NULL) AS counted_lines,
            (SELECT COUNT(*) FROM count_lines cl WHERE cl.round_id = cr.round_id
              AND cl.counted_qty IS NOT NULL AND cl.counted_qty <> cl.expected_qty) AS variance_lines
       FROM count_rounds cr
       LEFT JOIN warehouses w ON w.warehouse_id = cr.warehouse_id
       LEFT JOIN zones z ON z.zone_id = cr.zone_id
       LEFT JOIN users u ON u.user_id = cr.created_by
       LEFT JOIN users ua ON ua.user_id = cr.approved_by
      ORDER BY cr.round_id DESC LIMIT ?`,
    Number(limit),
  );
}

export async function roundDetail(roundId) {
  const round = await get(
    `SELECT cr.*, w.wh_code, w.wh_name, z.zone_code, z.zone_name,
            u.full_name AS created_by_name, ua.full_name AS approved_by_name
       FROM count_rounds cr
       LEFT JOIN warehouses w ON w.warehouse_id = cr.warehouse_id
       LEFT JOIN zones z ON z.zone_id = cr.zone_id
       LEFT JOIN users u ON u.user_id = cr.created_by
       LEFT JOIN users ua ON ua.user_id = cr.approved_by
      WHERE cr.round_id = ?`,
    Number(roundId),
  );
  if (!round) throw notFound('ไม่พบรอบนับ');
  const lines = await all(
    `SELECT cl.*, l.location_code, s.sku_code, s.sku_name, s.unit,
            (cl.counted_qty - cl.expected_qty) AS variance
       FROM count_lines cl
       JOIN locations l ON l.location_id = cl.location_id
       LEFT JOIN skus s ON s.sku_id = cl.sku_id
      WHERE cl.round_id = ?
      ORDER BY l.location_code`,
    Number(roundId),
  );
  const counted = lines.filter((l) => l.counted_qty !== null);
  return {
    round, lines,
    progress: {
      total: lines.length,
      counted: counted.length,
      variance: counted.filter((l) => l.variance !== 0).length,
    },
  };
}

/** บันทึกผลนับของ 1 ตำแหน่ง (นับซ้ำได้จนกว่าจะอนุมัติ) */
export async function recordCount(roundId, { location_code, counted_qty, note }, user) {
  const round = await get('SELECT * FROM count_rounds WHERE round_id = ?', Number(roundId));
  if (!round) throw notFound('ไม่พบรอบนับ');
  if (round.status !== 'OPEN') throw conflict('รอบนับนี้ปิดแล้ว — บันทึกผลเพิ่มไม่ได้');

  const qty = Number(counted_qty);
  if (!Number.isFinite(qty) || qty < 0) throw badRequest('จำนวนที่นับได้ไม่ถูกต้อง');

  const line = await get(
    `SELECT cl.* FROM count_lines cl JOIN locations l ON l.location_id = cl.location_id
      WHERE cl.round_id = ? AND UPPER(l.location_code) = UPPER(?)`,
    Number(roundId), (location_code ?? '').trim(),
  );
  if (!line) throw notFound(`ตำแหน่ง ${location_code} ไม่อยู่ในรอบนับนี้`);

  await run('UPDATE count_lines SET counted_qty = ?, note = ? WHERE line_id = ?',
    qty, note?.trim() || null, line.line_id);
  return { line_id: line.line_id, expected_qty: line.expected_qty, counted_qty: qty, variance: qty - line.expected_qty };
}

/**
 * อนุมัติรอบนับ — สร้างเอกสาร ADJUST แล้วปรับยอดทุกบรรทัดที่มีผลต่าง
 * บรรทัดที่ยังไม่ได้นับจะถูกข้าม (ไม่ปรับ)
 */
export async function approveRound(roundId, user) {
  const { round, lines } = await roundDetail(roundId);
  if (round.status !== 'OPEN') throw conflict('รอบนับนี้ถูกปิดไปแล้ว');

  const diffs = lines.filter((l) => l.counted_qty !== null && l.variance !== 0);

  return await tx(async () => {
    let docId = null;
    let docNo = null;
    if (diffs.length) {
      const now = new Date(Date.now() + 7 * 3600_000);
      const yy = String((now.getUTCFullYear() + 543) % 100).padStart(2, '0');
      const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
      const prefix = `ADJUST-${yy}${mm}-`;
      const row = await get(
        `SELECT COALESCE(MAX(CAST(RIGHT(doc_no, 4) AS INTEGER)), 0) AS n
           FROM documents WHERE doc_no LIKE ?`,
        `${prefix}%`,
      );
      docNo = `${prefix}${String(row.n + 1).padStart(4, '0')}`;
      const r = await run(
        `INSERT INTO documents (doc_type, doc_no, ref_no, reason, note, created_by)
         VALUES ('ADJUST', ?, ?, ?, ?, ?)`,
        docNo, round.round_no, 'ปรับยอดตามผลนับสต็อก',
        `รอบนับ ${round.round_no} — ผลต่าง ${diffs.length} ตำแหน่ง`, user.user_id,
      );
      docId = Number(r.lastInsertRowid);

      for (const l of diffs) {
        if (l.item_id) {
          await editItem({
            item_id: l.item_id, quantity: l.counted_qty, doc_id: docId,
            note: `นับสต็อก ${round.round_no}: ระบบ ${l.expected_qty} → นับได้ ${l.counted_qty}${l.note ? ` (${l.note})` : ''}`,
          }, user);
        } else if (l.counted_qty > 0 && l.sku_id) {
          // ตำแหน่งที่ระบบว่างแต่นับเจอของ — ต้องระบุ SKU ตอนนับ จึงจะรับเข้าได้
          await storeItem({
            sku_id: l.sku_id, location_code: l.location_code, quantity: l.counted_qty,
            lot_no: l.lot_no, doc_id: docId, note: `พบจากนับสต็อก ${round.round_no}`,
          }, user);
        }
      }
    }

    await run(
      `UPDATE count_rounds SET status='APPROVED', approved_by=?, approved_at=(now() AT TIME ZONE 'Asia/Bangkok')
        WHERE round_id = ?`,
      user.user_id, Number(roundId),
    );
    return { ...(await roundDetail(roundId)), adjusted: diffs.length, doc_no: docNo, doc_id: docId };
  });
}

export async function cancelRound(roundId, user) {
  const round = await get('SELECT * FROM count_rounds WHERE round_id = ?', Number(roundId));
  if (!round) throw notFound('ไม่พบรอบนับ');
  if (round.status !== 'OPEN') throw conflict('รอบนับนี้ถูกปิดไปแล้ว');
  await run(
    `UPDATE count_rounds SET status='CANCELLED', approved_by=?, approved_at=(now() AT TIME ZONE 'Asia/Bangkok')
      WHERE round_id = ?`,
    user.user_id, Number(roundId),
  );
  return { ok: true };
}
