// ตั้งค่าระบบ — จัดการโซน ชั้นวาง สินค้า ผู้ใช้งาน (เฉพาะ ADMIN)
import { api } from '../api.js';
import { h, table, pill, field, modal, toast, fmtNum, confirmBox, ROLE_LABEL } from '../ui.js';

export async function settingsView() {
  const tabs = ['warehouses', 'zones', 'rags', 'skus', 'users'];
  const labels = {
    warehouses: 'คลังสินค้า', zones: 'โซน', rags: 'ชั้นวาง (RACK)',
    skus: 'สินค้า (SKU)', users: 'ผู้ใช้งาน',
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
        h('div', { class: 'grid g2' }, field('รหัสคลัง', code), field('ชื่อคลัง', name)),
        field('ที่อยู่', addr),
        h('div', { class: 'grid g2' },
          field('ความกว้างผัง (คอลัมน์)', cols), field('ความลึกผัง (แถว)', rows)),
        status ? field('สถานะ', status) : null),
      [
        h('button', { class: 'btn', onclick: () => m.close() }, 'ยกเลิก'),
        w ? h('button', {
          class: 'btn danger',
          onclick: async () => {
            if (!(await confirmBox('ลบคลังสินค้า', `ลบคลัง ${w.wh_code}? (ต้องไม่มีโซนเหลืออยู่)`, 'ลบ'))) return;
            try { await api.del(`/api/warehouses/${w.warehouse_id}`); toast('ลบคลังแล้ว'); m.close(); location.reload(); }
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
            toast(w ? 'อัปเดตคลังแล้ว' : 'เพิ่มคลังเรียบร้อย'); m.close(); location.reload();
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
        h('div', { class: 'grid g2' }, field('รหัสโซน', code, 'ต้องไม่ซ้ำทุกคลัง'), field('ชื่อโซน', name)),
        h('div', { class: 'grid g2' }, field('คลังสินค้า', whSel), field('สีบนผัง', color)),
        status ? field('สถานะ', status) : null),
      [
        h('button', { class: 'btn', onclick: () => m.close() }, 'ยกเลิก'),
        z && !z.rag_count ? h('button', {
          class: 'btn danger',
          onclick: async () => {
            if (!(await confirmBox('ลบโซน', `ลบโซน ${z.zone_code}?`, 'ลบ'))) return;
            try { await api.del(`/api/zones/${z.zone_id}`); toast('ลบโซนแล้ว'); m.close(); location.reload(); }
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
            toast(z ? 'อัปเดตโซนแล้ว' : 'เพิ่มโซนเรียบร้อย'); m.close(); location.reload();
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
        h('div', { class: 'grid g2' }, field('หมายเลข RACK', no), field('โซน', zoneSel)),
        h('div', { class: 'grid g2' }, field('จำนวนชั้น', lvl), field('จำนวนล็อค (แนวกว้าง)', dep)),
        field('หมายเหตุ', nt),
        status ? field('สถานะ', status) : null),
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
            m.close(); location.reload();
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
        { label: 'หมวด', key: 'category' },
        { label: 'หน่วย', key: 'unit' },
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
    const status = s ? h('select', {},
      h('option', { value: 'ACTIVE', selected: s.status === 'ACTIVE' }, 'ใช้งาน'),
      h('option', { value: 'INACTIVE', selected: s.status === 'INACTIVE' }, 'ปิดใช้งาน')) : null;

    const m = modal(s ? 'แก้ไขสินค้า' : 'เพิ่มสินค้าใหม่',
      h('div', {},
        h('div', { class: 'grid g2' }, field('รหัสสินค้า', code), field('ชื่อสินค้า', name)),
        h('div', { class: 'grid g2' }, field('หมวดหมู่', h('div', {}, cat, catCustom)), field('หน่วยนับ', unit)),
        field('บาร์โค้ด', barcode),
        status ? field('สถานะ', status) : null),
      [
        h('button', { class: 'btn', onclick: () => m.close() }, 'ยกเลิก'),
        h('button', { class: 'btn primary', onclick: async () => {
          try {
            const body = {
              sku_code: code.value.trim(), sku_name: name.value.trim(),
              category: (cat.value === '__other__' ? catCustom.value.trim() : cat.value) || null, unit: unit.value.trim() || 'ชิ้น',
              barcode: barcode.value.trim() || null, ...(status ? { status: status.value } : {}),
            };
            s ? await api.put(`/api/skus/${s.sku_id}`, body) : await api.post('/api/skus', body);
            toast(s ? 'อัปเดตสินค้าแล้ว' : 'เพิ่มสินค้าเรียบร้อย'); m.close(); location.reload();
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
        h('div', { class: 'grid g2' }, field('ชื่อผู้ใช้', username), field('ชื่อ-นามสกุล', fullname)),
        h('div', { class: 'grid g2' }, field('บทบาท', role), field('รหัสผ่าน', pw)),
        status ? field('สถานะ', status) : null),
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
            toast(u ? 'อัปเดตผู้ใช้งานแล้ว' : 'เพิ่มผู้ใช้งานเรียบร้อย'); m.close(); location.reload();
          } catch (err) { toast(err.message, 'err'); }
        } }, 'บันทึก'),
      ]);
  }

  renderTabs();
  await load();

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'ตั้งค่าระบบ'),
        h('p', {}, 'จัดการข้อมูลหลัก: โซน ชั้นวาง สินค้า และผู้ใช้งาน'))),
    h('div', { class: 'card' }, tabBar, content));
}
