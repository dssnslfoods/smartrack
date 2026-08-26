# การนำระบบขึ้นใช้งานจริง (Deployment Guide)

> ## ข้อมูลเก็บบน Supabase (PostgreSQL)
>
> ตั้งแต่เวอร์ชันนี้ระบบไม่เก็บข้อมูลไว้ในเครื่องแล้ว ทุกอย่างอยู่บนฐานข้อมูล PostgreSQL
> ที่ Supabase ดูแลให้ (สำรองข้อมูลอัตโนมัติ) ตัวระบบจึงเป็น **stateless** —
> deploy ซ้ำ ปิดเปิด หรือเพิ่มจำนวน instance ได้โดยข้อมูลไม่หาย
>
> สิ่งเดียวที่ต้องตั้งให้ถูกคือ `DATABASE_URL` **ห้าม hard-code ลงในโค้ดหรือ push ขึ้น Git**
>
> รันได้ทั้งบน VM/VPS, Docker, Cloud Run และ Cloud Functions

## 1. สภาพแวดล้อมที่ต้องมี

| รายการ | ข้อกำหนดขั้นต่ำ | หมายเหตุ |
|--------|----------------|---------|
| ฐานข้อมูล | Supabase (PostgreSQL 15+) | แพ็กเกจฟรีใช้ทดลองได้ · ระบบจริงควรใช้ Pro เพราะแพ็กเกจฟรีหยุดโปรเจกต์เมื่อไม่มีการใช้งาน ~7 วัน |
| Server | 1 vCPU / 1 GB RAM | ระบบไม่เก็บข้อมูลในเครื่องแล้ว จึงใช้เครื่องเล็กได้ · หรือ deploy แบบ serverless |
| Node.js | เวอร์ชัน 22 ขึ้นไป | ระบบใช้ความสามารถของ Node 22+ (เช่น `process.loadEnvFile`) |
| เครือข่าย | Wi-Fi ครอบคลุมพื้นที่คลัง | จุดอับสัญญาณคือความเสี่ยงหลักของงานสแกน |
| อุปกรณ์ | Tablet 8–10" (Android/iPad) · Handheld Scanner (USB/Bluetooth แบบ HID) | เครื่องสแกนแบบ HID ใช้ได้ทันทีโดยไม่ต้องลงไดรเวอร์ |
| ป้ายสติกเกอร์ | ตำแหน่ง 5×3 ซม. ทนน้ำ/ทนแดด · พาเลท 10×7 ซม. | แนะนำ Polyester/Synthetic ไม่ใช่กระดาษธรรมดา (ความชื้นในคลัง) |

## 2. ตัวแปรสภาพแวดล้อม

| ตัวแปร | ค่าเริ่มต้น | คำอธิบาย |
|--------|-----------|---------|
| `PORT` | 4000 | พอร์ตของระบบ |
| `DATABASE_URL` | — | **จำเป็น** — connection string ของ Supabase (Dashboard → ปุ่ม Connect → **Session pooler**) |
| `RAG_DB_POOL` | 10 | จำนวน connection สูงสุดใน pool |
| `RAG_ADMIN_PASSWORD` | — | รหัสผ่าน `admin` ที่จะสร้างตอนบูตครั้งแรก ถ้าไม่ตั้ง ระบบจะสุ่มให้แล้วพิมพ์ใน log ครั้งเดียว |
| `RAG_SEED` | — | ตั้งเป็น `demo` เพื่อสร้าง**ข้อมูลตัวอย่าง**ตอนบูตครั้งแรก (สำหรับทดลองใช้เท่านั้น — อย่าใช้กับระบบจริง) |
| `RAG_LINE_CHANNEL_TOKEN` + `RAG_LINE_TO` | — | แจ้งเตือนผ่าน **LINE Messaging API** (แนะนำ) |
| `RAG_LINE_TOKEN` | — | LINE Notify แบบเดิม (บริการปิดแล้ว — ใช้เฉพาะระบบที่ยังรองรับ) |
| `RAG_WEBHOOK_URL` | — | ส่งเข้า Webhook ทั่วไป (Email Gateway / Teams / ระบบภายใน) |
| `RAG_LOG` | — | ตั้งเป็น `off` เพื่อปิด log ราย request |

ค่าทั้งหมดอ่านจากไฟล์ `.env` ที่โฟลเดอร์หลัก (ดูตัวอย่างใน `.env.example`) — ไฟล์นี้ถูกกันไม่ให้ขึ้น Git แล้ว

### การบูตครั้งแรก

ถ้าฐานข้อมูลยังว่าง ระบบจะสร้างบัญชี `admin` ให้อัตโนมัติ แล้วพิมพ์รหัสผ่านออกทาง log **ครั้งเดียว**
ถ้าไม่ได้ตั้ง `RAG_ADMIN_PASSWORD` ไว้ ให้ดูรหัสจาก log แล้วเข้าไปเปลี่ยนทันที

```bash
sudo journalctl -u rag -n 30      # ดูรหัสผ่านที่ระบบสุ่มให้
```

การบูตครั้งถัดไประบบจะไม่แตะข้อมูลเดิม (ตรวจจากตาราง `users` ว่ามีคนอยู่แล้วหรือยัง)

