// เอกสารคลังสินค้า: รับเข้า (GRN) · จ่ายออก (ISSUE) · โอนย้าย · รับคืน/ส่งคืน · ตัดเสีย
// ทุกเอกสารสร้างแล้วยืนยันทันที (ไม่มี draft) และผูกกับ movements ผ่าน doc_id — ตรวจย้อนได้เสมอ
import { all, get, run, tx } from '../lib/db.js';
import { badRequest, conflict, notFound } from '../lib/http.js';
import { storeItem, removeItem, moveItem, listMovements } from './inventory.js';

// ---------------------------------------------------------------- เลขเอกสาร
// รูปแบบ: GRN-2608-0001 (ปี พ.ศ. 2 หลัก + เดือน + ลำดับในเดือนนั้น)
async function nextDocNo(type) {
  const now = new Date(Date.now() + 7 * 3600_000);
  const yy = String((now.getUTCFullYear() + 543) % 100).padStart(2, '0');
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const prefix = `${type}-${yy}${mm}-`;
  const row = await get(
    `SELECT COALESCE(MAX(CAST(RIGHT(doc_no, 4) AS INTEGER)), 0) AS n
       FROM documents WHERE doc_no LIKE ?`,
    `${prefix}%`,
  );
  return `${prefix}${String(row.n + 1).padStart(4, '0')}`;
}

