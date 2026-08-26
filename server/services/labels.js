// พิมพ์ป้ายรหัสตำแหน่งสำหรับติดที่ชั้นวาง (Barcode Code-128 + QR Code)
import bwip from 'bwip-js';
import { all } from '../lib/db.js';
import { notFound } from '../lib/http.js';

const esc = async (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export async function locationLabels({ rag_id }) {
  const rows = await all(
    `SELECT l.*, r.rag_no, z.zone_code FROM locations l
       JOIN rags r ON r.rag_id = l.rag_id JOIN zones z ON z.zone_id = r.zone_id
      WHERE l.rag_id = ? ORDER BY l.level, l.depth`,
    Number(rag_id),
  );
  if (!rows.length) throw notFound('ไม่พบตำแหน่งสำหรับพิมพ์ป้าย');

  const cards = [];
  for (const l of rows) {
    const [barcode, qr] = await Promise.all([
      bwip.toSVG({ bcid: 'code128', text: l.location_code, includetext: false, height: 8, width: 60 }),
      bwip.toSVG({ bcid: 'qrcode', text: l.location_code, eclevel: 'M' }),
    ]);
    cards.push(`<div class="label">
      <div class="code">${esc(l.location_code)}</div>
      <div class="bc">${barcode}</div>
      <div class="meta"><span>โซน ${esc(l.zone_code)} · ชั้นวาง ${esc(l.rag_no)}</span><span>ชั้น L${l.level} · ตอน D${l.depth}</span></div>
      <div class="qr">${qr}</div>
    </div>`);
  }

  return `<!doctype html>
<html lang="th"><head><meta charset="utf-8"><title>ป้ายตำแหน่งจัดเก็บ</title><style>
  @page { size: A4; margin: 8mm; }
  * { box-sizing: border-box; }
  body { font-family: "Sarabun","Noto Sans Thai",system-ui,sans-serif; margin:0; padding:10px; background:#eef1f5; }
  .toolbar { margin-bottom:10px; display:flex; gap:10px; align-items:center; }
  .toolbar button { padding:9px 18px; border:0; border-radius:8px; background:#0f766e; color:#fff; font-size:14px; cursor:pointer; }
  .sheet { display:flex; flex-wrap:wrap; gap:4mm; }
  .label { width:50mm; height:30mm; background:#fff; border:1px dashed #999; padding:2mm;
           display:grid; grid-template-columns:1fr 12mm; gap:1mm; align-content:center; page-break-inside:avoid; }
  .label svg { width:100%; height:auto; }
  .code { grid-column:1/3; text-align:center; font-size:13pt; font-weight:800; }
  .bc { grid-column:1/2; } .bc svg { height:9mm; }
  .qr { grid-column:2/3; grid-row:2/4; }
  .meta { grid-column:1/2; display:flex; flex-direction:column; font-size:6.5pt; color:#333; }
  @media print { body { background:#fff; padding:0 } .toolbar { display:none } }
</style></head><body>
  <div class="toolbar"><button onclick="window.print()">🖨️ พิมพ์ป้าย</button>
    <span>ป้ายตำแหน่งจัดเก็บ ${rows.length} ป้าย — แนะนำสติกเกอร์กันน้ำ ขนาด 5×3 ซม.</span></div>
  <div class="sheet">${cards.join('\n')}</div>
</body></html>`;
}
