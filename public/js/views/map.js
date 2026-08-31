// แผนผังคลัง — ผังพื้นคลังเลือก RACK + แผนผัง RACK รายตัว (ชั้น × ความลึก) + จัดเก็บสินค้า
import { api, auth, wh, openLabels } from '../api.js?v=45';
import { h, field, modal, pill, expiryPill, toast, fmtNum, fmtDateTime, table } from '../ui.js?v=45';
import { itemActions } from '../actions.js?v=45';

const heatColor = (pct) => (pct >= 90 ? '#dc2626' : pct >= 70 ? '#d97706' : pct >= 35 ? '#2563eb' : '#16a34a');

function rackSpan(r) {
  return {
    cols: Math.max(1, Math.min(4, Math.ceil(r.total_depths / 3))),
    rows: Math.max(1, Math.min(3, Math.ceil(r.total_levels / 3))),
  };
}

// ============================================================ ภาพรวม — ผังพื้นคลัง
export async function overviewView() {
  const data = await api.get('/api/overview', { warehouse_id: wh.id });
  const w = data.warehouse;
  const houses = data.warehouses ?? [];

  const panels = await Promise.all(houses.map((wh) => {
    if (!wh.warehouse_id) return warehouseListPanel(wh);
    return warehouseFloorPanel(wh);
  }));

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'แผนผังชั้นวาง'),
        h('p', {}, `คลัง: ${wh.label} — เลือกชั้นวางจากผังพื้นเพื่อดูแผนผังภายในและจัดการสินค้า`)),
      h('div', { class: 'actions' },
        pill(`ใช้พื้นที่ ${w.usage_pct}%`, w.usage_pct >= 90 ? 'red' : 'blue'),
        pill(`ว่าง ${w.empty}`, 'green'),
        pill(`ทั้งหมด ${w.total}`, 'gray'))),
    ...panels);
}

function warehouseListPanel(wh) {
  const zoneBlock = (z) =>
    h('div', { class: 'zone-block' },
      h('div', { style: 'display:flex;align-items:center;gap:10px;flex-wrap:wrap' },
        h('h2', { style: 'margin:0' }, `${z.zone_code} — ${z.zone_name}`),
        pill(`${z.usage_pct}%`, z.usage_pct >= 90 ? 'red' : z.usage_pct >= 70 ? 'amber' : 'blue'),
        h('span', { class: 'muted', style: 'font-size:13px' }, `${z.occupied}/${z.usable} ตำแหน่ง`)),
      h('div', { class: 'rack-tiles' },
        ...z.rags.map((r) =>
          h('div', { class: 'rack-tile', onclick: () => (location.hash = `#/map/${r.rag_id}`) },
            h('div', { class: 'no' }, `${r.zone_code}-${r.rag_no}`),
            h('div', { class: 'util' }, `${r.usage_pct}% · ${r.occupied}/${r.usable}`),
            h('div', { class: 'heat' }, h('span', { style: `width:${r.usage_pct}%;background:${heatColor(r.usage_pct)}` }))))));

  return h('div', { style: 'margin-bottom:22px' },
    h('div', { class: 'wh-band' },
      h('h2', { style: 'margin:0;font-size:15px' }, `🏭 ${wh.wh_code} — ${wh.wh_name ?? 'ไม่ระบุคลัง'}`),
      pill(`${wh.usage_pct}%`, wh.usage_pct >= 90 ? 'red' : wh.usage_pct >= 70 ? 'amber' : 'blue'),
      h('span', { class: 'muted', style: 'font-size:12px' }, `${wh.occupied}/${wh.usable} ตำแหน่ง`)),
    ...wh.zones.map(zoneBlock));
}

