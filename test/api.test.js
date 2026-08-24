// ทดสอบระบบตาม Acceptance Criteria (SRS §10)
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

const DB = join(process.cwd(), 'data', 'test.db');
const PORT = 4123;
const BASE = `http://localhost:${PORT}`;
let server;
let token;
let managerToken;

const api = async (method, path, body, tk = token) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(tk ? { Authorization: `Bearer ${tk}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data };
};

before(async () => {
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) rmSync(f, { force: true });
  execFileSync(process.execPath, ['server/seed.js'], { env: { ...process.env, RAG_DB: DB }, stdio: 'ignore' });
  server = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, RAG_DB: DB, PORT: String(PORT), RAG_LOG: 'off' }, stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try { await fetch(BASE + '/api/dashboard'); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  token = (await api('POST', '/api/auth/login', { username: 'admin', password: 'admin123' }, null)).data.token;
  managerToken = (await api('POST', '/api/auth/login', { username: 'manager', pin: '1234' }, null)).data.token;
});

after(() => {
  server?.kill();
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) rmSync(f, { force: true });
});

describe('Authentication & RBAC (FR-09, NFR-12/13)', () => {
  test('ปฏิเสธรหัสผ่านผิด', async () => {
    const r = await api('POST', '/api/auth/login', { username: 'admin', password: 'wrong' }, null);
    assert.equal(r.status, 401);
  });
  test('เข้าสู่ระบบด้วย PIN ได้ (Handheld)', async () => {
    assert.ok(managerToken);
  });
  test('เรียก API โดยไม่มี Token ต้องถูกปฏิเสธ', async () => {
    assert.equal((await api('GET', '/api/dashboard', null, null)).status, 401);
  });
  test('VIEWER บันทึกรายการไม่ได้', async () => {
    const vt = (await api('POST', '/api/auth/login', { username: 'viewer', password: 'viewer123' }, null)).data.token;
    const r = await api('POST', '/api/inbound', { sku_id: 1, lot_no: 'X', exp_date: '2030-01-01', quantity: 1 }, vt);
    assert.equal(r.status, 403);
  });
});

describe('AC-02 · สร้าง RAG แล้ว Generate Location Codes ครบถ้วน', () => {
  test('RAG 4 ชั้น × 6 ตอน → 24 ตำแหน่ง และรหัสถูกต้อง', async () => {
    const zones = (await api('GET', '/api/zones')).data;
    const fg = zones.find((z) => z.zone_code === 'FG');
    const r = await api('POST', '/api/rags', { rag_no: 'T99', zone_id: fg.zone_id, total_levels: 4, total_depths: 6, max_weight_per_level_kg: 4000 });
    assert.equal(r.status, 201);
    assert.equal(r.data.total, 24);
    const map = (await api('GET', `/api/rags/${r.data.rag.rag_id}/map`)).data;
    assert.equal(map.cells.length, 24);
    assert.ok(map.cells.some((c) => c.location_code === 'FG-T99-L1-D1'));
    assert.ok(map.cells.some((c) => c.location_code === 'FG-T99-L4-D6'));
  });
});

describe('AC-01 · ค้นหาสินค้าพบตำแหน่งภายใน 1 วินาที (NFR-01)', () => {
  test('ค้นหาด้วยชื่อสินค้าและได้ผลเรียงตาม FEFO', async () => {
    const t0 = Date.now();
    const rows = (await api('GET', '/api/stock?q=' + encodeURIComponent('ครีม'))).data;
    const elapsed = Date.now() - t0;
    assert.ok(rows.length > 0, 'ต้องพบสินค้า');
    assert.ok(elapsed < 1000, `ต้องเร็วกว่า 1 วินาที (ใช้ ${elapsed} ms)`);
    const exps = rows.map((r) => r.exp_date);
    assert.deepEqual(exps, [...exps].sort(), 'ต้องเรียงตามวันหมดอายุ (FEFO)');
    assert.ok(rows[0].location_code, 'ต้องมีรหัสตำแหน่ง');
  });
  test('ค้นหาด้วย Location Code และ Lot ได้', async () => {
    const any = (await api('GET', '/api/stock?q=FG-A01')).data[0];
    assert.ok(any);
    assert.ok((await api('GET', '/api/stock?q=' + any.lot_no)).data.length > 0);
  });
});

describe('AC-03 · Putaway: แนะนำตำแหน่ง → ยืนยัน → Occupied', () => {
  let barcode; let location;
  test('รับเข้าสินค้าต้องมี Lot และวันหมดอายุ', async () => {
    const bad = await api('POST', '/api/inbound', { sku_id: 1, quantity: 10 });
    assert.equal(bad.status, 400);
    const ok = await api('POST', '/api/inbound', { sku_id: 1, lot_no: 'UAT-001', exp_date: '2029-01-31', quantity: 480, pallet_count: 2 });
    assert.equal(ok.status, 201);
    assert.equal(ok.data.pallets.length, 2);
    barcode = ok.data.pallets[0].pallet_barcode;
  });
  test('ระบบแนะนำตำแหน่งที่ถูกต้อง (โซนตรง ไม่ถูกขวาง ชั้นล่างก่อน)', async () => {
    const list = (await api('GET', '/api/putaway/suggest?sku_id=1&limit=5')).data;
    assert.ok(list.length > 0);
    assert.ok(list[0].zone_match, 'อันดับแรกต้องอยู่ในโซนที่กำหนด');
    location = list[0].location_code;
  });
  test('ยืนยันจัดเก็บแล้วตำแหน่งเปลี่ยนเป็น OCCUPIED', async () => {
    const r = await api('POST', '/api/putaway/confirm', { pallet_barcode: barcode, location_code: location });
    assert.equal(r.status, 201);
    const loc = (await api('GET', `/api/locations/${location}`)).data;
    assert.equal(loc.location.status, 'OCCUPIED');
    assert.equal(loc.pallet.pallet_barcode, barcode);
  });
  test('1 ตำแหน่ง = 1 พาเลท — วางซ้ำไม่ได้', async () => {
    const second = (await api('GET', '/api/putaway/pending')).data[0];
    const r = await api('POST', '/api/putaway/confirm', { pallet_barcode: second.pallet_barcode, location_code: location });
    assert.equal(r.status, 409);
    assert.equal(r.data.code, 'LOCATION_OCCUPIED');
  });
});

describe('AC-04 · Picking ตาม FEFO + AC-08 Transaction Log', () => {
  test('หยิบผิดหลัก FEFO ต้องถูกปฏิเสธจนกว่าจะระบุเหตุผล', async () => {
    const plan = (await api('GET', '/api/picking/sequence?sku_id=1')).data;
    assert.ok(plan.sequence.length > 1);
    const last = plan.all_stock.at(-1);           // พาเลทที่หมดอายุช้าที่สุด
    const bad = await api('POST', '/api/picking/confirm', { pallet_barcode: last.pallet_barcode, location_code: last.location_code });
    assert.equal(bad.data.code, 'FEFO_VIOLATION');
    const ok = await api('POST', '/api/picking/confirm', { pallet_barcode: last.pallet_barcode, location_code: last.location_code, reason: 'ลูกค้าขอ Lot ใหม่' });
    assert.equal(ok.status, 201);
    const loc = (await api('GET', `/api/locations/${last.location_code}`)).data;
    assert.equal(loc.location.status, 'EMPTY');
  });
  test('หยิบตามลำดับ FEFO ปกติทำได้ทันที', async () => {
    const plan = (await api('GET', '/api/picking/sequence?sku_id=1')).data;
    const first = plan.sequence[0];
    const r = await api('POST', '/api/picking/confirm', { pallet_barcode: first.pallet_barcode, location_code: first.location_code });
    assert.equal(r.status, 201);
  });
  test('Transaction ถูกบันทึกครบและลบ/แก้ไขไม่ได้ (Immutable)', async () => {
    const txns = (await api('GET', '/api/transactions?limit=50')).data;
    assert.ok(txns.some((t) => t.txn_type === 'PUTAWAY'));
    assert.ok(txns.some((t) => t.txn_type === 'PICKING'));
    assert.ok(txns.some((t) => t.txn_type === 'INBOUND'));
    const del = await fetch(`${BASE}/api/transactions/${txns[0].txn_id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    assert.equal(del.status, 404, 'ไม่มี endpoint สำหรับลบ Transaction');
  });
  test('แก้ไขทำได้ด้วยการกลับรายการ (Reversal) พร้อมเหตุผลเท่านั้น', async () => {
    const put = (await api('GET', '/api/transactions?type=PUTAWAY&limit=1')).data[0];
    const noReason = await api('POST', `/api/transactions/${put.txn_id}/reverse`, {});
    assert.equal(noReason.status, 400);
    const ok = await api('POST', `/api/transactions/${put.txn_id}/reverse`, { reason: 'บันทึกผิดพลาด' });
    assert.equal(ok.status, 201);
    const again = await api('POST', `/api/transactions/${put.txn_id}/reverse`, { reason: 'ซ้ำ' });
    assert.equal(again.data.code, 'ALREADY_REVERSED');
  });
});

