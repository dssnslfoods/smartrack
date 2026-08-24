# Traceability Matrix — SRS ↔ การพัฒนา ↔ การทดสอบ

สถานะ: ✅ พัฒนาและทดสอบแล้ว · 🟡 พัฒนาแล้ว รอตรวจรับ/ข้อมูลจริง · ⬜ ยังไม่พัฒนา (ดูเหตุผลใน [OPEN_ISSUES.md](OPEN_ISSUES.md))

## Functional Requirements

| FR | ข้อกำหนด | สถานะ | ไฟล์ที่พัฒนา | การทดสอบ |
|----|---------|:-----:|-------------|----------|
| FR-01.1 | จัดการ Zone | ✅ | `api/routes.js` (`/api/zones`) | ทดสอบผ่าน UI + กฎห้ามลบโซนที่มีสินค้า |
| FR-01.2 | สร้าง RAG + Generate Location อัตโนมัติ | ✅ | `services/locations.js` | AC-02 (4×6 → 24 ตำแหน่ง, รหัสถูกต้อง) |
| FR-01.3 | SKU Master (+ ช่อง `erp_item_id`) | ✅ | `api/routes.js` (`/api/skus`) | ทดสอบผ่าน UI |
| FR-02.1 | บันทึกรับเข้า (บังคับ Lot + วันหมดอายุ) | ✅ | `services/operations.js` | AC-03 (ไม่ใส่ Lot → 400) |
| FR-02.2 | แนะนำตำแหน่งจัดเก็บ | ✅ | `services/suggest.js` | AC-03 (โซนตรง, ชั้นล่างก่อน, ตัดตำแหน่งที่ถูกขวาง) |
| FR-02.3 | ยืนยันจัดเก็บด้วยการสแกน 2 ชั้น | ✅ | `views/operations.js` + `confirmPutaway()` | AC-03 (สถานะ → OCCUPIED, วางซ้ำ → 409) |
| FR-03.1 | ค้นหาสินค้า (Product Locator) | ✅ | `services/search.js` | AC-01 (< 1 วินาที, เรียง FEFO) |
| FR-03.2 | ลำดับการหยิบ + เตือนพาเลทขวาง | ✅ | `pickSequence()` | AC-04 |
| FR-03.3 | ยืนยันการหยิบ + FEFO ต้องมีเหตุผล | ✅ | `confirmPicking()` | AC-04 (`FEFO_VIOLATION`) |
| FR-04.1 | ย้ายตำแหน่ง + ตรวจสอบเงื่อนไข | ✅ | `transferPallet()` | ทดสอบ: ถูกขวาง → ปฏิเสธ, ปกติ → อัปเดต 2 ตำแหน่ง |
| FR-05.1 | แผนผัง RAG + Color Coding | ✅ | `services/locations.js → rackMap()`, `views/map.js` | AC-05 |
| FR-05.2 | ภาพรวมคลัง + Drill-Down | ✅ | `reports.js → warehouseOverview()` | ทดสอบผ่าน UI |
| FR-06.1 | รายงานสินค้าคงคลัง + Export | ✅ | `reports.js`, `csvExports` | ทดสอบ CSV + BOM ภาษาไทย |
| FR-06.2 | Aging & Expiry Alert + แจ้งเตือน | ✅ | `reports.js`, `notify.js` | AC-06 (จัดกลุ่ม 3 ระดับ, ส่งแจ้งเตือน) |
| FR-06.3 | Utilization + Trend | ✅ | `utilizationReport()`, `snapshotUtilization()` | AC-10 (สูตรถูกต้อง) |
| FR-07.1 | Transaction History (Immutable) | ✅ | `schema.sql` Trigger, `listTransactions()` | AC-08 (ลบไม่ได้, กลับรายการได้ครั้งเดียว) |
| FR-07.2 | Cycle Count + อนุมัติผลต่าง | ✅ | `services/cyclecount.js` | AC-07 (Operator อนุมัติไม่ได้ → Manager อนุมัติ → สต็อกถูกปรับ) |
| FR-08.1 | ป้ายตำแหน่ง 5×3 ซม. | ✅ | `services/labels.js` | AC-09 (Code-128 + QR ใน HTML สำหรับพิมพ์) |
| FR-08.2 | ป้ายพาเลท 10×7 ซม. | ✅ | `services/labels.js` | AC-09 |
| FR-09 | ผู้ใช้และสิทธิ์ 4 บทบาท | ✅ | `lib/auth.js` | ทดสอบ RBAC ทุกบทบาท |
| FR-10.1 | Global Search + สแกนบาร์โค้ด | ✅ | `globalSearch()`, `views/app.js` | AC-01 |

## Non-Functional Requirements

