# การนำระบบขึ้นใช้งานจริง (Deployment Guide)

## 1. สภาพแวดล้อมที่ต้องมี

| รายการ | ข้อกำหนดขั้นต่ำ | หมายเหตุ |
|--------|----------------|---------|
| Server | 2 vCPU / 4 GB RAM / 40 GB SSD | Cloud VPS (~2,000–3,000 บาท/เดือน) หรือเครื่องในโรงงาน |
| Node.js | เวอร์ชัน 22 ขึ้นไป | ระบบใช้ `node:sqlite` ที่มีใน Node 22+ |
| เครือข่าย | Wi-Fi ครอบคลุมพื้นที่คลัง | จุดอับสัญญาณคือความเสี่ยงหลักของงานสแกน |
| อุปกรณ์ | Tablet 8–10" (Android/iPad) · Handheld Scanner (USB/Bluetooth แบบ HID) | เครื่องสแกนแบบ HID ใช้ได้ทันทีโดยไม่ต้องลงไดรเวอร์ |
| ป้ายสติกเกอร์ | ตำแหน่ง 5×3 ซม. ทนน้ำ/ทนแดด · พาเลท 10×7 ซม. | แนะนำ Polyester/Synthetic ไม่ใช่กระดาษธรรมดา (ความชื้นในคลัง) |

## 2. ตัวแปรสภาพแวดล้อม

| ตัวแปร | ค่าเริ่มต้น | คำอธิบาย |
|--------|-----------|---------|
| `PORT` | 4000 | พอร์ตของระบบ |
| `RAG_DB` | `data/rag.db` | ตำแหน่งไฟล์ฐานข้อมูล |
| `RAG_LINE_CHANNEL_TOKEN` + `RAG_LINE_TO` | — | แจ้งเตือนผ่าน **LINE Messaging API** (แนะนำ) |
| `RAG_LINE_TOKEN` | — | LINE Notify แบบเดิม (บริการปิดแล้ว — ใช้เฉพาะระบบที่ยังรองรับ) |
| `RAG_WEBHOOK_URL` | — | ส่งเข้า Webhook ทั่วไป (Email Gateway / Teams / ระบบภายใน) |
| `RAG_LOG` | — | ตั้งเป็น `off` เพื่อปิด log ราย request |

ถ้าไม่ตั้งค่าใด ๆ ระบบจะบันทึกข้อความแจ้งเตือนลง `data/notifications.log` (ไม่มีการส่งออกภายนอก)

## 3. ติดตั้งเป็นบริการถาวร (systemd)