async function warehouseFloorPanel(wh) {
  let layoutData;
  try {
    layoutData = await api.get(`/api/warehouses/${wh.warehouse_id}/layout`);
  } catch {
    return warehouseListPanel(wh);
  }

  const { warehouse: whInfo, zones, racks } = layoutData;
  const board = h('div', { class: 'floor' });
  board.style.gridTemplateColumns = `repeat(${whInfo.grid_cols}, minmax(48px, 1fr))`;
  board.style.gridTemplateRows = `repeat(${whInfo.grid_rows}, minmax(48px, auto))`;

  const rackAt = (x, y) => racks.find((r) => r.pos_x === x && r.pos_y === y);

  const covered = new Map();
  for (const r of racks) {
    if (r.pos_x === null) continue;
    const s = rackSpan(r);
    for (let dy = 0; dy < s.rows; dy++)
      for (let dx = 0; dx < s.cols; dx++)
        covered.set(`${r.pos_x + dx}:${r.pos_y + dy}`, r);
  }

  function miniGrid(r) {
    const cellMap = new Map();
    for (const c of (r.cells || [])) cellMap.set(`${c.level}:${c.depth}`, c.status);
    const miniCells = [];
    for (let lv = r.total_levels; lv >= 1; lv--)
      for (let d = 1; d <= r.total_depths; d++) {
        const st = cellMap.get(`${lv}:${d}`) || 'EMPTY';
        miniCells.push(h('i', { class: `mc ${st === 'OCCUPIED' ? 'occ' : st === 'DISABLED' ? 'dis' : 'emp'}` }));
      }
    return h('div', {
      class: 'mini-rack',
      style: `grid-template-columns:repeat(${r.total_depths},1fr)`,
    }, ...miniCells);
  }

  const cells = [];
  for (let y = 0; y < whInfo.grid_rows; y++) {
    for (let x = 0; x < whInfo.grid_cols; x++) {
      const r = rackAt(x, y);
      if (r) {
        const s = rackSpan(r);
        const usable = r.total - r.disabled;
        cells.push(h('div', {
          class: 'floor-rack',
          style: `--zc:${r.color || '#2563eb'}; grid-column:${r.pos_x + 1}/span ${s.cols}; grid-row:${r.pos_y + 1}/span ${s.rows}; cursor:pointer`,
          title: `${r.zone_code}-${r.rag_no} · ${r.zone_name} · คลิกเพื่อดูแผนผังภายใน`,
          onclick: () => (location.hash = `#/map/${r.rag_id}`),
        },
          h('div', { class: 'fr-header' },
            h('div', {},
              h('div', { class: 'fr-no' }, r.rag_no),
              h('div', { class: 'fr-zone' }, r.zone_code)),
            h('div', { class: 'fr-use' }, `${r.occupied}/${usable}`)),
          miniGrid(r)));
      } else if (!covered.has(`${x}:${y}`)) {
        cells.push(h('div', {
          class: 'floor-cell',
          style: `grid-column:${x + 1}; grid-row:${y + 1}; cursor:default`,
        }));
      }
    }
  }
  board.replaceChildren(...cells);

  const zoneLegend = h('div', { class: 'map-zone-legend' },
    ...zones.map((z) =>
      h('div', { class: 'zone-legend-item' },
        h('i', { style: `background:${z.color || '#2563eb'}` }),
        h('span', {}, `${z.zone_code} — ${z.zone_name} (${z.rack_count})`))));

  return h('div', { style: 'margin-bottom:22px' },
    h('div', { class: 'wh-band' },
      h('h2', { style: 'margin:0;font-size:15px' }, `🏭 ${wh.wh_code} — ${wh.wh_name}`),
      pill(`${wh.usage_pct}%`, wh.usage_pct >= 90 ? 'red' : wh.usage_pct >= 70 ? 'amber' : 'blue'),
      h('span', { class: 'muted', style: 'font-size:12px' }, `${wh.occupied}/${wh.usable} ตำแหน่ง`)),
    h('div', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h2', {}, 'ผังพื้นคลัง'),
        h('div', { class: 'floor-hint' }, 'คลิกชั้นวางเพื่อดูแผนผังภายในและจัดการสินค้า')),
      h('div', { class: 'floor-wrap' }, board),
      zoneLegend));
}