const createDoc = async (fields, user) => {
  const doc_no = await nextDocNo(fields.doc_type);
  const r = await run(
    `INSERT INTO documents (doc_type, doc_no, ref_no, party, channel_id, reason,
                            qc_status, qc_note, note, ship_status, picked_at, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    fields.doc_type, doc_no, fields.ref_no?.trim() || null, fields.party?.trim() || null,
    fields.channel_id ? Number(fields.channel_id) : null, fields.reason?.trim() || null,
    fields.qc_status || null, fields.qc_note?.trim() || null, fields.note?.trim() || null,
    fields.ship_status || null,
    fields.ship_status === 'PICKED' ? new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 19).replace('T', ' ') : null,
    user.user_id,
  );
  return { doc_id: Number(r.lastInsertRowid), doc_no };
};

// ---------------------------------------------------------------- หน่วยนับ
/** แปลงจำนวนจากหน่วยที่กรอกเป็นหน่วยฐานของสินค้า (unit_name ว่าง/ตรงหน่วยฐาน = ไม่แปลง) */
export async function toBaseQty(sku_id, unit_name, qty) {
  const n = Number(qty);
  if (!Number.isFinite(n) || n <= 0) throw badRequest('จำนวนไม่ถูกต้อง');
  const sku = await get('SELECT unit FROM skus WHERE sku_id = ?', Number(sku_id));
  if (!sku) throw notFound('ไม่พบสินค้า');
  const name = (unit_name ?? '').trim();
  if (!name || name === sku.unit) return { qty: n, note: null };
  const u = await get('SELECT * FROM sku_units WHERE sku_id = ? AND unit_name = ?', Number(sku_id), name);
  if (!u) throw badRequest(`สินค้านี้ไม่มีหน่วย "${name}" — เพิ่มอัตราแปลงได้ที่ข้อมูลหลัก → สินค้า`);
  const base = Math.round(n * Number(u.factor));
  return { qty: base, note: `${n} ${name} = ${base} ${sku.unit}` };
}

export const listSkuUnits = (skuId) =>
  all('SELECT * FROM sku_units WHERE sku_id = ? ORDER BY factor', Number(skuId));

export async function saveSkuUnits(skuId, units) {
  if (!Array.isArray(units)) throw badRequest('รูปแบบหน่วยนับไม่ถูกต้อง');
  return await tx(async () => {
    await run('DELETE FROM sku_units WHERE sku_id = ?', Number(skuId));
    for (const u of units) {
      const name = (u.unit_name ?? '').trim();
      const factor = Number(u.factor);
      if (!name || !Number.isFinite(factor) || factor <= 0) continue;
      await run('INSERT INTO sku_units (sku_id, unit_name, factor) VALUES (?,?,?)', Number(skuId), name, factor);
    }
    return await listSkuUnits(skuId);
  });
}

// ---------------------------------------------------------------- รับเข้า (GRN)
/**
 * ใบรับสินค้าเข้าคลัง — หลายรายการ/หลาย Lot ต่อใบ พร้อมผล QC และอ้างอิงเลข PO
 * แต่ละบรรทัดระบุตำแหน่งจัดเก็บของตัวเอง (1 ตำแหน่ง = 1 รายการเหมือนเดิม)
 */
/** เลขพาเลทรันตามเดือน เช่น PL-6909-0001 — อ่านง่ายและไม่ชนกันข้ามเดือน */
async function nextPalletNo() {
  const now = new Date(Date.now() + 7 * 3600_000);
  const yy = String((now.getUTCFullYear() + 543) % 100).padStart(2, '0');
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const prefix = `PL-${yy}${mm}-`;
  const row = await get(
    `SELECT COALESCE(MAX(CAST(RIGHT(pallet_no, 4) AS INTEGER)), 0) AS n FROM pallets WHERE pallet_no LIKE ?`,
    `${prefix}%`,
  );
  return `${prefix}${String(row.n + 1).padStart(4, '0')}`;
}

export async function createGRN(input, user) {
  const lines = input.lines;
  if (!Array.isArray(lines) || !lines.length) throw badRequest('ไม่มีรายการสินค้าในใบรับเข้า');
  if (input.qc_status && !['PASS', 'FAIL', 'QUARANTINE'].includes(input.qc_status))
    throw badRequest('ผล QC ไม่ถูกต้อง');

  return await tx(async () => {
    const { doc_id, doc_no } = await createDoc({ ...input, doc_type: 'GRN' }, user);
    const stored = [];
    const pallets = [];
    // 1 พาเลท = 1 SKU + 1 Lot เท่านั้น — บรรทัดที่เป็นสินค้าและ Lot เดียวกันใช้พาเลทใบเดียวกัน
    // (เช่น รับของล็อตเดียวแต่กระจายเก็บหลายตำแหน่ง ยังถือเป็นพาเลทเดียวในเชิงการตามสอบ)
    const palletOf = new Map();
    for (const l of lines) {
      const key = `${Number(l.sku_id)}::${(l.lot_no ?? '').trim()}`;
      if (!palletOf.has(key)) {
        const pallet_no = await nextPalletNo();
        const r = await run(
          `INSERT INTO pallets (pallet_no, sku_id, lot_no, mfg_date, exp_date, doc_id) VALUES (?,?,?,?,?,?)`,
          pallet_no, Number(l.sku_id), l.lot_no?.trim() || null,
          l.mfg_date || null, l.exp_date || null, doc_id);
        const pallet_id = Number(r.lastInsertRowid);
        palletOf.set(key, pallet_id);
        pallets.push({ pallet_id, pallet_no, sku_id: Number(l.sku_id), lot_no: l.lot_no?.trim() || null });
      }
      const conv = await toBaseQty(l.sku_id, l.unit_name, l.quantity);
      const item = await storeItem({
        sku_id: Number(l.sku_id), location_code: l.location_code,
        lot_no: l.lot_no, mfg_date: l.mfg_date || null, exp_date: l.exp_date || null,
        quantity: conv.qty, doc_id,
        note: [conv.note, l.note?.trim()].filter(Boolean).join(' · ') || null,
      }, user);
      await run('UPDATE stock_items SET pallet_id = ? WHERE item_id = ?', palletOf.get(key), item.item_id);
      stored.push({ ...item, pallet_id: palletOf.get(key) });
    }
    return { ...(await docDetail(doc_id)), doc_no, stored: stored.length, pallets };
  });
}

// ---------------------------------------------------------------- จ่ายออก (ISSUE)
/**
 * ใบจ่ายสินค้าออก — อ้างอิงเลข SO/MO + ลูกค้า + ช่องทางขาย
 * ตรวจกฎอายุคงเหลือขั้นต่ำของช่องทางให้อัตโนมัติ (ข้ามได้ด้วย force เมื่อผู้ใช้ยืนยันเอง)
 */
export async function createIssue(input, user) {
  const lines = input.lines;
  if (!Array.isArray(lines) || !lines.length) throw badRequest('ไม่มีรายการให้จ่ายออก');

  // ตรวจกฎ % อายุคงเหลือของช่องทาง ก่อนเปิด Transaction
  if (input.channel_id && !input.force) {
    const ch = await get('SELECT * FROM channels WHERE channel_id = ?', Number(input.channel_id));
    if (ch?.min_pct_remaining !== null && ch?.min_pct_remaining !== undefined) {
      const bad = [];
      for (const l of lines) {
        const v = await get('SELECT * FROM v_stock WHERE item_id = ?', Number(l.item_id));
        if (v && v.pct_remaining !== null && v.pct_remaining < ch.min_pct_remaining)
          bad.push(`${v.location_code} (${v.sku_code} Lot ${v.lot_no ?? '-'} เหลือ ${v.pct_remaining}%)`);
      }
      if (bad.length)
        throw conflict(
          `อายุคงเหลือต่ำกว่าเกณฑ์ช่องทาง ${ch.channel_code} (ต้อง ≥${ch.min_pct_remaining}%): ${bad.join(', ')}`,
          'CHANNEL_PCT',
        );
    }
  }

  return await tx(async () => {
    const { doc_id, doc_no } = await createDoc({ ...input, doc_type: 'ISSUE', ship_status: 'PICKED' }, user);
    const results = [];
    for (const l of lines) {
      const itemId = Number(l.item_id);
      const take = Number(l.take ?? l.quantity);
      if (!Number.isFinite(take) || take <= 0) throw badRequest('จำนวนที่จ่ายออกไม่ถูกต้อง');
      const cur = await get('SELECT * FROM stock_items WHERE item_id = ?', itemId);
      if (!cur || cur.status !== 'IN_STOCK' || !cur.location_id)
        throw conflict(`${l.location_code ?? `รายการ #${itemId}`} ถูกหยิบออกไปแล้ว — กรุณาคำนวณแผนใหม่`);
      if (cur.quantity < take)
        throw conflict(`${l.location_code ?? `รายการ #${itemId}`} เหลือ ${cur.quantity} (แผนระบุ ${take}) — กรุณาคำนวณแผนใหม่`);
      results.push(await removeItem({
        item_id: itemId, quantity: take, doc_id,
        note: input.so_note ?? 'จ่ายออกตามใบจ่ายสินค้า',
      }, user));
    }
    return {
      ...(await docDetail(doc_id)), doc_no,
      picked: results.length, total: results.reduce((s, r) => s + r.removed, 0),
    };
  });
}

/** เดินสถานะจัดส่ง: PICKED → PACKED → SHIPPED → DELIVERED (บันทึกเวลาแต่ละขั้น) */
const SHIP_FLOW = ['PICKED', 'PACKED', 'SHIPPED', 'DELIVERED'];
const SHIP_STAMP = { PACKED: 'packed_at', SHIPPED: 'shipped_at', DELIVERED: 'delivered_at' };

export async function updateShipStatus(docId, { ship_status, tracking_no, carrier }, user) {
  const doc = await get('SELECT * FROM documents WHERE doc_id = ?', Number(docId));
  if (!doc) throw notFound('ไม่พบเอกสาร');
  if (doc.doc_type !== 'ISSUE') throw badRequest('เดินสถานะจัดส่งได้เฉพาะใบจ่ายสินค้า');
  if (doc.status === 'CANCELLED') throw conflict('เอกสารถูกยกเลิกแล้ว');

  const sets = [];
  const params = [];
  if (ship_status) {
    const cur = SHIP_FLOW.indexOf(doc.ship_status);
    const next = SHIP_FLOW.indexOf(ship_status);
    if (next < 0) throw badRequest('สถานะไม่ถูกต้อง');
    if (next !== cur + 1)
      throw conflict(`เดินสถานะข้ามขั้นไม่ได้ — ปัจจุบันอยู่ที่ ${doc.ship_status}`);
    sets.push('ship_status = ?'); params.push(ship_status);
    sets.push(`${SHIP_STAMP[ship_status]} = (now() AT TIME ZONE 'Asia/Bangkok')`);
  }
  if (tracking_no !== undefined) { sets.push('tracking_no = ?'); params.push(tracking_no?.trim() || null); }
  if (carrier !== undefined) { sets.push('carrier = ?'); params.push(carrier?.trim() || null); }
  if (!sets.length) return await docDetail(docId);

  await run(`UPDATE documents SET ${sets.join(', ')} WHERE doc_id = ?`, ...params, Number(docId));
  return await docDetail(docId);
}

// ---------------------------------------------------------------- โอนย้าย
/** ใบโอนย้าย — ย้ายหลายรายการในเอกสารเดียว (ในคลังเดียวกันหรือข้ามคลังก็ได้) */
export async function createTransfer(input, user) {
  const lines = input.lines;
  if (!Array.isArray(lines) || !lines.length) throw badRequest('ไม่มีรายการให้โอนย้าย');
  return await tx(async () => {
    const { doc_id, doc_no } = await createDoc({ ...input, doc_type: 'TRANSFER' }, user);
    for (const l of lines)
      await moveItem({ item_id: Number(l.item_id), to_location_code: l.to_location_code, doc_id, note: input.note }, user);
    return { ...(await docDetail(doc_id)), doc_no, moved: lines.length };
  });
}

// ---------------------------------------------------------------- รับคืน / ส่งคืน
/** รับคืนจากลูกค้า — สินค้ากลับเข้าคลัง (บันทึก Lot วันหมดอายุ เหตุผล และคลังปลายทางที่เลือกเอง) */
export async function createReturnIn(input, user) {
  const lines = input.lines;
  if (!Array.isArray(lines) || !lines.length) throw badRequest('ไม่มีรายการรับคืน');
  if (!input.reason?.trim()) throw badRequest('กรุณาระบุเหตุผลการคืนสินค้า');
  return await tx(async () => {
    const { doc_id, doc_no } = await createDoc({ ...input, doc_type: 'RETURN_IN' }, user);
    for (const l of lines) {
      const conv = await toBaseQty(l.sku_id, l.unit_name, l.quantity);
      await storeItem({
        sku_id: Number(l.sku_id), location_code: l.location_code,
        lot_no: l.lot_no, mfg_date: l.mfg_date || null, exp_date: l.exp_date || null,
        quantity: conv.qty, doc_id,
        note: [`รับคืน: ${input.reason.trim()}`, conv.note, l.note?.trim()].filter(Boolean).join(' · '),
      }, user);
    }
    return { ...(await docDetail(doc_id)), doc_no };
  });
}

/** ส่งคืนผู้ขาย (Supplier Return) — สินค้าออกจากคลัง */
export async function createReturnOut(input, user) {
  const lines = input.lines;
  if (!Array.isArray(lines) || !lines.length) throw badRequest('ไม่มีรายการส่งคืน');
  if (!input.reason?.trim()) throw badRequest('กรุณาระบุเหตุผลการส่งคืน');
  return await tx(async () => {
    const { doc_id, doc_no } = await createDoc({ ...input, doc_type: 'RETURN_OUT' }, user);
    for (const l of lines)
      await removeItem({
        item_id: Number(l.item_id), quantity: l.quantity, doc_id,
        note: `ส่งคืนผู้ขาย: ${input.reason.trim()}`,
      }, user);
    return { ...(await docDetail(doc_id)), doc_no };
  });
}

// ---------------------------------------------------------------- ตัดเสีย
export async function createScrap(input, user) {
  const lines = input.lines;
  if (!Array.isArray(lines) || !lines.length) throw badRequest('ไม่มีรายการตัดเสีย');
  if (!input.reason?.trim()) throw badRequest('กรุณาระบุเหตุผลการตัดเสีย');
  return await tx(async () => {
    const { doc_id, doc_no } = await createDoc({ ...input, doc_type: 'SCRAP' }, user);
    for (const l of lines)
      await removeItem({
        item_id: Number(l.item_id), quantity: l.quantity, doc_id,
        note: `ตัดเสีย: ${input.reason.trim()}`,
      }, user);
    return { ...(await docDetail(doc_id)), doc_no };
  });
}

// ---------------------------------------------------------------- ดูรายการ
export async function listDocuments(f = {}) {
  const where = [];
  const params = [];
  if (f.type) { where.push('d.doc_type = ?'); params.push(f.type); }
  if (f.ship_status) { where.push('d.ship_status = ?'); params.push(f.ship_status); }
  if (f.q) {
    where.push('(d.doc_no ILIKE ? OR d.ref_no ILIKE ? OR d.party ILIKE ? OR d.tracking_no ILIKE ?)');
    const like = `%${f.q.trim()}%`;
    params.push(like, like, like, like);
  }
  if (f.from) { where.push('d.created_at >= ?'); params.push(f.from); }
  if (f.to) { where.push('d.created_at <= ?'); params.push(`${f.to} 23:59:59`); }
  return await all(
    `SELECT d.*, u.full_name AS created_by_name, c.channel_code, c.channel_name,
            (SELECT COUNT(*) FROM movements m WHERE m.doc_id = d.doc_id) AS line_count,
            (SELECT COALESCE(SUM(m.quantity),0) FROM movements m WHERE m.doc_id = d.doc_id) AS total_qty
       FROM documents d
       LEFT JOIN users u ON u.user_id = d.created_by
       LEFT JOIN channels c ON c.channel_id = d.channel_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY d.doc_id DESC LIMIT ?`,
    ...params, Number(f.limit ?? 200),
  );
}

export async function docDetail(docId) {
  const doc = await get(
    `SELECT d.*, u.full_name AS created_by_name, c.channel_code, c.channel_name
       FROM documents d
       LEFT JOIN users u ON u.user_id = d.created_by
       LEFT JOIN channels c ON c.channel_id = d.channel_id
      WHERE d.doc_id = ?`,
    Number(docId),
  );
  if (!doc) throw notFound('ไม่พบเอกสาร');
  return { doc, movements: await listMovements({ doc_id: docId, limit: 500 }) };
}

// ---------------------------------------------------------------- ใบส่งสินค้า (พิมพ์)
export async function deliveryNoteHTML(docId) {
  const { doc, movements } = await docDetail(docId);
  if (doc.doc_type !== 'ISSUE') throw badRequest('พิมพ์ใบส่งสินค้าได้เฉพาะใบจ่ายสินค้า');
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const rows = movements.map((m, i) => `
    <tr><td class="c">${i + 1}</td><td class="mono">${esc(m.sku_code)}</td><td>${esc(m.sku_name)}</td>
        <td class="mono">${esc(m.lot_no ?? '-')}</td><td class="n">${Number(m.quantity).toLocaleString('th-TH')}</td>
        <td>${esc(m.unit)}</td><td class="mono">${esc(m.from_code ?? '-')}</td></tr>`).join('');
  const total = movements.reduce((s, m) => s + Number(m.quantity || 0), 0);
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>ใบส่งสินค้า ${esc(doc.doc_no)}</title>
<style>
  body{font-family:'TH Sarabun New','Sarabun',sans-serif;font-size:16px;margin:24px;color:#111}
  h1{font-size:22px;margin:0 0 2px} .sub{color:#555;margin:0 0 14px}
  table{border-collapse:collapse;width:100%;margin-top:10px}
  th,td{border:1px solid #999;padding:5px 8px;text-align:left}
  th{background:#eee} .c{text-align:center} .n{text-align:right} .mono{font-family:monospace}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 24px;margin:10px 0}
  .grid b{display:inline-block;min-width:110px}
  .sign{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:48px;text-align:center}
  .sign div{border-top:1px solid #333;padding-top:6px}
  @media print{button{display:none}}
</style></head><body>
<button onclick="print()" style="float:right;padding:8px 20px">🖨️ พิมพ์</button>
<h1>ใบส่งสินค้า / Delivery Note</h1>
<p class="sub">EVERYDAYHAPPY CO., LTD. — De Leaf</p>
<div class="grid">
  <div><b>เลขที่เอกสาร:</b> ${esc(doc.doc_no)}</div><div><b>วันที่:</b> ${esc(String(doc.created_at).slice(0, 16))}</div>
  <div><b>อ้างอิง SO:</b> ${esc(doc.ref_no ?? '-')}</div><div><b>ลูกค้า:</b> ${esc(doc.party ?? '-')}</div>
  <div><b>ช่องทาง:</b> ${esc(doc.channel_code ?? '-')}</div><div><b>Tracking No:</b> ${esc(doc.tracking_no ?? '-')} ${esc(doc.carrier ? `(${doc.carrier})` : '')}</div>
</div>
<table><thead><tr><th class="c">#</th><th>รหัสสินค้า</th><th>ชื่อสินค้า</th><th>Lot</th><th class="n">จำนวน</th><th>หน่วย</th><th>จากตำแหน่ง</th></tr></thead>
<tbody>${rows}</tbody>
<tfoot><tr><th colspan="4" class="n">รวม</th><th class="n">${total.toLocaleString('th-TH')}</th><th colspan="2"></th></tr></tfoot></table>
${doc.note ? `<p><b>หมายเหตุ:</b> ${esc(doc.note)}</p>` : ''}
<div class="sign"><div>ผู้จ่ายสินค้า</div><div>ผู้รับสินค้า</div></div>
</body></html>`;
}