describe('FR-04 · Transfer และข้อจำกัดทางกายภาพ (§3.3)', () => {
  test('ย้ายไปตำแหน่งที่ถูกขวางไม่ได้ (Drive-In Rack)', async () => {
    const map = (await api('GET', '/api/rags/1/map')).data;
    const blockedTarget = map.cells.find((c) =>
      c.status === 'EMPTY' && map.cells.some((o) => o.level === c.level && o.depth < c.depth && o.pallet_id));
    if (!blockedTarget) return;                    // ไม่มีเคสนี้ในข้อมูลตัวอย่าง
    const source = map.cells.find((c) => c.pallet_id && c.location_id !== blockedTarget.location_id);
    const r = await api('POST', '/api/transfer', { pallet_barcode: source.pallet_barcode, to_location_code: blockedTarget.location_code });
    assert.equal(r.data.code, 'LOCATION_BLOCKED');
  });
  test('ย้ายไปตำแหน่งว่างที่เข้าถึงได้ สำเร็จและอัปเดตทั้ง 2 ตำแหน่ง', async () => {
    const map = (await api('GET', '/api/rags/1/map')).data;
    const source = map.cells.find((c) => c.pallet_id);
    const target = map.cells.find((c) =>
      c.status === 'EMPTY' && !map.cells.some((o) => o.level === c.level && o.depth < c.depth && o.pallet_id));
    const r = await api('POST', '/api/transfer', { pallet_barcode: source.pallet_barcode, to_location_code: target.location_code });
    assert.equal(r.status, 201);
    assert.equal((await api('GET', `/api/locations/${source.location_code}`)).data.location.status, 'EMPTY');
    assert.equal((await api('GET', `/api/locations/${target.location_code}`)).data.location.status, 'OCCUPIED');
  });
});

