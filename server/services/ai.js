// ชั้น AI ของ WMS — ผู้ช่วยถาม-ตอบ · อ่านเอกสารรับเข้า · เรียบเรียงคำแนะนำ · นับสต็อกจากรูป
// หลักสำคัญ: AI ไม่เขียนข้อมูลเอง ทุกอย่างที่เสนอต้องให้คนกดยืนยันก่อนเสมอ
// ตัวเลขทุกตัวที่ AI พูดถึงต้องมาจากเครื่องมือที่ดึงจากฐานข้อมูลจริง ห้ามเดา
import { callClaude, callClaudeJSON, textOf, toolUsesOf, imageBlock, pdfBlock, MODEL, aiEnabled } from '../lib/claude.js';
import { badRequest } from '../lib/http.js';
import { all } from '../lib/db.js';
import * as inv from './inventory.js';
import * as rpt from './reports.js';
import * as docs from './documents.js';
import * as intel from './intelligence.js';

export { aiEnabled };

const trim = (rows, n = 40) => (Array.isArray(rows) ? rows.slice(0, n) : rows);
const todayTH = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

// ══════════════════════════════════════════════════════════════
//  1.1  WMS Copilot — ถาม-ตอบภาษาไทยบนข้อมูลจริง
// ══════════════════════════════════════════════════════════════

/** เครื่องมือที่ AI เรียกได้ — อ่านอย่างเดียวทั้งหมด ไม่มีตัวไหนแก้ข้อมูล */
const TOOLS = [
  {
    name: 'search_stock',
    description: 'ค้นหาสินค้าคงคลังตามชื่อสินค้า รหัสสินค้า Lot หรือรหัสตำแหน่ง คืนรายการที่มีของพร้อมตำแหน่ง จำนวน วันหมดอายุ และ % อายุคงเหลือ',
    input_schema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'คำค้น เช่น ชื่อสินค้า รหัส SKU Lot หรือรหัสตำแหน่ง เว้นว่างได้เพื่อดูทั้งหมด' },
        max_days: { type: 'integer', description: 'กรองเฉพาะที่เหลืออายุไม่เกินกี่วัน' },
        min_days: { type: 'integer', description: 'กรองเฉพาะที่เหลืออายุอย่างน้อยกี่วัน' },
        limit: { type: 'integer', description: 'จำนวนแถวสูงสุด (ค่าเริ่มต้น 30)' },
      },
    },
  },
  {
    name: 'stock_summary',
    description: 'สรุปยอดคงคลังรวม จัดกลุ่มตามสินค้า โซน หรือหมวดหมู่ ใช้ตอบคำถามภาพรวมว่ามีอะไรเท่าไร',
    input_schema: {
      type: 'object',
      properties: { group_by: { type: 'string', enum: ['sku', 'zone', 'category'], description: 'จัดกลุ่มตามอะไร' } },
    },
  },
  {
    name: 'warehouse_overview',
    description: 'ภาพรวมการใช้พื้นที่คลัง — จำนวนตำแหน่งทั้งหมด ว่าง ใช้ไปแล้ว แยกตามโซนและชั้นวาง ใช้ตอบว่าพื้นที่พอไหม',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'expiry_risk',
    description: 'วิเคราะห์ Lot ที่เสี่ยงขายไม่ทันหมดอายุ โดยเทียบอัตราจ่ายออกจริงกับคิว FEFO พร้อมบอกช่องทางขายที่ยังรับได้',
    input_schema: {
      type: 'object',
      properties: { horizon_days: { type: 'integer', description: 'มองไปข้างหน้ากี่วัน (ค่าเริ่มต้น 180)' } },
    },
  },
  {
    name: 'demand_forecast',
    description: 'พยากรณ์ความต้องการรายสัปดาห์ต่อสินค้า พร้อมบอกว่าของจะหมดเมื่อไร ควรสั่งเติมเท่าไร',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['OUT_OF_STOCK', 'REORDER_NOW', 'REORDER_SOON', 'OVERSTOCK', 'IDLE', 'ALL'],
          description: 'กรองเฉพาะสถานะที่สนใจ' },
      },
    },
  },
  {
    name: 'movement_history',
    description: 'สถิติการเคลื่อนไหวย้อนหลัง — แยกตามประเภท รายวัน สินค้าที่หมุนเร็วสุด และของที่ค้างนาน',
    input_schema: {
      type: 'object',
      properties: { days: { type: 'integer', description: 'ย้อนหลังกี่วัน (ค่าเริ่มต้น 30)' } },
    },
  },
  {
    name: 'list_documents',
    description: 'รายการเอกสารคลัง เช่น ใบรับเข้า (GRN) ใบจ่ายสินค้า (ISSUE) โอน คืน ตัดเสีย พร้อมสถานะจัดส่ง',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['GRN', 'ISSUE', 'TRANSFER', 'RETURN_IN', 'RETURN_OUT', 'SCRAP', 'ADJUST'] },
        q: { type: 'string', description: 'ค้นเลขเอกสาร SO ลูกค้า หรือ Tracking' },
        from: { type: 'string', description: 'ตั้งแต่วันที่ (YYYY-MM-DD)' },
        to: { type: 'string', description: 'ถึงวันที่ (YYYY-MM-DD)' },
        limit: { type: 'integer' },
      },
    },
  },
  {
    name: 'slotting_advice',
    description: 'วิเคราะห์ ABC ตามความถี่หยิบ และเสนอการย้าย/สลับตำแหน่งเพื่อลดระยะเดินหยิบ',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'detect_anomalies',
    description: 'ตรวจจับความผิดปกติ เช่น นับสต็อกไม่ตรงซ้ำๆ ใบจ่ายค้างสถานะ การข้ามลำดับ FEFO ปริมาณงานผิดปกติ',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'labor_plan',
    description: 'ภาระงานตามวันในสัปดาห์และช่วงเวลา พร้อมประมาณจำนวนคนที่ควรจัดกะ',
    input_schema: { type: 'object', properties: {} },
  },
];

