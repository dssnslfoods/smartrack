# De Leaf WMS — Warehouse Management System

## Project Overview

ระบบ WMS สำหรับบริษัท De Leaf (EVERYDAYHAPPY CO., LTD.) ผู้ผลิตเครื่องสำอาง/สกินแคร์แบรนด์ "de leaf thanaka"
เป็นส่วนหนึ่งของโครงการ EHOS (Everyday Happy Operating System)

## Tech Stack

- **Frontend:** Next.js 14+ (App Router) + TypeScript + Tailwind CSS + shadcn/ui
- **Backend:** Next.js API Routes (Route Handlers)
- **Database:** PostgreSQL + Prisma ORM
- **Auth:** NextAuth.js (Credentials provider — username/password + PIN)
- **Barcode:** react-barcode (generate) + html5-qrcode (scan via camera)
- **Real-time:** Server-Sent Events (SSE) สำหรับ Visual Map update
- **Notification:** LINE Notify API + Nodemailer (SMTP)
- **Language:** UI ภาษาไทยเป็นหลัก, Code/variables ภาษาอังกฤษ

## Key Business Rules

1. **1 Location = 1 Pallet** — แต่ละตำแหน่ง RAG จัดวางได้สูงสุด 1 พาเลทไม้
2. **Location Code Format:** `{Zone}-{RAG No.}-L{Level}-D{Depth}` เช่น `FG-A01-L2-D3`
3. **Lot/Batch + วันหมดอายุ = บังคับ** — สินค้าเครื่องสำอางต้องมีเสมอ
4. **FEFO (First Expired, First Out)** — เรียงการหยิบตามวันหมดอายุใกล้สุดก่อน
5. **Drive-In Rack** — D1 (หน้าสุด) เข้าถึงได้โดยตรง, D2+ ต้องย้าย D1 ออกก่อน
6. **Zone Types:** RM (Raw Material), FG (Finished Goods), PK (Packaging), QR (Quarantine)
7. **Transactions ลบไม่ได้** — แก้ไขด้วย Reverse Transaction เท่านั้น

## Database Schema Overview

Core tables (see prisma/schema.prisma for full definition):
- `zones` — โซนคลังสินค้า (RM, FG, PK, QR)
- `rags` — ชั้นวางสินค้า (RAG) พร้อมจำนวน level/depth
- `locations` — ตำแหน่งจัดเก็บ (auto-generated จาก RAG)
- `skus` — ข้อมูลสินค้า
- `pallets` — พาเลท (ผูกกับ SKU + Lot + Location)
- `transactions` — ประวัติทุกการเคลื่อนไหว (PUTAWAY/PICKING/TRANSFER/ADJUSTMENT/CYCLE_COUNT)
- `users` — ผู้ใช้งาน (roles: ADMIN/WAREHOUSE_MANAGER/OPERATOR/VIEWER)

## Auto-Generation Rule

เมื่อสร้าง RAG ใหม่ (เช่น RAG-A01, Zone: FG, 4 Levels, 6 Depths):
→ ระบบต้อง auto-generate 24 location records:
  FG-A01-L1-D1, FG-A01-L1-D2, ..., FG-A01-L4-D6

## Putaway Suggestion Logic (ลำดับแนะนำตำแหน่งจัดเก็บ)

1. ค้นหาตำแหน่งว่างใน Zone ที่ตรงกับ SKU
2. ถ้า Same SKU มีอยู่แล้ว → แนะนำ RAG เดียวกัน (group)
3. จัดลำดับ: ชั้นล่างก่อน (L1→L4), ลึกที่สุดก่อน (D6→D1)
4. ตรวจสอบ Max Weight ต่อชั้น

## Visual Map Color Coding

- 🟢 EMPTY (ว่าง) — `#22c55e`
- 🔵 OCCUPIED (มีสินค้า) — `#3b82f6`
- 🟡 NEAR_EXPIRY (เหลือ <90 วัน) — `#eab308`
- 🔴 EXPIRED (หมดอายุ) — `#ef4444`
- ⬜ DISABLED (ปิดใช้งาน) — `#9ca3af`

## File Structure

```
src/app/
├── (auth)/login/          # Login page
├── dashboard/             # Main dashboard
├── rag/                   # RAG Management
│   ├── zones/             # Zone CRUD
│   ├── racks/             # RAG CRUD + auto-generate locations
│   ├── locations/         # Location list + status
│   └── visual-map/        # Visual Map (Grid view)
├── inbound/               # รับเข้า
│   ├── putaway/           # Putaway (scan + suggest location)
│   └── receiving/         # Goods Receiving (GRN)
├── outbound/              # จ่ายออก
│   ├── picking/           # Picking (search + FEFO + scan confirm)
│   └── transfer/          # Transfer between locations
├── inventory/             # สินค้าคงคลัง
│   ├── search/            # Global Search (by SKU/Lot/Location)
│   ├── cycle-count/       # Cycle Count
│   └── reports/           # Reports (Aging, Utilization, History)
├── master/                # Master Data
│   ├── skus/              # SKU Master
│   └── suppliers/         # Supplier Master
└── settings/              # Settings
    └── users/             # User Management + Roles
```

## API Route Pattern

```
src/app/api/
├── zones/                 # GET (list), POST (create)
│   └── [id]/              # GET, PUT, DELETE
├── rags/                  # GET, POST (→ auto-generate locations)
│   └── [id]/              # GET, PUT, DELETE
├── locations/             # GET (filter by zone/rag/status)
│   └── [id]/              # GET, PATCH (status)
├── skus/                  # GET, POST
│   └── [id]/              # GET, PUT
├── pallets/               # GET, POST
│   └── [id]/              # GET, PATCH
├── putaway/               # POST (confirm putaway)
│   └── suggest/           # GET ?sku_id= (location suggestions)
├── picking/               # POST (confirm picking)
│   └── search/            # GET ?q= (product locator — FEFO sorted)
├── transfer/              # POST (confirm transfer)
├── transactions/          # GET (history, filterable)
├── cycle-count/           # GET, POST
│   └── [id]/approve/      # POST
├── reports/
│   ├── utilization/       # GET
│   ├── aging/             # GET
│   └── expiry-alerts/     # GET
└── auth/[...nextauth]/    # NextAuth
```

## UI Guidelines

- ใช้ภาษาไทยทุก label/button/message ในหน้าจอ
- ศัพท์เทคนิคใช้ภาษาอังกฤษ: SKU, Lot, Barcode, Location Code, FIFO, FEFO
- ใช้ shadcn/ui components: Button, Card, Table, Dialog, Input, Select, Badge, Toast
- Responsive: ต้องใช้งานได้ดีบน Tablet (8-10 นิ้ว) และ PC Desktop
- Barcode Scanner: ต้องรองรับทั้ง Handheld USB Scanner และ Camera Scan (mobile/tablet)
- Search ต้องเร็ว — แสดงผลภายใน 1 วินาที

## Important Notes

- นี่คือ SME ไทย — ไม่ต้อง over-engineer, เน้นใช้งานง่าย เรียนรู้เร็ว
- ทุก Transaction ต้อง log ใน transactions table (ลบไม่ได้)
- สินค้าเครื่องสำอาง: Shelf Life สำคัญมาก (ครีม ~2-3 ปี, สบู่ ~3 ปี)
- อนาคตจะ Integrate กับ Odoo ERP — ออกแบบ API ให้พร้อม
