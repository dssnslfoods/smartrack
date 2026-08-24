# RAG Management System — ระบบบริหารจัดการชั้นวางสินค้า

ระบบบริหารจัดการตำแหน่งจัดเก็บสินค้าในคลัง (Zone → RAG → Level → Depth) สำหรับ **De Leaf (EVERYDAYHAPPY CO., LTD.)**
พัฒนาตามเอกสาร `SRS-RAG-001 v1.0` ภายใต้โครงการ **EHOS — Everyday Happy Operating System**

---

## เริ่มใช้งานใน 3 คำสั่ง

```bash
npm install
npm run seed
npm start
```

เปิด <http://localhost:4000>

| บัญชีทดสอบ | รหัสผ่าน | PIN | บทบาท |
|---|---|---|---|
| `admin` | `admin123` | 9999 | ผู้ดูแลระบบ — ข้อมูลหลัก, ผู้ใช้, ทุกฟังก์ชัน |
| `manager` | `manager123` | 1234 | หัวหน้าคลัง — อนุมัติผลนับสต็อก, Override ตำแหน่ง, รายงาน |
| `operator` | `operator123` | 1111 | พนักงานคลัง — รับเข้า / หยิบ / ย้าย / นับสต็อก |
| `viewer` | `viewer123` | — | ผู้ดูข้อมูล (Read-only) |

คำสั่งอื่น ๆ

```bash
npm test      # ทดสอบตาม Acceptance Criteria ใน SRS §10 (26 เคส)
npm run reset # ล้างฐานข้อมูลและสร้างข้อมูลตัวอย่างใหม่
npm run dev   # โหมดพัฒนา (auto-reload)
```

---

## ระบบนี้แก้ Pain Point อย่างไร

| Pain Point (SRS §1.3) | สิ่งที่ระบบทำ |
|---|---|
| **P1** ไม่รู้ว่าสินค้าอยู่ RAG ไหน | ช่องค้นหากลาง — พิมพ์/สแกนแล้วเห็นตำแหน่งทันที (`Zone-RAG-Level-Depth`) พร้อมลิงก์ไปแผนผัง |
| **P2** ชั้นสูง/ลึก มองไม่เห็น | แผนผัง 2 มิติ (ชั้น × ความลึก) แสดงของทุกช่องพร้อมสี และเตือน "ต้องใช้รถยก" เมื่อชั้น > L1 |
| **P3** ไม่รู้ว่า RAG ไหนว่าง/เต็ม | ภาพรวมคลังแบบ Bird-Eye + Utilization รายโซน/ราย RAG + กราฟแนวโน้ม 30 วัน |
| **P4** ไม่มีประวัติเข้า-ออก | ทุกการเคลื่อนไหวบันทึกเป็น Transaction ที่ **ลบและแก้ไขไม่ได้** (บังคับด้วย DB Trigger) แก้ไขได้ด้วยการกลับรายการเท่านั้น |
| **P5** ไม่เป็น FIFO/FEFO สินค้าหมดอายุ | ผลค้นหาและลำดับการหยิบเรียงตาม FEFO เสมอ · หยิบผิดลำดับต้องระบุเหตุผล · แจ้งเตือนสินค้าใกล้หมดอายุทุกเช้า |

**นอกเหนือจาก SRS ที่เพิ่มให้ตามข้อจำกัดจริงของ Drive-In Rack:** ระบบตรวจ "การถูกขวาง" — ตำแหน่งที่ลึกกว่าจะเข้าถึงไม่ได้
ถ้าช่องด้านหน้ามีพาเลทอยู่ ระบบจึงไม่แนะนำให้วาง และเตือนก่อนหยิบว่าต้องย้ายพาเลทตัวไหนออกก่อน

---

## ฟังก์ชันหลัก (อ้างอิง SRS §4)

