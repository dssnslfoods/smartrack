// สมองวิเคราะห์ของ WMS — คำนวณด้วย SQL ล้วน ไม่พึ่ง AI
// ชั้น AI (services/ai.js) จะเอาผลจากที่นี่ไปเรียบเรียงเป็นคำแนะนำภาษาคนอีกที
// แยกกันแบบนี้เพื่อให้ตัวเลขตรวจสอบย้อนกลับได้เสมอ และใช้งานต่อได้แม้ไม่เปิด AI
import { all, get } from '../lib/db.js';

const num = (v, d = 0) => (v === null || v === undefined || v === '' ? d : Number(v));
const round = (v, p = 1) => (v === null || !Number.isFinite(v) ? null : Math.round(v * 10 ** p) / 10 ** p);
const cutoffDate = (days) => new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);

/** เงื่อนไขกรองคลัง — ใช้ร่วมกันหลายฟังก์ชัน */
const whClause = (warehouseId, alias = 'v') =>
  (warehouseId ? { sql: ` AND ${alias}.warehouse_id = ?`, params: [warehouseId] } : { sql: '', params: [] });

// ══════════════════════════════════════════════════════════════
//  1.3  Expiry Intelligence — คาดการณ์ Lot ที่จะขายไม่ทันหมดอายุ
// ══════════════════════════════════════════════════════════════
/**
 * หลักคิด: เทียบ "อัตราจ่ายออกจริง" ของแต่ละสินค้า กับ "คิวที่ Lot นี้จะถูกหยิบ" ตามลำดับ FEFO
 *  - cum_qty = จำนวนสะสมของ Lot ที่อยู่คิวก่อนหน้า + ตัวมันเอง
 *  - days_to_clear = cum_qty ÷ อัตราจ่ายออกต่อวัน  → กว่าจะขายหมด Lot นี้ใช้เวลากี่วัน
 *  - ถ้า days_to_clear > days_to_expiry แปลว่า "ขายไม่ทัน" → เป็นความเสี่ยง
 */