/** เรียกเครื่องมือจริง — ทุกตัวอ่านอย่างเดียว และผูกกับคลังที่ผู้ใช้เลือกอยู่ */
async function runTool(name, input, ctx) {
  const wh = ctx.warehouseId ?? null;
  switch (name) {
    case 'search_stock': {
      const rows = await inv.searchStock(input.q ?? '', {
        warehouseId: wh, minDays: input.min_days ?? null, maxDays: input.max_days ?? null,
        limit: Math.min(input.limit ?? 30, 60),
      });
      return {
        found: rows.length,
        items: trim(rows).map((r) => ({
          sku_code: r.sku_code, sku_name: r.sku_name, lot_no: r.lot_no, quantity: r.quantity, unit: r.unit,
          location_code: r.location_code, zone_code: r.zone_code, wh_name: r.wh_name,
          exp_date: r.exp_date, days_to_expiry: r.days_to_expiry, pct_remaining: r.pct_remaining,
        })),
      };
    }
    case 'stock_summary':
      return await rpt.inventorySummary({ group_by: input.group_by ?? 'sku', warehouseId: wh });
    case 'warehouse_overview': {
      const [ov, util] = await Promise.all([
        inv.warehouseOverview({ warehouseId: wh }),
        rpt.spaceUtilization({ warehouseId: wh }),
      ]);
      return { overview: ov, utilization: util };
    }
    case 'expiry_risk': {
      const r = await intel.expiryRisk({ warehouseId: wh, horizonDays: input.horizon_days ?? 180 });
      return { summary: r.summary, at_risk: trim(r.at_risk, 25) };
    }
    case 'demand_forecast': {
      const f = await intel.demandForecast({ warehouseId: wh });
      const st = input.status && input.status !== 'ALL' ? input.status : null;
      return { summary: f.summary, items: trim(st ? f.items.filter((i) => i.status === st) : f.items, 30) };
    }
    case 'movement_history':
      return await rpt.movementAnalytics({ days: Math.min(input.days ?? 30, 365), warehouseId: wh });
    case 'list_documents': {
      const rows = await docs.listDocuments({ ...input, limit: Math.min(input.limit ?? 30, 60) });
      return {
        found: rows.length,
        documents: trim(rows).map((d) => ({
          doc_no: d.doc_no, doc_type: d.doc_type, created_at: d.created_at, ref_no: d.ref_no,
          party: d.party, channel_code: d.channel_code, ship_status: d.ship_status,
          line_count: d.line_count, total_qty: d.total_qty, created_by: d.created_by_name,
        })),
      };
    }
    case 'slotting_advice': {
      const s = await intel.slotting({ warehouseId: wh });
      return { abc: s.abc, top_skus: trim(s.top_skus, 10), recommendations: trim(s.recommendations, 10),
        potential_trips_saved_per_month: s.potential_trips_saved_per_month };
    }
    case 'detect_anomalies': {
      const a = await intel.anomalies({ warehouseId: wh });
      return { summary: a.summary, findings: trim(a.findings, 15) };
    }
    case 'labor_plan':
      return await intel.laborPlan({ warehouseId: wh });
    default:
      return { error: `ไม่รู้จักเครื่องมือ ${name}` };
  }
}