| NFR | ข้อกำหนด | สถานะ | หมายเหตุ |
|-----|---------|:-----:|---------|
| NFR-01 | ค้นหา < 1 วินาที | ✅ | วัดได้ < 10 ms ที่ ~130 พาเลท · ต้องวัดซ้ำที่ 500+ พาเลทตาม AC-01 |
| NFR-02 | แผนผังโหลด < 3 วินาที | ✅ | 1 query ต่อ RAG + render ฝั่ง Client |
| NFR-03 | 10–20 ผู้ใช้พร้อมกัน | 🟡 | สถาปัตยกรรมรองรับ · ต้องทดสอบ Load ก่อน Go-Live (SQLite WAL รองรับได้ในระดับนี้, PostgreSQL รองรับสูงกว่า) |
| NFR-04 | Transaction < 2 วินาที | ✅ | ทุกรายการเป็น atomic write เดียว |
| NFR-05 | Uptime 99.5% | ⬜ | ขึ้นกับการติดตั้ง Production — ดู [DEPLOYMENT.md](DEPLOYMENT.md) |
| NFR-06 | Backup ทุกวัน เก็บ 90 วัน | 🟡 | มีสคริปต์แนะนำใน DEPLOYMENT.md ต้องตั้ง cron บนเครื่องจริง |
| NFR-07 | DR: RTO ≤ 4 ชม., RPO ≤ 1 ชม. | ⬜ | ต้องกำหนดร่วมกับฝ่าย IT (ความถี่ backup + เครื่องสำรอง) |
| NFR-08 | ภาษาไทยเป็นหลัก | ✅ | ทุกเมนู/ข้อความ/ข้อผิดพลาดเป็นภาษาไทย |
| NFR-09 | รองรับ Tablet / Handheld / PC | ✅ | Responsive + ช่องสแกนรองรับ Handheld (พิมพ์เร็ว + Enter) |
| NFR-10 | เรียนรู้ได้ใน 2 ชั่วโมง | 🟡 | UI ออกแบบให้ขั้นตอนน้อยที่สุด · ต้องวัดจริงตอนอบรม |
| NFR-11 | Offline Mode (ค้นหา + แผนผัง) | ✅ | Service Worker แคชข้อมูลอ่านอย่างเดียว + แถบเตือน |
| NFR-12 | Login ด้วยรหัสผ่านหรือ PIN | ✅ | scrypt hash ทั้งคู่ |
| NFR-13 | RBAC | ✅ | ตรวจที่ API ทุกเส้น |
| NFR-14 | Audit Log ลบ/แก้ไม่ได้ | ✅ | DB Trigger |
| NFR-15 | ERP Integration (REST) | 🟡 | API พร้อมและมีช่อง `erp_item_id` · ตัว Connector รอสรุปว่าจะใช้ ERP ตัวใด |
| NFR-16 | Barcode Code-128 / EAN-13 / QR | ✅ | ป้ายใช้ Code-128 + QR · ช่องสแกนรับได้ทุกรูปแบบรวม EAN-13 |
| NFR-17 | LINE Notify + Email | 🟡 | LINE พร้อมใช้เมื่อใส่ Token · **LINE Notify ปิดบริการ 31 มี.ค. 2568** ดู OPEN_ISSUES |

## Use Cases

| UC | สถานะ | เส้นทางในระบบ |
|----|:-----:|---------------|
| UC-01 ค้นหาสินค้า | ✅ | ค้นหา → คลิกตำแหน่ง → แผนผัง RAG (Highlight) → ไปหน้าหยิบ · มี Alternative Flow ทั้งไม่พบสินค้าและกรณีถูกขวาง |
| UC-02 รับเข้าและจัดเก็บ | ✅ | รับเข้า → แนะนำตำแหน่ง → สแกน 2 ชั้น → พิมพ์ป้ายพาเลท |
| UC-03 หยิบสินค้าออก | ✅ | เลือกสินค้า/สแกนพาเลท → ลำดับ FEFO → สแกนยืนยัน · ถูกขวาง → ลิงก์ไปหน้าย้าย |
| UC-04 ย้ายตำแหน่ง | ✅ | สแกนต้นทาง → ตรวจสอบ 4 เงื่อนไข → ยืนยัน |

## Acceptance Criteria (SRS §10)

| AC | เกณฑ์ | ผลทดสอบอัตโนมัติ |
|----|------|------------------|
| AC-01 | ค้นหาพบตำแหน่งภายใน 1 วินาที | ✅ ผ่าน (ต้องทดสอบซ้ำกับข้อมูลจริง 500+ พาเลทตอน UAT) |
| AC-02 | สร้าง RAG 4L × 6D → 24 ตำแหน่ง | ✅ ผ่าน |
| AC-03 | Putaway ครบวงจร | ✅ ผ่าน |
| AC-04 | Picking ตาม FEFO | ✅ ผ่าน |
| AC-05 | Color Coding ถูกต้อง | ✅ ผ่าน |
| AC-06 | แจ้งเตือนสินค้าใกล้หมดอายุ | ✅ ผ่าน (งานประจำวันตั้งไว้ 07:00 น.) |
| AC-07 | Cycle Count ต้องอนุมัติก่อนปรับ | ✅ ผ่าน |
| AC-08 | Transaction Log ครบและลบไม่ได้ | ✅ ผ่าน |
| AC-09 | ป้าย Barcode / QR | ✅ ผ่าน (ต้องทดสอบยิงจริงกับเครื่องสแกนรุ่นที่ใช้) |
| AC-10 | Utilization ถูกต้อง + Trend | ✅ ผ่าน |

รันทดสอบ: `npm test` — 26 เคส ผ่านทั้งหมด