export async function expiryRisk({ warehouseId = null, lookbackDays = 90, horizonDays = 180 } = {}) {
  const cutoff = cutoffDate(lookbackDays);
  const w = whClause(warehouseId);

  const rows = await all(
    `WITH demand AS (
       SELECT m.sku_id,
              SUM(m.quantity)::numeric / ? AS per_day,
              SUM(m.quantity)             AS total_out,
              COUNT(DISTINCT m.doc_id)    AS order_count
         FROM movements m
         JOIN documents d ON d.doc_id = m.doc_id
        WHERE m.movement_type = 'REMOVE'
          AND d.doc_type = 'ISSUE' AND d.status = 'CONFIRMED'
          AND m.moved_at >= ?
        GROUP BY m.sku_id
     ),
     ranked AS (
       SELECT v.item_id, v.sku_id, v.sku_code, v.sku_name, v.unit, v.lot_no, v.quantity,
              v.exp_date, v.days_to_expiry, v.pct_remaining,
              v.location_code, v.rag_id, v.zone_code, v.warehouse_id, v.wh_name,
              s.unit_cost,
              COALESCE(dm.per_day, 0)     AS per_day,
              COALESCE(dm.total_out, 0)   AS total_out,
              COALESCE(dm.order_count, 0) AS order_count,
              SUM(v.quantity) OVER (
                PARTITION BY v.sku_id
                ORDER BY v.exp_date NULLS LAST, v.item_id
                ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
              ) AS cum_qty
         FROM v_stock v
         JOIN skus s ON s.sku_id = v.sku_id
         LEFT JOIN demand dm ON dm.sku_id = v.sku_id
        WHERE v.exp_date IS NOT NULL${w.sql}
     )
     SELECT * FROM ranked
      WHERE days_to_expiry <= ?
      ORDER BY days_to_expiry`,
    lookbackDays, cutoff, ...w.params, horizonDays);

  const channels = await all(
    `SELECT channel_id, channel_code, channel_name, min_pct_remaining
       FROM channels WHERE status = 'ACTIVE' AND min_pct_remaining IS NOT NULL
      ORDER BY min_pct_remaining DESC`);

  const items = rows.map((r) => {
    const perDay = num(r.per_day);
    const cum = num(r.cum_qty);
    const days = num(r.days_to_expiry, null);
    const daysToClear = perDay > 0 ? cum / perDay : null;

    // จะขายได้จริงกี่ชิ้นก่อนหมดอายุ = โควตายอดขายทั้งหมดในช่วงนั้น หักคิวที่อยู่ข้างหน้า
    const sellableByExpiry = perDay > 0 && days !== null
      ? Math.max(0, Math.min(num(r.quantity), perDay * days - (cum - num(r.quantity))))
      : null;
    const qtyAtRisk = sellableByExpiry === null ? null : Math.round(num(r.quantity) - sellableByExpiry);

    let risk = 'OK';
    if (days !== null && days < 0) risk = 'EXPIRED';
    else if (perDay <= 0) risk = num(r.quantity) > 0 ? 'NO_DEMAND' : 'OK';
    else if (daysToClear !== null && days !== null) {
      if (daysToClear > days) risk = 'WILL_EXPIRE';
      else if (daysToClear > days * 0.75) risk = 'TIGHT';
    }

    // ช่องทางที่ยังรับได้ตอนนี้ และอีกกี่วันจะหลุดเกณฑ์
    const pct = r.pct_remaining === null ? null : num(r.pct_remaining);
    const pctPerDay = pct !== null && days !== null && days > 0 ? pct / days : null;
    const channelFit = pct === null ? [] : channels.map((c) => {
      const ok = pct >= num(c.min_pct_remaining);
      const daysLeft = ok && pctPerDay > 0
        ? Math.floor((pct - num(c.min_pct_remaining)) / pctPerDay) : (ok ? null : 0);
      return { channel_code: c.channel_code, channel_name: c.channel_name,
        min_pct: num(c.min_pct_remaining), eligible: ok, days_until_ineligible: daysLeft };
    });

    const cost = r.unit_cost === null || r.unit_cost === undefined ? null : num(r.unit_cost);
    return {
      item_id: r.item_id, sku_id: r.sku_id, sku_code: r.sku_code, sku_name: r.sku_name, unit: r.unit,
      lot_no: r.lot_no, quantity: num(r.quantity), location_code: r.location_code, rag_id: r.rag_id,
      zone_code: r.zone_code, wh_name: r.wh_name,
      exp_date: r.exp_date, days_to_expiry: days, pct_remaining: pct,
      demand_per_day: round(perDay, 2), sold_last_period: num(r.total_out), order_count: num(r.order_count),
      queue_qty: Math.round(cum), days_to_clear: round(daysToClear, 1),
      qty_at_risk: qtyAtRisk, value_at_risk: qtyAtRisk !== null && cost !== null ? round(qtyAtRisk * cost, 2) : null,
      risk, channels: channelFit,
      eligible_now: channelFit.filter((c) => c.eligible).map((c) => c.channel_code),
    };
  });

  const atRisk = items.filter((i) => i.risk === 'WILL_EXPIRE' || i.risk === 'EXPIRED' || i.risk === 'NO_DEMAND');
  const summary = {
    lookback_days: lookbackDays, horizon_days: horizonDays,
    lots_checked: items.length,
    lots_at_risk: atRisk.length,
    qty_at_risk: atRisk.reduce((s, i) => s + (i.qty_at_risk ?? i.quantity), 0),
    value_at_risk: atRisk.some((i) => i.value_at_risk !== null)
      ? round(atRisk.reduce((s, i) => s + (i.value_at_risk ?? 0), 0), 2) : null,
    by_risk: ['EXPIRED', 'WILL_EXPIRE', 'NO_DEMAND', 'TIGHT', 'OK']
      .map((k) => ({ risk: k, count: items.filter((i) => i.risk === k).length }))
      .filter((x) => x.count > 0),
  };
  return { summary, items, at_risk: atRisk.sort((a, b) => (a.days_to_expiry ?? 1e9) - (b.days_to_expiry ?? 1e9)) };
}

// ══════════════════════════════════════════════════════════════
//  2.1  Smart Slotting — จัดตำแหน่งใหม่ตามความถี่หยิบ (ABC)
// ══════════════════════════════════════════════════════════════
/** ต้นทุนการเข้าถึงตำแหน่ง: ชั้นยิ่งสูง/ยิ่งลึก ยิ่งหยิบยาก (D1 หน้าสุดเข้าถึงตรง) */
const accessCost = (level, depth) => (num(level) - 1) * 3 + (num(depth) - 1) * 2;