const COPILOT_SYSTEM = `คุณคือ "น้องสต๊อค" ผู้ช่วยประจำคลังสินค้าของบริษัท EVERYDAYHAPPY (แบรนด์ "de leaf thanaka") ผู้ผลิตเครื่องสำอาง/สกินแคร์
คุณช่วยพนักงานคลังและผู้บริหารตอบคำถามเกี่ยวกับสต๊อก การรับเข้า-จ่ายออก อายุสินค้า และประสิทธิภาพคลัง

บุคลิกของน้องสต๊อค:
- เป็นมิตร สุภาพ กระตือรือร้น ลงท้ายด้วย "ครับ" เป็นธรรมชาติ (ไม่ต้องทุกประโยค)
- เรียกตัวเองว่า "ผม" ไม่ต้องแนะนำตัวซ้ำทุกครั้ง ถ้าถูกถามว่าเป็นใครค่อยบอกว่าชื่อน้องสต๊อค
- ใส่ใจคนทำงานหน้างาน ถ้าเจอเรื่องน่าห่วงให้เตือนด้วยน้ำเสียงห่วงใย ไม่ตื่นตระหนก
- ใช้อีโมจิได้บ้างพอเหมาะ (เช่น ⚠️ ✅ 📦) ไม่ใส่รัวจนอ่านยาก
- ห้ามน่ารักจนข้อมูลเพี้ยน — ความถูกต้องของตัวเลขสำคัญกว่าความน่ารักเสมอ

กฎการทำงาน:
1. ตอบเป็นภาษาไทยเสมอ กระชับ ตรงประเด็น เหมือนเพื่อนร่วมงานที่รู้เรื่องคลังดี
2. ตัวเลขทุกตัวต้องมาจากเครื่องมือเท่านั้น ห้ามเดาหรือประมาณเอง ถ้าเครื่องมือไม่มีข้อมูลให้บอกตรงๆ ว่าไม่มี
3. เลือกเครื่องมือให้ตรงกับคำถาม เรียกหลายตัวได้ถ้าจำเป็น แต่อย่าเรียกเกินความจำเป็น
4. เมื่อตอบเรื่องจำนวน ให้ระบุหน่วยเสมอ (ขวด กระปุก ก้อน หลอด ฯลฯ) และใส่ตำแหน่ง/Lot เมื่อเกี่ยวข้อง
5. ถ้าพบความเสี่ยง (ของใกล้หมดอายุ ของจะขาด งานค้าง) ให้บอกและเสนอสิ่งที่ควรทำต่อสั้นๆ
6. คุณอ่านข้อมูลได้อย่างเดียว บันทึก/แก้ไข/ลบข้อมูลไม่ได้ ถ้าผู้ใช้ขอให้ทำ ให้บอกว่าต้องไปทำที่หน้าจอนั้นๆ เอง
7. ศัพท์เทคนิคใช้ภาษาอังกฤษตามที่ระบบใช้: SKU, Lot, FEFO, FIFO, GRN, Location Code
8. ตอบสั้นเป็นย่อหน้าหรือรายการสั้นๆ ไม่ต้องใส่หัวข้อใหญ่ ไม่ต้องขึ้นต้นด้วยการทวนคำถาม

บริบทระบบ:
- ตำแหน่งเก็บของรูปแบบ {โซน}-{ชั้นวาง}-L{ชั้น}-D{ตอน} เช่น FG-A01-L2-D3 — 1 ตำแหน่งวางได้ 1 พาเลท
- โซน: FG=สินค้าสำเร็จรูป, RM=วัตถุดิบ, PK=บรรจุภัณฑ์, QR=กักกัน
- ชั้นวางแบบ Drive-in: D1 คือหน้าสุดหยิบง่ายที่สุด, ชั้น L1 คือชั้นล่างสุด
- การหยิบเรียงตาม FEFO (หมดอายุก่อน หยิบก่อน) เป็นค่ามาตรฐาน
- แต่ละช่องทางขายมีเกณฑ์ % อายุคงเหลือขั้นต่ำต่างกัน`;

/**
 * ถาม-ตอบกับผู้ช่วย — วนเรียกเครื่องมือจนกว่า AI จะตอบเสร็จ
 * @param {Array} history ประวัติสนทนา [{role:'user'|'assistant', content:'...'}]
 */
export async function copilotAsk({ messages = [], warehouseId = null, warehouseName = null } = {}, user) {
  if (!Array.isArray(messages) || !messages.length) throw badRequest('กรุณาพิมพ์คำถาม');
  const clean = messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content.trim().slice(0, 4000) }));
  if (!clean.length) throw badRequest('กรุณาพิมพ์คำถาม');

  const ctx = { warehouseId };
  const convo = [...clean];
  const toolLog = [];
  let usage = { input_tokens: 0, output_tokens: 0 };

  const system = `${COPILOT_SYSTEM}

วันนี้คือ ${todayTH()} (เวลาไทย)
ผู้ใช้ที่กำลังถาม: ${user?.full_name ?? '-'} (สิทธิ์ ${user?.role_name ?? user?.role ?? '-'})
คลังที่กำลังดูอยู่: ${warehouseName ?? 'ทุกคลัง'}${warehouseId ? '' : ' — ข้อมูลที่ได้จะรวมทุกคลัง'}`;

  for (let step = 0; step < 6; step++) {
    const reply = await callClaude({ messages: convo, system, tools: TOOLS, model: MODEL.SMART, maxTokens: 2048 });
    usage = {
      input_tokens: usage.input_tokens + (reply.usage?.input_tokens ?? 0),
      output_tokens: usage.output_tokens + (reply.usage?.output_tokens ?? 0),
    };
    const uses = toolUsesOf(reply);
    if (!uses.length) {
      return { answer: textOf(reply) || 'ขออภัย ยังตอบคำถามนี้ไม่ได้ ลองถามใหม่อีกครั้งได้ไหมครับ', tools_used: toolLog, usage };
    }

    convo.push({ role: 'assistant', content: reply.content });
    const results = [];
    for (const u of uses) {
      let out;
      try {
        out = await runTool(u.name, u.input ?? {}, ctx);
        toolLog.push({ name: u.name, input: u.input ?? {} });
      } catch (err) {
        out = { error: err.message };
        toolLog.push({ name: u.name, input: u.input ?? {}, error: err.message });
      }
      results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out) });
    }
    convo.push({ role: 'user', content: results });
  }
  return { answer: 'คำถามนี้ซับซ้อนเกินกว่าจะหาคำตอบได้ในรอบเดียว ลองถามให้เจาะจงขึ้นได้ไหมครับ', tools_used: toolLog, usage };
}

// ══════════════════════════════════════════════════════════════
//  1.2  Document AI — อ่านใบส่งของ/PO เป็นบรรทัดใบรับเข้า
// ══════════════════════════════════════════════════════════════