```ini
# /etc/systemd/system/rag.service
[Unit]
Description=RAG Management System (EHOS)
After=network.target

[Service]
Type=simple
User=rag
WorkingDirectory=/opt/rag
Environment=PORT=4000
Environment=RAG_DB=/var/lib/rag/rag.db
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

ควรวาง Nginx/Caddy ไว้ด้านหน้าเพื่อทำ **HTTPS** — จำเป็นสำหรับ Service Worker (Offline Mode) และการใช้กล้องมือถือสแกนบาร์โค้ด

## 4. สำรองข้อมูล (NFR-06) และกู้คืน (NFR-07)

```bash
# สำรองรายวัน เก็บย้อนหลัง 90 วัน — ตั้งใน crontab เวลา 22:30 น.
sqlite3 /var/lib/rag/rag.db ".backup '/backup/rag-$(date +\%F).db'"
find /backup -name 'rag-*.db' -mtime +90 -delete
```

- **RPO ≤ 1 ชั่วโมง** ตาม NFR-07 ต้องสำรองถี่กว่าวันละครั้ง — แนะนำ `.backup` ทุกชั่วโมงในเวลาทำงาน แล้วส่งขึ้น Object Storage
- **RTO ≤ 4 ชั่วโมง** — เตรียมสคริปต์กู้คืนและซ้อมกู้คืนอย่างน้อยปีละครั้ง

## 5. ย้ายไปใช้ PostgreSQL (แนะนำเมื่อขึ้น Production)

SQLite เหมาะกับ Prototype/UAT และรองรับผู้ใช้ 10–20 คนได้ แต่ PostgreSQL เหมาะกว่าเมื่อ (ก) ต้องเชื่อมกับ ERP,
(ข) ต้องการ Replication/Backup ระดับองค์กร, (ค) มีหลายระบบเขียนข้อมูลพร้อมกัน

การแปลง `server/schema.sql` → PostgreSQL:

| SQLite | PostgreSQL |
|--------|-----------|
| `INTEGER PRIMARY KEY AUTOINCREMENT` | `BIGSERIAL PRIMARY KEY` |
| `TEXT` (วันเวลา) | `TIMESTAMPTZ` / `DATE` |
| `datetime('now','localtime')` | `now()` (ตั้ง `TimeZone='Asia/Bangkok'`) |
| `julianday(a) - julianday(b)` | `(a::date - b::date)` |
| `CHECK (x IN (...))` | คงเดิม หรือใช้ `ENUM` |
| Trigger ห้าม UPDATE/DELETE | `CREATE RULE` หรือ Trigger `RAISE EXCEPTION` |
| `INSERT ... ON CONFLICT` | เหมือนกัน |

โค้ดที่ต้องแก้อยู่ที่ `server/lib/db.js` เท่านั้น (เปลี่ยน `all/get/run/tx` ไปใช้ไดรเวอร์ `pg`) — Service Layer ใช้ SQL มาตรฐานเป็นหลัก

## 6. การเชื่อมต่อกับ ERP (NFR-15 / M12)

ระบบเตรียมจุดเชื่อมไว้แล้ว: `skus.erp_item_id` และ `transactions.reference_doc`

**แนวทางที่แนะนำ** — ให้ ERP เป็นเจ้าของ "สินค้าและมูลค่าสต็อก" ส่วนระบบ RAG เป็นเจ้าของ "ตำแหน่งจัดเก็บ"

1. **ขาเข้า:** ดึง SKU Master จาก ERP มาสร้าง/อัปเดตผ่าน `POST /api/skus` (จับคู่ด้วย `erp_item_id`)
2. **ขาออก:** ส่ง Transaction (PUTAWAY/PICKING/ADJUSTMENT) กลับเข้า ERP เป็นรายการเคลื่อนไหวสต็อก
3. **การกระทบยอด:** ใช้ `GET /api/reports/inventory` เทียบกับสต็อกใน ERP ทุกสิ้นวัน

> **ก่อนพัฒนา Connector ควรสรุปให้ชัดว่าจะใช้ ERP ตัวใด** (ตาม SRS §1.5) หากเลือก Odoo ให้ทดสอบก่อนว่า Location
> แบบ 3 มิติ (RAG × ชั้น × ความลึก) และข้อจำกัด Drive-In Rack รองรับได้เพียงใด — ดู [OPEN_ISSUES.md](OPEN_ISSUES.md) ข้อ 1

## 7. Checklist ก่อน Go-Live

- [ ] สำรวจ RAG จริงทั้งหมดในคลัง แล้วบันทึกโครงสร้าง (จำนวนชั้น × ตอน, น้ำหนักรับได้, ทางเดิน)
- [ ] พิมพ์และติดป้ายตำแหน่งครบทุกช่อง — ขั้นตอนนี้ใช้เวลามากที่สุด ควรวางแผนกำลังคน
- [ ] นำเข้าข้อมูล SKU จริง และกำหนดโซนที่แนะนำของแต่ละสินค้า
- [ ] นับสต็อกตั้งต้น (Opening Count) แล้วบันทึกตำแหน่งจริงเข้าระบบ
- [ ] ทดสอบเครื่องสแกนรุ่นที่ใช้จริงกับป้ายที่พิมพ์จริง (AC-09)
- [ ] ทดสอบ Performance กับข้อมูล 500+ พาเลท (AC-01) และผู้ใช้ 10–20 คนพร้อมกัน (NFR-03)
- [ ] ตั้งค่า HTTPS · Backup · ช่องทางแจ้งเตือน · บัญชีผู้ใช้จริง (และลบบัญชีทดสอบทั้งหมด)
- [ ] อบรมพนักงาน + กำหนด SOP ให้การสแกนยืนยันเป็นขั้นตอนบังคับ (ดูความเสี่ยงใน SRS §11)
