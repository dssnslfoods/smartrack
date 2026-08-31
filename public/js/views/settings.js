// ตั้งค่าระบบ — จัดการโซน ชั้นวาง สินค้า ผู้ใช้งาน (เฉพาะ ADMIN)
import { api } from '../api.js';
import { h, table, pill, field, modal, toast, fmtNum, confirmBox, ROLE_LABEL, PTYPE_LABEL } from '../ui.js?v=34';

export async function settingsView() {
  const tabs = ['warehouses', 'zones', 'rags', 'skus', 'channels', 'users', 'ai'];
  const labels = {
    warehouses: 'คลังสินค้า', zones: 'โซน', rags: 'ชั้นวาง (RACK)',
    skus: 'สินค้า (SKU)', channels: 'ช่องทางขาย', users: 'ผู้ใช้งาน', ai: 'ตั้งค่า AI',
  };
  let active = 'warehouses';

  const content = h('div', {});
  const tabBar = h('div', { class: 'tab-bar' });

  function renderTabs() {
    tabBar.replaceChildren(...tabs.map((t) =>
      h('button', { class: `tab ${t === active ? 'active' : ''}`, onclick: () => { active = t; renderTabs(); load(); } }, labels[t])));
  }

  async function load() {
    content.replaceChildren(h('div', { class: 'empty-state' }, 'กำลังโหลด…'));
    try {
      if (active === 'warehouses') await loadWarehouses();
      else if (active === 'zones') await loadZones();
      else if (active === 'rags') await loadRags();
      else if (active === 'skus') await loadSkus();
      else if (active === 'channels') await loadChannels();
      else if (active === 'ai') await loadAI();
      else await loadUsers();
    } catch (err) { content.replaceChildren(h('div', { class: 'empty-state' }, err.message)); }
  }

  // ======== คลังสินค้า ========
  async function loadWarehouses() {
    const rows = await api.get('/api/warehouses');
    content.replaceChildren(
      h('div', { style: 'text-align:right;margin-bottom:12px' },
        h('button', { class: 'btn primary', onclick: () => warehouseForm() }, '+ เพิ่มคลังสินค้า')),
      table([
        { label: 'รหัส', key: 'wh_code', mono: true },
        { label: 'ชื่อคลัง', key: 'wh_name' },
        { label: 'ที่อยู่', key: 'address' },
        { label: 'ผังพื้น', value: (r) => `${r.grid_cols} × ${r.grid_rows}` },
        { label: 'โซน', key: 'zone_count', num: true },
        { label: 'RACK', key: 'rack_count', num: true },
        { label: 'ตำแหน่ง', value: (r) => fmtNum(r.total_locations), num: true },
        { label: 'ใช้ไป', value: (r) => pill(`${r.usage_pct}%`, r.usage_pct >= 85 ? 'red' : r.usage_pct >= 60 ? 'amber' : 'green') },
        { label: 'สถานะ', value: (r) => pill(r.status === 'ACTIVE' ? 'ใช้งาน' : 'ปิด', r.status === 'ACTIVE' ? 'green' : 'gray') },
        { label: '', value: (r) => h('span', {},
            h('a', { class: 'btn ghost', href: `#/layout/${r.warehouse_id}`, title: 'ผังพื้น' }, '🏗️'),
            h('button', { class: 'btn ghost', onclick: () => warehouseForm(r) }, 'แก้ไข')) },
      ], rows));
  }

  function warehouseForm(w) {
    const code = h('input', { value: w?.wh_code ?? '', placeholder: 'เช่น WH1' });
    const name = h('input', { value: w?.wh_name ?? '', placeholder: 'เช่น คลังสินค้าหลัก' });
    const addr = h('input', { value: w?.address ?? '' });
    const cols = h('input', { type: 'number', min: '1', max: '40', value: String(w?.grid_cols ?? 10) });
    const rows = h('input', { type: 'number', min: '1', max: '40', value: String(w?.grid_rows ?? 8) });
    const status = w ? h('select', {},
      h('option', { value: 'ACTIVE', selected: w.status === 'ACTIVE' }, 'ใช้งาน'),
      h('option', { value: 'INACTIVE', selected: w.status === 'INACTIVE' }, 'ปิดใช้งาน')) : null;

    const m = modal(w ? 'แก้ไขคลังสินค้า' : 'เพิ่มคลังสินค้าใหม่',
      h('div', {},
        h('div', { class: 'grid g2' }, field('รหัสคลัง', code, null, 'รหัสย่อของคลังสินค้า เช่น WH1, WH2 ใช้อ้างอิงในระบบ'), field('ชื่อคลัง', name, null, 'ชื่อเต็มของคลังสินค้า เช่น คลังสินค้าหลัก')),
        field('ที่อยู่', addr, null, 'ที่อยู่จริงของคลังสินค้า'),
        h('div', { class: 'grid g2' },
          field('ความกว้างผัง (คอลัมน์)', cols, null, 'จำนวนช่องแนวนอนของผังพื้น ใช้วางตำแหน่ง RACK บนแผนที่'), field('ความลึกผัง (แถว)', rows, null, 'จำนวนช่องแนวตั้งของผังพื้น ใช้วางตำแหน่ง RACK บนแผนที่')),
        status ? field('สถานะ', status, null, 'ปิดใช้งาน = ไม่แสดงในรายการเลือก แต่ข้อมูลเดิมยังอยู่') : null),
      [
        h('button', { class: 'btn', onclick: () => m.close() }, 'ยกเลิก'),
        w ? h('button', {
          class: 'btn danger',
          onclick: async () => {
            if (!(await confirmBox('ลบคลังสินค้า', `ลบคลัง ${w.wh_code}? (ต้องไม่มีโซนเหลืออยู่)`, 'ลบ'))) return;
            try { await api.del(`/api/warehouses/${w.warehouse_id}`); toast('ลบคลังแล้ว'); m.close(); load(); }
            catch (err) { toast(err.message, 'err'); }
          },
        }, '🗑 ลบ') : null,
        h('button', { class: 'btn primary', onclick: async () => {
          try {
            const body = {
              wh_code: code.value.trim(), wh_name: name.value.trim(), address: addr.value.trim() || null,
              grid_cols: Number(cols.value), grid_rows: Number(rows.value),
              ...(status ? { status: status.value } : {}),
            };
            w ? await api.put(`/api/warehouses/${w.warehouse_id}`, body) : await api.post('/api/warehouses', body);
            toast(w ? 'อัปเดตคลังแล้ว' : 'เพิ่มคลังเรียบร้อย'); m.close(); load();
          } catch (err) { toast(err.message, 'err'); }
        } }, 'บันทึก'),
      ].filter(Boolean));
  }

  // ======== โซน ========
  async function loadZones() {
    const rows = await api.get('/api/zones');
    content.replaceChildren(
      h('div', { style: 'text-align:right;margin-bottom:12px' },
        h('button', { class: 'btn primary', onclick: () => zoneForm() }, '+ เพิ่มโซน')),
      table([
        { label: 'สี', value: (r) => h('i', { class: 'dot', style: `background:${r.color || '#2563eb'}` }) },
        { label: 'รหัส', key: 'zone_code', mono: true },
        { label: 'ชื่อโซน', key: 'zone_name' },
        { label: 'คลังสินค้า', value: (r) => (r.wh_code ? `${r.wh_code} — ${r.wh_name}` : '—') },
        { label: 'สถานะ', value: (r) => pill(r.status === 'ACTIVE' ? 'ใช้งาน' : 'ปิด', r.status === 'ACTIVE' ? 'green' : 'gray') },
        { label: 'RACK', key: 'rag_count', num: true },
        { label: '', value: (r) => h('button', { class: 'btn ghost', onclick: () => zoneForm(r) }, 'แก้ไข') },
      ], rows));
  }

  async function zoneForm(z) {
    const houses = await api.get('/api/warehouses');
    if (!houses.length) { toast('กรุณาสร้างคลังสินค้าก่อน', 'err'); return; }
    const code = h('input', { value: z?.zone_code ?? '', placeholder: 'เช่น FG, RM, PK' });
    const name = h('input', { value: z?.zone_name ?? '' });
    const whSel = h('select', {},
      ...houses.map((w) => h('option', { value: w.warehouse_id, selected: w.warehouse_id === z?.warehouse_id }, `${w.wh_code} — ${w.wh_name}`)));
    const color = h('input', { type: 'color', value: z?.color ?? '#2563eb' });
    const status = z ? h('select', {},
      h('option', { value: 'ACTIVE', selected: z.status === 'ACTIVE' }, 'ใช้งาน'),
      h('option', { value: 'INACTIVE', selected: z.status === 'INACTIVE' }, 'ปิดใช้งาน')) : null;

    const m = modal(z ? 'แก้ไขโซน' : 'เพิ่มโซนใหม่',
      h('div', {},
        h('div', { class: 'grid g2' }, field('รหัสโซน', code, 'ต้องไม่ซ้ำทุกคลัง', 'รหัสย่อของโซน เช่น FG (สินค้าสำเร็จรูป), RM (วัตถุดิบ) ต้องไม่ซ้ำทุกคลัง'), field('ชื่อโซน', name, null, 'ชื่อเต็มของโซน เช่น โซนสินค้าสำเร็จรูป')),
        h('div', { class: 'grid g2' }, field('คลังสินค้า', whSel, null, 'โซนนี้อยู่ในคลังไหน'), field('สีบนผัง', color, null, 'สีที่ใช้แสดง RACK ของโซนนี้บนแผนผังคลัง')),
        status ? field('สถานะ', status, null, 'ปิดใช้งาน = ไม่แสดงในรายการเลือก แต่ข้อมูลเดิมยังอยู่') : null),
      [
        h('button', { class: 'btn', onclick: () => m.close() }, 'ยกเลิก'),
        z && !z.rag_count ? h('button', {
          class: 'btn danger',
          onclick: async () => {
            if (!(await confirmBox('ลบโซน', `ลบโซน ${z.zone_code}?`, 'ลบ'))) return;
            try { await api.del(`/api/zones/${z.zone_id}`); toast('ลบโซนแล้ว'); m.close(); load(); }
            catch (err) { toast(err.message, 'err'); }
          },
        }, '🗑 ลบ') : null,
        h('button', { class: 'btn primary', onclick: async () => {
          try {
            const body = {
              zone_code: code.value.trim(), zone_name: name.value.trim(),
              warehouse_id: Number(whSel.value), color: color.value,
              ...(status ? { status: status.value } : {}),
            };
            z ? await api.put(`/api/zones/${z.zone_id}`, body) : await api.post('/api/zones', body);
            toast(z ? 'อัปเดตโซนแล้ว' : 'เพิ่มโซนเรียบร้อย'); m.close(); load();
          } catch (err) { toast(err.message, 'err'); }
        } }, 'บันทึก'),
      ].filter(Boolean));
  }

  // ======== ชั้นวาง ========
  async function loadRags() {
    const rows = await api.get('/api/rags');
    content.replaceChildren(
      h('div', { style: 'text-align:right;margin-bottom:12px' },
        h('button', { class: 'btn primary', onclick: () => ragForm() }, '+ เพิ่มชั้นวาง')),
      table([
        { label: 'หมายเลข', key: 'rag_no', mono: true },
        { label: 'คลังสินค้า', value: (r) => r.wh_code ?? '—' },
        { label: 'โซน', value: (r) => `${r.zone_code} — ${r.zone_name}` },
        { label: 'ชั้น', key: 'total_levels', num: true },
        { label: 'ตอน', key: 'total_depths', num: true },
        { label: 'ตำแหน่ง', key: 'total_locations', num: true },
        { label: 'ใช้งาน', key: 'occupied', num: true },
        { label: 'สถานะ', value: (r) => pill(r.status === 'ACTIVE' ? 'ใช้งาน' : 'ปิด', r.status === 'ACTIVE' ? 'green' : 'gray') },
        { label: '', value: (r) => h('span', {},
            h('a', { class: 'btn ghost', href: `#/map/${r.rag_id}` }, '🗺️'),
            h('button', { class: 'btn ghost', onclick: () => ragForm(r) }, 'แก้ไข')) },
      ], rows));
  }

  async function ragForm(r) {
    const zones = await api.get('/api/zones');
    const no = h('input', { value: r?.rag_no ?? '', placeholder: 'เช่น A01, B02' });
    const zoneSel = h('select', {},
      ...zones.map((z) => h('option', { value: z.zone_id, selected: z.zone_id === r?.zone_id },
        `${z.wh_code ? `[${z.wh_code}] ` : ''}${z.zone_code} — ${z.zone_name}`)));
    const lvl = h('input', { type: 'number', min: '1', max: '20', value: String(r?.total_levels ?? 4) });
    const dep = h('input', { type: 'number', min: '2', max: '20', step: '2', value: String(r?.total_depths ?? 2) });
    const nt = h('input', { value: r?.note ?? '' });
    const status = r ? h('select', {},
      h('option', { value: 'ACTIVE', selected: r.status === 'ACTIVE' }, 'ใช้งาน'),
      h('option', { value: 'INACTIVE', selected: r.status === 'INACTIVE' }, 'ปิดใช้งาน')) : null;

    const m = modal(r ? 'แก้ไขชั้นวาง' : 'เพิ่มชั้นวางใหม่',
      h('div', {},
        h('div', { class: 'grid g2' }, field('หมายเลข RACK', no, null, 'หมายเลขชั้นวาง เช่น A01, B02 ใช้สร้างรหัสตำแหน่ง'), field('โซน', zoneSel, null, 'RACK นี้อยู่ในโซนไหน')),
        h('div', { class: 'grid g2' }, field('จำนวนชั้น', lvl, null, 'จำนวนชั้นของ RACK (นับจากล่างขึ้นบน) เช่น 4 = L1 ถึง L4'), field('จำนวนล็อค (แนวกว้าง)', dep, null, 'จำนวนล็อคแนวกว้าง (ต้องเป็นเลขคู่) แต่ละล็อคเป็น 1 ตำแหน่งจัดเก็บ')),
        field('หมายเหตุ', nt, null, 'บันทึกเพิ่มเติมเกี่ยวกับ RACK นี้ เช่น ความสูง น้ำหนักที่รับได้'),
        status ? field('สถานะ', status, null, 'ปิดใช้งาน = ไม่แสดงในรายการเลือก แต่ข้อมูลเดิมยังอยู่') : null),
      [
        h('button', { class: 'btn', onclick: () => m.close() }, 'ยกเลิก'),
        h('button', { class: 'btn primary', onclick: async () => {
          try {
            const body = {
              rag_no: no.value.trim(), zone_id: Number(zoneSel.value),
              total_levels: Number(lvl.value), total_depths: Number(dep.value),
              note: nt.value.trim() || null, ...(status ? { status: status.value } : {}),
            };
            if (body.total_depths % 2 !== 0) throw new Error('จำนวนล็อคต้องเป็นเลขคู่');
            const res = r ? await api.put(`/api/rags/${r.rag_id}`, body) : await api.post('/api/rags', body);
            toast(r ? 'อัปเดตชั้นวางแล้ว' : `เพิ่มชั้นวางเรียบร้อย (${res.total ?? res.created} ตำแหน่ง)`);
            m.close(); load();
          } catch (err) { toast(err.message, 'err'); }
        } }, 'บันทึก'),
      ]);
  }

  // ======== สินค้า ========
  async function loadSkus() {
    const rows = await api.get('/api/skus');
    content.replaceChildren(
      h('div', { style: 'text-align:right;margin-bottom:12px' },
        h('button', { class: 'btn primary', onclick: () => skuForm() }, '+ เพิ่มสินค้า')),
      table([
        { label: 'รหัส', key: 'sku_code', mono: true },
        { label: 'ชื่อสินค้า', key: 'sku_name' },
        { label: 'ประเภท', value: (r) => (r.product_type ? pill(r.product_type, 'blue') : '—') },
        { label: 'หมวด', key: 'category' },
        { label: 'หน่วย', key: 'unit' },
        { label: 'อายุ (ด.)', value: (r) => r.shelf_life_months ?? '—', num: true },
        { label: 'บาร์โค้ด', key: 'barcode', mono: true },
        { label: 'จัดเก็บอยู่', value: (r) => `${r.locations_used} ตำแหน่ง`, num: true },
        { label: 'ยอดรวม', value: (r) => fmtNum(r.qty_in_stock), num: true },
        { label: 'สถานะ', value: (r) => pill(r.status === 'ACTIVE' ? 'ใช้งาน' : 'ปิด', r.status === 'ACTIVE' ? 'green' : 'gray') },
        { label: '', value: (r) => h('button', { class: 'btn ghost', onclick: () => skuForm(r) }, 'แก้ไข') },
      ], rows));
  }

  function skuForm(s) {
    const code = h('input', { value: s?.sku_code ?? '' });
    const name = h('input', { value: s?.sku_name ?? '' });
    const cat = h('select', {}, h('option', { value: '' }, '-- เลือกหมวดหมู่ --'));
    const catCustom = h('input', { placeholder: 'พิมพ์หมวดหมู่ใหม่', style: 'display:none;margin-top:6px' });
    (async () => {
      try {
        const cats = await api.get('/api/skus/categories');
        cats.forEach(c => cat.appendChild(h('option', { value: c, selected: s?.category === c }, c)));
      } catch {}
      cat.appendChild(h('option', { value: '__other__' }, 'อื่น ๆ (พิมพ์เอง)'));
      if (s?.category && !cat.querySelector(`option[value="${CSS.escape(s.category)}"]`)) {
        const opt = h('option', { value: s.category, selected: true }, s.category);
        cat.insertBefore(opt, cat.lastElementChild);
      }
    })();
    cat.onchange = () => { catCustom.style.display = cat.value === '__other__' ? '' : 'none'; };
    const unit = h('input', { value: s?.unit ?? 'ชิ้น' });
    const barcode = h('input', { value: s?.barcode ?? '', placeholder: 'บาร์โค้ดสินค้า (ถ้ามี)' });
    const ptype = h('select', {},
      h('option', { value: '' }, '— ไม่ระบุ —'),
      ...Object.entries(PTYPE_LABEL).map(([v, l]) => h('option', { value: v, selected: s?.product_type === v }, l)));
    const shelfLife = h('input', { type: 'number', min: '1', value: s?.shelf_life_months ?? '', placeholder: 'เช่น 36' });
    const status = s ? h('select', {},
      h('option', { value: 'ACTIVE', selected: s.status === 'ACTIVE' }, 'ใช้งาน'),
      h('option', { value: 'INACTIVE', selected: s.status === 'INACTIVE' }, 'ปิดใช้งาน')) : null;

    // ---- หน่วยนับเพิ่มเติม (UoM) เช่น 1 ลัง = 12 ชิ้น ----
    const unitRows = [];
    const unitsBox = h('div', {});
    function addUnitRow(u) {
      const uname = h('input', { value: u?.unit_name ?? '', placeholder: 'เช่น ลัง', style: 'width:110px' });
      const factor = h('input', { type: 'number', min: '0.001', step: 'any', value: u?.factor ?? '', placeholder: 'เช่น 12', style: 'width:90px' });
      const row = { uname, factor };
      unitRows.push(row);
      unitsBox.append(h('div', { class: 'row', style: 'align-items:center;gap:8px;margin-bottom:6px' },
        h('span', {}, '1'), uname, h('span', {}, '='), factor, h('span', { class: 'muted' }, unit.value || 'หน่วยฐาน'),
        h('button', { class: 'btn ghost', onclick: (e) => { unitRows.splice(unitRows.indexOf(row), 1); e.target.closest('.row').remove(); } }, '🗑️')));
    }
    if (s) api.get(`/api/skus/${s.sku_id}/units`).then((units) => units.forEach(addUnitRow)).catch(() => {});

    const m = modal(s ? 'แก้ไขสินค้า' : 'เพิ่มสินค้าใหม่',
      h('div', {},
        h('div', { class: 'grid g2' }, field('รหัสสินค้า', code, null, 'รหัสเฉพาะของสินค้า (SKU Code) ต้องไม่ซ้ำกัน'), field('ชื่อสินค้า', name, null, 'ชื่อเต็มของสินค้าที่แสดงในระบบ')),
        h('div', { class: 'grid g2' }, field('ประเภทสินค้า', ptype, null, 'ประเภทหลัก เช่น เครื่องสำอาง สกินแคร์ ใช้จัดกลุ่มในรายงาน'), field('หมวดหมู่', h('div', {}, cat, catCustom), null, 'หมวดย่อยของสินค้า เช่น ครีม สบู่ แชมพู')),
        h('div', { class: 'grid g2' }, field('หน่วยนับ (หน่วยฐาน)', unit, null, 'หน่วยนับเล็กสุดที่ใช้ในระบบ เช่น ชิ้น หลอด ซอง'), field('อายุสินค้า (เดือน)', shelfLife, 'ใช้คำนวณ % อายุคงเหลือเมื่อ Lot ไม่ระบุวันผลิต', 'ระยะเวลาตั้งแต่ผลิตถึงหมดอายุ ใช้คำนวณ % อายุคงเหลือเมื่อ Lot ไม่ระบุวันผลิต')),
        field('บาร์โค้ด', barcode, null, 'รหัสบาร์โค้ดบนตัวสินค้า ใช้สแกนค้นหาเร็ว'),
        h('div', { class: 'field' },
          h('label', {}, 'หน่วยนับเพิ่มเติม (เช่น ลัง / โหล)'),
          unitsBox,
          h('button', { class: 'btn ghost', onclick: () => addUnitRow() }, '+ เพิ่มหน่วย')),
        status ? field('สถานะ', status, null, 'ปิดใช้งาน = ไม่แสดงในรายการเลือก แต่ข้อมูลเดิมยังอยู่') : null),
      [
        h('button', { class: 'btn', onclick: () => m.close() }, 'ยกเลิก'),
        h('button', { class: 'btn primary', onclick: async () => {
          try {
            const body = {
              sku_code: code.value.trim(), sku_name: name.value.trim(),
              category: (cat.value === '__other__' ? catCustom.value.trim() : cat.value) || null, unit: unit.value.trim() || 'ชิ้น',
              barcode: barcode.value.trim() || null, ...(status ? { status: status.value } : {}),
              product_type: ptype.value || null,
              shelf_life_months: shelfLife.value ? Number(shelfLife.value) : null,
            };
            const saved = s ? await api.put(`/api/skus/${s.sku_id}`, body) : await api.post('/api/skus', body);
            const units = unitRows
              .filter((r) => r.uname.value.trim() && Number(r.factor.value) > 0)
              .map((r) => ({ unit_name: r.uname.value.trim(), factor: Number(r.factor.value) }));
            await api.put(`/api/skus/${saved.sku_id}/units`, { units });
            toast(s ? 'อัปเดตสินค้าแล้ว' : 'เพิ่มสินค้าเรียบร้อย'); m.close(); load();
          } catch (err) { toast(err.message, 'err'); }
        } }, 'บันทึก'),
      ]);
  }

  // ======== ช่องทางขาย + เกณฑ์อายุคงเหลือ ========
  async function loadChannels() {
    const [channels, settings] = await Promise.all([api.get('/api/channels'), api.get('/api/settings')]);
    const moveM = h('input', { type: 'number', min: '0', value: settings.expiry_move_months, style: 'width:90px' });
    const cutM = h('input', { type: 'number', min: '0', value: settings.expiry_cutoff_months, style: 'width:90px' });

    content.replaceChildren(
      h('div', { class: 'card', style: 'margin-bottom:14px' },
        h('h2', {}, 'เกณฑ์การจัดการอายุสินค้า'),
        h('div', { class: 'row', style: 'align-items:flex-end;flex-wrap:wrap' },
          field('ย้ายเข้าโปรโมชันเมื่ออายุต่ำกว่า (เดือน)', moveM, null, 'เมื่อสินค้าเหลืออายุน้อยกว่ากี่เดือน ระบบจะแนะนำให้ย้ายเข้าช่องทางลดราคา/โปรโมชัน'),
          field('ตัดออกจากระบบเมื่ออายุต่ำกว่า (เดือน)', cutM, null, 'เมื่อสินค้าเหลืออายุน้อยกว่ากี่เดือน ระบบจะแนะนำให้ตัดออก (scrap) เพราะขายไม่ทันแล้ว'),
          h('button', { class: 'btn primary', onclick: async () => {
            try {
              await api.put('/api/settings', { expiry_move_months: moveM.value, expiry_cutoff_months: cutM.value });
              toast('บันทึกเกณฑ์แล้ว');
            } catch (err) { toast(err.message, 'err'); }
          } }, 'บันทึกเกณฑ์'))),
      h('div', { style: 'text-align:right;margin-bottom:12px' },
        h('button', { class: 'btn primary', onclick: () => channelForm() }, '+ เพิ่มช่องทาง')),
      table([
        { label: 'รหัส', key: 'channel_code', mono: true },
        { label: 'ชื่อช่องทาง', key: 'channel_name' },
        { label: '% อายุคงเหลือขั้นต่ำ', value: (r) => (r.min_pct_remaining === null ? 'ไม่จำกัด' : `≥ ${r.min_pct_remaining}%`), num: true },
        { label: 'สถานะ', value: (r) => pill(r.status === 'ACTIVE' ? 'ใช้งาน' : 'ปิด', r.status === 'ACTIVE' ? 'green' : 'gray') },
        { label: '', value: (r) => h('button', { class: 'btn ghost', onclick: () => channelForm(r) }, 'แก้ไข') },
      ], channels));
  }

  function channelForm(c) {
    const code = h('input', { value: c?.channel_code ?? '', placeholder: 'เช่น MT / GT / ONLINE' });
    const name = h('input', { value: c?.channel_name ?? '', placeholder: 'เช่น Modern Trade' });
    const pct = h('input', { type: 'number', min: '0', max: '100', value: c?.min_pct_remaining ?? '', placeholder: 'เว้นว่าง = ไม่จำกัด' });
    const status = c ? h('select', {},
      h('option', { value: 'ACTIVE', selected: c.status === 'ACTIVE' }, 'ใช้งาน'),
      h('option', { value: 'INACTIVE', selected: c.status === 'INACTIVE' }, 'ปิดใช้งาน')) : null;
    const m = modal(c ? 'แก้ไขช่องทางขาย' : 'เพิ่มช่องทางขาย',
      h('div', {},
        h('div', { class: 'grid g2' }, field('รหัสช่องทาง', code, null, 'รหัสย่อ เช่น MT (Modern Trade), GT (General Trade), ONLINE'), field('ชื่อช่องทาง', name, null, 'ชื่อเต็มของช่องทางขาย')),
        field('% อายุคงเหลือขั้นต่ำที่รับได้', pct, 'เช่น MT = 80, GT = 50 — ระบบใช้ตรวจตอนจ่ายออกและในหน้าอายุสินค้า', 'สินค้าต้องเหลืออายุอย่างน้อยกี่ % ถึงจะส่งช่องทางนี้ได้ เช่น MT = 80%'),
        status ? field('สถานะ', status, null, 'ปิดใช้งาน = ไม่แสดงในรายการเลือก แต่ข้อมูลเดิมยังอยู่') : null),
      [
        h('button', { class: 'btn', onclick: () => m.close() }, 'ยกเลิก'),
        h('button', { class: 'btn primary', onclick: async () => {
          try {
            const body = {
              channel_code: code.value, channel_name: name.value,
              min_pct_remaining: pct.value === '' ? null : Number(pct.value),
              ...(status ? { status: status.value } : {}),
            };
            c ? await api.put(`/api/channels/${c.channel_id}`, body) : await api.post('/api/channels', body);
            toast('บันทึกช่องทางแล้ว'); m.close(); load();
          } catch (err) { toast(err.message, 'err'); }
        } }, 'บันทึก'),
      ]);
  }

  // ======== ผู้ใช้งาน ========
  async function loadUsers() {
    const rows = await api.get('/api/users');
    content.replaceChildren(
      h('div', { style: 'text-align:right;margin-bottom:12px' },
        h('button', { class: 'btn primary', onclick: () => userForm() }, '+ เพิ่มผู้ใช้งาน')),
      table([
        { label: 'ชื่อผู้ใช้', key: 'username', mono: true },
        { label: 'ชื่อ-นามสกุล', key: 'full_name' },
        { label: 'บทบาท', value: (r) => pill(ROLE_LABEL[r.role] ?? r.role, r.role === 'ADMIN' ? 'blue' : r.role === 'STAFF' ? 'green' : 'gray') },
        { label: 'สถานะ', value: (r) => pill(r.status === 'ACTIVE' ? 'ใช้งาน' : 'ปิด', r.status === 'ACTIVE' ? 'green' : 'gray') },
        { label: '', value: (r) => h('button', { class: 'btn ghost', onclick: () => userForm(r) }, 'แก้ไข') },
      ], rows));
  }

  function userForm(u) {
    const username = h('input', { value: u?.username ?? '', disabled: !!u });
    const fullname = h('input', { value: u?.full_name ?? '' });
    const role = h('select', {},
      h('option', { value: 'ADMIN', selected: u?.role === 'ADMIN' }, 'ผู้ดูแลระบบ (ADMIN)'),
      h('option', { value: 'STAFF', selected: u?.role === 'STAFF' || !u }, 'พนักงานคลัง (STAFF)'),
      h('option', { value: 'VIEWER', selected: u?.role === 'VIEWER' }, 'ผู้ดูข้อมูล (VIEWER)'));
    const pw = h('input', { type: 'password', placeholder: u ? 'เว้นว่างถ้าไม่เปลี่ยน' : 'กำหนดรหัสผ่าน' });
    const status = u ? h('select', {},
      h('option', { value: 'ACTIVE', selected: u.status === 'ACTIVE' }, 'ใช้งาน'),
      h('option', { value: 'INACTIVE', selected: u.status === 'INACTIVE' }, 'ปิดใช้งาน')) : null;

    const m = modal(u ? 'แก้ไขผู้ใช้งาน' : 'เพิ่มผู้ใช้งานใหม่',
      h('div', {},
        h('div', { class: 'grid g2' }, field('ชื่อผู้ใช้', username, null, 'ชื่อที่ใช้เข้าสู่ระบบ (login) ต้องไม่ซ้ำกัน'), field('ชื่อ-นามสกุล', fullname, null, 'ชื่อจริงของผู้ใช้งาน แสดงในประวัติการทำรายการ')),
        h('div', { class: 'grid g2' }, field('บทบาท', role, null, 'กำหนดสิทธิ์การใช้งาน: ADMIN ทำได้ทุกอย่าง / STAFF รับ-จ่ายสินค้าได้ / VIEWER ดูข้อมูลอย่างเดียว'), field('รหัสผ่าน', pw, null, 'รหัสผ่านสำหรับเข้าสู่ระบบ')),
        status ? field('สถานะ', status, null, 'ปิดใช้งาน = ไม่แสดงในรายการเลือก แต่ข้อมูลเดิมยังอยู่') : null),
      [
        h('button', { class: 'btn', onclick: () => m.close() }, 'ยกเลิก'),
        h('button', { class: 'btn primary', onclick: async () => {
          try {
            const body = {
              username: username.value.trim(), full_name: fullname.value.trim(),
              role: role.value, ...(pw.value ? { password: pw.value } : {}),
              ...(status ? { status: status.value } : {}),
            };
            u ? await api.put(`/api/users/${u.user_id}`, body) : await api.post('/api/users', body);
            toast(u ? 'อัปเดตผู้ใช้งานแล้ว' : 'เพิ่มผู้ใช้งานเรียบร้อย'); m.close(); load();
          } catch (err) { toast(err.message, 'err'); }
        } }, 'บันทึก'),
      ]);
  }

  // ======== ตั้งค่า AI ========
  async function loadAI() {
    const s = await api.get('/api/settings/ai');
    const providers = s.providers;

    // --- สถานะปัจจุบัน ---
    const statusEl = h('div', { class: 'ai-status', style: 'display:flex;align-items:center;gap:8px;margin-bottom:16px;padding:12px 16px;border-radius:8px;background:var(--surface, #f8fafc)' },
      h('span', { style: `display:inline-block;width:10px;height:10px;border-radius:50%;background:${s.has_key ? '#22c55e' : '#ef4444'}` }),
      h('strong', {}, s.has_key ? `เชื่อมต่อแล้ว — ${providers[s.provider]?.label}` : 'ยังไม่ได้ตั้งค่า'),
      s.has_key ? h('span', { class: 'muted' }, `Key: ${s.key_hint}`) : null);

    // --- เลือกค่าย ---
    const providerCards = h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:20px' });
    let selectedProvider = s.provider || 'claude';

    function renderProviderCards() {
      providerCards.replaceChildren(...Object.entries(providers).map(([key, p]) => {
        const active = key === selectedProvider;
        const card = h('label', {
          style: `display:flex;flex-direction:column;gap:4px;padding:14px 16px;border-radius:10px;cursor:pointer;border:2px solid ${active ? 'var(--primary, #0f766e)' : 'var(--border, #e2e8f0)'};background:${active ? 'var(--primary-bg, #f0fdfa)' : 'transparent'};transition:all .15s`,
          onclick: () => {
            selectedProvider = key;
            renderProviderCards();
            const dp = providers[key];
            modelSmart.value = dp.smart;
            modelFast.value = dp.fast;
            keyLink.href = dp.keyUrl;
            keyLink.textContent = dp.keyUrl.replace('https://', '');
          },
        },
          h('div', { style: 'display:flex;align-items:center;gap:8px' },
            h('input', { type: 'radio', name: 'ai_provider', value: key, checked: active, style: 'accent-color:var(--primary, #0f766e)' }),
            h('strong', { style: 'font-size:15px' }, p.label)),
          h('div', { class: 'muted', style: 'font-size:12px;padding-left:24px' }, `Smart: ${p.smart} · Fast: ${p.fast}`));
        return card;
      }));
    }

    // --- API Key ---
    const keyInput = h('input', { type: 'password', value: '', placeholder: s.has_key ? '(ไม่แสดง — ใส่ค่าใหม่เพื่อเปลี่ยน)' : 'วาง API Key ที่นี่', style: 'flex:1' });
    const showBtn = h('button', { class: 'btn ghost', type: 'button', onclick: () => {
      const t = keyInput.type === 'password' ? 'text' : 'password';
      keyInput.type = t;
      showBtn.textContent = t === 'password' ? 'แสดง' : 'ซ่อน';
    } }, 'แสดง');

    const curP = providers[selectedProvider] || providers.claude;
    const keyLink = h('a', { href: curP.keyUrl, target: '_blank', rel: 'noopener', style: 'font-size:12px' }, curP.keyUrl.replace('https://', ''));

    // --- Models ---
    const modelSmart = h('input', { value: s.model_smart, placeholder: curP.smart });
    const modelFast = h('input', { value: s.model_fast, placeholder: curP.fast });

    // --- Test & Save ---
    const testResult = h('div', { style: 'margin-top:8px;font-size:13px' });

    const testBtn = h('button', { class: 'btn', onclick: async () => {
      const key = keyInput.value.trim();
      if (!key && !s.has_key) { toast('กรุณาใส่ API Key ก่อนทดสอบ', 'err'); return; }
      testResult.textContent = 'กำลังทดสอบ…';
      testResult.style.color = '';
      testBtn.disabled = true;
      try {
        const r = await api.post('/api/settings/ai/test', { provider: selectedProvider, api_key: key || '__current__' });
        if (r.ok) {
          testResult.textContent = `เชื่อมต่อสำเร็จ — ${r.provider}`;
          testResult.style.color = '#22c55e';
        } else {
          testResult.textContent = `ไม่สำเร็จ: ${r.error}`;
          testResult.style.color = '#ef4444';
        }
      } catch (err) {
        testResult.textContent = `ผิดพลาด: ${err.message}`;
        testResult.style.color = '#ef4444';
      }
      testBtn.disabled = false;
    } }, 'ทดสอบการเชื่อมต่อ');

    const saveBtn = h('button', { class: 'btn primary', onclick: async () => {
      saveBtn.disabled = true;
      try {
        const body = { provider: selectedProvider, model_smart: modelSmart.value.trim(), model_fast: modelFast.value.trim() };
        const key = keyInput.value.trim();
        if (key) body.api_key = key;
        await api.put('/api/settings/ai', body);
        toast('บันทึกการตั้งค่า AI เรียบร้อย');
        await loadAI();
      } catch (err) { toast(err.message, 'err'); }
      saveBtn.disabled = false;
    } }, 'บันทึก');

    const clearBtn = s.has_key ? h('button', { class: 'btn danger', onclick: async () => {
      try {
        await api.put('/api/settings/ai', { api_key: '' });
        toast('ลบ API Key แล้ว');
        await loadAI();
      } catch (err) { toast(err.message, 'err'); }
    } }, 'ลบ API Key') : null;

    renderProviderCards();

    content.replaceChildren(
      h('div', { style: 'max-width:640px' },
        statusEl,

        h('h3', { style: 'margin:0 0 8px' }, 'เลือกค่าย AI'),
        providerCards,

        h('h3', { style: 'margin:0 0 8px' }, 'API Key'),
        h('div', { style: 'display:flex;gap:8px;align-items:center' }, keyInput, showBtn),
        h('div', { style: 'margin:4px 0 16px' }, h('span', { class: 'muted', style: 'font-size:12px' }, 'สมัครได้ที่ '), keyLink),

        h('h3', { style: 'margin:0 0 8px' }, 'รุ่น AI (เว้นว่างใช้ค่าเริ่มต้น)'),
        h('div', { class: 'grid g2' },
          field('Smart Model (งานวิเคราะห์)', modelSmart, null, 'รุ่น AI สำหรับงานคิดหนัก เช่น วิเคราะห์เอกสาร สรุปข้อมูล (เว้นว่างใช้ค่าเริ่มต้น)'),
          field('Fast Model (งานเร็ว)', modelFast, null, 'รุ่น AI สำหรับงานเร็ว เช่น ถาม-ตอบ ค้นหาข้อมูล (เว้นว่างใช้ค่าเริ่มต้น)')),

        h('div', { style: 'display:flex;gap:8px;margin-top:20px;align-items:center' }, saveBtn, testBtn, clearBtn),
        testResult));
  }

  renderTabs();
  await load();

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'ตั้งค่าระบบ'),
        h('p', {}, 'จัดการข้อมูลหลัก: โซน ชั้นวาง สินค้า และผู้ใช้งาน'))),
    h('div', { class: 'card' }, tabBar, content));
}