export async function slotting({ warehouseId = null, days = 90 } = {}) {
  const cutoff = cutoffDate(days);
  const w = whClause(warehouseId);

  // ความถี่หยิบต่อสินค้า — นับ "จำนวนครั้ง" เพราะสะท้อนแรงงานเดินหยิบมากกว่าจำนวนชิ้น
  const freq = await all(
    `SELECT m.sku_id, s.sku_code, s.sku_name, s.unit,
            COUNT(*) AS pick_count, COALESCE(SUM(m.quantity), 0) AS pick_qty
       FROM movements m
       JOIN skus s ON s.sku_id = m.sku_id
      WHERE m.movement_type = 'REMOVE' AND m.moved_at >= ?
      GROUP BY m.sku_id, s.sku_code, s.sku_name, s.unit
      ORDER BY pick_count DESC`, cutoff);

  const totalPicks = freq.reduce((s, r) => s + num(r.pick_count), 0);
  let cum = 0;
  const classOf = new Map();
  for (const r of freq) {
    cum += num(r.pick_count);
    const share = totalPicks ? cum / totalPicks : 1;
    const cls = share <= 0.8 ? 'A' : share <= 0.95 ? 'B' : 'C';
    classOf.set(r.sku_id, { ...r, pick_count: num(r.pick_count), pick_qty: num(r.pick_qty), class: cls,
      share_pct: round((num(r.pick_count) / (totalPicks || 1)) * 100, 2) });
  }

  const stock = await all(
    `SELECT v.item_id, v.sku_id, v.sku_code, v.sku_name, v.unit, v.lot_no, v.quantity,
            v.location_code, v.level, v.depth, v.rag_id, v.rag_no, v.zone_code, v.warehouse_id
       FROM v_stock v WHERE 1=1${w.sql}`, ...w.params);

  const empties = await all(
    `SELECT l.location_code, l.level, l.depth, r.rag_id, r.rag_no, z.zone_code, z.warehouse_id
       FROM locations l
       JOIN rags r ON r.rag_id = l.rag_id
       JOIN zones z ON z.zone_id = r.zone_id
      WHERE l.status = 'EMPTY'
        AND l.location_id NOT IN (SELECT location_id FROM stock_items WHERE status='IN_STOCK' AND location_id IS NOT NULL)
        ${warehouseId ? 'AND z.warehouse_id = ?' : ''}`, ...(warehouseId ? [warehouseId] : []));

  const placed = stock.map((s) => ({
    ...s, quantity: num(s.quantity),
    class: classOf.get(s.sku_id)?.class ?? 'C',
    pick_count: classOf.get(s.sku_id)?.pick_count ?? 0,
    cost: accessCost(s.level, s.depth),
  }));

  // แนะนำสลับ: ของหมุนเร็วที่อยู่ตำแหน่งเข้าถึงยาก ↔ ของหมุนช้าที่ครองตำแหน่งดี
  const hot = placed.filter((p) => p.class === 'A' && p.cost >= 3).sort((a, b) => b.pick_count - a.pick_count || b.cost - a.cost);
  const cold = placed.filter((p) => p.class === 'C' && p.cost <= 2).sort((a, b) => a.pick_count - b.pick_count || a.cost - b.cost);

  const swaps = [];
  const usedCold = new Set();
  for (const h of hot) {
    const c = cold.find((x) => !usedCold.has(x.item_id) && x.zone_code === h.zone_code && x.cost < h.cost);
    if (!c) continue;
    usedCold.add(c.item_id);
    swaps.push({
      type: 'SWAP',
      hot: { item_id: h.item_id, sku_code: h.sku_code, sku_name: h.sku_name, lot_no: h.lot_no,
        quantity: h.quantity, unit: h.unit, location_code: h.location_code, level: h.level, depth: h.depth,
        pick_count: h.pick_count, class: h.class },
      cold: { item_id: c.item_id, sku_code: c.sku_code, sku_name: c.sku_name, lot_no: c.lot_no,
        quantity: c.quantity, unit: c.unit, location_code: c.location_code, level: c.level, depth: c.depth,
        pick_count: c.pick_count, class: c.class },
      cost_saved: h.cost - c.cost,
      trips_saved_per_month: round((h.pick_count / days) * 30, 1),
      score: round(((h.cost - c.cost) * h.pick_count) / days * 30, 1),
    });
    if (swaps.length >= 20) break;
  }

  // ย้ายเปล่า: ของหมุนเร็วอยู่ตำแหน่งแย่ แต่มีตำแหน่งว่างที่ดีกว่าในโซนเดียวกัน
  const moves = [];
  const usedEmpty = new Set();
  for (const h of hot) {
    if (swaps.some((s) => s.hot.item_id === h.item_id)) continue;
    const better = empties
      .filter((e) => !usedEmpty.has(e.location_code) && e.zone_code === h.zone_code && accessCost(e.level, e.depth) < h.cost)
      .sort((a, b) => accessCost(a.level, a.depth) - accessCost(b.level, b.depth))[0];
    if (!better) continue;
    usedEmpty.add(better.location_code);
    moves.push({
      type: 'MOVE',
      item: { item_id: h.item_id, sku_code: h.sku_code, sku_name: h.sku_name, lot_no: h.lot_no,
        quantity: h.quantity, unit: h.unit, location_code: h.location_code, pick_count: h.pick_count, class: h.class },
      to: { location_code: better.location_code, level: better.level, depth: better.depth, rag_id: better.rag_id },
      cost_saved: h.cost - accessCost(better.level, better.depth),
      trips_saved_per_month: round((h.pick_count / days) * 30, 1),
      score: round(((h.cost - accessCost(better.level, better.depth)) * h.pick_count) / days * 30, 1),
    });
    if (moves.length >= 20) break;
  }

  const abc = ['A', 'B', 'C'].map((c) => {
    const skus = [...classOf.values()].filter((x) => x.class === c);
    const items = placed.filter((p) => p.class === c);
    return {
      class: c, sku_count: skus.length,
      pick_share_pct: round(skus.reduce((s, x) => s + x.share_pct, 0), 1),
      avg_access_cost: items.length ? round(items.reduce((s, i) => s + i.cost, 0) / items.length, 2) : null,
      items_placed: items.length,
    };
  });

  const recs = [...swaps, ...moves].sort((a, b) => b.score - a.score).slice(0, 20);
  return {
    days, total_picks: totalPicks, abc,
    top_skus: [...classOf.values()].slice(0, 15),
    recommendations: recs,
    potential_trips_saved_per_month: round(recs.reduce((s, r) => s + num(r.trips_saved_per_month), 0), 1),
  };
}

