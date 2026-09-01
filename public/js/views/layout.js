// ผังคลังสินค้า — เลือกคลัง แล้วจัดวาง RACK บนผังพื้น (เฉพาะ ADMIN แก้ไขได้)
import { api, auth } from '../api.js?v=49';
import { h, field, modal, toast, pill, fmtNum, confirmBox } from '../ui.js?v=49';

const ZONE_COLORS = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d'];
const heatColor = (pct) => (pct >= 90 ? '#dc2626' : pct >= 70 ? '#d97706' : pct >= 35 ? '#2563eb' : '#16a34a');

function rackSpan(r) {
  return {
    cols: Math.max(1, Math.min(4, Math.ceil(r.total_depths / 3))),
    rows: Math.max(1, Math.min(3, Math.ceil(r.total_levels / 3))),
  };
}

// ============================================================ รายการคลัง
export async function warehouseListView() {
  const rows = await api.get('/api/warehouses');
  const canManage = auth.can('manage');

  const cards = rows.length
    ? h('div', { class: 'grid g3' },
        ...rows.map((w) =>
          h('div', { class: 'card wh-card', onclick: () => (location.hash = `#/layout/${w.warehouse_id}`) },
            h('div', { class: 'wh-head' },
              h('div', {},
                h('div', { class: 'wh-code' }, w.wh_code),
                h('div', { class: 'wh-name' }, w.wh_name)),
              pill(`${w.usage_pct}%`, w.usage_pct >= 90 ? 'red' : w.usage_pct >= 70 ? 'amber' : 'blue')),
            w.address ? h('div', { class: 'muted', style: 'font-size:12px' }, `📍 ${w.address}`) : null,
            h('div', { class: 'wh-stats' },
              stat('โซน', w.zone_count), stat('ชั้นวาง', w.rack_count),
              stat('ตำแหน่ง', fmtNum(w.total_locations)), stat('ว่าง', fmtNum(w.empty))),
            h('div', { class: 'heat' }, h('span', { style: `width:${w.usage_pct}%;background:${heatColor(w.usage_pct)}` })),
            h('div', { class: 'muted', style: 'font-size:12px;margin-top:8px' },
              `ผังพื้น ${w.grid_cols} × ${w.grid_rows} ช่อง`))))
    : h('div', { class: 'empty-state' }, 'ยังไม่มีคลังสินค้า — กด "เพิ่มคลังสินค้า" เพื่อเริ่มต้น');

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'ผังคลังสินค้า'),
        h('p', {}, 'เลือกคลังเพื่อจัดวางชั้นวาง (RACK) และกำหนดโซนจัดเก็บ')),
      canManage
        ? h('div', { class: 'actions' },
            h('button', { class: 'btn primary', title: 'สร้างคลังสินค้าใหม่พร้อมกำหนดขนาดผังพื้น (คอลัมน์ × แถว) — จากนั้นจึงเพิ่มโซนและชั้นวางเข้าไป', onclick: () => warehouseForm(null, () => reload()) }, '+ เพิ่มคลังสินค้า'))
        : null),
    cards);
}

const stat = (label, value) =>
  h('div', {}, h('div', { class: 'muted', style: 'font-size:11px' }, label), h('div', { style: 'font-weight:700' }, value));

const reload = () => location.reload();