const GRN_SCHEMA = {
  type: 'object',
  properties: {
    ref_no: { type: 'string', description: 'เลขที่เอกสารอ้างอิงจาก supplier เช่น เลข PO หรือเลขใบส่งของ ไม่พบให้เว้นว่าง' },
    party: { type: 'string', description: 'ชื่อผู้ขาย/ซัพพลายเออร์ที่ปรากฏบนเอกสาร ไม่พบให้เว้นว่าง' },
    doc_date: { type: 'string', description: 'วันที่บนเอกสาร รูปแบบ YYYY-MM-DD ไม่พบให้เว้นว่าง' },
    lines: {
      type: 'array',
      description: 'รายการสินค้าทุกบรรทัดที่อ่านได้จากเอกสาร',
      items: {
        type: 'object',
        properties: {
          raw_text: { type: 'string', description: 'ข้อความชื่อสินค้าตามที่ปรากฏบนเอกสารจริง' },
          sku_code: { type: 'string', description: 'รหัสสินค้าในระบบที่จับคู่ได้ ถ้าไม่มั่นใจให้เว้นว่าง' },
          quantity: { type: 'number', description: 'จำนวนที่รับเข้า' },
          unit: { type: 'string', description: 'หน่วยนับตามเอกสาร เช่น ชิ้น ลัง กล่อง' },
          lot_no: { type: 'string', description: 'เลข Lot/Batch ไม่พบให้เว้นว่าง' },
          mfg_date: { type: 'string', description: 'วันผลิต YYYY-MM-DD ไม่พบให้เว้นว่าง' },
          exp_date: { type: 'string', description: 'วันหมดอายุ YYYY-MM-DD ไม่พบให้เว้นว่าง' },
          confidence: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'], description: 'ความมั่นใจในการอ่านบรรทัดนี้' },
          note: { type: 'string', description: 'สิ่งที่ต้องให้คนตรวจ เช่น อ่านไม่ชัด หรือจับคู่สินค้าไม่ได้' },
        },
        required: ['raw_text', 'quantity', 'confidence'],
      },
    },
    warnings: { type: 'array', items: { type: 'string' }, description: 'ข้อสังเกตภาพรวม เช่น เอกสารเบลอ ข้อมูลบางส่วนหาย' },
  },
  required: ['lines'],
};

/**
 * อ่านเอกสารรับเข้า (รูปหรือ PDF) แล้วแปลงเป็นบรรทัด GRN พร้อมจับคู่ SKU ในระบบ
 * ไม่บันทึกอะไรทั้งสิ้น — คืนข้อมูลให้หน้าจอเติมฟอร์มให้คนตรวจก่อนกดบันทึกเอง
 */