| FR | ฟังก์ชัน | หน้าจอ |
|----|---------|--------|
| FR-01 | ข้อมูลหลัก: Zone / RAG / SKU — สร้าง RAG แล้ว **Generate รหัสตำแหน่งอัตโนมัติ** (4×6 = 24 ตำแหน่ง) | ข้อมูลหลัก & ผู้ใช้ |
| FR-02 | รับเข้า → แนะนำตำแหน่ง → ยืนยันด้วยการสแกน 2 ชั้น (Location + Pallet) | รับเข้า & จัดเก็บ |
| FR-03 | ค้นหาสินค้า · ลำดับการหยิบตาม FEFO · ยืนยันการหยิบ | ค้นหาสินค้า / หยิบสินค้าออก |
| FR-04 | ย้ายตำแหน่ง พร้อมตรวจ ว่าง/ถูกขวาง/โซน/น้ำหนัก | ย้ายตำแหน่ง |
| FR-05 | แผนผัง RAG แบบ Real-Time + ภาพรวมคลังทั้งหมด | แผนผังคลังสินค้า |
| FR-06 | รายงานสินค้าคงคลัง · Aging/Expiry Alert · Utilization + Export CSV | รายงาน |
| FR-07 | ประวัติ Transaction (Immutable) · Cycle Count + อนุมัติผลต่าง | ประวัติ / นับสต็อก |
| FR-08 | พิมพ์ป้ายตำแหน่ง 5×3 ซม. และป้ายพาเลท 10×7 ซม. (Code-128 + QR) | ข้อมูลหลัก → พิมพ์ป้าย |
| FR-09 | ผู้ใช้และสิทธิ์ 4 บทบาท (Login ด้วยรหัสผ่านหรือ PIN) | ข้อมูลหลัก → ผู้ใช้ |
| FR-10 | ช่องค้นหากลาง รองรับสแกนบาร์โค้ด ตอบใน < 1 วินาที | ทุกหน้า (แถบบน) |

---

## โครงสร้างโปรเจกต์

```
RAG/
├── server/
│   ├── index.js              HTTP server + routing + งานประจำวัน (snapshot/alert)
│   ├── schema.sql            โครงสร้างฐานข้อมูล + Trigger ป้องกันการแก้ไขประวัติ
│   ├── seed.js               ข้อมูลตัวอย่างสำหรับทดสอบ/UAT
│   ├── api/routes.js         REST API ทั้งหมด (แมปกับ FR)
│   ├── lib/                  db · http · auth (RBAC, session, audit)
│   └── services/             ตรรกะธุรกิจ: locations · suggest · search · operations
│                             · cyclecount · reports · labels · notify
├── public/                   Web App (PWA) ภาษาไทย — ไม่มี build step
│   ├── js/views/             หน้าจอแต่ละหน้า
│   └── sw.js                 Service Worker (Offline Mode)
├── test/api.test.js          ทดสอบตาม Acceptance Criteria
├── docs/                     สถาปัตยกรรม · API · Traceability · แผนขึ้น Production
└── data/rag.db               ฐานข้อมูล SQLite (สร้างอัตโนมัติ)
```

## เอกสารประกอบ

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — สถาปัตยกรรม, Data Model, กฎธุรกิจ, ความปลอดภัย
- [docs/API.md](docs/API.md) — REST API Reference
- [docs/TRACEABILITY.md](docs/TRACEABILITY.md) — SRS ↔ โค้ด ↔ ผลทดสอบ (ครบทุก FR/NFR/AC)
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — ขึ้น Production, ย้ายไป PostgreSQL, เชื่อม ERP/Odoo, ฮาร์ดแวร์ที่ต้องจัดหา
- [docs/OPEN_ISSUES.md](docs/OPEN_ISSUES.md) — ประเด็นที่ต้องตัดสินใจร่วมกับ De Leaf ก่อนขึ้นระบบจริง

## เทคโนโลยี

Node.js 22 (ไม่มี framework ฝั่ง server) · SQLite (`node:sqlite`) ในระยะ Prototype → PostgreSQL ตอนขึ้น Production ·
Web App แบบ Vanilla JS + PWA (ไม่มี build step — แก้ไฟล์แล้วรีเฟรชได้ทันที เหมาะกับทีม IT ขนาดเล็ก) ·
`bwip-js` สำหรับ Barcode/QR บนป้าย