// ============================================================ ผังพื้นของคลังหนึ่ง
export async function warehouseLayoutView({ match }) {
  const whId = Number(match[1]);
  const data = await api.get(`/api/warehouses/${whId}/layout`);
  const { warehouse: w, zones, racks } = data;
  const canManage = auth.can('manage');

  let selected = null;
  let dragging = null;
  const board = h('div', { class: 'floor' });
  const hint = h('div', { class: 'floor-hint' });

  const rackAt = (x, y) => racks.find((r) => r.pos_x === x && r.pos_y === y);

  function buildCoveredMap() {
    const covered = new Map();
    for (const r of racks) {
      if (r.pos_x === null) continue;
      const s = rackSpan(r);
      for (let dy = 0; dy < s.rows; dy++)
        for (let dx = 0; dx < s.cols; dx++)
          covered.set(`${r.pos_x + dx}:${r.pos_y + dy}`, r);
    }
    return covered;
  }

  function renderHint() {
    if (!canManage) { hint.replaceChildren('คลิกชั้นวางเพื่อดูแผนผังภายใน'); return; }
    hint.replaceChildren(selected
      ? `กำลังย้าย ${selected.zone_code}-${selected.rag_no} — คลิกช่องปลายทาง (คลิกซ้ำที่เดิมเพื่อยกเลิก)`
      : 'คลิกช่องว่างเพื่อเพิ่มชั้นวาง · คลิกหรือลากชั้นวางเพื่อย้าย');
  }

  function renderBoard() {
    board.style.gridTemplateColumns = `repeat(${w.grid_cols}, minmax(48px, 1fr))`;
    board.style.gridTemplateRows = `repeat(${w.grid_rows}, minmax(48px, auto))`;
    const covered = buildCoveredMap();
    const cells = [];

    for (let y = 0; y < w.grid_rows; y++) {
      for (let x = 0; x < w.grid_cols; x++) {
        const r = rackAt(x, y);
        if (r) {
          cells.push(rackCell(r));
        } else if (!covered.has(`${x}:${y}`)) {
          cells.push(emptyCell(x, y));
        }
      }
    }
    board.replaceChildren(...cells);
    renderHint();
  }

  function emptyCell(x, y) {
    return h('div', {
      class: `floor-cell ${selected ? 'droppable' : ''}`,
      style: `grid-column:${x + 1}; grid-row:${y + 1}`,
      title: `ช่อง ${x + 1},${y + 1}`,
      onclick: () => {
        if (!canManage) return;
        if (selected) return doMove(selected, x, y);
        rackForm(null, { x, y });
      },
      ondragover: canManage ? (e) => { e.preventDefault(); e.currentTarget.classList.add('drag-over'); } : null,
      ondragleave: canManage ? (e) => { e.currentTarget.classList.remove('drag-over'); } : null,
      ondrop: canManage ? (e) => { e.preventDefault(); e.currentTarget.classList.remove('drag-over'); if (dragging) doMove(dragging, x, y); } : null,
    }, canManage ? h('span', { class: 'plus' }, selected ? '↳' : '+') : null);
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

  function rackCell(r) {
    const isSel = selected?.rag_id === r.rag_id;
    const s = rackSpan(r);
    return h('div', {
      class: `floor-rack ${isSel ? 'selected' : ''} ${r.status === 'INACTIVE' ? 'off' : ''}`,
      style: `--zc:${r.color || '#2563eb'}; grid-column:${r.pos_x + 1}/span ${s.cols}; grid-row:${r.pos_y + 1}/span ${s.rows}`,
      title: `${r.zone_code}-${r.rag_no} · ${r.zone_name} · ${r.total_levels}ชั้น×${r.total_depths / 2}ล็อค`,
      draggable: canManage ? 'true' : null,
      ondragstart: canManage ? (e) => {
        dragging = r;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', r.rag_id);
        e.currentTarget.classList.add('dragging');
        board.classList.add('drag-active');
      } : null,
      ondragend: canManage ? (e) => {
        dragging = null;
        e.currentTarget.classList.remove('dragging');
        board.classList.remove('drag-active');
      } : null,
      ondragover: canManage ? (e) => { if (dragging && dragging.rag_id !== r.rag_id) { e.preventDefault(); e.currentTarget.classList.add('drag-over'); } } : null,
      ondragleave: canManage ? (e) => { e.currentTarget.classList.remove('drag-over'); } : null,
      ondrop: canManage ? (e) => { e.preventDefault(); e.currentTarget.classList.remove('drag-over'); if (dragging && dragging.rag_id !== r.rag_id) doMove(dragging, r.pos_x, r.pos_y); } : null,
      onclick: () => {
        if (selected && selected.rag_id !== r.rag_id) return doMove(selected, r.pos_x, r.pos_y);
        if (selected) { selected = null; renderBoard(); return; }
        rackMenu(r);
      },
    },
      h('div', { class: 'fr-header' },
        h('div', {},
          h('div', { class: 'fr-no' }, r.rag_no),
          h('div', { class: 'fr-zone' }, r.zone_code)),
        h('div', { class: 'fr-use' }, `${r.occupied}/${r.usable}`)),
      miniGrid(r));
  }

  async function doMove(rack, x, y) {
    try {
      await api.patch(`/api/rags/${rack.rag_id}/position`, { pos_x: x, pos_y: y });
      toast(`ย้าย ${rack.rag_no} แล้ว`);
      selected = null;
      refresh();
    } catch (err) { toast(err.message, 'err'); }
  }

  // ---------------- เมนูของชั้นวาง ----------------
  function rackMenu(r) {
    const s = rackSpan(r);
    const m = modal(`ชั้นวาง ${r.zone_code}-${r.rag_no}`,
      h('div', {},
        h('div', { class: 'grid g2' },
          kv('โซน', `${r.zone_code} — ${r.zone_name}`),
          kv('ขนาด', `${r.total_levels} ชั้น × ${r.total_depths / 2} ล็อค (${r.total_depths} ตอน)`),
          kv('ตำแหน่งทั้งหมด', fmtNum(r.total)),
          kv('ใช้งาน', `${r.occupied}/${r.usable} (${r.usage_pct}%)`),
          kv('ตำแหน่งบนผัง', `คอลัมน์ ${r.pos_x + 1} · แถว ${r.pos_y + 1} (${s.cols}×${s.rows} ช่อง)`),
          kv('สถานะ', r.status === 'ACTIVE' ? 'ใช้งาน' : 'ปิดใช้งาน')),
        r.note ? h('p', { class: 'muted', style: 'margin-top:8px' }, r.note) : null),
      [
        h('a', { class: 'btn', title: 'เปิดผังภายในชั้นวางนี้ ดูทุกช่องแยกตามชั้น (Level) และตอน (Depth) ว่ามีสินค้าอะไรอยู่', href: `#/map/${r.rag_id}` }, '🗺️ ดูแผนผังภายใน'),
        canManage ? h('button', { class: 'btn', title: 'ย้ายชั้นวางนี้ไปช่องอื่นบนผังพื้น — ปิดหน้าต่างแล้วคลิกช่องปลายทางที่ต้องการ (รหัสตำแหน่งสินค้าไม่เปลี่ยน)', onclick: () => { m.close(); selected = r; renderBoard(); } }, '✥ ย้ายตำแหน่ง') : null,
        canManage ? h('button', { class: 'btn', title: 'แก้ไขหมายเลข โซน จำนวนชั้น/ตอน หรือปิดใช้งานชั้นวางนี้ — การเพิ่มชั้น/ตอนจะสร้างตำแหน่งใหม่เพิ่มให้อัตโนมัติ', onclick: () => { m.close(); rackForm(r); } }, '✎ แก้ไข') : null,
        canManage ? h('button', {
          class: 'btn danger',
          title: `ลบชั้นวางนี้พร้อมตำแหน่งจัดเก็บทั้ง ${r.total} ช่องออกจากระบบถาวร — ทำได้ต่อเมื่อไม่มีสินค้าค้างอยู่`,
          onclick: async () => {
            if (!(await confirmBox('ลบชั้นวาง', `ลบ ${r.zone_code}-${r.rag_no} และตำแหน่งทั้งหมด ${r.total} ช่อง?`, 'ลบ'))) return;
            try { await api.del(`/api/rags/${r.rag_id}`); toast('ลบชั้นวางแล้ว'); m.close(); refresh(); }
            catch (err) { toast(err.message, 'err'); }
          },
        }, '🗑 ลบ') : null,
      ].filter(Boolean));
  }

  // ---------------- ฟอร์มชั้นวาง ----------------
  function rackForm(r, at) {
    if (!zones.length) { toast('กรุณาสร้างโซนก่อนเพิ่มชั้นวาง', 'err'); return zoneForm(); }
    const no = h('input', { value: r?.rag_no ?? '', placeholder: 'เช่น A01, B02' });
    const zoneSel = h('select', {},
      ...zones.map((z) => h('option', { value: z.zone_id, selected: z.zone_id === r?.zone_id }, `${z.zone_code} — ${z.zone_name}`)));
    const lvl = h('input', { type: 'number', min: '1', max: '20', value: String(r?.total_levels ?? 4) });
    const dep = h('input', { type: 'number', min: '2', max: '30', step: '2', value: String(r?.total_depths ?? 2) });
    const nt = h('input', { value: r?.note ?? '' });
    const status = r ? h('select', {},
      h('option', { value: 'ACTIVE', selected: r.status === 'ACTIVE' }, 'ใช้งาน'),
      h('option', { value: 'INACTIVE', selected: r.status === 'INACTIVE' }, 'ปิดใช้งาน')) : null;

    const m = modal(r ? `แก้ไขชั้นวาง ${r.rag_no}` : 'เพิ่มชั้นวางใหม่',
      h('div', {},
        h('div', { class: 'grid g2' }, field('หมายเลข RACK', no, null, 'รหัสชั้นวาง เช่น A01, B02 — ใช้ร่วมกับโซนเป็นรหัสตำแหน่ง'), field('โซน', zoneSel, null, 'โซนจัดเก็บที่ชั้นวางนี้อยู่ เช่น FG (สินค้าสำเร็จรูป), RM (วัตถุดิบ)')),
        h('div', { class: 'grid g2' },
          field('จำนวนชั้น (Level)', lvl, 'ความสูงของชั้นวาง', 'จำนวนชั้นจากล่างขึ้นบน — L1 คือชั้นล่างสุด หยิบง่ายที่สุด'),
          field('จำนวนตอน', dep, 'ใส่เลขคู่ — ทุก 2 ตอน = 1 ล็อค (1 พาเลต)', 'ความลึกของ Drive-in Rack — D1 คือหน้าสุด เข้าถึงได้โดยตรง')),
        field('หมายเหตุ', nt, null, 'บันทึกเพิ่มเติมเกี่ยวกับชั้นวาง เช่น ตำแหน่งพิเศษ'),
        status ? field('สถานะ', status, null, 'ปิดใช้งานจะไม่แสดงชั้นวางนี้ในการแนะนำตำแหน่ง') : null,
        at ? h('div', { class: 'hint' }, `จะวางที่ช่อง คอลัมน์ ${at.x + 1} · แถว ${at.y + 1}`) : null),
      [
        h('button', { class: 'btn', onclick: () => m.close() }, 'ยกเลิก'),
        h('button', { class: 'btn primary', title: r ? 'บันทึกการแก้ไขชั้นวาง — ถ้าเพิ่มจำนวนชั้นหรือตอน ระบบจะสร้างรหัสตำแหน่งใหม่ให้อัตโนมัติ' : 'สร้างชั้นวางและวางลงบนผัง — ระบบจะสร้างรหัสตำแหน่งครบทุกช่องให้อัตโนมัติ ({โซน}-{RACK}-L{ชั้น}-D{ตอน})', onclick: async () => {
          try {
            const body = {
              rag_no: no.value.trim(), zone_id: Number(zoneSel.value),
              total_levels: Number(lvl.value), total_depths: Number(dep.value),
              note: nt.value.trim() || null,
              ...(status ? { status: status.value } : {}),
              ...(at ? { pos_x: at.x, pos_y: at.y } : {}),
            };
            if (!body.rag_no) throw new Error('กรุณากรอกหมายเลข RACK');
            if (body.total_depths % 2 !== 0) throw new Error('จำนวนตอนต้องเป็นเลขคู่ (ทุก 2 ตอน = 1 ล็อค)');
            const res = r ? await api.put(`/api/rags/${r.rag_id}`, body) : await api.post('/api/rags', body);
            toast(r ? 'อัปเดตชั้นวางแล้ว' : `เพิ่มชั้นวางเรียบร้อย (${res.total ?? res.created} ตำแหน่ง)`);
            m.close(); refresh();
          } catch (err) { toast(err.message, 'err'); }
        } }, 'บันทึก'),
      ]);
  }

  // ---------------- ฟอร์มโซน ----------------
  function zoneForm(z) {
    const code = h('input', { value: z?.zone_code ?? '', placeholder: 'เช่น FG, RM, PK' });
    const name = h('input', { value: z?.zone_name ?? '', placeholder: 'เช่น สินค้าสำเร็จรูป' });
    let color = z?.color ?? ZONE_COLORS[zones.length % ZONE_COLORS.length];
    const swatches = h('div', { class: 'swatches' });
    const paint = () => swatches.replaceChildren(...ZONE_COLORS.map((c) =>
      h('button', {
        class: `swatch ${c === color ? 'active' : ''}`, style: `background:${c}`, title: c,
        onclick: (e) => { e.preventDefault(); color = c; paint(); },
      })));
    paint();
    const status = z ? h('select', {},
      h('option', { value: 'ACTIVE', selected: z.status === 'ACTIVE' }, 'ใช้งาน'),
      h('option', { value: 'INACTIVE', selected: z.status === 'INACTIVE' }, 'ปิดใช้งาน')) : null;

    const m = modal(z ? `แก้ไขโซน ${z.zone_code}` : 'เพิ่มโซนใหม่',
      h('div', {},
        h('div', { class: 'grid g2' }, field('รหัสโซน', code, 'ต้องไม่ซ้ำกับโซนอื่นทุกคลัง', 'รหัสย่อของโซน เช่น FG, RM, PK, QR — ใช้เป็นส่วนหนึ่งของรหัสตำแหน่ง'), field('ชื่อโซน', name, null, 'ชื่อเต็มของโซน เช่น สินค้าสำเร็จรูป, วัตถุดิบ')),
        field('สีบนผัง', swatches, null, 'สีที่ใช้แสดงโซนนี้บนผังพื้นคลัง — เลือกให้ต่างจากโซนอื่น'),
        status ? field('สถานะ', status, null, 'ปิดใช้งานจะซ่อนโซนนี้จากการแนะนำตำแหน่ง') : null),
      [
        h('button', { class: 'btn', onclick: () => m.close() }, 'ยกเลิก'),
        z && !z.rack_count ? h('button', {
          class: 'btn danger',
          title: 'ลบโซนนี้ออกจากระบบถาวร — ปุ่มนี้แสดงเฉพาะโซนที่ยังไม่มีชั้นวางอยู่',
          onclick: async () => {
            if (!(await confirmBox('ลบโซน', `ลบโซน ${z.zone_code}?`, 'ลบ'))) return;
            try { await api.del(`/api/zones/${z.zone_id}`); toast('ลบโซนแล้ว'); m.close(); refresh(); }
            catch (err) { toast(err.message, 'err'); }
          },
        }, '🗑 ลบ') : null,
        h('button', { class: 'btn primary', title: z ? 'บันทึกการแก้ไขโซน — รหัสโซนถูกใช้เป็นส่วนหน้าของรหัสตำแหน่ง เปลี่ยนแล้วมีผลกับชั้นวางในโซนนี้ทั้งหมด' : 'สร้างโซนจัดเก็บใหม่ในคลังนี้ — ต้องมีโซนก่อนจึงจะเพิ่มชั้นวางได้', onclick: async () => {
          try {
            const body = {
              zone_code: code.value.trim(), zone_name: name.value.trim(),
              warehouse_id: whId, color, ...(status ? { status: status.value } : {}),
            };
            if (!body.zone_code || !body.zone_name) throw new Error('กรุณากรอกรหัสและชื่อโซน');
            z ? await api.put(`/api/zones/${z.zone_id}`, body) : await api.post('/api/zones', body);
            toast(z ? 'อัปเดตโซนแล้ว' : 'เพิ่มโซนเรียบร้อย'); m.close(); refresh();
          } catch (err) { toast(err.message, 'err'); }
        } }, 'บันทึก'),
      ].filter(Boolean));
  }

  const refresh = () => { location.hash = `#/layout/${whId}`; location.reload(); };
  const kv = (k, v) => h('div', {}, h('div', { style: 'font-size:12px;color:#64748b' }, k), h('div', { style: 'font-weight:700' }, v ?? '—'));

  renderBoard();

  const zonePanel = h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('h2', {}, 'โซนจัดเก็บ'),
      canManage ? h('button', { class: 'btn', title: 'เพิ่มโซนจัดเก็บใหม่ เช่น FG (สินค้าสำเร็จรูป) RM (วัตถุดิบ) — ต้องมีโซนก่อนจึงจะสร้างชั้นวางได้', onclick: () => zoneForm() }, '+ เพิ่มโซน') : null),
    zones.length
      ? h('div', { class: 'zone-list' },
          ...zones.map((z) =>
            h('div', {
              class: `zone-item ${canManage ? 'clickable' : ''}`,
              onclick: canManage ? () => zoneForm(z) : null,
            },
              h('i', { style: `background:${z.color || '#2563eb'}` }),
              h('div', { style: 'flex:1;min-width:0' },
                h('div', { style: 'font-weight:700' }, `${z.zone_code} — ${z.zone_name}`),
                h('div', { class: 'muted', style: 'font-size:12px' }, `${z.rack_count} ชั้นวาง`)),
              z.status !== 'ACTIVE' ? pill('ปิด', 'gray') : null)))
      : h('div', { class: 'empty-state' }, 'ยังไม่มีโซน — เพิ่มโซนก่อนสร้างชั้นวาง'));

  const totalLoc = racks.reduce((a, r) => a + r.total, 0);
  const totalOcc = racks.reduce((a, r) => a + r.occupied, 0);
  const totalUsable = racks.reduce((a, r) => a + r.usable, 0);
  const pct = totalUsable ? Math.round((totalOcc / totalUsable) * 1000) / 10 : 0;

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', {}, `${w.wh_code} — ${w.wh_name}`),
        h('p', {}, [w.address, `ผังพื้น ${w.grid_cols} × ${w.grid_rows} ช่อง`, `${racks.length} ชั้นวาง`].filter(Boolean).join(' · '))),
      h('div', { class: 'actions' },
        pill(`ใช้พื้นที่ ${pct}%`, pct >= 90 ? 'red' : 'blue'),
        pill(`${fmtNum(totalOcc)}/${fmtNum(totalLoc)} ตำแหน่ง`, 'gray'),
        canManage ? h('button', { class: 'btn', title: 'แก้ไขชื่อ ที่อยู่ และขนาดผังพื้นของคลังนี้ — ลดขนาดผังได้เฉพาะเมื่อไม่มีชั้นวางอยู่นอกขอบเขตใหม่', onclick: () => warehouseForm(w, refresh) }, '⚙️ ตั้งค่าคลัง') : null,
        h('a', { class: 'btn', title: 'กลับไปหน้ารายการคลังสินค้าทั้งหมด — การเปลี่ยนแปลงบนผังถูกบันทึกไว้แล้ว', href: '#/layout' }, '← คลังทั้งหมด'))),

    h('div', { class: 'layout-split' },
      h('div', { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', {}, 'ผังพื้นคลัง'), hint),
        h('div', { class: 'floor-wrap' }, board)),
      zonePanel));
}

