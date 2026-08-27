// REST API — เท่าที่ระบบต้องใช้จริง: ค้นหา · จัดเก็บ/หยิบ/ย้าย · ประวัติ · ข้อมูลหลัก
import { all, get, run, tx } from '../lib/db.js';
import { badRequest, conflict, notFound, int } from '../lib/http.js';
import { login, logout, listUsers, hashSecret, PERMISSIONS, ROLE_NAME } from '../lib/auth.js';
import { syncRagLocations, rackMap, emptyLocations } from '../services/locations.js';
import * as inv from '../services/inventory.js';
import * as rpt from '../services/reports.js';
import * as wh from '../services/warehouses.js';
import * as docs from '../services/documents.js';
import * as exp from '../services/expiry.js';
import * as cnt from '../services/counting.js';
import { locationLabels } from '../services/labels.js';

/** [method, path, สิทธิ์ที่ต้องมี (null = ไม่ต้องล็อกอิน), handler] */
export const routes = [
  // ---------------- เข้าสู่ระบบ ----------------
  ['POST', '/api/auth/login', null, async ({ body }) => await login(body)],
  ['POST', '/api/auth/logout', 'view', async ({ req }) => { await logout((req.headers.authorization ?? '').slice(7)); return { ok: true }; }],
  ['GET', '/api/auth/me', 'view', ({ user }) => user],

  // ---------------- หน้าแรก / ค้นหา ----------------
  ['GET', '/api/dashboard', 'view', ({ query }) => inv.dashboard({ warehouseId: int(query.warehouse_id) })],
  ['GET', '/api/search', 'view', ({ query }) => inv.quickSearch(query.q)],
  ['GET', '/api/stock', 'view', ({ query }) => inv.searchStock(query.q, stockFilter(query))],

  // ---------------- วางแผนหยิบสินค้า (FEFO) ----------------
  ['GET', '/api/pick/plan', 'view', ({ query }) => inv.pickPlan({
    sku_id: int(query.sku_id), quantity: int(query.quantity),
    min_days: int(query.min_days), max_days: int(query.max_days),
    min_pct: int(query.min_pct), max_pct: int(query.max_pct),
    warehouse_id: int(query.warehouse_id), zone_id: int(query.zone_id), strategy: query.strategy,
  })],
  ['POST', '/api/pick/confirm', 'move', ({ body, user }) => inv.pickConfirm(body, user)],

  // ---------------- แผนผังคลัง ----------------
  ['GET', '/api/overview', 'view', ({ query }) => inv.warehouseOverview({ warehouseId: int(query.warehouse_id) })],
  ['GET', '/api/rags/:id/map', 'view', async ({ params }) => await rackMap(+params.id)],
  ['GET', '/api/locations', 'view', async ({ query }) =>
    await emptyLocations({ zoneId: int(query.zone_id), ragId: int(query.rag_id), limit: int(query.limit, 300) })],
  ['GET', '/api/locations/:code', 'view', ({ params }) => inv.locationDetail(decodeURIComponent(params.code))],
  ['PATCH', '/api/locations/:id', 'manage', async ({ params, body }) => {
    const loc = await get('SELECT * FROM locations WHERE location_id = ?', +params.id);
    if (!loc) throw notFound('ไม่พบตำแหน่ง');
    if (loc.status === 'OCCUPIED') throw conflict('เปลี่ยนสถานะไม่ได้ — ยังมีสินค้าอยู่ในตำแหน่งนี้');
    if (!['EMPTY', 'DISABLED'].includes(body.status)) throw badRequest('สถานะไม่ถูกต้อง');
    await run('UPDATE locations SET status = ? WHERE location_id = ?', body.status, +params.id);
    return await get('SELECT * FROM locations WHERE location_id = ?', +params.id);
  }],

  // ---------------- จัดเก็บ / หยิบออก / ย้าย ----------------
  ['POST', '/api/items', 'move', ({ body, user }) => inv.storeItem(body, user)],
  ['GET', '/api/items/:id', 'view', ({ params }) => ({
    item: inv.itemDetail(+params.id),
    history: inv.listMovements({ item_id: +params.id, limit: 50 }),
  })],
  ['POST', '/api/items/:id/remove', 'move', ({ params, body, user }) =>
    inv.removeItem({ ...body, item_id: +params.id }, user)],
  ['POST', '/api/items/:id/move', 'move', ({ params, body, user }) =>
    inv.moveItem({ ...body, item_id: +params.id }, user)],
  ['PUT', '/api/items/:id', 'move', ({ params, body, user }) =>
    inv.editItem({ ...body, item_id: +params.id }, user)],

  // ---------------- ประวัติการเคลื่อนย้าย ----------------
  ['GET', '/api/movements', 'view', ({ query }) => inv.listMovements({ ...query, warehouse_id: int(query.warehouse_id) })],

  // ---------------- คลังสินค้า + ผังพื้น ----------------
  ['GET', '/api/warehouses', 'view', () => wh.listWarehouses()],
  ['GET', '/api/warehouses/:id', 'view', ({ params }) => wh.getWarehouse(+params.id)],
  ['GET', '/api/warehouses/:id/layout', 'view', ({ params }) => wh.warehouseLayout(+params.id)],
  ['POST', '/api/warehouses', 'manage', ({ body }) => wh.createWarehouse(body)],
  ['PUT', '/api/warehouses/:id', 'manage', ({ params, body }) => wh.updateWarehouse(+params.id, body)],
  ['DELETE', '/api/warehouses/:id', 'manage', ({ params }) => wh.deleteWarehouse(+params.id)],
  ['PATCH', '/api/rags/:id/position', 'manage', ({ params, body }) => wh.moveRack(+params.id, body)],
  ['DELETE', '/api/rags/:id', 'manage', ({ params }) => wh.deleteRack(+params.id)],
  ['DELETE', '/api/zones/:id', 'manage', ({ params }) => wh.deleteZone(+params.id)],

  // ---------------- ข้อมูลหลัก: โซน ----------------
  ['GET', '/api/zones', 'view', async ({ query }) =>
    await all(`SELECT z.*, w.wh_code, w.wh_name,
                (SELECT COUNT(*) FROM rags r WHERE r.zone_id = z.zone_id) AS rag_count
           FROM zones z LEFT JOIN warehouses w ON w.warehouse_id = z.warehouse_id
          ${query.warehouse_id ? 'WHERE z.warehouse_id = ?' : ''}
          ORDER BY w.wh_code, z.zone_code`,
      ...(query.warehouse_id ? [int(query.warehouse_id)] : []))],
  ['POST', '/api/zones', 'manage', async ({ body }) => {
    requireFields(body, ['zone_code', 'zone_name', 'warehouse_id']);
    if (await get('SELECT 1 FROM zones WHERE zone_code = ?', body.zone_code.toUpperCase()))
      throw conflict('รหัสโซนนี้ถูกใช้แล้ว — รหัสโซนต้องไม่ซ้ำกันทุกคลัง');
    if (!await get('SELECT 1 FROM warehouses WHERE warehouse_id = ?', +body.warehouse_id)) throw notFound('ไม่พบคลังสินค้า');
    const r = await run('INSERT INTO zones (zone_code, zone_name, warehouse_id, color) VALUES (?,?,?,?)',
      body.zone_code.toUpperCase(), body.zone_name, +body.warehouse_id, body.color || '#2563eb');
    return await get('SELECT * FROM zones WHERE zone_id = ?', Number(r.lastInsertRowid));
  }],
  ['PUT', '/api/zones/:id', 'manage', async ({ params, body }) => {
    const z = await get('SELECT * FROM zones WHERE zone_id = ?', +params.id);
    if (!z) throw notFound('ไม่พบโซน');
    const code = (body.zone_code ?? z.zone_code).toUpperCase();
    if (await get('SELECT 1 FROM zones WHERE zone_code = ? AND zone_id <> ?', code, +params.id))
      throw conflict('รหัสโซนนี้ถูกใช้แล้ว — รหัสโซนต้องไม่ซ้ำกันทุกคลัง');
    await run('UPDATE zones SET zone_code=?, zone_name=?, warehouse_id=?, color=?, status=? WHERE zone_id=?',
      code, body.zone_name ?? z.zone_name, body.warehouse_id ? +body.warehouse_id : z.warehouse_id,
      body.color ?? z.color, body.status ?? z.status, +params.id);
    for (const r of await all('SELECT rag_id FROM rags WHERE zone_id = ?', +params.id)) await syncRagLocations(r.rag_id);
    return await get('SELECT * FROM zones WHERE zone_id = ?', +params.id);
  }],

  // ---------------- ข้อมูลหลัก: ชั้นวาง ----------------
  ['GET', '/api/rags', 'view', async ({ query }) => {
    const where = [];
    const params = [];
    if (query.zone_id) { where.push('r.zone_id = ?'); params.push(int(query.zone_id)); }
    if (query.warehouse_id) { where.push('z.warehouse_id = ?'); params.push(int(query.warehouse_id)); }
    return await all(
      `SELECT r.*, z.zone_code, z.zone_name, z.color, w.warehouse_id, w.wh_code, w.wh_name,
              (SELECT COUNT(*) FROM locations l WHERE l.rag_id = r.rag_id) AS total_locations,
              (SELECT COUNT(*) FROM locations l WHERE l.rag_id = r.rag_id AND l.status='OCCUPIED') AS occupied
         FROM rags r JOIN zones z ON z.zone_id = r.zone_id
         LEFT JOIN warehouses w ON w.warehouse_id = z.warehouse_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY w.wh_code, z.zone_code, r.rag_no`,
      ...params);
  }],
  ['POST', '/api/rags', 'manage', async ({ body }) => {
    requireFields(body, ['rag_no', 'zone_id', 'total_levels', 'total_depths']);
    const no = String(body.rag_no).trim().toUpperCase();
    if (await get('SELECT 1 FROM rags WHERE rag_no = ?', no)) throw conflict('หมายเลขชั้นวางนี้ถูกใช้แล้ว');
    const ragId = await tx(async () => Number((await run(
      'INSERT INTO rags (rag_no, zone_id, total_levels, total_depths, note, pos_x, pos_y) VALUES (?,?,?,?,?,?,?)',
      no, body.zone_id, body.total_levels, body.total_depths, body.note ?? null,
      body.pos_x ?? null, body.pos_y ?? null,
    )).lastInsertRowid));
    return { rag: await get('SELECT * FROM rags WHERE rag_id = ?', ragId), ...await syncRagLocations(ragId) };
  }],
  ['PUT', '/api/rags/:id', 'manage', async ({ params, body }) => {
    const rag = await get('SELECT * FROM rags WHERE rag_id = ?', +params.id);
    if (!rag) throw notFound('ไม่พบชั้นวาง');
    await run(`UPDATE rags SET rag_no=?, zone_id=?, total_levels=?, total_depths=?, note=?, status=? WHERE rag_id=?`,
      String(body.rag_no ?? rag.rag_no).toUpperCase(), body.zone_id ?? rag.zone_id,
      body.total_levels ?? rag.total_levels, body.total_depths ?? rag.total_depths,
      body.note ?? rag.note, body.status ?? rag.status, +params.id);
    return { rag: await get('SELECT * FROM rags WHERE rag_id = ?', +params.id), ...await syncRagLocations(+params.id) };
  }],

  // ---------------- ข้อมูลหลัก: สินค้า ----------------
  ['GET', '/api/skus/categories', 'view', async () => {
    const rows = await all("SELECT DISTINCT category FROM skus WHERE category IS NOT NULL AND category != '' ORDER BY category");
    return rows.map(r => r.category);
  }],
  ['GET', '/api/skus', 'view', async ({ query }) => {
    const q = (query.q ?? '').trim();
    const whId = int(query.warehouse_id);
    // จำนวนคงคลังนับตามคลังที่เลือกอยู่ เพื่อให้ตัวเลขตรงกับหน้าจออื่น
    const scope = whId ? 'AND v.warehouse_id = ?' : '';
    const scopeParams = whId ? [whId] : [];
    return await all(
      `SELECT s.*,
              (SELECT COUNT(*) FROM v_stock v WHERE v.sku_id = s.sku_id ${scope}) AS locations_used,
              (SELECT COALESCE(SUM(v.quantity),0) FROM v_stock v WHERE v.sku_id = s.sku_id ${scope}) AS qty_in_stock
         FROM skus s ${q ? 'WHERE s.sku_code ILIKE ? OR s.sku_name ILIKE ? OR s.barcode = ?' : ''}
        ORDER BY s.sku_code`,
      ...scopeParams, ...scopeParams, ...(q ? [`%${q}%`, `%${q}%`, q] : []));
  }],
  ['POST', '/api/skus', 'manage', async ({ body }) => {
    requireFields(body, ['sku_code', 'sku_name']);
    if (await get('SELECT 1 FROM skus WHERE sku_code = ?', body.sku_code)) throw conflict('รหัสสินค้านี้ถูกใช้แล้ว');
    const r = await run('INSERT INTO skus (sku_code, sku_name, category, unit, barcode, product_type, shelf_life_months) VALUES (?,?,?,?,?,?,?)',
      body.sku_code.trim(), body.sku_name.trim(), body.category ?? null, body.unit || 'ชิ้น', body.barcode ?? null,
      body.product_type || null, body.shelf_life_months ? Number(body.shelf_life_months) : null);
    return await get('SELECT * FROM skus WHERE sku_id = ?', Number(r.lastInsertRowid));
  }],
  ['PUT', '/api/skus/:id', 'manage', async ({ params, body }) => {
    const s = await get('SELECT * FROM skus WHERE sku_id = ?', +params.id);
    if (!s) throw notFound('ไม่พบสินค้า');
    await run('UPDATE skus SET sku_code=?, sku_name=?, category=?, unit=?, barcode=?, status=?, product_type=?, shelf_life_months=? WHERE sku_id=?',
      body.sku_code ?? s.sku_code, body.sku_name ?? s.sku_name, body.category ?? s.category,
      body.unit ?? s.unit, body.barcode ?? s.barcode, body.status ?? s.status,
      body.product_type !== undefined ? (body.product_type || null) : s.product_type,
      body.shelf_life_months !== undefined ? (body.shelf_life_months ? Number(body.shelf_life_months) : null) : s.shelf_life_months,
      +params.id);
    return await get('SELECT * FROM skus WHERE sku_id = ?', +params.id);
  }],
  ['GET', '/api/skus/:id/units', 'view', ({ params }) => docs.listSkuUnits(+params.id)],
  ['PUT', '/api/skus/:id/units', 'manage', ({ params, body }) => docs.saveSkuUnits(+params.id, body.units)],

  // ---------------- ผู้ใช้งาน ----------------
  ['GET', '/api/users', 'manage', async () => await listUsers()],
  ['POST', '/api/users', 'manage', async ({ body }) => {
    requireFields(body, ['username', 'full_name', 'role', 'password']);
    if (!PERMISSIONS[body.role]) throw badRequest('บทบาทไม่ถูกต้อง');
    if (await get('SELECT 1 FROM users WHERE username = ?', body.username)) throw conflict('ชื่อผู้ใช้นี้ถูกใช้แล้ว');
    const r = await run('INSERT INTO users (username, full_name, role, password_hash) VALUES (?,?,?,?)',
      body.username.trim(), body.full_name.trim(), body.role, hashSecret(body.password));
    return { user_id: Number(r.lastInsertRowid) };
  }],
  ['PUT', '/api/users/:id', 'manage', async ({ params, body }) => {
    const u = await get('SELECT * FROM users WHERE user_id = ?', +params.id);
    if (!u) throw notFound('ไม่พบผู้ใช้');
    await run('UPDATE users SET full_name=?, role=?, status=?, password_hash=? WHERE user_id=?',
      body.full_name ?? u.full_name, body.role ?? u.role, body.status ?? u.status,
      body.password ? hashSecret(body.password) : u.password_hash, +params.id);
    return { ok: true };
  }],

  // ---------------- เอกสารคลัง: รับเข้า/จ่ายออก/โอน/คืน/ตัดเสีย ----------------
  ['GET', '/api/docs', 'view', ({ query }) => docs.listDocuments(query)],
  ['GET', '/api/docs/:id', 'view', ({ params }) => docs.docDetail(+params.id)],
  ['POST', '/api/docs/grn', 'move', ({ body, user }) => docs.createGRN(body, user)],
  ['POST', '/api/docs/issue', 'move', ({ body, user }) => docs.createIssue(body, user)],
  ['POST', '/api/docs/transfer', 'move', ({ body, user }) => docs.createTransfer(body, user)],
  ['POST', '/api/docs/return-in', 'move', ({ body, user }) => docs.createReturnIn(body, user)],
  ['POST', '/api/docs/return-out', 'move', ({ body, user }) => docs.createReturnOut(body, user)],
  ['POST', '/api/docs/scrap', 'move', ({ body, user }) => docs.createScrap(body, user)],
  ['PATCH', '/api/docs/:id/ship', 'move', ({ params, body, user }) => docs.updateShipStatus(+params.id, body, user)],

  // ---------------- ช่องทางขาย + กฎอายุคงเหลือ ----------------
  ['GET', '/api/channels', 'view', () => exp.listChannels()],
  ['POST', '/api/channels', 'manage', ({ body }) => exp.saveChannel(body)],
  ['PUT', '/api/channels/:id', 'manage', ({ params, body }) => exp.saveChannel(body, +params.id)],
  ['GET', '/api/settings', 'view', () => exp.getSettings()],
  ['PUT', '/api/settings', 'manage', ({ body }) => exp.saveSettings(body)],
  ['GET', '/api/expiry/actions', 'view', ({ query }) => exp.expiryActions({ warehouseId: int(query.warehouse_id) })],
  ['GET', '/api/recall', 'view', ({ query }) => exp.recallReport({ lot_no: query.lot, sku_id: int(query.sku_id) })],

  // ---------------- รอบนับสต็อก (Cycle Count) ----------------
  ['GET', '/api/counts', 'view', ({ query }) => cnt.listRounds({ limit: int(query.limit, 100) })],
  ['GET', '/api/counts/:id', 'view', ({ params }) => cnt.roundDetail(+params.id)],
  ['POST', '/api/counts', 'move', ({ body, user }) => cnt.createRound(body, user)],
  ['POST', '/api/counts/:id/record', 'move', ({ params, body, user }) => cnt.recordCount(+params.id, body, user)],
  ['POST', '/api/counts/:id/approve', 'manage', ({ params, user }) => cnt.approveRound(+params.id, user)],
  ['POST', '/api/counts/:id/cancel', 'manage', ({ params, user }) => cnt.cancelRound(+params.id, user)],

  // ---------------- รายงาน ----------------
  ['GET', '/api/reports/inventory', 'view', ({ query }) => rpt.inventorySummary({ group_by: query.group_by, warehouseId: int(query.warehouse_id) })],
  ['GET', '/api/reports/expiry', 'view', ({ query }) => rpt.expiryReport({ warehouseId: int(query.warehouse_id) })],
  ['GET', '/api/reports/space', 'view', ({ query }) => rpt.spaceUtilization({ warehouseId: int(query.warehouse_id) })],
  ['GET', '/api/reports/movements', 'view', ({ query }) => rpt.movementAnalytics({ days: int(query.days, 30), warehouseId: int(query.warehouse_id) })],
  ['GET', '/api/reports/staff', 'view', ({ query }) => rpt.staffPerformance({ days: int(query.days, 30), warehouseId: int(query.warehouse_id) })],

  // ---------------- พิมพ์ป้ายตำแหน่ง / ใบส่งสินค้า ----------------
  ['GET', '/labels/location', 'view', async ({ query }) => ({ html: await locationLabels({ rag_id: int(query.rag_id) }) })],
  ['GET', '/labels/delivery', 'view', async ({ query }) => ({ html: await docs.deliveryNoteHTML(int(query.doc_id)) })],
];