// ══════════════════════════════════════════════════════════════
//  2.2  Demand Forecast — พยากรณ์ความต้องการ & จุดสั่งเติม
// ══════════════════════════════════════════════════════════════
/** ใช้ค่าเฉลี่ยถ่วงน้ำหนัก (สัปดาห์ล่าสุดมีน้ำหนักมากกว่า) + แนวโน้มเชิงเส้นอย่างง่าย */
export async function demandForecast({ warehouseId = null, weeks = 12, leadTimeDays = 21 } = {}) {
  const cutoff = cutoffDate(weeks * 7);

  const weekly = await all(
    `SELECT m.sku_id, s.sku_code, s.sku_name, s.unit,
            FLOOR((( now() AT TIME ZONE 'Asia/Bangkok')::date - m.moved_at::date) / 7) AS weeks_ago,
            COALESCE(SUM(m.quantity), 0) AS qty
       FROM movements m
       JOIN skus s ON s.sku_id = m.sku_id
       JOIN documents d ON d.doc_id = m.doc_id
      WHERE m.movement_type = 'REMOVE'
        AND d.doc_type = 'ISSUE' AND d.status = 'CONFIRMED'
        AND m.moved_at >= ?
      GROUP BY m.sku_id, s.sku_code, s.sku_name, s.unit, weeks_ago
      ORDER BY m.sku_id, weeks_ago`, cutoff);

  const w = whClause(warehouseId);
  const onHand = await all(
    `SELECT v.sku_id, SUM(v.quantity) AS qty, COUNT(*) AS lots
       FROM v_stock v WHERE 1=1${w.sql} GROUP BY v.sku_id`, ...w.params);
  const stockBySku = new Map(onHand.map((r) => [r.sku_id, { qty: num(r.qty), lots: num(r.lots) }]));

  const bySku = new Map();
  for (const r of weekly) {
    if (!bySku.has(r.sku_id))
      bySku.set(r.sku_id, { sku_id: r.sku_id, sku_code: r.sku_code, sku_name: r.sku_name, unit: r.unit, series: Array(weeks).fill(0) });
    const idx = num(r.weeks_ago);
    if (idx >= 0 && idx < weeks) bySku.get(r.sku_id).series[idx] = num(r.qty);
  }

  const items = [...bySku.values()].map((s) => {
    // series[0] = สัปดาห์ล่าสุด → เรียงกลับให้เก่า→ใหม่ เพื่อคำนวณแนวโน้ม
    const hist = [...s.series].reverse();
    const n = hist.length;
    const weightsSum = (n * (n + 1)) / 2;
    const weighted = hist.reduce((acc, v, i) => acc + v * (i + 1), 0) / (weightsSum || 1);
    const simple = hist.reduce((a, v) => a + v, 0) / (n || 1);

    // ความชันจาก least squares
    const meanX = (n - 1) / 2;
    const meanY = simple;
    let sxy = 0, sxx = 0;
    hist.forEach((v, i) => { sxy += (i - meanX) * (v - meanY); sxx += (i - meanX) ** 2; });
    const slope = sxx ? sxy / sxx : 0;

    const forecastWeek = Math.max(0, weighted + slope * 0.5);
    const perDay = forecastWeek / 7;
    const stock = stockBySku.get(s.sku_id) ?? { qty: 0, lots: 0 };
    const daysOfStock = perDay > 0 ? stock.qty / perDay : null;
    const reorderPoint = Math.ceil(perDay * leadTimeDays);

    let status = 'OK';
    if (perDay <= 0) status = stock.qty > 0 ? 'IDLE' : 'OK';
    else if (stock.qty <= 0) status = 'OUT_OF_STOCK';
    else if (daysOfStock !== null && daysOfStock < leadTimeDays) status = 'REORDER_NOW';
    else if (daysOfStock !== null && daysOfStock < leadTimeDays * 1.5) status = 'REORDER_SOON';
    else if (daysOfStock !== null && daysOfStock > 180) status = 'OVERSTOCK';

    const nonZero = hist.filter((v) => v > 0);
    const variability = nonZero.length > 1
      ? round(Math.sqrt(hist.reduce((a, v) => a + (v - simple) ** 2, 0) / n) / (simple || 1), 2) : null;

    return {
      sku_id: s.sku_id, sku_code: s.sku_code, sku_name: s.sku_name, unit: s.unit,
      history_weekly: hist,
      avg_weekly: round(simple, 1),
      forecast_weekly: round(forecastWeek, 1),
      forecast_daily: round(perDay, 2),
      trend: slope > simple * 0.05 ? 'UP' : slope < -simple * 0.05 ? 'DOWN' : 'FLAT',
      trend_slope: round(slope, 2),
      variability,
      on_hand: stock.qty, lots: stock.lots,
      days_of_stock: round(daysOfStock, 1),
      reorder_point: reorderPoint,
      suggested_order_qty: status === 'REORDER_NOW' || status === 'REORDER_SOON' || status === 'OUT_OF_STOCK'
        ? Math.max(0, Math.ceil(perDay * leadTimeDays * 2 - stock.qty)) : 0,
      stockout_date: daysOfStock !== null && Number.isFinite(daysOfStock)
        ? new Date(Date.now() + daysOfStock * 86400_000).toISOString().slice(0, 10) : null,
      status,
    };
  });

  // สินค้าที่มีของแต่ไม่เคยขายในช่วงที่ดู
  const seen = new Set(items.map((i) => i.sku_id));
  const idle = onHand.filter((r) => !seen.has(r.sku_id) && num(r.qty) > 0);

  const order = { OUT_OF_STOCK: 0, REORDER_NOW: 1, REORDER_SOON: 2, OVERSTOCK: 3, IDLE: 4, OK: 5 };
  items.sort((a, b) => (order[a.status] - order[b.status]) || ((a.days_of_stock ?? 1e9) - (b.days_of_stock ?? 1e9)));

  return {
    weeks, lead_time_days: leadTimeDays,
    summary: {
      skus_analyzed: items.length,
      reorder_now: items.filter((i) => i.status === 'REORDER_NOW' || i.status === 'OUT_OF_STOCK').length,
      reorder_soon: items.filter((i) => i.status === 'REORDER_SOON').length,
      overstock: items.filter((i) => i.status === 'OVERSTOCK').length,
      idle_skus: idle.length,
    },
    items,
  };
}