// ============================================================ ฟอร์มคลังสินค้า
function warehouseForm(w, onDone) {
  const code = h('input', { value: w?.wh_code ?? '', placeholder: 'เช่น WH1' });
  const name = h('input', { value: w?.wh_name ?? '', placeholder: 'เช่น คลังสินค้าหลัก' });
  const addr = h('input', { value: w?.address ?? '', placeholder: 'ที่อยู่ (ถ้ามี)' });
  const cols = h('input', { type: 'number', min: '1', max: '40', value: String(w?.grid_cols ?? 10) });
  const rows = h('input', { type: 'number', min: '1', max: '40', value: String(w?.grid_rows ?? 8) });
  const status = w ? h('select', {},
    h('option', { value: 'ACTIVE', selected: w.status === 'ACTIVE' }, 'ใช้งาน'),
    h('option', { value: 'INACTIVE', selected: w.status === 'INACTIVE' }, 'ปิดใช้งาน')) : null;

  const m = modal(w ? `ตั้งค่าคลัง ${w.wh_code}` : 'เพิ่มคลังสินค้าใหม่',
    h('div', {},
      h('div', { class: 'grid g2' }, field('รหัสคลัง', code, null, 'รหัสย่อของคลัง เช่น WH1, WH2 — ใช้อ้างอิงในระบบ'), field('ชื่อคลัง', name, null, 'ชื่อเต็มของคลัง เช่น คลังสินค้าหลัก')),
      field('ที่อยู่', addr, null, 'ที่อยู่หรือที่ตั้งของคลังสินค้า — ไม่บังคับ'),
      h('div', { class: 'grid g2' },
        field('ความกว้างผัง (คอลัมน์)', cols, 'จำนวนช่องแนวนอน', 'จำนวนช่องแนวนอนของผังพื้น — กำหนดความกว้างที่วางชั้นวางได้'),
        field('ความลึกผัง (แถว)', rows, 'จำนวนช่องแนวตั้ง', 'จำนวนช่องแนวตั้งของผังพื้น — กำหนดความลึกที่วางชั้นวางได้')),
      status ? field('สถานะ', status, null, 'ปิดใช้งานจะซ่อนคลังนี้จากรายการเลือก') : null),
    [
      h('button', { class: 'btn', onclick: () => m.close() }, 'ยกเลิก'),
      w ? h('button', {
        class: 'btn danger',
        title: 'ลบคลังสินค้านี้ออกจากระบบถาวร — ต้องลบโซนและชั้นวางทั้งหมดในคลังออกก่อน',
        onclick: async () => {
          if (!(await confirmBox('ลบคลังสินค้า', `ลบคลัง ${w.wh_code}? (ต้องไม่มีโซนเหลืออยู่)`, 'ลบ'))) return;
          try { await api.del(`/api/warehouses/${w.warehouse_id}`); toast('ลบคลังแล้ว'); m.close(); location.hash = '#/layout'; location.reload(); }
          catch (err) { toast(err.message, 'err'); }
        },
      }, '🗑 ลบ') : null,
      h('button', { class: 'btn primary', title: w ? 'บันทึกการตั้งค่าคลัง — ถ้าย่อขนาดผังพื้น ต้องไม่มีชั้นวางอยู่นอกขอบเขตใหม่' : 'สร้างคลังสินค้าใหม่ตามขนาดผังที่กำหนด — ขั้นต่อไปคือเพิ่มโซนแล้วจึงวางชั้นวาง', onclick: async () => {
        try {
          const body = {
            wh_code: code.value.trim(), wh_name: name.value.trim(),
            address: addr.value.trim() || null,
            grid_cols: Number(cols.value), grid_rows: Number(rows.value),
            ...(status ? { status: status.value } : {}),
          };
          if (!body.wh_code || !body.wh_name) throw new Error('กรุณากรอกรหัสและชื่อคลัง');
          w ? await api.put(`/api/warehouses/${w.warehouse_id}`, body) : await api.post('/api/warehouses', body);
          toast(w ? 'อัปเดตคลังแล้ว' : 'เพิ่มคลังเรียบร้อย'); m.close(); onDone?.();
        } catch (err) { toast(err.message, 'err'); }
      } }, 'บันทึก'),
    ].filter(Boolean));
}
