// วางแผนหยิบสินค้าตามใบสั่งขาย (SO) — 1 ใบสั่งมีได้หลายสินค้า
// ระบุ SO ก่อน → เพิ่มสินค้าทีละรายการ → ระบบคำนวณ FEFO ให้ → แก้ตำแหน่งเองได้ → ยืนยันทีเดียวทั้งใบ
import { api, auth, wh } from '../api.js?v=47';
import { h, field, table, pill, expiryPill, fmtNum, fmtDate, toast, confirmBox, modal, scanInput } from '../ui.js?v=47';

export async function pickView() {
  const [skus, zones, channels] = await Promise.all([
    api.get('/api/skus', { warehouse_id: wh.id }),
    api.get('/api/zones', { warehouse_id: wh.id }),
    api.get('/api/channels').catch(() => []),
  ]);

  // รายการสินค้าในใบสั่งนี้ — 1 ช่องต่อ 1 SKU พร้อมแผนหยิบของตัวเอง
  const cart = [];
  let sku = null;

  // ---------------- 1. ข้อมูลใบสั่ง (SO) ----------------
  const soRef = h('input', { placeholder: 'เช่น SO-202608102' });
  const customer = h('input', { placeholder: 'ชื่อลูกค้า / ปลายทาง' });
  const chSel = h('select', {}, h('option', { value: '' }, '— ไม่ระบุช่องทาง —'),
    ...channels.filter((c) => c.status === 'ACTIVE').map((c) =>
      h('option', { value: c.channel_id },
        `${c.channel_code} — ${c.channel_name}${c.min_pct_remaining !== null ? ` (อายุ ≥${c.min_pct_remaining}%)` : ''}`)));
  const soNote = h('input', { placeholder: 'หมายเหตุของใบสั่ง (ถ้ามี)' });

  // ---------------- 2. เพิ่มสินค้าเข้าใบสั่ง ----------------
  const skuSearch = h('input', { placeholder: 'พิมพ์ชื่อสินค้า หรือรหัสสินค้า เช่น แป้ง, FG-CRM' });
  const skuList = h('div', { class: 'pick-list' });

  function renderSkus() {
    const term = skuSearch.value.trim().toLowerCase();
    const rows = skus
      .filter((s) => !term || s.sku_code.toLowerCase().includes(term) || s.sku_name.toLowerCase().includes(term))
      .slice(0, 8);

    if (!rows.length) {
      skuList.replaceChildren(h('div', { class: 'empty-state' }, 'ไม่พบสินค้าที่ตรงกับคำค้นหา'));
      return;
    }
    skuList.replaceChildren(...rows.map((s) => {
      const inCart = cart.some((c) => c.sku.sku_id === s.sku_id);
      return h('button', {
        class: `sku-option ${sku?.sku_id === s.sku_id ? 'active' : ''}`,
        title: inCart
          ? `${s.sku_name} อยู่ในใบสั่งนี้แล้ว — แก้จำนวนหรือตำแหน่งได้ที่รายการด้านล่าง`
          : `เลือก ${s.sku_name} แล้วกรอกจำนวนที่ต้องการ เพื่อเพิ่มเข้าใบสั่งนี้`,
        onclick: () => { sku = s; renderSkus(); qty.focus(); },
      },
        h('div', {},
          h('div', { style: 'font-weight:700' }, s.sku_name, inCart ? ' ' : null, inCart ? pill('อยู่ในใบสั่งแล้ว', 'blue') : null),
          h('div', { class: 'mono muted', style: 'font-size:12px' }, s.sku_code)),
        h('div', { style: 'text-align:right' },
          h('div', { style: 'font-weight:700' }, `${fmtNum(s.qty_in_stock)} ${s.unit}`),
          h('div', { class: 'muted', style: 'font-size:12px' }, `${fmtNum(s.locations_used)} ตำแหน่ง`)));
    }));
  }
  skuSearch.addEventListener('input', renderSkus);

  const qty = h('input', { type: 'number', min: '1', placeholder: 'เช่น 500' });
  const minDays = h('input', { type: 'number', min: '0', placeholder: 'เช่น 90' });
  const minUnit = h('select', { style: 'width:80px' },
    h('option', { value: 'days' }, 'วัน'), h('option', { value: 'pct' }, '%'));
  const maxDays = h('input', { type: 'number', min: '0', placeholder: 'ไม่จำกัด' });
  const maxUnit = h('select', { style: 'width:80px' },
    h('option', { value: 'days' }, 'วัน'), h('option', { value: 'pct' }, '%'));
  const syncHint = (inp, unit, base) => {
    const hint = inp.closest('.field')?.querySelector('.hint');
    if (hint) hint.textContent = unit.value === 'pct' ? '% ของอายุทั้งหมด — เว้นว่างคือไม่กำหนด' : 'จำนวนวัน — เว้นว่างคือไม่กำหนด';
    inp.placeholder = unit.value === 'pct' ? (base === 'min' ? 'เช่น 50' : 'ไม่จำกัด') : (base === 'min' ? 'เช่น 90' : 'ไม่จำกัด');
  };
  minUnit.onchange = () => syncHint(minDays, minUnit, 'min');
  maxUnit.onchange = () => syncHint(maxDays, maxUnit, 'max');
  const zoneSel = h('select', {}, h('option', { value: '' }, 'ทุกโซน'),
    ...zones.map((z) => h('option', { value: z.zone_id }, `${z.zone_code} — ${z.zone_name}`)));
  const strategy = h('select', {},
    h('option', { value: 'FEFO' }, 'FEFO — หมดอายุก่อน หยิบก่อน (แนะนำ)'),
    h('option', { value: 'FIFO' }, 'FIFO — เข้าคลังก่อน หยิบก่อน'));

  [qty, minDays, maxDays].forEach((el) =>
    el.addEventListener('keydown', (e) => e.key === 'Enter' && addItem()));

  const planParams = (skuId) => ({
    sku_id: skuId, quantity: qty.value,
    min_days: minUnit.value === 'days' ? minDays.value : '',
    max_days: maxUnit.value === 'days' ? maxDays.value : '',
    min_pct: minUnit.value === 'pct' ? minDays.value : '',
    max_pct: maxUnit.value === 'pct' ? maxDays.value : '',
    zone_id: zoneSel.value, warehouse_id: wh.id, strategy: strategy.value,
  });

  const addBtn = h('button', {
    class: 'btn primary', style: 'padding:12px 32px;font-size:16px',
    title: 'คำนวณ FEFO ให้สินค้าตัวนี้แล้วเพิ่มเข้าใบสั่ง — เพิ่มสินค้าตัวอื่นต่อได้เรื่อย ๆ ยังไม่ตัดสต๊อก',
    onclick: () => addItem(),
  }, '➕ เพิ่มเข้าใบสั่ง');

  async function addItem() {
    if (!sku) { toast('เลือกสินค้าที่ต้องการหยิบก่อนครับ', 'err'); skuSearch.focus(); return; }
    if (!qty.value || Number(qty.value) <= 0) { toast('ระบุจำนวนที่ต้องการก่อนครับ', 'err'); qty.focus(); return; }
    if (cart.some((c) => c.sku.sku_id === sku.sku_id)) {
      toast(`${sku.sku_name} อยู่ในใบสั่งนี้แล้ว — แก้ที่รายการด้านล่างได้เลย`, 'err');
      return;
    }

    addBtn.disabled = true;
    const prevLabel = addBtn.textContent;
    addBtn.textContent = '⏳ กำลังคำนวณ…';
    try {
      const plan = await api.get('/api/pick/plan', planParams(sku.sku_id));
      cart.push({
        sku: plan.sku,
        requested: plan.requested,
        strategy: plan.strategy,
        filter: plan.filter,
        lines: plan.lines.map((l) => ({ ...l })),
        skipped: plan.skipped,
        manual: false,
      });
      // เคลียร์ฟอร์มให้พร้อมเพิ่มตัวถัดไปทันที
      sku = null; qty.value = ''; skuSearch.value = '';
      renderSkus(); renderCart();
      toast(`เพิ่ม ${plan.sku.sku_name} เข้าใบสั่งแล้ว — จัดสรรได้ ${fmtNum(plan.allocated)} ${plan.sku.unit}`,
        plan.complete ? 'ok' : 'err');
      skuSearch.focus();
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      addBtn.disabled = false;
      addBtn.textContent = prevLabel;
    }
  }

  // ---------------- 3. รายการในใบสั่ง ----------------
  const cartBox = h('div', {});
  const allocOf = (it) => it.lines.reduce((s, l) => s + Number(l.take || 0), 0);

  function renderCart() {
    if (!cart.length) {
      cartBox.replaceChildren(h('div', { class: 'empty-state' },
        h('p', {}, 'ยังไม่มีสินค้าในใบสั่งนี้'),
        h('p', { style: 'font-size:13px' }, 'เลือกสินค้าและจำนวนด้านบน แล้วกด "เพิ่มเข้าใบสั่ง" — ใบเดียวใส่ได้หลายสินค้า')));
      return;
    }

    const totalLines = cart.reduce((s, it) => s + it.lines.length, 0);
    const anyShort = cart.some((it) => allocOf(it) < it.requested);

    cartBox.replaceChildren(
      h('div', { class: 'so-sum' },
        h('b', {}, `${cart.length} สินค้า`),
        h('span', { class: 'muted' }, `${totalLines} ตำแหน่งที่ต้องเดินหยิบ`),
        anyShort ? pill('มีสินค้าจัดสรรไม่ครบ', 'red') : pill('จัดสรรครบทุกรายการ', 'green')),
      ...cart.map((it, i) => {
        const alloc = allocOf(it);
        const short = it.requested - alloc;
        return h('div', { class: 'so-item' },
          h('div', { class: 'so-item-head' },
            h('div', { style: 'min-width:0' },
              h('div', { style: 'font-weight:800' }, `${i + 1}. ${it.sku.sku_name}`),
              h('div', { class: 'mono muted', style: 'font-size:12px' }, it.sku.sku_code)),
            h('div', { style: 'text-align:right;white-space:nowrap' },
              h('div', { style: 'font-weight:800;font-size:17px;color:var(--brand)' },
                `${fmtNum(alloc)} / ${fmtNum(it.requested)} ${it.sku.unit}`),
              short > 0
                ? pill(`ขาด ${fmtNum(short)}`, 'red')
                : pill(`${it.lines.length} ตำแหน่ง · ${it.strategy}`, 'green')),
            h('div', { style: 'display:flex;gap:6px;margin-left:10px' },
              h('button', {
                class: 'btn', style: 'font-size:12.5px;padding:6px 12px',
                title: 'เลือกเองว่าจะหยิบจากตำแหน่งไหนบ้าง ตำแหน่งละเท่าไร — สแกนรหัสตำแหน่งได้ด้วย',
                onclick: () => editLines(it),
              }, '📍 เลือกตำแหน่ง'),
              h('button', {
                class: 'btn ghost', style: 'font-size:12.5px;padding:6px 10px',
                title: `เอา ${it.sku.sku_name} ออกจากใบสั่งนี้ (ยังไม่ตัดสต๊อก)`,
                onclick: () => { cart.splice(i, 1); renderCart(); renderSkus(); },
              }, '🗑️'))),
          it.manual ? h('div', { class: 'muted', style: 'font-size:12px;margin-bottom:6px' }, '✏️ แก้ตำแหน่งเองแล้ว') : null,
          it.lines.length
            ? table([
                { label: 'ลำดับ', value: (r) => h('span', { class: 'seq' }, r.seq), num: true },
                { label: 'ไปหยิบที่', value: (r) => h('a', { href: `#/map/${r.rag_id}?loc=${r.location_code}` }, r.location_code), mono: true },
                { label: 'ชั้น / ตอน', value: (r) => `L${r.level} / D${r.depth}` },
                { label: 'Lot', key: 'lot_no', mono: true },
                { label: 'วันหมดอายุ', value: (r) => (r.exp_date ? h('div', {}, fmtDate(r.exp_date), ' ', expiryPill(r.expiry)) : '—') },
                { label: 'มีอยู่', value: (r) => `${fmtNum(r.quantity)} ${r.unit}`, num: true },
                { label: 'หยิบ', value: (r) => h('strong', { class: 'take' }, `${fmtNum(r.take)} ${r.unit}`), num: true },
                { label: 'หมายเหตุ', value: (r) => (r.needs_forklift ? pill('ชั้นสูง — ใช้รถยก', 'blue') : null) },
              ], it.lines)
            : h('div', { class: 'note bad' }, 'ยังไม่ได้เลือกตำแหน่งหยิบ — กด "เลือกตำแหน่ง" เพื่อระบุเอง'));
      }));
  }

  // ---------------- เลือก/สแกนตำแหน่งเอง รายสินค้า ----------------
  async function editLines(it) {
    const rows = await api.get('/api/stock', {
      sku_id: it.sku.sku_id, warehouse_id: wh.id, limit: 500, sort: it.strategy === 'FIFO' ? 'newest' : 'fefo',
    }).catch(() => []);
    if (!rows.length) { toast('ไม่พบสต๊อกของสินค้านี้ในคลัง', 'err'); return; }

    // เหตุผลที่ FEFO ข้ามตำแหน่งนี้ไป — ยังเลือกเองได้ แต่ต้องรู้ว่ากำลังฝืนเงื่อนไขอะไร
    const skipReason = new Map(it.skipped.map((s) => [s.item_id, s.reason]));
    const chosen = new Map(it.lines.map((l) => [l.item_id, Number(l.take)]));

    const totalEl = h('b', {});
    const stateEl = h('span', {});
    const inputs = new Map();

    const recalc = () => {
      let sum = 0;
      for (const [id, inp] of inputs) if (inp.checked) sum += Number(inp.qtyEl.value || 0);
      totalEl.textContent = `${fmtNum(sum)} / ${fmtNum(it.requested)} ${it.sku.unit}`;
      const diff = it.requested - sum;
      stateEl.replaceChildren(diff === 0 ? pill('ครบพอดี', 'green')
        : diff > 0 ? pill(`ขาดอีก ${fmtNum(diff)}`, 'red')
        : pill(`เกิน ${fmtNum(-diff)}`, 'amber'));
    };

    // จำนวนที่ควรเติมให้อัตโนมัติ = ที่ยังขาด แต่ไม่เกินที่ตำแหน่งนั้นมีจริง
    const autoFill = (row, requested) => {
      let sum = 0;
      for (const [id, inp] of inputs) if (inp.checked && id !== row.item_id) sum += Number(inp.qtyEl.value || 0);
      return Math.max(0, Math.min(row.quantity, requested - sum));
    };

    const body = h('div', { class: 'loc-editor' });
    const scan = scanInput('สแกน/พิมพ์รหัสตำแหน่ง แล้วกด Enter เพื่อเลือกตำแหน่งนั้น', (code) => {
      const key = String(code).trim().toUpperCase();
      const hit = rows.find((r) => String(r.location_code).toUpperCase() === key);
      if (!hit) { toast(`ไม่พบ ${key} ในตำแหน่งที่มีสินค้าตัวนี้`, 'err'); return; }
      const rec = inputs.get(hit.item_id);
      rec.checked = true;
      rec.checkEl.checked = true;
      // เติมจำนวนที่ยังขาดให้อัตโนมัติ — สแกนแล้วได้เลย ไม่ต้องพิมพ์ซ้ำ
      // ถ้าเลือกครบจำนวนแล้ว ปล่อยว่างให้พิมพ์เอง ดีกว่าใส่ 1 แล้วยอดเกินโดยไม่ตั้งใจ
      const fill = autoFill(hit, it.requested);
      if (fill > 0) rec.qtyEl.value = String(fill);
      else toast('เลือกครบจำนวนที่ต้องการแล้ว — ระบุจำนวนเองถ้าจะหยิบจากตำแหน่งนี้เพิ่ม');
      rec.rowEl.classList.add('hit');
      rec.rowEl.scrollIntoView({ block: 'center' });
      setTimeout(() => rec.rowEl.classList.remove('hit'), 1200);
      recalc();
      scan.value = '';
    }, { autofocus: true });

    const rowEls = rows.map((r) => {
      const reason = skipReason.get(r.item_id);
      const checkEl = h('input', { type: 'checkbox', checked: chosen.has(r.item_id) });
      const qtyEl = h('input', {
        type: 'number', min: '0', max: String(r.quantity), style: 'width:92px',
        value: String(chosen.get(r.item_id) ?? ''),
      });
      const rowEl = h('tr', { class: reason ? 'off-rule' : '' },
        h('td', {}, checkEl),
        h('td', { class: 'mono' }, h('a', { href: `#/map/${r.rag_id}?loc=${r.location_code}`, target: '_blank' }, r.location_code)),
        h('td', {}, `L${r.level} / D${r.depth}`),
        h('td', { class: 'mono' }, r.lot_no ?? '—'),
        h('td', {}, r.exp_date ? h('div', {}, fmtDate(r.exp_date), ' ', expiryPill(r.expiry)) : '—'),
        h('td', { style: 'text-align:right' }, `${fmtNum(r.quantity)} ${r.unit}`),
        h('td', {}, qtyEl),
        h('td', {}, reason ? pill(reason, 'amber') : (r.needs_forklift ? pill('ใช้รถยก', 'blue') : null)));

      const rec = { checked: chosen.has(r.item_id), checkEl, qtyEl, rowEl, row: r };
      checkEl.addEventListener('change', () => {
        rec.checked = checkEl.checked;
        if (checkEl.checked && !qtyEl.value) {
          const fill = autoFill(r, it.requested);
          if (fill > 0) qtyEl.value = String(fill);
        }
        recalc();
      });
      qtyEl.addEventListener('input', () => {
        if (Number(qtyEl.value) > r.quantity) qtyEl.value = String(r.quantity);
        if (Number(qtyEl.value) > 0 && !checkEl.checked) { checkEl.checked = true; rec.checked = true; }
        recalc();
      });
      inputs.set(r.item_id, rec);
      return rowEl;
    });

    body.replaceChildren(
      h('p', { class: 'muted', style: 'margin-top:0;font-size:13.5px' },
        `ติ๊กเลือกตำแหน่งที่จะไปหยิบและระบุจำนวนของแต่ละที่ — แถวสีเหลืองคือตำแหน่งที่ ${it.strategy} ข้ามไปเพราะไม่ผ่านเงื่อนไขอายุ เลือกได้แต่ควรมีเหตุผล`),
      scan,
      h('div', { class: 'table-wrap', style: 'max-height:46vh;overflow:auto;margin-top:10px' },
        h('table', {},
          h('thead', {}, h('tr', {},
            h('th', {}, '✓'), h('th', {}, 'ตำแหน่ง'), h('th', {}, 'ชั้น/ตอน'), h('th', {}, 'Lot'),
            h('th', {}, 'วันหมดอายุ'), h('th', { style: 'text-align:right' }, 'มีอยู่'), h('th', {}, 'หยิบ'), h('th', {}, 'หมายเหตุ'))),
          h('tbody', {}, ...rowEls))),
      h('div', { class: 'loc-total' },
        h('span', {}, 'รวมที่เลือก'), totalEl, stateEl));

    recalc();

    const m = modal(`📍 เลือกตำแหน่งหยิบ — ${it.sku.sku_name}`, body, [
      h('button', { class: 'btn', onclick: () => m.close() }, 'ยกเลิก'),
      h('button', {
        class: 'btn', style: 'margin-right:auto',
        title: `ให้ระบบคำนวณตำแหน่งใหม่ตามลำดับ ${it.strategy} ทับที่แก้ไว้`,
        onclick: async () => {
          try {
            const plan = await api.get('/api/pick/plan', {
              sku_id: it.sku.sku_id, quantity: it.requested,
              min_days: it.filter.min_days ?? '', max_days: it.filter.max_days ?? '',
              min_pct: it.filter.min_pct ?? '', max_pct: it.filter.max_pct ?? '',
              warehouse_id: wh.id, strategy: it.strategy,
            });
            it.lines = plan.lines.map((l) => ({ ...l }));
            it.skipped = plan.skipped;
            it.manual = false;
            m.close(); renderCart();
            toast(`คำนวณใหม่ตาม ${it.strategy} แล้ว`);
          } catch (err) { toast(err.message, 'err'); }
        },
      }, `↺ คำนวณใหม่ตาม ${it.strategy}`),
      h('button', {
        class: 'btn primary',
        title: 'บันทึกตำแหน่งที่เลือกไว้กับสินค้ารายการนี้ — ยังไม่ตัดสต๊อก',
        onclick: () => {
          const picked = [];
          for (const [, rec] of inputs) {
            const take = Number(rec.qtyEl.value || 0);
            if (rec.checked && take > 0) picked.push({ ...rec.row, take, remaining_after: rec.row.quantity - take });
          }
          if (!picked.length) { toast('ยังไม่ได้เลือกตำแหน่งไหนเลย', 'err'); return; }
          picked.forEach((l, i) => { l.seq = i + 1; });
          it.lines = picked;
          it.manual = true;
          m.close(); renderCart();
          toast(`บันทึกแล้ว — ${picked.length} ตำแหน่ง รวม ${fmtNum(picked.reduce((s, l) => s + l.take, 0))} ${it.sku.unit}`);
        },
      }, '✓ ใช้ตำแหน่งที่เลือก'),
    ]);
  }

  // ---------------- 4. ยืนยันทั้งใบ ----------------
  async function confirmAll() {
    if (!cart.length) { toast('ยังไม่มีสินค้าในใบสั่งนี้', 'err'); return; }
    if (!soRef.value.trim()) { toast('ระบุเลขที่ SO ก่อนครับ', 'err'); soRef.focus(); return; }
    const empty = cart.find((it) => !it.lines.length);
    if (empty) { toast(`${empty.sku.sku_name} ยังไม่ได้เลือกตำแหน่งหยิบ`, 'err'); return; }

    const lines = cart.flatMap((it) =>
      it.lines.map((l) => ({ item_id: l.item_id, take: l.take, location_code: l.location_code })));
    const grand = cart.reduce((s, it) => s + allocOf(it), 0);
    const shortList = cart.filter((it) => allocOf(it) < it.requested);

    const doIssue = async (force) => {
      const res = await api.post('/api/docs/issue', {
        ref_no: soRef.value.trim(), party: customer.value.trim(), channel_id: chSel.value || null, force,
        so_note: soNote.value.trim() || `หยิบตามใบสั่ง ${soRef.value.trim()} — ${cart.length} สินค้า`,
        lines,
      });
      toast(`จ่ายออกสำเร็จ ${fmtNum(res.total)} หน่วย จาก ${cart.length} สินค้า — ใบจ่ายสินค้า ${res.doc_no}`);
      m.close();
      cart.length = 0;
      soRef.value = ''; customer.value = ''; soNote.value = ''; chSel.value = '';
      renderCart();
      skus.splice(0, skus.length, ...await api.get('/api/skus', { warehouse_id: wh.id }));
      renderSkus();
    };

    const m = modal('ยืนยันหยิบทั้งใบ + สร้างใบจ่ายสินค้า',
      h('div', {},
        h('p', { class: 'muted', style: 'margin-top:0' },
          `ใบสั่ง ${soRef.value.trim()} — ${cart.length} สินค้า รวม ${fmtNum(grand)} หน่วย จาก ${lines.length} ตำแหน่ง`),
        table([
          { label: 'สินค้า', value: (it) => h('div', {}, it.sku.sku_name,
              h('div', { class: 'mono muted', style: 'font-size:12px' }, it.sku.sku_code)) },
          { label: 'ตำแหน่ง', value: (it) => `${it.lines.length}`, num: true },
          { label: 'หยิบรวม', value: (it) => h('strong', {}, `${fmtNum(allocOf(it))} ${it.sku.unit}`), num: true },
          { label: 'ครบไหม', value: (it) => (allocOf(it) < it.requested
              ? pill(`ขาด ${fmtNum(it.requested - allocOf(it))}`, 'red') : pill('ครบ', 'green')) },
        ], cart),
        shortList.length
          ? h('div', { class: 'note bad', style: 'margin-top:10px' },
              `⚠️ มี ${shortList.length} รายการที่จัดสรรไม่ครบ — จ่ายออกได้เท่าที่มี ส่วนที่ขาดต้องเปิดใบใหม่ภายหลัง`)
          : null),
      [
        h('button', { class: 'btn', onclick: () => m.close() }, 'ยกเลิก'),
        h('button', {
          class: 'btn primary',
          title: 'ตัดสต๊อกทุกตำแหน่งในใบสั่งนี้และเปิดใบจ่ายสินค้า 1 ใบ — ย้อนกลับไม่ได้ ต้องแก้ด้วยรายการรับคืนเท่านั้น',
          onclick: async () => {
            try { await doIssue(false); } catch (err) {
              if (err.code === 'CHANNEL_PCT') {
                const ok = await confirmBox('อายุคงเหลือต่ำกว่าเกณฑ์ช่องทาง',
                  `${err.message} — ยืนยันจ่ายออกทั้งที่ต่ำกว่าเกณฑ์หรือไม่?`, 'ยืนยันจ่ายออก');
                if (ok) { try { await doIssue(true); } catch (e2) { toast(e2.message, 'err'); } }
              } else toast(err.message, 'err');
            }
          },
        }, '✅ ยืนยันหยิบทั้งใบ'),
      ]);
  }

  // ---------------- ดาวน์โหลด CSV ของทั้งใบ ----------------
  function exportCsv() {
    if (!cart.length) { toast('ยังไม่มีสินค้าในใบสั่งนี้', 'err'); return; }
    const head = ['เลขที่ SO', 'ลูกค้า', 'ลำดับ', 'รหัสสินค้า', 'ชื่อสินค้า', 'ตำแหน่ง', 'ชั้น', 'ตอน', 'Lot', 'วันหมดอายุ', 'มีอยู่', 'หยิบ', 'หน่วย'];
    const rows = cart.flatMap((it) => it.lines.map((l) => [
      soRef.value.trim(), customer.value.trim(), l.seq, it.sku.sku_code, it.sku.sku_name,
      l.location_code, l.level, l.depth, l.lot_no ?? '', l.exp_date ?? '', l.quantity, l.take, it.sku.unit,
    ]));
    const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = '﻿' + [head, ...rows].map((r) => r.map(esc).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = h('a', { href: url, download: `picklist_${soRef.value.trim() || 'draft'}.csv` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------------- พิมพ์ใบเบิกทั้งใบ ----------------
  function printOrder() {
    if (!cart.length) { toast('ยังไม่มีสินค้าในใบสั่งนี้', 'err'); return; }
    const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const now = new Date();
    const dateStr = `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear() + 543}`;
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    const chName = chSel.selectedIndex > 0 ? chSel.options[chSel.selectedIndex].text : '-';

    let seq = 0;
    const blocks = cart.map((it) => {
      const rows = it.lines.map((l) => {
        seq += 1;
        return `<tr>
          <td class="c">${seq}</td>
          <td class="mono">${esc(l.location_code)}</td>
          <td class="c">L${l.level} / D${l.depth}</td>
          <td class="mono">${esc(l.lot_no ?? '-')}</td>
          <td>${l.exp_date ? esc(fmtDate(l.exp_date)) : '-'}</td>
          <td class="n">${Number(l.quantity).toLocaleString('th-TH')}</td>
          <td class="n take">${Number(l.take).toLocaleString('th-TH')}</td>
          <td class="c">${l.needs_forklift ? '🚜' : ''}</td>
          <td class="check"></td>
        </tr>`;
      }).join('');
      return `<div class="sku-block">
        <div class="sku-title">${esc(it.sku.sku_name)} <span class="code">${esc(it.sku.sku_code)}</span>
          <span class="qty">${allocOf(it).toLocaleString('th-TH')} ${esc(it.sku.unit)}</span></div>
        <table>
          <thead><tr>
            <th class="c" style="width:30px">#</th><th>ตำแหน่ง</th><th class="c">ชั้น/ตอน</th>
            <th>Lot</th><th>วันหมดอายุ</th><th class="n">มีอยู่</th><th class="n">หยิบ</th>
            <th class="c" style="width:28px">ยก</th><th class="c" style="width:36px">✓</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table></div>`;
    }).join('');

    const grand = cart.reduce((s, it) => s + allocOf(it), 0);
    const html = `<!doctype html><html lang="th"><head><meta charset="utf-8">
<title>ใบเบิกสินค้า — ${esc(soRef.value.trim() || 'ร่าง')}</title>
<style>
  *{box-sizing:border-box}
  html{background:#fff}
  body{font-family:'TH Sarabun New','Sarabun',sans-serif;font-size:15px;margin:20px 28px;color:#111;background:#fff}
  h1{font-size:22px;margin:0;text-align:center}
  .sub{text-align:center;color:#555;margin:0 0 12px;font-size:13px}
  .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px}
  .logo{font-weight:700;font-size:14px}
  .logo small{display:block;font-weight:400;color:#555;font-size:12px}
  .doc-no{text-align:right;font-size:13px;color:#555}
  .info{display:grid;grid-template-columns:1fr 1fr;gap:2px 20px;margin:10px 0;font-size:14px;border:1px solid #ccc;padding:8px 12px;border-radius:4px}
  .info b{min-width:100px;display:inline-block}
  .sku-block{margin-top:14px;break-inside:avoid}
  .sku-title{font-weight:700;font-size:15px;background:#eef4f3;border:1px solid #ccc;border-bottom:0;padding:5px 10px}
  .sku-title .code{font-family:'Courier New',monospace;font-size:12px;color:#555;font-weight:400;margin-left:6px}
  .sku-title .qty{float:right;color:#0f766e}
  table{border-collapse:collapse;width:100%;font-size:13px}
  th,td{border:1px solid #888;padding:4px 7px;text-align:left}
  th{background:#e8e8e8;font-weight:700;font-size:12px}
  .c{text-align:center} .n{text-align:right} .mono{font-family:'Courier New',monospace;font-size:12px}
  .take{font-weight:700;color:#0f766e;font-size:14px}
  .grand{margin-top:12px;text-align:right;font-size:16px;font-weight:700}
  .note-box{margin-top:12px;border:1px solid #ccc;border-radius:4px;padding:8px 12px;min-height:44px}
  .sign{display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px;margin-top:36px;text-align:center;font-size:14px}
  .sign .line{border-top:1px solid #333;margin-top:40px;padding-top:4px}
  .sign .role{font-weight:700;margin-bottom:2px}
  .sign small{display:block;color:#777;font-size:12px}
  .footer{margin-top:16px;text-align:center;font-size:11px;color:#999;border-top:1px solid #ddd;padding-top:6px}
  @media print{body{margin:12px 16px} .no-print{display:none!important}}
</style></head><body>
<button onclick="print()" style="float:right;padding:8px 20px;cursor:pointer" class="no-print">🖨️ พิมพ์</button>
<div class="header">
  <div class="logo">EVERYDAYHAPPY CO., LTD.<small>De Leaf — ระบบจัดการคลังสินค้า</small></div>
  <div class="doc-no">วันที่พิมพ์: ${dateStr} ${timeStr}</div>
</div>
<h1>ใบเบิกสินค้า / Pickup Order</h1>
<p class="sub">เอกสารนี้ใช้ประกอบการหยิบสินค้าจากคลัง — กรุณาตรวจสอบและลงนามเมื่อหยิบครบ</p>
<div class="info">
  <div><b>เลขที่ SO:</b> ${esc(soRef.value.trim() || '-')}</div>
  <div><b>ลูกค้า:</b> ${esc(customer.value.trim() || '-')}</div>
  <div><b>ช่องทางขาย:</b> ${esc(chName)}</div>
  <div><b>คลัง:</b> ${esc(wh.name ?? wh.label ?? 'ทุกคลัง')}</div>
  <div><b>จำนวนสินค้า:</b> ${cart.length} รายการ</div>
  <div><b>จำนวนตำแหน่ง:</b> ${cart.reduce((s, it) => s + it.lines.length, 0)} ตำแหน่ง</div>
  ${soNote.value.trim() ? `<div style="grid-column:1/-1"><b>หมายเหตุ:</b> ${esc(soNote.value.trim())}</div>` : ''}
</div>
${blocks}
<div class="grand">รวมทั้งใบ ${grand.toLocaleString('th-TH')} หน่วย</div>
<div class="note-box"><b>หมายเหตุผู้หยิบ:</b></div>
<div class="sign">
  <div><div class="role">ผู้เบิกสินค้า</div><div class="line">ลงชื่อ ................................................</div><small>วันที่ ........../............/............</small></div>
  <div><div class="role">ผู้อนุมัติ</div><div class="line">ลงชื่อ ................................................</div><small>วันที่ ........../............/............</small></div>
  <div><div class="role">ผู้จ่ายสินค้า</div><div class="line">ลงชื่อ ................................................</div><small>วันที่ ........../............/............</small></div>
</div>
<div class="footer">พิมพ์จากระบบ RACK Management — De Leaf WMS · ${dateStr} ${timeStr}</div>
</body></html>`;
    const w = window.open('', '_blank');
    w.document.write(html);
    w.document.close();
  }

  renderSkus();
  renderCart();

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'วางแผนหยิบสินค้า'),
        h('p', {}, `คลัง: ${wh.label} — 1 ใบสั่ง (SO) ใส่ได้หลายสินค้า ระบบคำนวณ FEFO ให้ หรือเลือก/สแกนตำแหน่งเองก็ได้`))),

    h('div', { class: 'card' },
      h('h2', {}, '1. ข้อมูลใบสั่ง (SO)'),
      h('div', { class: 'row' },
        field('เลขที่ SO *', soRef, null, 'เลขที่ใบสั่งขายจากฝ่ายขาย — ใช้อ้างอิงตอนจ่ายออกและตามของย้อนหลัง'),
        field('ลูกค้า / ปลายทาง', customer, null, 'ชื่อลูกค้าหรือสถานที่ที่จะส่งสินค้าไป')),
      h('div', { class: 'row' },
        field('ช่องทางขาย', chSel, 'ระบบจะตรวจ % อายุคงเหลือขั้นต่ำของช่องทางให้ตอนยืนยัน', 'ช่องทางขายที่สั่งสินค้า เช่น MT, GT, Online — แต่ละช่องทางมีเกณฑ์อายุขั้นต่ำต่างกัน'),
        field('หมายเหตุใบสั่ง', soNote, null, 'บันทึกเพิ่มเติมของใบสั่งนี้ เช่น เงื่อนไขการส่ง'))),

    h('div', { class: 'card' },
      h('h2', {}, '2. เพิ่มสินค้าเข้าใบสั่ง'),
      h('p', { class: 'muted', style: 'margin:2px 0 10px;font-size:13px' },
        'เลือกสินค้า → กรอกจำนวน → กด "เพิ่มเข้าใบสั่ง" · ทำซ้ำได้เรื่อย ๆ สำหรับสินค้าตัวอื่นในใบเดียวกัน'),
      skuSearch,
      skuList,
      h('div', { class: 'row', style: 'margin-top:12px' },
        field('จำนวนที่ต้องการ *', qty, null, 'จำนวนสินค้าที่ต้องการหยิบออกจากคลังสำหรับสินค้าตัวนี้'),
        field('อายุคงเหลืออย่างน้อย', h('div', { style: 'display:flex;gap:4px' }, minDays, minUnit), 'จำนวนวัน — เว้นว่างคือไม่กำหนด', 'สินค้าต้องเหลืออายุอย่างน้อยเท่านี้ถึงจะหยิบได้ — ป้องกันส่งของใกล้หมดอายุ'),
        field('อายุคงเหลือไม่เกิน', h('div', { style: 'display:flex;gap:4px' }, maxDays, maxUnit), 'จำนวนวัน — เว้นว่างคือไม่กำหนด', 'จำกัดไม่ให้หยิบของที่อายุยาวเกินไป เพื่อเก็บไว้ขายทีหลัง')),
      h('div', { class: 'row' },
        field('เฉพาะโซน', zoneSel, null, 'กรองเฉพาะโซนที่ต้องการ เช่น FG, RM — เว้นว่างคือค้นทุกโซน'),
        field('ลำดับการหยิบ', strategy, null, 'FEFO = หมดอายุก่อนหยิบก่อน, FIFO = เข้าคลังก่อนหยิบก่อน')),
      h('div', { style: 'margin-top:14px;text-align:right' }, addBtn)),

    h('div', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h2', {}, '3. รายการในใบสั่งนี้'),
        h('div', { class: 'actions' },
          h('button', { class: 'btn', title: 'ดาวน์โหลดแผนหยิบทั้งใบเป็นไฟล์ CSV ไว้เปิดใน Excel หรือส่งต่อให้ทีมอื่น', onclick: exportCsv }, '⬇️ CSV'),
          h('button', { class: 'btn', title: 'พิมพ์ใบเบิกสินค้าทั้งใบ แยกตามสินค้าแต่ละตัว ให้พนักงานถือเข้าไปหยิบและลงนามกำกับ', onclick: printOrder }, '🖨️ พิมพ์ใบเบิก'),
          auth.can('move')
            ? h('button', { class: 'btn primary', title: 'ตัดสต๊อกทุกรายการในใบสั่งนี้และเปิดใบจ่ายสินค้า 1 ใบ — ต้องระบุเลขที่ SO ก่อน', onclick: confirmAll }, '✅ ยืนยันหยิบทั้งใบ')
            : null)),
      cartBox));
}