describe('AC-05/AC-10 · Visual Map และ Utilization', () => {
  test('แผนผัง RAG มี Color Coding ครบทุกสถานะ', async () => {
    const map = (await api('GET', '/api/rags/1/map')).data;
    assert.ok(map.cells.every((c) => ['EMPTY', 'OCCUPIED', 'RESERVED', 'DISABLED'].includes(c.status)));
    assert.ok(map.cells.filter((c) => c.pallet_id).every((c) => ['red', 'amber', 'blue'].includes(c.expiry.color)));
    assert.ok(map.stats.utilization_pct >= 0 && map.stats.utilization_pct <= 100);
  });
  test('Utilization = ตำแหน่งที่มีสินค้า / ตำแหน่งที่ใช้งานได้', async () => {
    const u = (await api('GET', '/api/reports/utilization')).data;
    const expected = Math.round((u.warehouse.occupied / u.warehouse.usable) * 1000) / 10;
    assert.equal(u.warehouse.utilization_pct, expected);
    assert.equal(u.warehouse.total, u.rags.reduce((s, r) => s + r.total, 0));
  });
  test('Snapshot และ Trend ทำงาน', async () => {
    await api('POST', '/api/reports/snapshot');
    const trend = (await api('GET', '/api/reports/trend?days=30')).data;
    assert.ok(trend.length > 0);
  });
});