// ══════════════════════════════════════════════════════════════
//  2.3  Anomaly Detection — ตรวจจับความผิดปกติ
// ══════════════════════════════════════════════════════════════
export async function anomalies({ warehouseId = null, days = 60 } = {}) {
  const cutoff = cutoffDate(days);
  const found = [];

  // ① ผลต่างนับสต็อกซ้ำที่ตำแหน่งเดิม — สัญญาณของหาย หรือกระบวนการมีปัญหา
  const varLoc = await all(
    `SELECT l.location_code, z.zone_code, s.sku_code, s.sku_name,
            COUNT(*) AS times, SUM(ABS(cl.counted_qty - cl.expected_qty)) AS total_diff,
            SUM(cl.counted_qty - cl.expected_qty) AS net_diff
       FROM count_lines cl
       JOIN count_rounds cr ON cr.round_id = cl.round_id
       JOIN locations l ON l.location_id = cl.location_id
       JOIN rags r ON r.rag_id = l.rag_id
       JOIN zones z ON z.zone_id = r.zone_id
       LEFT JOIN skus s ON s.sku_id = cl.sku_id
      WHERE cr.status = 'APPROVED' AND cr.approved_at >= ?
        AND cl.counted_qty IS NOT NULL AND cl.counted_qty <> cl.expected_qty
        ${warehouseId ? 'AND z.warehouse_id = ?' : ''}
      GROUP BY l.location_code, z.zone_code, s.sku_code, s.sku_name
     HAVING COUNT(*) >= 2
      ORDER BY total_diff DESC LIMIT 15`, cutoff, ...(warehouseId ? [warehouseId] : []));
  for (const r of varLoc)
    found.push({
      type: 'COUNT_VARIANCE', severity: num(r.total_diff) > 50 ? 'HIGH' : 'MEDIUM',
      title: `ตำแหน่ง ${r.location_code} นับไม่ตรง ${r.times} รอบติด`,
      detail: `ผลต่างสะสม ${num(r.total_diff)} หน่วย (สุทธิ ${num(r.net_diff) > 0 ? '+' : ''}${num(r.net_diff)})${r.sku_name ? ` — ${r.sku_name}` : ''}`,
      hint: 'ตรวจสอบว่าเป็นของหาย การหยิบไม่บันทึก หรือป้ายตำแหน่งสับสน',
      ref: { location_code: r.location_code, zone_code: r.zone_code, sku_code: r.sku_code },
      metric: num(r.total_diff),
    });

  // ② การแก้ไขจำนวน (EDIT) ถี่ผิดปกติรายคน — เทียบกับค่าเฉลี่ยของทั้งทีม
  const edits = await all(
    `SELECT u.user_id, u.full_name, u.role,
            SUM(CASE WHEN m.movement_type='EDIT' THEN 1 ELSE 0 END) AS edits,
            COUNT(*) AS total
       FROM movements m JOIN users u ON u.user_id = m.user_id
      WHERE m.moved_at >= ?
      GROUP BY u.user_id, u.full_name, u.role
     HAVING COUNT(*) >= 10`, cutoff);
  if (edits.length >= 2) {
    const rates = edits.map((e) => num(e.edits) / num(e.total, 1));
    const mean = rates.reduce((a, v) => a + v, 0) / rates.length;
    const sd = Math.sqrt(rates.reduce((a, v) => a + (v - mean) ** 2, 0) / rates.length);
    edits.forEach((e, i) => {
      if (sd > 0 && rates[i] > mean + 2 * sd && num(e.edits) >= 3)
        found.push({
          type: 'EDIT_SPIKE', severity: 'MEDIUM',
          title: `${e.full_name} แก้ไขจำนวนบ่อยผิดปกติ`,
          detail: `แก้ไข ${num(e.edits)} ครั้งจาก ${num(e.total)} รายการ (${round(rates[i] * 100, 1)}% เทียบค่าเฉลี่ยทีม ${round(mean * 100, 1)}%)`,
          hint: 'อาจเป็นการรับเข้าที่คีย์ผิดบ่อย หรือต้องอบรมเพิ่ม',
          ref: { user_id: e.user_id, full_name: e.full_name },
          metric: round(rates[i] * 100, 1),
        });
    });
  }

  // ③ ใบจ่ายสินค้าค้างสถานะนานเกินควร
  const stuck = await all(
    `SELECT doc_id, doc_no, party, ship_status, ref_no,
            COALESCE(shipped_at, packed_at, picked_at, created_at) AS since,
            ((now() AT TIME ZONE 'Asia/Bangkok')::date
              - COALESCE(shipped_at, packed_at, picked_at, created_at)::date) AS days_stuck
       FROM documents
      WHERE doc_type='ISSUE' AND status='CONFIRMED'
        AND ship_status IN ('PICKED','PACKED','SHIPPED')
        AND COALESCE(shipped_at, packed_at, picked_at, created_at)
            < (now() AT TIME ZONE 'Asia/Bangkok') - INTERVAL '3 days'
      ORDER BY days_stuck DESC LIMIT 15`);
  const stuckLabel = { PICKED: 'หยิบแล้วแต่ยังไม่แพ็ค', PACKED: 'แพ็คแล้วแต่ยังไม่ส่ง', SHIPPED: 'ส่งแล้วแต่ยังไม่ยืนยันถึงปลายทาง' };
  for (const d of stuck)
    found.push({
      type: 'STUCK_SHIPMENT', severity: num(d.days_stuck) > 7 ? 'HIGH' : 'MEDIUM',
      title: `${d.doc_no} ค้างสถานะ ${num(d.days_stuck)} วัน`,
      detail: `${stuckLabel[d.ship_status] ?? d.ship_status}${d.party ? ` — ${d.party}` : ''}${d.ref_no ? ` (SO ${d.ref_no})` : ''}`,
      hint: 'ตามงานหรืออัปเดตสถานะให้ตรงกับความจริง',
      ref: { doc_id: d.doc_id, doc_no: d.doc_no },
      metric: num(d.days_stuck),
    });

  // ④ Lot เก่าค้างในคลังทั้งที่ Lot ใหม่กว่าถูกหยิบไปแล้ว — ผิดหลัก FEFO
  const w = whClause(warehouseId);
  const fefo = await all(
    `WITH oldest AS (
       SELECT DISTINCT ON (v.sku_id) v.sku_id, v.item_id, v.sku_code, v.sku_name,
              v.lot_no, v.exp_date, v.quantity, v.location_code, v.stored_at
         FROM v_stock v
        WHERE v.exp_date IS NOT NULL${w.sql}
        ORDER BY v.sku_id, v.exp_date
     )
     SELECT o.*,
            (SELECT COUNT(*) FROM movements m
              JOIN stock_items si ON si.item_id = m.item_id
              WHERE m.movement_type='REMOVE' AND m.sku_id = o.sku_id
                AND m.moved_at >= ?
                AND si.exp_date > o.exp_date) AS newer_picked
       FROM oldest o
      WHERE (SELECT COUNT(*) FROM movements m
              JOIN stock_items si ON si.item_id = m.item_id
              WHERE m.movement_type='REMOVE' AND m.sku_id = o.sku_id
                AND m.moved_at >= ? AND si.exp_date > o.exp_date) > 0
      ORDER BY o.exp_date LIMIT 10`, ...w.params, cutoff, cutoff);
  for (const r of fefo)
    found.push({
      type: 'FEFO_VIOLATION', severity: 'MEDIUM',
      title: `${r.sku_name} — Lot เก่าถูกข้าม`,
      detail: `Lot ${r.lot_no ?? '-'} (หมดอายุ ${String(r.exp_date).slice(0, 10)}) ยังอยู่ที่ ${r.location_code} แต่มีการหยิบ Lot ที่หมดอายุช้ากว่าไปแล้ว ${num(r.newer_picked)} ครั้ง`,
      hint: 'ตรวจสอบว่าตำแหน่งเข้าถึงยากหรือพนักงานข้ามลำดับ FEFO',
      ref: { item_id: r.item_id, sku_code: r.sku_code, location_code: r.location_code },
      metric: num(r.newer_picked),
    });

  // ⑤ ปริมาณงานรายวันพุ่ง/ตกผิดปกติ (z-score)
  const daily = await all(
    `SELECT m.moved_at::date AS day, COUNT(*) AS cnt
       FROM movements m WHERE m.moved_at >= ?
      GROUP BY day ORDER BY day`, cutoff);
  if (daily.length >= 10) {
    const vals = daily.map((d) => num(d.cnt));
    const mean = vals.reduce((a, v) => a + v, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length);
    daily.slice(-14).forEach((d, i) => {
      const v = num(d.cnt);
      const z = sd ? (v - mean) / sd : 0;
      if (Math.abs(z) >= 2.5)
        found.push({
          type: 'VOLUME_ANOMALY', severity: 'LOW',
          title: `ปริมาณงานวันที่ ${String(d.day).slice(0, 10)} ${z > 0 ? 'สูง' : 'ต่ำ'}ผิดปกติ`,
          detail: `${v} รายการ (ค่าเฉลี่ย ${round(mean, 1)} รายการ/วัน)`,
          hint: z > 0 ? 'ตรวจว่ามีออเดอร์ก้อนใหญ่หรือคีย์ย้อนหลัง' : 'ตรวจว่าลืมบันทึกงานหรือไม่',
          ref: { day: String(d.day).slice(0, 10) },
          metric: round(z, 2),
        });
    });
  }

  const rank = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  found.sort((a, b) => rank[a.severity] - rank[b.severity] || num(b.metric) - num(a.metric));
  return {
    days,
    summary: {
      total: found.length,
      high: found.filter((f) => f.severity === 'HIGH').length,
      medium: found.filter((f) => f.severity === 'MEDIUM').length,
      low: found.filter((f) => f.severity === 'LOW').length,
      by_type: [...new Set(found.map((f) => f.type))].map((t) => ({ type: t, count: found.filter((f) => f.type === t).length })),
    },
    findings: found,
  };
}