export async function scanReceivingDoc({ files = [] } = {}) {
  if (!Array.isArray(files) || !files.length) throw badRequest('กรุณาแนบรูปหรือไฟล์ PDF ของเอกสาร');
  if (files.length > 5) throw badRequest('แนบได้สูงสุด 5 ไฟล์ต่อครั้ง');

  const skus = await all(
    `SELECT sku_id, sku_code, sku_name, unit, barcode, product_type
       FROM skus WHERE status = 'ACTIVE' ORDER BY sku_code`);
  if (!skus.length) throw badRequest('ยังไม่มีข้อมูลสินค้าในระบบ — กรุณาเพิ่มสินค้าก่อน');

  const catalog = skus.map((s) => `${s.sku_code} | ${s.sku_name} | หน่วย ${s.unit}${s.barcode ? ` | บาร์โค้ด ${s.barcode}` : ''}`).join('\n');

  const blocks = files.map((f) => (String(f).startsWith('data:application/pdf') ? pdfBlock(f) : imageBlock(f)));
  const { data, usage } = await callClaudeJSON({
    system: `คุณคือผู้ช่วยคีย์ข้อมูลรับเข้าสินค้าของคลังเครื่องสำอาง de leaf thanaka
อ่านเอกสารที่ได้รับ (ใบส่งของ ใบกำกับภาษี หรือ PO) แล้วดึงรายการสินค้าออกมาให้ครบทุกบรรทัด

กฎ:
- อ่านเฉพาะสิ่งที่เห็นจริงบนเอกสาร ห้ามแต่งเติมหรือเดาตัวเลขเอง
- อ่านไม่ออก/ไม่แน่ใจ ให้ใส่ confidence เป็น LOW แล้วอธิบายใน note ห้ามเดามั่ว
- จับคู่ชื่อสินค้าบนเอกสารกับรายการสินค้าในระบบด้านล่าง ใส่ sku_code ที่ตรงที่สุด
  ถ้าไม่มีตัวไหนใกล้เคียงพอ ให้เว้น sku_code ว่างไว้ แล้วระบุใน note ว่าจับคู่ไม่ได้
- วันที่แปลงเป็น YYYY-MM-DD เสมอ ระวังปี พ.ศ. บนเอกสารไทย (พ.ศ. − 543 = ค.ศ.)
- สินค้าเครื่องสำอางต้องมี Lot และวันหมดอายุ ถ้าเอกสารไม่มี ให้เตือนใน warnings
- ตัวเลขจำนวนที่มีลูกน้ำคั่นหลักพัน ให้ตัดลูกน้ำออก

รายการสินค้าในระบบ (รหัส | ชื่อ | หน่วย):
${catalog}`,
    messages: [{ role: 'user', content: [...blocks, { type: 'text', text: 'อ่านเอกสารนี้แล้วดึงรายการสินค้าออกมาให้ครบทุกบรรทัด' }] }],
    schema: GRN_SCHEMA,
    name: 'extract_receiving_lines',
    description: 'ส่งรายการสินค้าที่อ่านได้จากเอกสารรับเข้า',
    model: MODEL.SMART,
    maxTokens: 4096,
  });

  // จับคู่ sku_code ที่ AI ให้มากับของจริงในระบบ — ไม่เชื่อ AI ตรงๆ ต้องมีอยู่จริงเท่านั้น
  const byCode = new Map(skus.map((s) => [String(s.sku_code).toUpperCase(), s]));
  const lines = (data.lines ?? []).map((l) => {
    const matched = l.sku_code ? byCode.get(String(l.sku_code).toUpperCase()) ?? null : null;
    return {
      raw_text: l.raw_text ?? '',
      sku_id: matched?.sku_id ?? null,
      sku_code: matched?.sku_code ?? null,
      sku_name: matched?.sku_name ?? null,
      base_unit: matched?.unit ?? null,
      quantity: Number(l.quantity) || 0,
      unit: l.unit ?? null,
      lot_no: l.lot_no || null,
      mfg_date: /^\d{4}-\d{2}-\d{2}$/.test(l.mfg_date ?? '') ? l.mfg_date : null,
      exp_date: /^\d{4}-\d{2}-\d{2}$/.test(l.exp_date ?? '') ? l.exp_date : null,
      confidence: l.confidence ?? 'MEDIUM',
      note: l.note || (l.sku_code && !matched ? `ไม่พบรหัส ${l.sku_code} ในระบบ` : null),
      needs_review: !matched || l.confidence === 'LOW' || !l.lot_no || !l.exp_date,
    };
  });

  const warnings = [...(data.warnings ?? [])];
  if (lines.some((l) => !l.sku_id)) warnings.push('มีบางบรรทัดจับคู่สินค้าในระบบไม่ได้ — ต้องเลือกสินค้าเอง');
  if (lines.some((l) => !l.exp_date)) warnings.push('มีบางบรรทัดไม่มีวันหมดอายุ — สินค้าเครื่องสำอางต้องระบุเสมอ');

  return {
    ref_no: data.ref_no || null,
    party: data.party || null,
    doc_date: /^\d{4}-\d{2}-\d{2}$/.test(data.doc_date ?? '') ? data.doc_date : null,
    lines,
    warnings: [...new Set(warnings)],
    stats: {
      total: lines.length,
      matched: lines.filter((l) => l.sku_id).length,
      needs_review: lines.filter((l) => l.needs_review).length,
    },
    usage,
  };
}

// ══════════════════════════════════════════════════════════════
//  1.4  สแกนใบสั่งขาย (SO) → รายการที่ต้องไปหยิบ
// ══════════════════════════════════════════════════════════════

const SO_SCHEMA = {
  type: 'object',
  properties: {
    ref_no: { type: 'string', description: 'เลขที่ใบสั่งขาย/SO ที่ปรากฏบนเอกสาร เช่น SO-202608102 ไม่พบให้เว้นว่าง' },
    party: { type: 'string', description: 'ชื่อลูกค้าหรือผู้รับสินค้า ไม่พบให้เว้นว่าง' },
    doc_date: { type: 'string', description: 'วันที่บนเอกสาร รูปแบบ YYYY-MM-DD ไม่พบให้เว้นว่าง' },
    lines: {
      type: 'array',
      description: 'รายการสินค้าทุกบรรทัดที่ต้องจัดของ',
      items: {
        type: 'object',
        properties: {
          raw_text: { type: 'string', description: 'ชื่อสินค้าตามที่ปรากฏบนเอกสารจริง' },
          doc_code: { type: 'string', description: 'รหัสสินค้าตามที่พิมพ์บนเอกสาร (อาจเป็นรหัสของลูกค้า ไม่ใช่รหัสในระบบ)' },
          sku_code: { type: 'string', description: 'รหัสสินค้าในระบบที่จับคู่ได้จากรายการด้านล่าง ถ้าไม่มั่นใจให้เว้นว่าง' },
          quantity: { type: 'number', description: 'จำนวนที่ต้องจัด' },
          unit: { type: 'string', description: 'หน่วยนับตามเอกสาร ไม่พบให้เว้นว่าง' },
          confidence: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'], description: 'ความมั่นใจในการอ่านและจับคู่บรรทัดนี้' },
          note: { type: 'string', description: 'สิ่งที่ต้องให้คนตรวจ เช่น อ่านไม่ชัด จับคู่สินค้าไม่ได้ หรือเป็นของแถม/เทสเตอร์' },
        },
        required: ['raw_text', 'quantity', 'confidence'],
      },
    },
    warnings: { type: 'array', items: { type: 'string' }, description: 'ข้อสังเกตภาพรวม เช่น เอกสารเบลอ มีลายมือเขียนแทรก' },
  },
  required: ['lines'],
};

/**
 * อ่านใบสั่งขาย (รูปหรือ PDF) แล้วแปลงเป็นรายการที่ต้องไปหยิบ พร้อมจับคู่ SKU ในระบบ
 * ไม่บันทึกอะไรทั้งสิ้น — คืนข้อมูลให้หน้าจอเติมให้คนตรวจก่อนยืนยันเอง
 */
