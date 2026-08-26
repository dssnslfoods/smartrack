// รายงานสำหรับผู้บริหาร — 5 รายงานหลัก
import { all, get } from '../lib/db.js';
import { expiryState } from './locations.js';

/** 1. สรุปสินค้าคงคลัง */
export async function inventorySummary({ group_by = 'sku', warehouseId = null } = {}) {
  const whJoin = warehouseId ? ' JOIN rags rw ON rw.rag_id = l.rag_id JOIN zones zw ON zw.zone_id = rw.zone_id' : '';
  const whWhere = warehouseId ? ' AND zw.warehouse_id = ?' : '';
  const whParams = warehouseId ? [warehouseId] : [];
  if (group_by === 'zone') {
    return await all(
      `SELECT z.zone_code, z.zone_name,
              COUNT(DISTINCT i.item_id) AS items,
              COUNT(DISTINCT i.sku_id) AS sku_count,
              COALESCE(SUM(i.quantity), 0) AS total_qty,
              COUNT(DISTINCT l.rag_id) AS rack_count
         FROM stock_items i
         JOIN locations l ON l.location_id = i.location_id
         JOIN rags r ON r.rag_id = l.rag_id
         JOIN zones z ON z.zone_id = r.zone_id
        WHERE i.status = 'IN_STOCK'${warehouseId ? ' AND z.warehouse_id = ?' : ''}
        GROUP BY z.zone_id ORDER BY z.zone_code`, ...whParams);
  }
  if (group_by === 'category') {
    return await all(
      `SELECT COALESCE(s.category, 'ไม่ระบุ') AS category,
              COUNT(DISTINCT i.item_id) AS items,
              COUNT(DISTINCT s.sku_id) AS sku_count,
              COALESCE(SUM(i.quantity), 0) AS total_qty
         FROM stock_items i JOIN skus s ON s.sku_id = i.sku_id
         JOIN locations l ON l.location_id = i.location_id${whJoin}
        WHERE i.status = 'IN_STOCK'${whWhere}
        GROUP BY s.category ORDER BY total_qty DESC`, ...whParams);
  }
  return await all(
    `SELECT s.sku_code, s.sku_name, s.category, s.unit,
            COUNT(i.item_id) AS locations_used,
            COALESCE(SUM(i.quantity), 0) AS total_qty,
            MIN(i.exp_date) AS nearest_expiry
       FROM stock_items i JOIN skus s ON s.sku_id = i.sku_id
       JOIN locations l ON l.location_id = i.location_id${whJoin}
      WHERE i.status = 'IN_STOCK'${whWhere}
      GROUP BY s.sku_id ORDER BY total_qty DESC`, ...whParams);
}

/** 2. สินค้าใกล้หมดอายุ */
export async function expiryReport({ warehouseId = null } = {}) {
  const rows = await all(
    `SELECT i.item_id, s.sku_code, s.sku_name, s.unit, i.lot_no, i.quantity,
            i.exp_date, l.location_code, z.zone_code,
            (i.exp_date::date - (now() AT TIME ZONE 'Asia/Bangkok')::date) AS days_left
       FROM stock_items i
       JOIN skus s ON s.sku_id = i.sku_id
       JOIN locations l ON l.location_id = i.location_id
       JOIN rags r ON r.rag_id = l.rag_id
       JOIN zones z ON z.zone_id = r.zone_id
      WHERE i.status = 'IN_STOCK' AND i.exp_date IS NOT NULL
        ${warehouseId ? 'AND z.warehouse_id = ?' : ''}
      ORDER BY i.exp_date`, ...(warehouseId ? [warehouseId] : []));

  const expired = [], within30 = [], within60 = [], within90 = [], safe = [];
  for (const r of rows) {
    r.expiry = expiryState(r.days_left);
    if (r.days_left < 0) expired.push(r);
    else if (r.days_left <= 30) within30.push(r);
    else if (r.days_left <= 60) within60.push(r);
    else if (r.days_left <= 90) within90.push(r);
    else safe.push(r);
  }

  return {
    summary: {
      expired: { count: expired.length, qty: sum(expired) },
      within30: { count: within30.length, qty: sum(within30) },
      within60: { count: within60.length, qty: sum(within60) },
      within90: { count: within90.length, qty: sum(within90) },
      safe: { count: safe.length, qty: sum(safe) },
    },
    items: [...expired, ...within30, ...within60, ...within90],
  };
}

/** 3. ประสิทธิภาพการใช้พื้นที่ */
export async function spaceUtilization({ warehouseId = null } = {}) {
  const racks = await all(
    `SELECT r.rag_id, r.rag_no, z.zone_code, z.zone_name,
            COUNT(l.location_id) AS total,
            SUM(CASE WHEN l.status='OCCUPIED' THEN 1 ELSE 0 END) AS occupied,
            SUM(CASE WHEN l.status='EMPTY' THEN 1 ELSE 0 END) AS empty,
            SUM(CASE WHEN l.status='DISABLED' THEN 1 ELSE 0 END) AS disabled
       FROM rags r JOIN zones z ON z.zone_id = r.zone_id
       LEFT JOIN locations l ON l.rag_id = r.rag_id
      ${warehouseId ? 'WHERE z.warehouse_id = ?' : ''}
      GROUP BY r.rag_id, z.zone_id ORDER BY z.zone_code, r.rag_no`, ...(warehouseId ? [warehouseId] : []));

  for (const r of racks) {
    r.usable = r.total - r.disabled;
    r.usage_pct = r.usable ? Math.round((r.occupied / r.usable) * 1000) / 10 : 0;
  }

  const zones = [];
  for (const r of racks) {
    let z = zones.find((x) => x.zone_code === r.zone_code);
    if (!z) { z = { zone_code: r.zone_code, zone_name: r.zone_name, total: 0, occupied: 0, empty: 0, disabled: 0, racks: [] }; zones.push(z); }
    z.total += r.total; z.occupied += r.occupied; z.empty += r.empty; z.disabled += r.disabled;
    z.racks.push(r);
  }
  for (const z of zones) {
    z.usable = z.total - z.disabled;
    z.usage_pct = z.usable ? Math.round((z.occupied / z.usable) * 1000) / 10 : 0;
  }

  const overloaded = racks.filter((r) => r.usage_pct >= 85).sort((a, b) => b.usage_pct - a.usage_pct);
  const underused = racks.filter((r) => r.usage_pct <= 20 && r.usable > 0).sort((a, b) => a.usage_pct - b.usage_pct);

  return { zones, overloaded, underused };
}