// ══════════════════════════════════════════════════════════════
//  3.2  Labor Planning — คาดการณ์ภาระงานและกำลังคน
// ══════════════════════════════════════════════════════════════
export async function laborPlan({ warehouseId = null, days = 60 } = {}) {
  const cutoff = cutoffDate(days);

  const byDow = await all(
    `SELECT EXTRACT(DOW FROM m.moved_at)::int AS dow, COUNT(*) AS cnt,
            COUNT(DISTINCT m.moved_at::date) AS day_count
       FROM movements m WHERE m.moved_at >= ?
      GROUP BY dow ORDER BY dow`, cutoff);

  const byHour = await all(
    `SELECT EXTRACT(HOUR FROM m.moved_at)::int AS hour, COUNT(*) AS cnt
       FROM movements m WHERE m.moved_at >= ?
      GROUP BY hour ORDER BY hour`, cutoff);

  const staff = await all(
    `SELECT u.user_id, u.full_name, u.role, COUNT(*) AS actions,
            COUNT(DISTINCT m.moved_at::date) AS active_days
       FROM movements m JOIN users u ON u.user_id = m.user_id
      WHERE m.moved_at >= ?
      GROUP BY u.user_id, u.full_name, u.role
      ORDER BY actions DESC`, cutoff);

  const DOW = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
  const perDay = byDow.map((r) => ({
    dow: num(r.dow), dow_name: DOW[num(r.dow)],
    total: num(r.cnt), day_count: num(r.day_count),
    avg_actions: round(num(r.cnt) / num(r.day_count, 1), 1),
  }));

  // ใช้เฉพาะคนที่ทำงานอย่างน้อย 3 วันเพื่อให้ค่าเฉลี่ยนิ่ง — ถ้าข้อมูลยังน้อยให้ใช้ทุกคนไปก่อน
  const rateOf = (s) => num(s.actions) / num(s.active_days, 1);
  const steady = staff.filter((s) => num(s.active_days) >= 3);
  const rates = (steady.length ? steady : staff).map(rateOf);
  const avgRate = rates.length ? rates.reduce((a, v) => a + v, 0) / rates.length : 0;

  // ประมาณคนที่ต้องใช้ในแต่ละวันของสัปดาห์ จากภาระงานเฉลี่ย ÷ กำลังต่อคนต่อวัน
  const staffing = perDay.map((d) => ({
    ...d,
    suggested_staff: avgRate > 0 ? Math.max(1, Math.ceil(d.avg_actions / avgRate)) : null,
  }));

  const peakHours = byHour
    .map((r) => ({ hour: num(r.hour), count: num(r.cnt) }))
    .sort((a, b) => b.count - a.count).slice(0, 4).sort((a, b) => a.hour - b.hour);

  return {
    days,
    avg_actions_per_person_per_day: round(avgRate, 1),
    by_day_of_week: staffing,
    by_hour: byHour.map((r) => ({ hour: num(r.hour), count: num(r.cnt) })),
    peak_hours: peakHours,
    staff: staff.map((s) => ({
      user_id: s.user_id, full_name: s.full_name, role: s.role,
      actions: num(s.actions), active_days: num(s.active_days),
      actions_per_day: round(num(s.actions) / num(s.active_days, 1), 1),
    })),
  };
}

// ══════════════════════════════════════════════════════════════
//  ภาพรวมสำหรับหน้า AI Insights และให้ AI ใช้ตอบคำถาม
// ══════════════════════════════════════════════════════════════
export async function insightSnapshot({ warehouseId = null } = {}) {
  const [risk, slot, fc, anom] = await Promise.all([
    expiryRisk({ warehouseId }),
    slotting({ warehouseId }),
    demandForecast({ warehouseId }),
    anomalies({ warehouseId }),
  ]);
  return {
    expiry: { summary: risk.summary, top: risk.at_risk.slice(0, 10) },
    slotting: { abc: slot.abc, potential_trips_saved_per_month: slot.potential_trips_saved_per_month,
      top_recommendations: slot.recommendations.slice(0, 5) },
    forecast: { summary: fc.summary, urgent: fc.items.filter((i) => ['OUT_OF_STOCK', 'REORDER_NOW'].includes(i.status)).slice(0, 10) },
    anomalies: { summary: anom.summary, top: anom.findings.slice(0, 8) },
  };
}