// ============================================================ แผนผัง RACK รายตัว + จัดเก็บ/จัดการสินค้า
export async function rackView({ match, params }) {
  const ragId = Number(match[1]);
  const data = await api.get(`/api/rags/${ragId}/map`);
  const highlight = params.get('loc');
  const { rag, cells, stats } = data;
  const canMove = auth.can('move');

  const byLevel = new Map();
  for (const c of cells) {
    if (!byLevel.has(c.level)) byLevel.set(c.level, []);
    byLevel.get(c.level).push(c);
  }
  const levels = [...byLevel.keys()].sort((a, b) => b - a);

  const cellClass = (c) => {
    if (c.status === 'DISABLED') return 'disabled';
    if (!c.item_id) return 'empty';
    return c.expiry?.color === 'red' ? 'red' : c.expiry?.color === 'amber' ? 'amber' : 'blue';
  };

  const grid = h('div', { class: 'rack' },
    h('div', { class: 'depth-head' }, ...Array.from({ length: rag.total_depths }, (_, i) => h('div', {}, `D${i + 1}`))),
    ...levels.map((lv) =>
      h('div', { class: 'rack-row' },
        h('div', { class: 'lvl' }, `L${lv}`),
        ...byLevel.get(lv).sort((a, b) => a.depth - b.depth).map((c) =>
          h('div', {
            class: `cell ${cellClass(c)} ${highlight === c.location_code ? 'selected' : ''}`,
            onclick: () => cellDetail(c),
          },
            h('div', { class: 'code' }, c.location_code.split('-').slice(-2).join('-')),
            c.item_id
              ? h('div', {}, h('div', { class: 'name' }, c.sku_name), h('div', {}, `${fmtNum(c.quantity)} ${c.unit}`))
              : h('div', { class: 'name' }, c.status === 'DISABLED' ? 'ปิดใช้งาน' : 'ว่าง'))))),
    h('div', { class: 'legend' },
      lg('#bbf7d0', 'ว่าง'), lg('#bfdbfe', 'มีสินค้า'), lg('#fde68a', 'ใกล้หมดอายุ'),
      lg('#fecaca', 'หมดอายุ'), lg('#e2e8f0', 'ปิดใช้งาน')));

  function lg(color, text) { return h('span', {}, h('i', { style: `display:inline-block;width:14px;height:14px;border-radius:3px;vertical-align:middle;margin-right:4px;background:${color}` }), text); }

  async function cellDetail(c) {
    const detail = await api.get(`/api/locations/${encodeURIComponent(c.location_code)}`);
    const item = detail.item;

    if (item) {
      showOccupiedCell(c, item, detail);
    } else if (c.status === 'DISABLED') {
      showDisabledCell(c);
    } else {
      showEmptyCell(c, detail);
    }
  }

  function showOccupiedCell(c, item, detail) {
    const rows = h('div', { class: 'grid g2' },
      kv('สินค้า', `${item.sku_name} (${item.sku_code})`),
      kv('Lot', item.lot_no), kv('จำนวน', `${fmtNum(item.quantity)} ${item.unit}`),
      kv('วันหมดอายุ', item.exp_date ? `${item.exp_date} ${item.expiry ? `(${item.expiry.label})` : ''}` : '—'),
      kv('จัดเก็บเมื่อ', fmtDateTime(item.stored_at)));

    const history = detail.history?.length
      ? h('div', { style: 'margin-top:12px' }, h('b', {}, 'ประวัติล่าสุด'),
          table([
            { label: 'เวลา', value: (r) => fmtDateTime(r.moved_at) },
            { label: 'ประเภท', value: (r) => ({ STORE: 'จัดเก็บ', REMOVE: 'หยิบออก', MOVE: 'ย้าย', EDIT: 'แก้ไข' }[r.movement_type]) },
            { label: 'สินค้า', key: 'sku_name' },
            { label: 'ผู้ทำรายการ', key: 'user_name' },
          ], detail.history.slice(0, 6)))
      : null;

    modal(`ตำแหน่ง ${c.location_code}`, h('div', {}, rows, history),
      [
        item ? h('a', { class: 'btn', title: 'เปิดหน้าค้นหาโดยใช้รหัสตำแหน่งนี้ เพื่อดูรายละเอียดสินค้าและประวัติการเคลื่อนไหวทั้งหมด', href: `#/search?q=${encodeURIComponent(c.location_code)}` }, '🔍 ค้นหา') : null,
        ...(item ? itemActions({ ...item, location_code: c.location_code }, reload) : []),
      ].filter(Boolean));
  }

  function showDisabledCell(c) {
    modal(`ตำแหน่ง ${c.location_code}`,
      h('p', {}, 'ตำแหน่งนี้ถูกปิดใช้งาน'),
      auth.can('manage')
        ? [h('button', {
            class: 'btn primary',
            title: 'เปิดตำแหน่งนี้กลับมาใช้งาน — จะกลายเป็นช่องว่างที่นำสินค้ามาวางได้และถูกนำไปเสนอเป็นตำแหน่งจัดเก็บอีกครั้ง',
            onclick: async () => {
              try {
                await api.patch(`/api/locations/${c.location_id}`, { status: 'EMPTY' });
                toast('เปิดใช้งานตำแหน่งแล้ว'); reload();
              } catch (err) { toast(err.message, 'err'); }
            },
          }, 'เปิดใช้งาน')]
        : []);
  }

  async function showEmptyCell(c, detail) {
    if (!canMove) {
      modal(`ตำแหน่ง ${c.location_code}`,
        h('p', {}, 'ตำแหน่งนี้ว่าง พร้อมจัดเก็บสินค้า'),
        []);
      return;
    }

    const skus = await api.get('/api/skus');
    const skuSel = h('select', {},
      h('option', { value: '' }, '— เลือกสินค้า —'),
      ...skus.map((s) => h('option', { value: s.sku_id }, `${s.sku_code} — ${s.sku_name} (${s.unit})`)));
    const qty = h('input', { type: 'number', min: '1', value: '1' });
    const lot = h('input', { placeholder: 'เช่น L2026-08-01' });
    const mfg = h('input', { type: 'date' });
    const exp = h('input', { type: 'date' });
    const note = h('input', { placeholder: 'หมายเหตุ (ถ้ามี)' });

    const history = detail.history?.length
      ? h('div', { style: 'margin-top:12px' }, h('b', {}, 'ประวัติล่าสุด'),
          table([
            { label: 'เวลา', value: (r) => fmtDateTime(r.moved_at) },
            { label: 'ประเภท', value: (r) => ({ STORE: 'จัดเก็บ', REMOVE: 'หยิบออก', MOVE: 'ย้าย', EDIT: 'แก้ไข' }[r.movement_type]) },
            { label: 'สินค้า', key: 'sku_name' },
            { label: 'ผู้ทำรายการ', key: 'user_name' },
          ], detail.history.slice(0, 6)))
      : null;

    const m = modal(`📥 จัดเก็บสินค้า — ${c.location_code}`,
      h('div', {},
        h('div', { style: 'background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:10px;margin-bottom:12px;font-size:13px' },
          `ตำแหน่งว่าง พร้อมจัดเก็บ — RACK ${rag.zone_code}-${rag.rag_no} ชั้น ${c.level} ตอน ${c.depth}`),
        field('สินค้า *', skuSel, null, 'เลือกรายการสินค้าที่ต้องการจัดเก็บเข้าตำแหน่งนี้'),
        h('div', { class: 'grid g2' },
          field('จำนวน *', qty, null, 'จำนวนสินค้าที่จัดเก็บ ตามหน่วยนับของสินค้านั้น'),
          field('Lot / รุ่นการผลิต', lot, null, 'รหัส Lot หรือรุ่นการผลิต — ใช้ติดตามย้อนกลับ')),
        h('div', { class: 'grid g2' },
          field('วันผลิต (MFG)', mfg, null, 'วันที่ผลิตสินค้า — Manufacturing Date'),
          field('วันหมดอายุ (EXP)', exp, null, 'วันหมดอายุ — ระบบจะใช้คำนวณ FEFO และแจ้งเตือนสินค้าใกล้หมดอายุ')),
        field('หมายเหตุ', note, null, 'บันทึกเพิ่มเติม เช่น เหตุผลที่เก็บตำแหน่งนี้'),
        history),
      [
        h('button', { class: 'btn', onclick: () => m.close() }, 'ยกเลิก'),
        auth.can('manage')
          ? h('button', {
              class: 'btn danger',
              style: 'margin-right:auto',
              title: 'ปิดตำแหน่งนี้ไม่ให้นำสินค้ามาวาง เช่น ชั้นชำรุดหรือกันพื้นที่ไว้ — ระบบจะไม่เสนอเป็นตำแหน่งจัดเก็บอีก เปิดคืนได้ภายหลัง',
              onclick: async () => {
                try {
                  await api.patch(`/api/locations/${c.location_id}`, { status: 'DISABLED' });
                  toast('ปิดใช้งานตำแหน่งแล้ว'); m.close(); reload();
                } catch (err) { toast(err.message, 'err'); }
              },
            }, 'ปิดใช้งาน')
          : null,
        h('button', { class: 'btn primary', title: 'นำสินค้าตามที่กรอกเข้าเก็บที่ตำแหน่งนี้ — สต๊อกเพิ่มทันที ช่องจะเปลี่ยนเป็นมีสินค้า และ 1 ตำแหน่งเก็บได้ 1 พาเลทเท่านั้น', onclick: async () => {
          if (!skuSel.value) { toast('กรุณาเลือกสินค้า', 'err'); return; }
          try {
            const res = await api.post('/api/items', {
              sku_id: Number(skuSel.value),
              location_code: c.location_code,
              quantity: Number(qty.value),
              lot_no: lot.value.trim() || null,
              mfg_date: mfg.value || null,
              exp_date: exp.value || null,
              note: note.value.trim() || null,
            });
            toast(`จัดเก็บ ${res.sku_name} ที่ ${c.location_code} เรียบร้อย`);
            m.close(); reload();
          } catch (err) { toast(err.message, 'err'); }
        } }, '📥 จัดเก็บสินค้า'),
      ].filter(Boolean));
  }

  function reload() { location.hash = `#/map/${ragId}`; location.reload(); }
  const kv = (k, v) => h('div', {}, h('div', { style: 'font-size:12px;color:#64748b' }, k), h('div', { style: 'font-weight:700' }, v ?? '—'));

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', {}, `RACK ${rag.zone_code}-${rag.rag_no}`),
        h('p', {}, `${rag.zone_name} · ${rag.total_levels} ชั้น × ${rag.total_depths / 2} ล็อค (${rag.total_depths} ตอน)`)),
      h('div', { class: 'actions' },
        pill(`ใช้พื้นที่ ${stats.usage_pct}%`, stats.usage_pct >= 90 ? 'red' : 'blue'),
        pill(`ว่าง ${stats.empty}`, 'green'),
        auth.can('view') ? h('button', { class: 'btn', title: 'เปิดหน้าพิมพ์ป้ายบาร์โค้ดของทุกตำแหน่งในชั้นวางนี้ สำหรับติดหน้าชั้นให้สแกนตอนรับเข้า/หยิบออก', onclick: () => openLabels('/labels/location', { rag_id: ragId }) }, '🏷️ พิมพ์ป้าย') : null,
        h('a', { class: 'btn', title: 'กลับไปผังพื้นคลังเพื่อเลือกชั้นวางอื่น', href: '#/map' }, '← ผังพื้นคลัง'))),
    h('div', { style: 'font-size:13px;color:#64748b;margin-bottom:8px' },
      canMove
        ? 'คลิกช่องว่างเพื่อจัดเก็บสินค้า · คลิกช่องที่มีสินค้าเพื่อหยิบออก/ย้าย · ← ด้านหน้า (ทางเดิน) →'
        : '← ด้านหน้า (ทางเดิน) · ด้านหลังชั้นวาง →'),
    grid);
}