/** 4. วิเคราะห์การเคลื่อนไหว */
export async function movementAnalytics({ days = 30, warehouseId = null } = {}) {
  const cutoff = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const mWhJoin = warehouseId
    ? ` JOIN locations lw ON lw.location_id = COALESCE(m.to_location_id, m.from_location_id)
        JOIN rags rw ON rw.rag_id = lw.rag_id JOIN zones zw ON zw.zone_id = rw.zone_id`
    : '';
  const mWhWhere = warehouseId ? ' AND zw.warehouse_id = ?' : '';
  const mWhP = warehouseId ? [warehouseId] : [];

  const byType = await all(
    `SELECT m.movement_type, COUNT(*) AS count, COALESCE(SUM(m.quantity), 0) AS total_qty
       FROM movements m${mWhJoin} WHERE m.moved_at >= ?${mWhWhere} GROUP BY m.movement_type`, cutoff, ...mWhP);

  const byDay = await all(
    `SELECT m.moved_at::date AS day, m.movement_type, COUNT(*) AS count
       FROM movements m${mWhJoin} WHERE m.moved_at >= ?${mWhWhere}
      GROUP BY day, m.movement_type ORDER BY day`, cutoff, ...mWhP);

  const topMoving = await all(
    `SELECT s.sku_code, s.sku_name, s.unit, COUNT(*) AS move_count,
            COALESCE(SUM(m.quantity), 0) AS total_qty
       FROM movements m JOIN skus s ON s.sku_id = m.sku_id${mWhJoin}
      WHERE m.moved_at >= ?${mWhWhere}
      GROUP BY s.sku_id ORDER BY move_count DESC LIMIT 10`, cutoff, ...mWhP);

  const sWhJoin = warehouseId ? ' JOIN rags rw ON rw.rag_id = l.rag_id JOIN zones zw ON zw.zone_id = rw.zone_id' : '';
  const sWhWhere = warehouseId ? ' AND zw.warehouse_id = ?' : '';
  const slowMoving = await all(
    `SELECT s.sku_code, s.sku_name, s.unit, i.lot_no, i.quantity,
            l.location_code, i.stored_at,
            ((now() AT TIME ZONE 'Asia/Bangkok')::date - i.stored_at::date) AS days_stored
       FROM stock_items i
       JOIN skus s ON s.sku_id = i.sku_id
       JOIN locations l ON l.location_id = i.location_id${sWhJoin}
      WHERE i.status = 'IN_STOCK'${sWhWhere}
        AND i.item_id NOT IN (
          SELECT DISTINCT item_id FROM movements
           WHERE moved_at >= ? AND item_id IS NOT NULL)
      ORDER BY i.stored_at LIMIT 20`, ...(warehouseId ? [warehouseId] : []), cutoff);

  return { days, byType, byDay, topMoving, slowMoving };
}

/** 5. ประสิทธิภาพพนักงาน */
export async function staffPerformance({ days = 30, warehouseId = null } = {}) {
  const cutoff = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const whJoin = warehouseId
    ? ` JOIN locations lw ON lw.location_id = COALESCE(m.to_location_id, m.from_location_id)
        JOIN rags rw ON rw.rag_id = lw.rag_id JOIN zones zw ON zw.zone_id = rw.zone_id`
    : '';
  const whWhere = warehouseId ? ' AND zw.warehouse_id = ?' : '';
  const whP = warehouseId ? [warehouseId] : [];

  const byUser = await all(
    `SELECT u.user_id, u.full_name, u.role,
            COUNT(*) AS total_actions,
            SUM(CASE WHEN m.movement_type='STORE' THEN 1 ELSE 0 END) AS stores,
            SUM(CASE WHEN m.movement_type='REMOVE' THEN 1 ELSE 0 END) AS removes,
            SUM(CASE WHEN m.movement_type='MOVE' THEN 1 ELSE 0 END) AS moves,
            SUM(CASE WHEN m.movement_type='EDIT' THEN 1 ELSE 0 END) AS edits,
            COALESCE(SUM(m.quantity), 0) AS total_qty
       FROM movements m JOIN users u ON u.user_id = m.user_id${whJoin}
      WHERE m.moved_at >= ?${whWhere}
      GROUP BY u.user_id ORDER BY total_actions DESC`, cutoff, ...whP);

  const byUserDay = await all(
    `SELECT u.full_name, m.moved_at::date AS day, COUNT(*) AS count
       FROM movements m JOIN users u ON u.user_id = m.user_id${whJoin}
      WHERE m.moved_at >= ?${whWhere}
      GROUP BY u.user_id, day ORDER BY u.full_name, day`, cutoff, ...whP);

  return { days, byUser, byUserDay };
}

const sum = (arr) => arr.reduce((a, r) => a + r.quantity, 0);