export async function scanSalesOrder({ files = [] } = {}) {
  if (!Array.isArray(files) || !files.length) throw badRequest('กรุณาแนบรูปหรือไฟล์ PDF ของใบสั่งขาย');
  if (files.length > 5) throw badRequest('แนบได้สูงสุด 5 ไฟล์ต่อครั้ง');

  const skus = await all(
    `SELECT sku_id, sku_code, sku_name, unit, barcode FROM skus WHERE status = 'ACTIVE' ORDER BY sku_code`);
  if (!skus.length) throw badRequest('ยังไม่มีข้อมูลสินค้าในระบบ — กรุณาเพิ่มสินค้าก่อน');

  const catalog = skus.map((s) => `${s.sku_code} | ${s.sku_name} | หน่วย ${s.unit}${s.barcode ? ` | บาร์โค้ด ${s.barcode}` : ''}`).join('\n');
  const blocks = files.map((f) => (String(f).startsWith('data:application/pdf') ? pdfBlock(f) : imageBlock(f)));

  const { data, usage } = await callClaudeJSON({
    system: `คุณคือผู้ช่วยจัดของตามใบสั่งขายของคลังเครื่องสำอาง de leaf thanaka
อ่านเอกสารใบสั่งขาย/ใบจัดเตรียมสินค้า แล้วดึงรายการสินค้าที่ต้องไปหยิบออกมาให้ครบทุกบรรทัด

กฎ:
- อ่านเฉพาะสิ่งที่เห็นจริงบนเอกสาร ห้ามแต่งเติมหรือเดาตัวเลขเอง
- อ่านไม่ออก/ไม่แน่ใจ ให้ confidence เป็น LOW แล้วอธิบายใน note ห้ามเดามั่ว
- รหัสสินค้าบนเอกสารมักเป็นรหัสของผู้ขาย ไม่ตรงกับรหัสในระบบ
  ให้ใส่รหัสบนเอกสารใน doc_code แล้วจับคู่จาก "ชื่อสินค้า" กับรายการในระบบด้านล่าง ใส่ผลใน sku_code
  ถ้าไม่มีตัวไหนใกล้เคียงพอ ให้เว้น sku_code ว่างไว้ แล้วระบุใน note ว่าจับคู่ไม่ได้
- ชื่อสินค้ามักมีทั้งไทยและอังกฤษปนกัน ให้ดูขนาด/ปริมาณ/แพ็คประกอบด้วย เช่น 100 กรัม แพ็ค 12 ต้องตรงกัน
- ตัวเลขจำนวนที่มีลูกน้ำคั่นหลักพัน ให้ตัดลูกน้ำออก
- บรรทัดที่เป็นของแถม เทสเตอร์ หรือตัวอย่าง ให้ดึงมาด้วยแต่ระบุไว้ใน note
- ถ้ามีลายมือเขียนแทรกบนเอกสาร ให้อ่านเท่าที่อ่านออกและแจ้งใน warnings
- อย่ารวมยอดข้ามบรรทัด แม้สินค้าจะซ้ำกัน ให้แยกตามที่เอกสารแสดง

รายการสินค้าในระบบ (รหัส | ชื่อ | หน่วย):
${catalog}`,
    messages: [{ role: 'user', content: [...blocks, { type: 'text', text: 'อ่านใบสั่งขายนี้แล้วดึงรายการสินค้าที่ต้องไปหยิบออกมาให้ครบทุกบรรทัด' }] }],
    schema: SO_SCHEMA,
    name: 'extract_sales_order',
    description: 'ส่งรายการสินค้าที่อ่านได้จากใบสั่งขาย',
    model: MODEL.SMART,
    maxTokens: 4096,
  });

  // จับคู่ sku_code ที่ AI ให้มากับของจริงในระบบ — ไม่เชื่อ AI ตรงๆ ต้องมีอยู่จริงเท่านั้น
  const byCode = new Map(skus.map((s) => [String(s.sku_code).toUpperCase(), s]));
  const lines = (data.lines ?? []).map((l) => {
    const matched = l.sku_code ? byCode.get(String(l.sku_code).toUpperCase()) ?? null : null;
    return {
      raw_text: l.raw_text ?? '',
      doc_code: l.doc_code || null,
      sku_id: matched?.sku_id ?? null,
      sku_code: matched?.sku_code ?? null,
      sku_name: matched?.sku_name ?? null,
      base_unit: matched?.unit ?? null,
      quantity: Number(l.quantity) || 0,
      unit: l.unit ?? null,
      confidence: l.confidence ?? 'MEDIUM',
      note: l.note || (l.sku_code && !matched ? `ไม่พบรหัส ${l.sku_code} ในระบบ` : null),
      needs_review: !matched || l.confidence === 'LOW' || !(Number(l.quantity) > 0),
    };
  });

  const warnings = [...(data.warnings ?? [])];
  if (lines.some((l) => !l.sku_id)) warnings.push('มีบางบรรทัดจับคู่สินค้าในระบบไม่ได้ — ต้องเลือกสินค้าเอง');
  if (lines.some((l) => !(l.quantity > 0))) warnings.push('มีบางบรรทัดอ่านจำนวนไม่ได้ — ต้องกรอกเอง');

  return {
    ref_no: data.ref_no || null,
    party: data.party || null,
    doc_date: /^\d{4}-\d{2}-\d{2}$/.test(data.doc_date ?? '') ? data.doc_date : null,
    lines,
    warnings: [...new Set(warnings)],
    stats: {
      total: lines.length,
      matched: lines.filter((l) => l.sku_id).length,
      needs_review: lines.filter((l) => l.needs_review).length,
    },
    usage,
  };
}