/** ตัวกรองของหน้าค้นหาสินค้า (ใช้ร่วมกันระหว่าง API และไฟล์ CSV) */
function stockFilter(query) {
  return {
    zoneId: int(query.zone_id), ragId: int(query.rag_id), warehouseId: int(query.warehouse_id),
    skuId: int(query.sku_id), minDays: int(query.min_days), maxDays: int(query.max_days),
    minQty: int(query.min_qty), limit: int(query.limit, 500),
  };
}

function requireFields(body, fields) {
  const missing = fields.filter((f) => body[f] === undefined || body[f] === null || body[f] === '');
  if (missing.length) throw badRequest(`กรุณากรอกข้อมูลให้ครบ: ${missing.join(', ')}`);
}

/** ไฟล์ CSV สำหรับเปิดใน Excel */
export const csvExports = {
  stock: async (query) => ({
    filename: `stock_${new Date().toISOString().slice(0, 10)}.csv`,
    body: inv.toCSV(await inv.searchStock(query.q, { ...stockFilter(query), limit: 5000 }), [
      { label: 'ตำแหน่ง', key: 'location_code' }, { label: 'โซน', key: 'zone_code' }, { label: 'ชั้นวาง', key: 'rag_no' },
      { label: 'ชั้น', key: 'level' }, { label: 'ตอน', key: 'depth' },
      { label: 'รหัสสินค้า', key: 'sku_code' }, { label: 'ชื่อสินค้า', key: 'sku_name' },
      { label: 'Lot', key: 'lot_no' }, { label: 'จำนวน', key: 'quantity' }, { label: 'หน่วย', key: 'unit' },
      { label: 'วันหมดอายุ', key: 'exp_date' }, { label: 'จัดเก็บเมื่อ', key: 'stored_at' },
    ]),
  }),
  picklist: async (query) => {
    const plan = await inv.pickPlan({
      sku_id: int(query.sku_id), quantity: int(query.quantity),
      min_days: int(query.min_days), max_days: int(query.max_days),
      warehouse_id: int(query.warehouse_id), zone_id: int(query.zone_id), strategy: query.strategy,
    });
    return {
      filename: `picklist_${plan.sku.sku_code}_${new Date().toISOString().slice(0, 10)}.csv`,
      body: inv.toCSV(plan.lines, [
        { label: 'ลำดับ', key: 'seq' }, { label: 'ตำแหน่งที่ไปหยิบ', key: 'location_code' },
        { label: 'โซน', key: 'zone_code' }, { label: 'ชั้นวาง', key: 'rag_no' },
        { label: 'ชั้น', key: 'level' }, { label: 'ตอน', key: 'depth' },
        { label: 'รหัสสินค้า', key: 'sku_code' }, { label: 'ชื่อสินค้า', key: 'sku_name' },
        { label: 'Lot', key: 'lot_no' }, { label: 'วันหมดอายุ', key: 'exp_date' },
        { label: 'อายุคงเหลือ (วัน)', key: 'days_to_expiry' },
        { label: 'คงเหลือในตำแหน่ง', key: 'quantity' },
        { label: 'จำนวนที่ต้องหยิบ', key: 'take' }, { label: 'หน่วย', key: 'unit' },
        { label: 'เหลือหลังหยิบ', key: 'remaining_after' },
        { label: 'ต้องใช้รถยก', value: (r) => (r.needs_forklift ? 'ใช่' : '') },
      ]),
    };
  },
  movements: async (query) => ({
    filename: `movements_${new Date().toISOString().slice(0, 10)}.csv`,
    body: inv.toCSV(await inv.listMovements({ ...query, limit: 5000 }), [
      { label: 'เลขที่', key: 'movement_id' },
      { label: 'ประเภท', value: (r) => ({ STORE: 'จัดเก็บ', REMOVE: 'หยิบออก', MOVE: 'ย้าย', EDIT: 'แก้ไข' }[r.movement_type]) },
      { label: 'วันเวลา', key: 'moved_at' }, { label: 'รหัสสินค้า', key: 'sku_code' }, { label: 'ชื่อสินค้า', key: 'sku_name' },
      { label: 'Lot', key: 'lot_no' }, { label: 'จำนวน', key: 'quantity' },
      { label: 'จากตำแหน่ง', key: 'from_code' }, { label: 'ไปตำแหน่ง', key: 'to_code' },
      { label: 'ผู้ทำรายการ', key: 'user_name' }, { label: 'หมายเหตุ', key: 'note' },
    ]),
  }),
};

export { ROLE_NAME };
