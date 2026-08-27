// หัวใจของระบบ: จัดเก็บ / หยิบออก / ย้าย + ค้นหาสินค้า + ประวัติการเคลื่อนย้าย
import { all, get, run, tx, nowStr } from '../lib/db.js';
import { badRequest, conflict, notFound } from '../lib/http.js';
import { expiryState, locationByCode, countStats } from './locations.js';

const like = (q) => `%${String(q).trim()}%`;

const logMovement = async (m) =>
  (await run(
    `INSERT INTO movements (movement_type, item_id, sku_id, lot_no, quantity,
                            from_location_id, to_location_id, user_id, note, doc_id)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    m.movement_type, m.item_id ?? null, m.sku_id, m.lot_no ?? null, m.quantity ?? null,
    m.from_location_id ?? null, m.to_location_id ?? null, m.user_id, m.note ?? null, m.doc_id ?? null,
  )).lastInsertRowid;

// ---------------------------------------------------------------- ค้นหา
/**
 * ค้นหาสินค้าในคลัง — พิมพ์อะไรก็ได้: รหัสสินค้า, ชื่อสินค้า, Lot, บาร์โค้ด,
 * รหัสตำแหน่ง หรือหมายเลขชั้นวาง (เว้นว่าง = แสดงทั้งหมด)
 */
export async function searchStock(q, { zoneId = null, ragId = null, warehouseId = null, skuId = null,
                                 minDays = null, maxDays = null, minQty = null, limit = 500 } = {}) {
  const term = (q ?? '').trim();
  const params = [];
  let where = '1=1';
  if (term) {
    where += ` AND (s.sku_code ILIKE ? OR s.sku_name ILIKE ? OR v.lot_no ILIKE ?
                    OR v.location_code ILIKE ? OR v.rag_no ILIKE ? OR s.barcode = ?)`;
    params.push(like(term), like(term), like(term), like(term), like(term), term);
  }
  if (warehouseId) { where += ' AND v.warehouse_id = ?'; params.push(warehouseId); }
  if (zoneId) { where += ' AND v.zone_id = ?'; params.push(zoneId); }
  if (ragId) { where += ' AND v.rag_id = ?'; params.push(ragId); }
  if (skuId) { where += ' AND v.sku_id = ?'; params.push(skuId); }
  // กรองตามอายุคงเหลือ — Lot ที่ไม่ระบุวันหมดอายุถือว่าไม่เข้าเงื่อนไข
  if (minDays !== null) { where += ' AND v.days_to_expiry IS NOT NULL AND v.days_to_expiry >= ?'; params.push(minDays); }
  if (maxDays !== null) { where += ' AND v.days_to_expiry IS NOT NULL AND v.days_to_expiry <= ?'; params.push(maxDays); }
  if (minQty !== null) { where += ' AND v.quantity >= ?'; params.push(minQty); }

  return (await all(
    `SELECT v.*, s.barcode FROM v_stock v JOIN skus s ON s.sku_id = v.sku_id
      WHERE ${where}
      ORDER BY (v.exp_date IS NULL), v.exp_date, v.zone_code, v.rag_no, v.level, v.depth
      LIMIT ?`,
    ...params, limit,
  )).map((r) => ({ ...r, expiry: expiryState(r.days_to_expiry), needs_forklift: r.level > 1 }));
}

/** ค้นหาแบบรวมสำหรับช่องค้นหาด้านบน */
export const quickSearch = async (q) => {
  const term = (q ?? '').trim();
  if (!term) return { stock: [], locations: [] };
  return {
    stock: await searchStock(term, { limit: 50 }),
    locations: await all(
      `SELECT l.location_id, l.location_code, l.status, r.rag_id, r.rag_no
         FROM locations l JOIN rags r ON r.rag_id = l.rag_id
        WHERE l.location_code ILIKE ? OR r.rag_no ILIKE ? LIMIT 10`,
      like(term), like(term),
    ),
  };
};

/** รายละเอียดของตำแหน่งหนึ่ง ๆ พร้อมประวัติของตำแหน่งนั้น */
export async function locationDetail(code) {
  const location = await locationByCode(code);
  if (!location) throw notFound(`ไม่พบตำแหน่ง ${code}`);
  const item = await get(
    `SELECT i.*, s.sku_code, s.sku_name, s.unit,
            CASE WHEN i.exp_date IS NULL THEN NULL
                 ELSE (i.exp_date::date - (now() AT TIME ZONE 'Asia/Bangkok')::date) END AS days_to_expiry
       FROM stock_items i JOIN skus s ON s.sku_id = i.sku_id
      WHERE i.location_id = ? AND i.status = 'IN_STOCK'`,
    location.location_id,
  );
  return {
    location,
    item: item ? { ...item, expiry: expiryState(item.days_to_expiry) } : null,
    history: await listMovements({ location_id: location.location_id, limit: 20 }),
  };
}

// ---------------------------------------------------------------- จัดเก็บ
/** จัดเก็บสินค้าลงตำแหน่งว่าง 1 ช่อง */
export async function storeItem(input, user) {
  const sku = await get('SELECT * FROM skus WHERE sku_id = ? AND status = ?', input.sku_id, 'ACTIVE');
  if (!sku) throw notFound('ไม่พบสินค้า');
  const quantity = Number(input.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) throw badRequest('กรุณาระบุจำนวนสินค้า');

  const location = await locationByCode(input.location_code ?? '');
  if (!location) throw notFound(`ไม่พบตำแหน่ง ${input.location_code}`);
  if (location.status === 'DISABLED') throw conflict(`ตำแหน่ง ${location.location_code} ถูกปิดใช้งานอยู่`);
  if (location.status === 'OCCUPIED')
    throw conflict(`ตำแหน่ง ${location.location_code} มีสินค้าอยู่แล้ว — 1 ตำแหน่งเก็บได้ 1 รายการ`, 'LOCATION_OCCUPIED');

  const doStore = async () => {
    const res = await run(
      `INSERT INTO stock_items (sku_id, location_id, lot_no, exp_date, mfg_date, quantity, note)
       VALUES (?,?,?,?,?,?,?)`,
      sku.sku_id, location.location_id, input.lot_no?.trim() || null,
      input.exp_date || null, input.mfg_date || null, quantity, input.note?.trim() || null,
    );
    const itemId = Number(res.lastInsertRowid);
    await run("UPDATE locations SET status = 'OCCUPIED' WHERE location_id = ?", location.location_id);
    await logMovement({
      movement_type: 'STORE', item_id: itemId, sku_id: sku.sku_id, lot_no: input.lot_no?.trim() || null,
      quantity, to_location_id: location.location_id, user_id: user.user_id,
      note: input.note?.trim() || null, doc_id: input.doc_id ?? null,
    });
    return await itemDetail(itemId);
  };
  return await tx(doStore);   // tx() เป็น reentrant — เรียกจากในเอกสารได้โดยไม่เปิด Transaction ซ้อน
}

// ---------------------------------------------------------------- หยิบออก
/** หยิบสินค้าออกจากตำแหน่ง (ระบุทั้งรายการ หรือหยิบบางส่วนก็ได้) */
export async function removeItem({ item_id, quantity, note, doc_id }, user) {
  return await tx(async () => await removeOne({ item_id, quantity, note, doc_id }, user));
}

/** หยิบออก 1 รายการ — ต้องเรียกภายใน await tx() เสมอ */
async function removeOne({ item_id, quantity, note, doc_id }, user) {
  const item = await getItem(item_id);
  const takeAll = quantity === undefined || quantity === null || quantity === '' || Number(quantity) >= item.quantity;
  const take = takeAll ? item.quantity : Number(quantity);
  if (!Number.isFinite(take) || take <= 0) throw badRequest('จำนวนที่หยิบออกไม่ถูกต้อง');

  {
    if (takeAll) {
      await run(
        `UPDATE stock_items SET status='REMOVED', location_id=NULL, quantity=0,
             updated_at=(now() AT TIME ZONE 'Asia/Bangkok') WHERE item_id=?`,
        item.item_id,
      );
      await run("UPDATE locations SET status='EMPTY' WHERE location_id = ?", item.location_id);
    } else {
      await run(
        `UPDATE stock_items SET quantity = quantity - ?, updated_at=(now() AT TIME ZONE 'Asia/Bangkok') WHERE item_id=?`,
        take, item.item_id,
      );
    }
    await logMovement({
      movement_type: 'REMOVE', item_id: item.item_id, sku_id: item.sku_id, lot_no: item.lot_no,
      quantity: take, from_location_id: item.location_id, user_id: user.user_id,
      note: [note?.trim(), takeAll ? null : `หยิบบางส่วน (เหลือ ${item.quantity - take})`].filter(Boolean).join(' · ') || null,
      doc_id: doc_id ?? null,
    });
    return { item_id: item.item_id, removed: take, remaining: takeAll ? 0 : item.quantity - take };
  }
}

// ------------------------------------------------------- วางแผนหยิบสินค้า
// FEFO = หมดอายุก่อนหยิบก่อน · FIFO = เข้าก่อนหยิบก่อน
// เมื่อวันหมดอายุเท่ากัน ให้หยิบของที่เข้าคลังก่อน แล้วค่อยเลือกชั้นล่าง/ตอนหน้าก่อน (หยิบง่ายกว่า)
const PICK_ORDER = {
  FEFO: 'ORDER BY (v.exp_date IS NULL), v.exp_date, v.stored_at, v.level, v.depth, v.location_code',
  FIFO: 'ORDER BY v.stored_at, (v.exp_date IS NULL), v.exp_date, v.level, v.depth, v.location_code',
};

const numOrNull = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

/** เหตุผลที่ Lot นี้หยิบไม่ได้ (null = หยิบได้) */
function pickReject(days, minDays, maxDays, pctRemaining, minPct, maxPct) {
  if (days !== null && days < 0) return `หมดอายุแล้ว ${Math.abs(days)} วัน`;
  if (minPct !== null || maxPct !== null) {
    if (pctRemaining === null) return 'ไม่ระบุวันผลิต/อายุสินค้า — คำนวณ % คงเหลือไม่ได้';
    if (minPct !== null && pctRemaining < minPct) return `อายุคงเหลือ ${pctRemaining}% (ต้องการอย่างน้อย ${minPct}%)`;
    if (maxPct !== null && pctRemaining > maxPct) return `อายุคงเหลือ ${pctRemaining}% (ต้องการไม่เกิน ${maxPct}%)`;
  }
  if (minDays === null && maxDays === null) return null;
  if (days === null) return 'ไม่ระบุวันหมดอายุ — รับประกันอายุคงเหลือไม่ได้';
  if (minDays !== null && days < minDays) return `อายุคงเหลือ ${days} วัน (ต้องการอย่างน้อย ${minDays} วัน)`;
  if (maxDays !== null && days > maxDays) return `อายุคงเหลือ ${days} วัน (ต้องการไม่เกิน ${maxDays} วัน)`;
  return null;
}

/**
 * วางแผนหยิบสินค้าอัตโนมัติ
 * รับ: สินค้า + จำนวนที่ต้องการ + เงื่อนไขอายุคงเหลือ
 * คืน: รายการว่าไปหยิบที่ตำแหน่งไหน ตำแหน่งละเท่าไร เรียงตาม FEFO จนครบจำนวน
 * หมายเหตุ: Lot ที่หมดอายุแล้วจะไม่ถูกจัดสรรให้เสมอ
 */
export async function pickPlan({ sku_id, quantity, min_days, max_days, min_pct, max_pct, warehouse_id, zone_id, strategy } = {}) {
  const sku = await get('SELECT * FROM skus WHERE sku_id = ?', Number(sku_id));
  if (!sku) throw notFound('ไม่พบสินค้า — กรุณาเลือกสินค้าที่ต้องการหยิบ');

  const need = Number(quantity);
  if (!Number.isFinite(need) || need <= 0) throw badRequest('กรุณาระบุจำนวนที่ต้องการหยิบ');

  const minDays = numOrNull(min_days);
  const maxDays = numOrNull(max_days);
  const minPct = numOrNull(min_pct);
  const maxPct = numOrNull(max_pct);
  if (minDays !== null && maxDays !== null && minDays > maxDays)
    throw badRequest('ช่วงอายุคงเหลือไม่ถูกต้อง — ค่าขั้นต่ำมากกว่าค่าสูงสุด');
  if (minPct !== null && maxPct !== null && minPct > maxPct)
    throw badRequest('ช่วง % อายุคงเหลือไม่ถูกต้อง — ค่าขั้นต่ำมากกว่าค่าสูงสุด');

  const mode = strategy === 'FIFO' ? 'FIFO' : 'FEFO';
  const params = [Number(sku.sku_id)];
  let where = 'v.sku_id = ?';
  if (warehouse_id) { where += ' AND v.warehouse_id = ?'; params.push(Number(warehouse_id)); }
  if (zone_id) { where += ' AND v.zone_id = ?'; params.push(Number(zone_id)); }

  const rows = await all(`SELECT v.* FROM v_stock v WHERE ${where} ${PICK_ORDER[mode]}`, ...params);

  // แยกรายการที่หยิบได้ / หยิบไม่ได้ (คงลำดับ FEFO ไว้)
  const usable = [];
  const skipped = [];
  for (const r of rows) {
    const item = { ...r, expiry: expiryState(r.days_to_expiry), needs_forklift: r.level > 1 };
    const reason = pickReject(r.days_to_expiry, minDays, maxDays, r.pct_remaining, minPct, maxPct);
    if (reason) skipped.push({ ...item, reason });
    else usable.push(item);
  }

  // ไล่จัดสรรทีละตำแหน่งจนครบจำนวนที่ต้องการ
  let left = need;
  const lines = [];
  for (const r of usable) {
    if (left <= 0) break;
    const take = Math.min(left, r.quantity);
    left -= take;
    lines.push({ ...r, seq: lines.length + 1, take, remaining_after: r.quantity - take });
  }

  return {
    sku,
    strategy: mode,
    filter: { min_days: minDays, max_days: maxDays, min_pct: minPct, max_pct: maxPct },
    requested: need,
    allocated: need - left,
    shortfall: left,
    complete: left === 0,
    available: usable.reduce((s, r) => s + r.quantity, 0),
    lines,
    skipped,
  };
}

/** ยืนยันหยิบตามแผน — หยิบทุกบรรทัดพร้อมกันใน Transaction เดียว (สำเร็จทั้งหมด หรือไม่สำเร็จเลย) */
export async function pickConfirm({ lines, note } = {}, user) {
  if (!Array.isArray(lines) || !lines.length) throw badRequest('ไม่มีรายการให้หยิบ');

  return await tx(async () => {
    const results = [];
    for (const l of lines) {
      const itemId = Number(l.item_id);
      const take = Number(l.take);
      if (!Number.isFinite(take) || take <= 0) throw badRequest('จำนวนที่หยิบไม่ถูกต้อง');

      // แผนอาจคำนวณไว้ก่อนหน้า — ตรวจว่าของยังอยู่ครบตามแผนจริง
      const cur = await get('SELECT * FROM stock_items WHERE item_id = ?', itemId);
      if (!cur || cur.status !== 'IN_STOCK' || !cur.location_id)
        throw conflict(`${l.location_code ?? `รายการ #${itemId}`} ถูกหยิบออกไปแล้ว — กรุณาคำนวณแผนใหม่`);
      if (cur.quantity < take)
        throw conflict(`${l.location_code ?? `รายการ #${itemId}`} เหลือ ${cur.quantity} (แผนระบุ ${take}) — กรุณาคำนวณแผนใหม่`);

      results.push({
        location_code: l.location_code ?? null,
        ...await removeOne({ item_id: itemId, quantity: take, note: note?.trim() || 'หยิบตามแผน FEFO' }, user),
      });
    }
    return {
      picked: results.length,
      total: results.reduce((s, r) => s + r.removed, 0),
      lines: results,
    };
  });
}

// ---------------------------------------------------------------- ย้าย
/** ย้ายสินค้าไปตำแหน่งอื่น */
export async function moveItem({ item_id, to_location_code, note, doc_id }, user) {
  const item = await getItem(item_id);
  const to = await locationByCode(to_location_code ?? '');
  if (!to) throw notFound(`ไม่พบตำแหน่งปลายทาง ${to_location_code}`);
  if (to.location_id === item.location_id) throw badRequest('ตำแหน่งต้นทางและปลายทางเป็นตำแหน่งเดียวกัน');
  if (to.status === 'DISABLED') throw conflict(`ตำแหน่ง ${to.location_code} ถูกปิดใช้งานอยู่`);
  if (to.status === 'OCCUPIED') throw conflict(`ตำแหน่ง ${to.location_code} มีสินค้าอยู่แล้ว`, 'LOCATION_OCCUPIED');

  const from = item.location_id;
  return await tx(async () => {
    await run("UPDATE locations SET status='EMPTY' WHERE location_id = ?", from);
    await run("UPDATE locations SET status='OCCUPIED' WHERE location_id = ?", to.location_id);
    await run(`UPDATE stock_items SET location_id=?, updated_at=(now() AT TIME ZONE 'Asia/Bangkok') WHERE item_id=?`, to.location_id, item.item_id);
    await logMovement({
      movement_type: 'MOVE', item_id: item.item_id, sku_id: item.sku_id, lot_no: item.lot_no,
      quantity: item.quantity, from_location_id: from, to_location_id: to.location_id,
      user_id: user.user_id, note: note?.trim() || null, doc_id: doc_id ?? null,
    });
    return await itemDetail(item.item_id);
  });
}

/** แก้ไขข้อมูลสินค้าที่จัดเก็บอยู่ (จำนวน / Lot / วันผลิต / วันหมดอายุ) — บันทึกประวัติทุกครั้ง */
export async function editItem({ item_id, quantity, lot_no, exp_date, mfg_date, note, doc_id }, user) {
  const item = await getItem(item_id);
  const newQty = quantity === undefined || quantity === null || quantity === '' ? item.quantity : Number(quantity);
  if (!Number.isFinite(newQty) || newQty < 0) throw badRequest('จำนวนไม่ถูกต้อง');

  const changes = [];
  if (newQty !== item.quantity) changes.push(`จำนวน ${item.quantity} → ${newQty}`);
  if (lot_no !== undefined && (lot_no || null) !== item.lot_no) changes.push(`Lot ${item.lot_no ?? '-'} → ${lot_no || '-'}`);
  if (exp_date !== undefined && (exp_date || null) !== item.exp_date) changes.push(`วันหมดอายุ ${item.exp_date ?? '-'} → ${exp_date || '-'}`);
  if (mfg_date !== undefined && (mfg_date || null) !== item.mfg_date) changes.push(`วันผลิต ${item.mfg_date ?? '-'} → ${mfg_date || '-'}`);
  if (!changes.length) return await itemDetail(item.item_id);

  return await tx(async () => {
    await run(
      `UPDATE stock_items SET quantity=?, lot_no=?, exp_date=?, mfg_date=?, updated_at=(now() AT TIME ZONE 'Asia/Bangkok') WHERE item_id=?`,
      newQty, lot_no !== undefined ? lot_no || null : item.lot_no,
      exp_date !== undefined ? exp_date || null : item.exp_date,
      mfg_date !== undefined ? mfg_date || null : item.mfg_date, item.item_id,
    );
    // นับเป็นศูนย์ = ตำแหน่งนั้นว่างจริง — ปิดรายการและคืนตำแหน่ง
    if (newQty === 0) {
      await run(`UPDATE stock_items SET status='REMOVED', location_id=NULL WHERE item_id=?`, item.item_id);
      await run("UPDATE locations SET status='EMPTY' WHERE location_id = ?", item.location_id);
    }
    await logMovement({
      movement_type: 'EDIT', item_id: item.item_id, sku_id: item.sku_id, lot_no: item.lot_no, quantity: newQty,
      from_location_id: item.location_id, to_location_id: newQty === 0 ? null : item.location_id, user_id: user.user_id,
      note: [changes.join(' · '), note?.trim()].filter(Boolean).join(' — '), doc_id: doc_id ?? null,
    });
    return await itemDetail(item.item_id);
  });
}

// ---------------------------------------------------------------- ประวัติ
export async function listMovements(f = {}) {
  const where = [];
  const params = [];
  const joins = [];
  if (f.type) { where.push('m.movement_type = ?'); params.push(f.type); }
  if (f.sku_id) { where.push('m.sku_id = ?'); params.push(Number(f.sku_id)); }
  if (f.item_id) { where.push('m.item_id = ?'); params.push(Number(f.item_id)); }
  if (f.location_id) { where.push('(m.from_location_id = ? OR m.to_location_id = ?)'); params.push(Number(f.location_id), Number(f.location_id)); }
  if (f.from) { where.push('m.moved_at >= ?'); params.push(f.from); }
  if (f.to) { where.push('m.moved_at <= ?'); params.push(`${f.to} 23:59:59`); }
  if (f.q) {
    where.push('(s.sku_code ILIKE ? OR s.sku_name ILIKE ? OR m.lot_no ILIKE ? OR lf.location_code ILIKE ? OR lt.location_code ILIKE ?)');
    params.push(like(f.q), like(f.q), like(f.q), like(f.q), like(f.q));
  }
  if (f.warehouse_id) {
    joins.push('LEFT JOIN rags rf ON rf.rag_id = COALESCE((SELECT rag_id FROM locations WHERE location_id = COALESCE(m.to_location_id, m.from_location_id)), 0)');
    joins.push('LEFT JOIN zones zf ON zf.zone_id = rf.zone_id');
    where.push('zf.warehouse_id = ?');
    params.push(Number(f.warehouse_id));
  }
  if (f.doc_id) { where.push('m.doc_id = ?'); params.push(Number(f.doc_id)); }
  if (f.lot_no) { where.push('m.lot_no = ?'); params.push(f.lot_no); }
  return await all(
    `SELECT m.*, s.sku_code, s.sku_name, s.unit, u.full_name AS user_name,
            lf.location_code AS from_code, lt.location_code AS to_code,
            d.doc_no, d.doc_type, d.ref_no AS doc_ref, d.party AS doc_party
       FROM movements m
       JOIN skus s ON s.sku_id = m.sku_id
       LEFT JOIN users u ON u.user_id = m.user_id
       LEFT JOIN locations lf ON lf.location_id = m.from_location_id
       LEFT JOIN locations lt ON lt.location_id = m.to_location_id
       LEFT JOIN documents d ON d.doc_id = m.doc_id
       ${joins.join(' ')}
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY m.movement_id DESC LIMIT ?`,
    ...params, Number(f.limit ?? 200),
  );
}

// ---------------------------------------------------------------- สรุปภาพรวม
/** ภาพรวมคลัง: ทุกโซนและทุกชั้นวาง พร้อม % การใช้พื้นที่ */
export async function warehouseOverview({ warehouseId = null } = {}) {
  const rags = (await all(
    `SELECT r.rag_id, r.rag_no, r.status, r.pos_x, r.pos_y,
            z.zone_id, z.zone_code, z.zone_name, z.color,
            w.warehouse_id, w.wh_code, w.wh_name,
            COUNT(l.location_id) AS total,
            SUM(CASE WHEN l.status='OCCUPIED' THEN 1 ELSE 0 END) AS occupied,
            SUM(CASE WHEN l.status='EMPTY' THEN 1 ELSE 0 END) AS empty,
            SUM(CASE WHEN l.status='DISABLED' THEN 1 ELSE 0 END) AS disabled
       FROM rags r JOIN zones z ON z.zone_id = r.zone_id
       LEFT JOIN warehouses w ON w.warehouse_id = z.warehouse_id
       LEFT JOIN locations l ON l.rag_id = r.rag_id
      ${warehouseId ? 'WHERE z.warehouse_id = ?' : ''}
      GROUP BY r.rag_id, z.zone_id, w.warehouse_id ORDER BY w.wh_code, z.zone_code, r.rag_no`,
    ...(warehouseId ? [warehouseId] : []),
  )).map((r) => {
    const usable = r.total - r.disabled;
    return { ...r, usable, usage_pct: usable ? Math.round((r.occupied / usable) * 1000) / 10 : 0 };
  });

  const roll = (bucket, r) => {
    bucket.total += r.total; bucket.occupied += r.occupied;
    bucket.empty += r.empty; bucket.disabled += r.disabled;
  };
  const finish = (b) => {
    b.usable = b.total - b.disabled;
    b.usage_pct = b.usable ? Math.round((b.occupied / b.usable) * 1000) / 10 : 0;
  };

  const zones = [];
  const warehouses = [];
  for (const r of rags) {
    let z = zones.find((x) => x.zone_id === r.zone_id);
    if (!z) {
      z = { zone_id: r.zone_id, zone_code: r.zone_code, zone_name: r.zone_name, color: r.color,
            warehouse_id: r.warehouse_id, wh_code: r.wh_code, wh_name: r.wh_name,
            total: 0, occupied: 0, empty: 0, disabled: 0, rags: [] };
      zones.push(z);
    }
    roll(z, r); z.rags.push(r);

    let w = warehouses.find((x) => x.warehouse_id === r.warehouse_id);
    if (!w) {
      w = { warehouse_id: r.warehouse_id, wh_code: r.wh_code, wh_name: r.wh_name,
            total: 0, occupied: 0, empty: 0, disabled: 0, zones: [] };
      warehouses.push(w);
    }
    roll(w, r);
    if (!w.zones.includes(z)) w.zones.push(z);
  }
  zones.forEach(finish);
  warehouses.forEach(finish);

  const total = { total: 0, occupied: 0, empty: 0, disabled: 0 };
  rags.forEach((r) => roll(total, r));
  finish(total);

  return { warehouse: total, warehouses, zones };
}

/** ข้อมูลหน้าแรก */
export async function dashboard({ warehouseId = null } = {}) {
  const { warehouse, zones } = await warehouseOverview({ warehouseId });
  const whFilter = warehouseId
    ? ` AND i.location_id IN (SELECT l.location_id FROM locations l JOIN rags r ON r.rag_id=l.rag_id JOIN zones z ON z.zone_id=r.zone_id WHERE z.warehouse_id=${Number(warehouseId)})`
    : '';
  const items = await get(`SELECT COUNT(*) AS n, COALESCE(SUM(quantity),0) AS qty FROM stock_items i WHERE i.status='IN_STOCK'${whFilter}`);
  return {
    warehouse,
    zones: zones.map(({ rags, ...z }) => z),
    items_in_stock: items.n,
    total_quantity: items.qty,
    sku_count: (await get(`SELECT COUNT(DISTINCT i.sku_id) AS n FROM stock_items i WHERE i.status='IN_STOCK'${whFilter}`)).n,
    recent_movements: await listMovements({ warehouse_id: warehouseId, limit: 10 }),
  };
}

// ---------------------------------------------------------------- helper
async function getItem(itemId) {
  const item = await get('SELECT * FROM stock_items WHERE item_id = ?', Number(itemId));
  if (!item) throw notFound('ไม่พบรายการสินค้า');
  if (item.status !== 'IN_STOCK' || !item.location_id) throw conflict('รายการนี้ถูกหยิบออกจากคลังไปแล้ว');
  return item;
}

export async function itemDetail(itemId) {
  const item = await get(
    `SELECT i.*, s.sku_code, s.sku_name, s.unit, l.location_code, l.level, l.depth,
            r.rag_id, r.rag_no, z.zone_code,
            CASE WHEN i.exp_date IS NULL THEN NULL
                 ELSE (i.exp_date::date - (now() AT TIME ZONE 'Asia/Bangkok')::date) END AS days_to_expiry
       FROM stock_items i
       JOIN skus s ON s.sku_id = i.sku_id
       LEFT JOIN locations l ON l.location_id = i.location_id
       LEFT JOIN rags r ON r.rag_id = l.rag_id
       LEFT JOIN zones z ON z.zone_id = r.zone_id
      WHERE i.item_id = ?`,
    Number(itemId),
  );
  if (!item) throw notFound('ไม่พบรายการสินค้า');
  return { ...item, expiry: expiryState(item.days_to_expiry) };
}

/** แปลงเป็น CSV (เปิดด้วย Excel ได้ ภาษาไทยไม่เพี้ยน) */
export function toCSV(rows, columns) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return '﻿' + [
    columns.map((c) => esc(c.label)).join(','),
    ...rows.map((r) => columns.map((c) => esc(typeof c.value === 'function' ? c.value(r) : r[c.key])).join(',')),
  ].join('\r\n');
}

export { countStats };