// ══════════════════════════════════════════════════════════════
//  1.3 / 2.x  เรียบเรียงผลวิเคราะห์เป็นคำแนะนำภาษาคน
// ══════════════════════════════════════════════════════════════

const BRIEF_SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string', description: 'สรุปสถานการณ์ในหนึ่งประโยค บอกสิ่งที่สำคัญที่สุด' },
    actions: {
      type: 'array',
      description: 'สิ่งที่ควรทำ เรียงตามความเร่งด่วน สูงสุด 6 ข้อ',
      items: {
        type: 'object',
        properties: {
          priority: { type: 'string', enum: ['ด่วน', 'ควรทำสัปดาห์นี้', 'เฝ้าดู'] },
          title: { type: 'string', description: 'สิ่งที่ต้องทำ สั้นๆ ไม่เกิน 15 คำ' },
          why: { type: 'string', description: 'เหตุผลพร้อมตัวเลขจริงจากข้อมูลที่ให้มา' },
          how: { type: 'string', description: 'ทำอย่างไร ระบุหน้าจอหรือขั้นตอนในระบบ' },
        },
        required: ['priority', 'title', 'why'],
      },
    },
    watch: { type: 'array', items: { type: 'string' }, description: 'เรื่องที่ยังไม่ต้องทำตอนนี้แต่ควรจับตา' },
  },
  required: ['headline', 'actions'],
};

const BRIEF_SYSTEM = `คุณคือที่ปรึกษาคลังสินค้าของโรงงานเครื่องสำอางไทยขนาด SME (de leaf thanaka)
หน้าที่: อ่านผลวิเคราะห์ที่เป็นตัวเลข แล้วสรุปเป็นคำแนะนำที่ผู้จัดการคลังเอาไปทำต่อได้ทันที

กฎ:
- ภาษาไทยล้วน กระชับ ตรงไปตรงมา เหมือนคุยกับผู้จัดการที่ยุ่ง
- อ้างตัวเลขจริงจากข้อมูลที่ให้มาเสมอ (จำนวน หน่วย วัน %) ห้ามคิดตัวเลขใหม่เอง
- เรียงตามผลกระทบต่อเงินและความเร่งด่วน ของใกล้หมดอายุมาก่อนเสมอ
- "how" ต้องบอกหน้าจอในระบบที่ใช้ทำ เช่น หน้าวางแผนหยิบสินค้า หน้าโอน/คืน/ตัดเสีย หน้ารับเข้า (GRN)
- ถ้าข้อมูลบอกว่าทุกอย่างปกติ ให้พูดตรงๆ ว่าปกติ ไม่ต้องหาเรื่องมาเตือน
- ห้ามแนะนำให้ลบข้อมูล ระบบนี้แก้ประวัติไม่ได้ ต้องใช้เอกสารกลับรายการเท่านั้น`;

/** สรุปสถานการณ์คลังทั้งหมดเป็นแผนปฏิบัติ (ใช้ที่หน้า AI Insights และส่งเข้า LINE ได้) */
export async function dailyBrief({ warehouseId = null, warehouseName = null } = {}) {
  const snap = await intel.insightSnapshot({ warehouseId });
  if (!aiEnabled()) return { snapshot: snap, brief: null, ai_disabled: true };

  const { data, usage } = await callClaudeJSON({
    system: BRIEF_SYSTEM,
    messages: [{
      role: 'user',
      content: `สรุปสถานการณ์คลัง "${warehouseName ?? 'ทุกคลัง'}" ประจำวันที่ ${todayTH()} จากผลวิเคราะห์นี้:

${JSON.stringify(snap, null, 1)}`,
    }],
    schema: BRIEF_SCHEMA,
    name: 'daily_brief',
    description: 'ส่งบทสรุปและสิ่งที่ควรทำ',
    model: MODEL.SMART,
    maxTokens: 2048,
  });
  return { snapshot: snap, brief: data, usage };
}