describe('AC-06 · Aging & Expiry Alert', () => {
  test('จัดกลุ่มระดับแจ้งเตือนถูกต้อง', async () => {
    const a = (await api('GET', '/api/reports/aging?days=90')).data;
    assert.ok(a.expired.every((r) => r.days_to_expiry < 0));
    assert.ok(a.critical.every((r) => r.days_to_expiry >= 0 && r.days_to_expiry < 30));
    assert.ok(a.warning.every((r) => r.days_to_expiry >= 30 && r.days_to_expiry < 90));
  });
  test('สร้างข้อความแจ้งเตือนและส่งได้ (LINE/Log)', async () => {
    const r = await api('POST', '/api/alerts/send');
    assert.equal(r.status, 201);
    assert.ok(r.data.message?.includes('แจ้งเตือน') || r.data.reason);
  });
});

describe('AC-07 · Cycle Count ต้องอนุมัติก่อนปรับสต็อก', () => {
  test('นับ → ส่งอนุมัติ → Operator อนุมัติไม่ได้ → Manager อนุมัติแล้วสต็อกถูกปรับ', async () => {
    const cc = (await api('POST', '/api/cycle-counts', { scope_type: 'RAG', rag_id: 2, note: 'UAT' })).data;
    const line = cc.lines.find((l) => l.expected_barcode);
    const newQty = line.expected_qty - 7;
    await api('POST', `/api/cycle-counts/${cc.cc_id}/lines`, { line_id: line.line_id, counted_barcode: line.expected_barcode, counted_qty: newQty, remark: 'นับจริง' });
    const submitted = (await api('POST', `/api/cycle-counts/${cc.cc_id}/submit`)).data;
    assert.equal(submitted.status, 'PENDING_APPROVAL');
    assert.equal(submitted.variance_lines.length, 1);

    const opToken = (await api('POST', '/api/auth/login', { username: 'operator', password: 'operator123' }, null)).data.token;
    assert.equal((await api('POST', `/api/cycle-counts/${cc.cc_id}/approve`, {}, opToken)).status, 403);

    const approved = (await api('POST', `/api/cycle-counts/${cc.cc_id}/approve`, { note: 'ตรวจแล้ว' }, managerToken)).data;
    assert.equal(approved.status, 'APPROVED');
    assert.equal(approved.applied.length, 1);

    const pallet = (await api('GET', `/api/pallets/${line.expected_barcode}`)).data.pallet;
    assert.equal(pallet.quantity, newQty, 'จำนวนต้องถูกปรับตามผลนับ');
    const ccTxn = (await api('GET', '/api/transactions?type=CYCLE_COUNT&limit=5')).data;
    assert.ok(ccTxn.length > 0, 'ต้องมี Transaction ประเภท CYCLE_COUNT');
  });
});

describe('AC-09 · Label / Barcode', () => {
  test('พิมพ์ป้ายตำแหน่งได้ (Code-128 + QR)', async () => {
    const res = await fetch(`${BASE}/labels/location?rag_id=1`, { headers: { Authorization: `Bearer ${token}` } });
    const html = await res.text();
    assert.equal(res.status, 200);
    assert.ok(html.includes('FG-A01-L1-D1'));
    assert.ok(html.includes('<svg'), 'ต้องมี SVG barcode/QR');
  });
  test('พิมพ์ป้ายพาเลทได้', async () => {
    const pallets = (await api('GET', '/api/labels/pallets')).data;
    const res = await fetch(`${BASE}/labels/pallet?ids=${pallets[0].pallet_id}`, { headers: { Authorization: `Bearer ${token}` } });
    const html = await res.text();
    assert.ok(html.includes(pallets[0].pallet_barcode));
  });
});

describe('Export รายงาน (FR-06.1)', () => {
  test('Export CSV ได้และมี BOM สำหรับภาษาไทย', async () => {
    const res = await fetch(`${BASE}/api/reports/inventory.csv`, { headers: { Authorization: `Bearer ${token}` } });
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.equal(res.status, 200);
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'ต้องมี UTF-8 BOM เพื่อให้ Excel อ่านภาษาไทยถูกต้อง');
    assert.ok(bytes.toString('utf8').includes('Location'));
  });
});
