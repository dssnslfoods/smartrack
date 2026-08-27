// เฟส 2: กฎอายุคงเหลือรายช่องทาง + ศูนย์จัดการสินค้าใกล้หมดอายุ + รายงาน Recall
// แทนงาน Excel เดิม: MT ต้อง ≥80% · GT ต้อง ≥50% · <12 เดือนย้ายเข้า PROM · <4 เดือนตัดออก
import { all, get, run } from '../lib/db.js';
import { badRequest, notFound } from '../lib/http.js';
import { listMovements } from './inventory.js';

const DAYS_PER_MONTH = 30.44;

// ---------------------------------------------------------------- ค่าตั้งระบบ
export async function getSettings() {
  const rows = await all('SELECT * FROM app_settings');
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    expiry_move_months: Number(map.expiry_move_months ?? 12),
    expiry_cutoff_months: Number(map.expiry_cutoff_months ?? 4),
  };
}

export async function saveSettings(body) {
  for (const key of ['expiry_move_months', 'expiry_cutoff_months']) {
    if (body[key] === undefined) continue;
    const n = Number(body[key]);
    if (!Number.isFinite(n) || n < 0) throw badRequest(`ค่า ${key} ไม่ถูกต้อง`);
    await run(
      `INSERT INTO app_settings (key, value) VALUES (?,?)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      key, String(n),
    );
  }
  return await getSettings();
}

// ---------------------------------------------------------------- ช่องทางขาย
export const listChannels = () =>
  all('SELECT * FROM channels ORDER BY channel_code');

export async function saveChannel(body, channelId = null) {
  const code = (body.channel_code ?? '').trim().toUpperCase();
  if (!code || !(body.channel_name ?? '').trim()) throw badRequest('กรุณากรอกรหัสและชื่อช่องทาง');
  const pct = body.min_pct_remaining === null || body.min_pct_remaining === '' || body.min_pct_remaining === undefined
    ? null : Number(body.min_pct_remaining);
  if (pct !== null && (!Number.isFinite(pct) || pct < 0 || pct > 100)) throw badRequest('% อายุคงเหลือขั้นต่ำต้องอยู่ระหว่าง 0–100');

  if (channelId) {
    const ch = await get('SELECT * FROM channels WHERE channel_id = ?', Number(channelId));
    if (!ch) throw notFound('ไม่พบช่องทาง');
    await run('UPDATE channels SET channel_code=?, channel_name=?, min_pct_remaining=?, status=? WHERE channel_id=?',
      code, body.channel_name.trim(), pct, body.status ?? ch.status, Number(channelId));
    return await get('SELECT * FROM channels WHERE channel_id = ?', Number(channelId));
  }
  const r = await run('INSERT INTO channels (channel_code, channel_name, min_pct_remaining) VALUES (?,?,?)',
    code, body.channel_name.trim(), pct);
  return await get('SELECT * FROM channels WHERE channel_id = ?', Number(r.lastInsertRowid));
}

// ---------------------------------------------------------------- ศูนย์จัดการอายุสินค้า
/**
 * รายการสินค้าทุก Lot ที่มีวันหมดอายุ พร้อม:
 *  - % อายุคงเหลือ + เดือนคงเหลือ
 *  - ขายได้ช่องทางไหนบ้าง (เทียบ min_pct_remaining ของแต่ละช่องทาง)
 *  - คำแนะนำ: CUTOFF (ตัดออก) / MOVE (ย้ายเข้าโซนโปรโมชัน) / WATCH / OK
 */
export async function expiryActions({ warehouseId = null } = {}) {
  const [settings, channels] = await Promise.all([getSettings(), listChannels()]);
  const active = channels.filter((c) => c.status === 'ACTIVE');

  const params = [];
  let where = 'v.exp_date IS NOT NULL';
  if (warehouseId) { where += ' AND v.warehouse_id = ?'; params.push(Number(warehouseId)); }

  const rows = await all(
    `SELECT v.* FROM v_stock v WHERE ${where} ORDER BY v.exp_date, v.location_code`,
    ...params,
  );

  const items = rows.map((r) => {
    const months = Math.floor(r.days_to_expiry / DAYS_PER_MONTH * 10) / 10;
    const channels_ok = active
      .filter((c) => c.min_pct_remaining === null || (r.pct_remaining !== null && r.pct_remaining >= c.min_pct_remaining))
      .map((c) => c.channel_code);
    let action = 'OK';
    if (r.days_to_expiry < 0) action = 'EXPIRED';
    else if (months < settings.expiry_cutoff_months) action = 'CUTOFF';
    else if (months < settings.expiry_move_months) action = 'MOVE';
    else if (channels_ok.length < active.length) action = 'WATCH';
    return { ...r, months_left: months, channels_ok, action };
  });

  const summary = { EXPIRED: 0, CUTOFF: 0, MOVE: 0, WATCH: 0, OK: 0 };
  for (const i of items) summary[i.action]++;

  const rank = { EXPIRED: 0, CUTOFF: 1, MOVE: 2, WATCH: 3, OK: 4 };
  items.sort((a, b) => rank[a.action] - rank[b.action] || a.days_to_expiry - b.days_to_expiry);

  return { settings, channels: active, summary, items };
}

// ---------------------------------------------------------------- Recall ราย Lot
/**
 * รายงานเรียกคืนสินค้า: Lot นี้ตอนนี้อยู่ที่ไหนบ้าง + เคยจ่ายออกไปที่ใคร (ผ่านเอกสารใบไหน)
 */
export async function recallReport({ lot_no, sku_id = null }) {
  const lot = (lot_no ?? '').trim();
  if (!lot) throw badRequest('กรุณาระบุ Lot ที่ต้องการตรวจสอบ');

  const params = [lot];
  let skuWhere = '';
  if (sku_id) { skuWhere = ' AND v.sku_id = ?'; params.push(Number(sku_id)); }

  const in_stock = await all(
    `SELECT v.* FROM v_stock v WHERE v.lot_no = ?${skuWhere} ORDER BY v.location_code`, ...params);

  const movements = await listMovements({ lot_no: lot, sku_id, limit: 1000 });
  const issued = movements.filter((m) => m.movement_type === 'REMOVE' && m.doc_type === 'ISSUE');

  return {
    lot_no: lot,
    in_stock,
    total_in_stock: in_stock.reduce((s, r) => s + r.quantity, 0),
    issued: issued.map((m) => ({
      moved_at: m.moved_at, quantity: m.quantity, sku_code: m.sku_code, sku_name: m.sku_name,
      doc_no: m.doc_no, so_ref: m.doc_ref, customer: m.doc_party,
    })),
    total_issued: issued.reduce((s, m) => s + Number(m.quantity || 0), 0),
    movements,
  };
}