## 2.5 ตั้งค่าครั้งแรก

```bash
cp .env.example .env          # แล้วใส่ DATABASE_URL กับ RAG_ADMIN_PASSWORD
npm ci
npm run check                 # ตรวจว่าต่อฐานข้อมูลได้ (บอกวิธีแก้ถ้าพลาด)
npm run migrate               # สร้างตาราง/view/index บน Supabase (รันซ้ำได้ ไม่ลบข้อมูล)
npm start
```

> **ต่อไม่ได้ / ขึ้น `ENOTFOUND db.<ref>.supabase.co`?**
> โปรเจกต์ Supabase ที่สร้างใหม่ส่วนใหญ่ไม่เปิดให้ต่อตรงผ่าน IPv4
> ให้ใช้ **Connection Pooler** แทน — Dashboard → ปุ่ม Connect → Session pooler แล้วคัดลอก URI มาใช้

ต้องการข้อมูลตัวอย่างสำหรับทดลองใช้ (อย่าใช้กับระบบจริง):

```bash
RAG_SEED=demo npm start
```

## 2.6 ทางเลือก: รันด้วย Docker

ไม่ต้อง mount ดิสก์ใด ๆ เพราะข้อมูลอยู่บน Supabase:

```bash
docker build -t deleaf-wms .
docker run -d --name rag --restart unless-stopped -p 80:8080 \
  -e DATABASE_URL='postgresql://postgres:<รหัสผ่าน>@db.<ref>.supabase.co:5432/postgres' \
  -e RAG_ADMIN_PASSWORD='ตั้งรหัสผ่านที่ปลอดภัย' \
  deleaf-wms
```

## 2.7 สำรองข้อมูล

Supabase สำรองข้อมูลให้อัตโนมัติทุกวัน (แพ็กเกจ Pro ย้อนเวลาได้แบบ Point-in-Time)
ถ้าต้องการสำรองเก็บไว้เองเพิ่ม:

```bash
pg_dump "$DATABASE_URL" -Fc -f rag-$(date +%F).dump
```

> การกู้คืนควรทดลองอย่างน้อยปีละครั้ง — ไฟล์สำรองที่กู้ไม่ได้ ไม่ต่างจากไม่มีไฟล์สำรอง

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
EnvironmentFile=/opt/rag/.env          # มี DATABASE_URL อยู่ข้างใน (chmod 600)
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

ควรวาง Nginx/Caddy ไว้ด้านหน้าเพื่อทำ **HTTPS** — จำเป็นสำหรับ Service Worker (Offline Mode) และการใช้กล้องมือถือสแกนบาร์โค้ด

## 4. สำรองข้อมูล (NFR-06) และกู้คืน (NFR-07)

Supabase สำรองข้อมูลอัตโนมัติให้ทุกวัน และแพ็กเกจ Pro กู้คืนย้อนเวลาได้ (Point-in-Time Recovery)
จึงตอบ **RPO ≤ 1 ชั่วโมง** ตาม NFR-07 ได้โดยไม่ต้องตั้ง cron เอง

เพิ่มสำเนาไว้นอก Supabase (แนะนำ):

```bash
# ตั้งใน crontab เวลา 22:30 น. — เก็บย้อนหลัง 90 วัน
pg_dump "$DATABASE_URL" -Fc -f /backup/rag-$(date +\%F).dump
find /backup -name 'rag-*.dump' -mtime +90 -delete
```

- **RTO ≤ 4 ชั่วโมง** — เตรียมสคริปต์กู้คืน (`pg_restore`) และซ้อมกู้คืนอย่างน้อยปีละครั้ง

## 5. หมายเหตุการย้ายจาก SQLite (ทำเสร็จแล้ว)

ระบบเคยใช้ SQLite และย้ายมาเป็น PostgreSQL/Supabase เรียบร้อยแล้ว สิ่งที่เปลี่ยนไปและควรรู้:

| เดิม (SQLite) | ปัจจุบัน (PostgreSQL) |
|--------|-----------|
| `INTEGER PRIMARY KEY AUTOINCREMENT` | `INTEGER GENERATED BY DEFAULT AS IDENTITY` |
| `TEXT` (วันเวลา) | `TIMESTAMP` / `DATE` |
| `datetime('now','localtime')` | `(now() AT TIME ZONE 'Asia/Bangkok')` |
| `julianday(a) - julianday(b)` | `(a::date - b::date)` |
| `LIKE` (ไม่สนตัวพิมพ์) | `ILIKE` |
| Trigger `RAISE(ABORT)` | Trigger + `RAISE EXCEPTION` |
| `GROUP BY` แบบหลวม | ต้องระบุคอลัมน์ให้ครบ หรือ group ด้วย Primary Key |

`all/get/run/tx` ใน `server/lib/db.js` ยังใช้ชื่อเดิมและรับ placeholder `?` เหมือนเดิม
(แปลงเป็น `$1 $2` ให้อัตโนมัติ) แต่ **เปลี่ยนเป็น async ทั้งหมด** — เวลาเพิ่มโค้ดใหม่อย่าลืม `await`

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