/** อธิบายผลวิเคราะห์เฉพาะเรื่อง — ใช้ปุ่ม "ให้ AI อธิบาย" ในแต่ละหน้ารายงาน */
export async function explain({ topic, warehouseId = null } = {}) {
  const map = {
    expiry: () => intel.expiryRisk({ warehouseId }),
    slotting: () => intel.slotting({ warehouseId }),
    forecast: () => intel.demandForecast({ warehouseId }),
    anomaly: () => intel.anomalies({ warehouseId }),
    labor: () => intel.laborPlan({ warehouseId }),
  };
  const fn = map[topic];
  if (!fn) throw badRequest('หัวข้อไม่ถูกต้อง');

  const raw = await fn();
  // ตัดให้เหลือเท่าที่จำเป็นก่อนส่งให้ AI เพื่อประหยัด token
  const data = topic === 'expiry' ? { summary: raw.summary, at_risk: trim(raw.at_risk, 20) }
    : topic === 'forecast' ? { summary: raw.summary, items: trim(raw.items, 25) }
    : topic === 'anomaly' ? { summary: raw.summary, findings: trim(raw.findings, 20) }
    : topic === 'slotting' ? { abc: raw.abc, recommendations: trim(raw.recommendations, 12),
        potential_trips_saved_per_month: raw.potential_trips_saved_per_month } : raw;

  if (!aiEnabled()) return { data: raw, brief: null, ai_disabled: true };

  const label = { expiry: 'ความเสี่ยงของหมดอายุ', slotting: 'การจัดตำแหน่งจัดเก็บ',
    forecast: 'การพยากรณ์ความต้องการ', anomaly: 'ความผิดปกติที่ตรวจพบ', labor: 'ภาระงานและกำลังคน' }[topic];

  const { data: brief, usage } = await callClaudeJSON({
    system: BRIEF_SYSTEM,
    messages: [{ role: 'user', content: `อธิบายผลวิเคราะห์เรื่อง "${label}" นี้ และบอกว่าควรทำอะไรต่อ:\n\n${JSON.stringify(data, null, 1)}` }],
    schema: BRIEF_SCHEMA,
    name: 'explain_result',
    description: 'ส่งคำอธิบายและสิ่งที่ควรทำ',
    model: MODEL.SMART,
    maxTokens: 2048,
  });
  return { data: raw, brief, usage };
}

// ══════════════════════════════════════════════════════════════
//  3.1  Vision Counting — นับสต็อกจากรูปหน้าชั้นวาง
// ══════════════════════════════════════════════════════════════

const COUNT_SCHEMA = {
  type: 'object',
  properties: {
    counted: { type: 'integer', description: 'จำนวนที่นับได้จากรูป' },
    confidence: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'], description: 'ความมั่นใจในการนับ' },
    counting_basis: { type: 'string', description: 'นับจากอะไร เช่น นับกล่องหน้าแถว 4 × สูง 3 ชั้น' },
    obstacles: { type: 'array', items: { type: 'string' }, description: 'อุปสรรคที่ทำให้นับไม่ชัด เช่น ของบังกัน แสงน้อย มองไม่เห็นด้านหลัง' },
    visible_labels: { type: 'array', items: { type: 'string' }, description: 'ข้อความบนป้าย/กล่องที่อ่านได้ เช่น Lot หรือชื่อสินค้า' },
  },
  required: ['counted', 'confidence', 'counting_basis'],
};

/**
 * ช่วยนับจำนวนจากรูปถ่ายหน้าชั้นวาง — เป็นตัวช่วยกะประมาณเท่านั้น
 * ผลที่ได้ต้องให้คนยืนยันก่อนบันทึกลงรอบนับสต็อกเสมอ
 */
export async function visionCount({ image, expected = null, sku_name = null, location_code = null } = {}) {
  if (!image) throw badRequest('กรุณาแนบรูปถ่ายชั้นวาง');
  const block = imageBlock(image);

  const hints = [
    location_code ? `ตำแหน่ง: ${location_code}` : null,
    sku_name ? `สินค้าที่ควรอยู่ตรงนี้: ${sku_name}` : null,
    expected !== null && expected !== undefined ? `จำนวนที่ระบบบันทึกไว้: ${expected}` : null,
  ].filter(Boolean).join('\n');

  const { data, usage } = await callClaudeJSON({
    system: `คุณช่วยนับจำนวนสินค้าจากรูปถ่ายหน้าชั้นวางในคลังเครื่องสำอาง

กฎ:
- นับเฉพาะที่มองเห็นจริงในรูป อธิบายวิธีนับให้ชัด เช่น "หน้าแถว 4 กล่อง × สูง 3 ชั้น = 12"
- ของที่ถูกบังหรือมองไม่เห็นด้านหลัง ห้ามเดาจำนวน ให้ระบุใน obstacles แล้วลด confidence
- รูปเบลอ แสงน้อย หรือมุมไม่ดี ให้ confidence เป็น LOW
- ถ้ามีจำนวนที่ระบบบันทึกไว้ให้เทียบ อย่าปรับตัวเลขที่นับได้ให้ตรงกับระบบ — รายงานตามที่เห็นจริง
- อ่านข้อความบนป้าย/กล่องที่เห็นได้ เช่น Lot หรือชื่อสินค้า ใส่ใน visible_labels`,
    messages: [{ role: 'user', content: [block, { type: 'text', text: `นับจำนวนสินค้าในรูปนี้${hints ? `\n\n${hints}` : ''}` }] }],
    schema: COUNT_SCHEMA,
    name: 'count_from_photo',
    description: 'ส่งผลการนับจากรูป',
    model: MODEL.SMART,
    maxTokens: 2048,
  });

  const counted = Number(data.counted) || 0;
  const exp = expected === null || expected === undefined ? null : Number(expected);
  return {
    counted, confidence: data.confidence, counting_basis: data.counting_basis,
    obstacles: data.obstacles ?? [], visible_labels: data.visible_labels ?? [],
    expected: exp,
    variance: exp === null ? null : counted - exp,
    matches: exp === null ? null : counted === exp,
    disclaimer: 'ผลนับจากรูปเป็นเพียงตัวช่วยประมาณ ต้องให้คนตรวจยืนยันก่อนบันทึกเสมอ',
    usage,
  };
}
