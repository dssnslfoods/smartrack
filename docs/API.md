# REST API Reference

Base URL: `http://<host>:4000` · รูปแบบข้อมูล: JSON (UTF-8)
การยืนยันตัวตน: `Authorization: Bearer <token>` (ได้จาก `POST /api/auth/login`)

ข้อผิดพลาดคืนในรูปแบบ `{ "error": "ข้อความภาษาไทย", "code": "MACHINE_CODE" }`
โดย `code` ใช้ให้ฝั่ง Client ตัดสินใจ เช่น `FEFO_VIOLATION` → เปิดกล่องขอเหตุผล

| HTTP | ความหมาย |
|------|---------|
| 400 | ข้อมูลไม่ครบ/ไม่ถูกต้อง · 401 ยังไม่เข้าสู่ระบบ · 403 ไม่มีสิทธิ์ · 404 ไม่พบข้อมูล · 409 ขัดกับกฎธุรกิจ |

## Authentication
| Method | Endpoint | สิทธิ์ | คำอธิบาย |
|--------|----------|-------|---------|
| POST | `/api/auth/login` | — | `{username, password}` หรือ `{username, pin}` → `{token, user}` |
| POST | `/api/auth/logout` | view | ยกเลิก session ปัจจุบัน |
| GET | `/api/auth/me` | view | ข้อมูลผู้ใช้และสิทธิ์ |

## Dashboard & Search
| Method | Endpoint | สิทธิ์ | คำอธิบาย |
|--------|----------|-------|---------|
| GET | `/api/dashboard` | view | KPI, แจ้งเตือน, รายการล่าสุด, แนวโน้ม |
| GET | `/api/search?q=` | view | ค้นหารวม (สินค้า/ตำแหน่ง/RAG) — FR-10.1 |
| GET | `/api/stock?q=&zone_id=&rag_id=&limit=` | view | ค้นหาสินค้าในคลัง เรียงตาม FEFO พร้อม `blocked_by` — FR-03.1 |

## Master Data (FR-01)
| Method | Endpoint | สิทธิ์ |
|--------|----------|-------|
| GET/POST | `/api/zones` · PUT/DELETE `/api/zones/:id` | view / master:write |
| GET/POST | `/api/rags` · PUT `/api/rags/:id` | view / master:write |
| GET | `/api/rags/:id/map` | view — แผนผังชั้น × ความลึก (FR-05.1) |
| GET | `/api/overview` | view — ภาพรวมทุกโซน/ทุก RAG (FR-05.2) |
| GET | `/api/locations/:code` | view — รายละเอียดตำแหน่ง + พาเลท + ตัวขวาง + ประวัติ |
| PATCH | `/api/locations/:id` | master:write — เปิด/ปิดใช้งานตำแหน่ง |
| GET/POST | `/api/skus?q=` · PUT `/api/skus/:id` | view / master:write |

> `POST /api/rags` และการแก้จำนวนชั้น/ตอน จะ Generate รหัสตำแหน่งอัตโนมัติ และคืน `{created, removed, total}`

## Putaway (FR-02)
| Method | Endpoint | สิทธิ์ | หมายเหตุ |
|--------|----------|-------|---------|
| POST | `/api/inbound` | txn:write | `{sku_id, lot_no*, exp_date*, mfg_date, quantity, pallet_count, supplier, reference_doc}` |
| GET | `/api/putaway/pending` | view | พาเลทที่รอจัดเก็บ |
| GET | `/api/putaway/suggest?sku_id=&weight_kg=&limit=` | view | ตำแหน่งแนะนำพร้อม `score` และ `reasons` |
| POST | `/api/putaway/confirm` | txn:write | `{pallet_barcode, location_code, override?, remarks?}` |

## Picking (FR-03)
| Method | Endpoint | สิทธิ์ |
|--------|----------|-------|
| GET | `/api/picking/sequence?sku_id=&qty=` | view — ลำดับการหยิบ + คำเตือน |
| POST | `/api/picking/confirm` | txn:write — `{pallet_barcode, location_code, reason?, order_line_id?}` |
| GET/POST | `/api/pick-orders` · GET `/api/pick-orders/:id` | view / txn:write |

## Transfer & Adjustment (FR-04, FR-07)
| Method | Endpoint | สิทธิ์ |
|--------|----------|-------|
| POST | `/api/transfer` | txn:write — `{pallet_barcode หรือ from_location_code, to_location_code, override?}` |
| POST | `/api/adjust` | txn:write — `{pallet_barcode, quantity?, status?, reason*}` |
| GET | `/api/pallets/:barcode` | view — ข้อมูลพาเลท + ประวัติ |
| GET | `/api/transactions?type=&q=&from=&to=&limit=` | view |
| POST | `/api/transactions/:id/reverse` | txn:write — `{reason*}` (ใช้แทนการลบ) |
| GET | `/api/audit-logs?limit=` | report:view |

## Reports (FR-06)
| Method | Endpoint | สิทธิ์ |
|--------|----------|-------|
| GET | `/api/reports/inventory?zone_id=&rag_id=&sku_id=&lot_no=&exp_from=&exp_to=` | report:view |
| GET | `/api/reports/aging?days=90` | report:view |
| GET | `/api/reports/utilization` | report:view |
| GET | `/api/reports/trend?scope=WAREHOUSE&ref_id=0&days=30` | report:view |
| POST | `/api/reports/snapshot` | report:view |
| POST | `/api/alerts/send` | report:view — ส่งแจ้งเตือน LINE/บันทึก log |
| GET | `/api/reports/{inventory\|aging\|utilization\|transactions}.csv` | report:view — Export (UTF-8 BOM สำหรับ Excel) |

## Cycle Count (FR-07.2)
| Method | Endpoint | สิทธิ์ |
|--------|----------|-------|
| GET/POST | `/api/cycle-counts` | view / cc:count — `{scope_type: ZONE\|RAG, zone_id\|rag_id, note}` |
| GET | `/api/cycle-counts/:id` | view — ใบนับ + รายการ + ผลต่าง |
| POST | `/api/cycle-counts/:id/lines` | cc:count — `{line_id, counted_barcode, counted_qty, remark}` |
| POST | `/api/cycle-counts/:id/submit` | cc:count |
| POST | `/api/cycle-counts/:id/approve` \| `/reject` | cc:approve (MANAGER/ADMIN) |

## Users & Labels (FR-09, FR-08)
| Method | Endpoint | สิทธิ์ |
|--------|----------|-------|
| GET/POST | `/api/users` · PUT `/api/users/:id` | user:manage |
| GET | `/api/labels/pallets` | label:print |
| GET | `/labels/location?rag_id=` หรือ `?ids=1,2,3` | label:print — คืนหน้า HTML สำหรับสั่งพิมพ์ |
| GET | `/labels/pallet?ids=1,2,3` | label:print |

## ตารางสิทธิ์ (FR-09)

| สิทธิ์ | ADMIN | MANAGER | OPERATOR | VIEWER |
|-------|:-----:|:-------:|:--------:|:------:|
| `view` / `report:view` | ✔ | ✔ | ✔ | ✔ |
| `txn:write` (รับเข้า/หยิบ/ย้าย/ปรับปรุง) | ✔ | ✔ | ✔ | — |
| `cc:count` (นับสต็อก) | ✔ | ✔ | ✔ | — |
| `cc:approve` (อนุมัติผลต่าง) | ✔ | ✔ | — | — |
| `override:location` (ข้ามข้อจำกัดตำแหน่ง) | ✔ | ✔ | — | — |
| `label:print` | ✔ | ✔ | ✔ | — |
| `master:write` (Zone/RAG/SKU) | ✔ | — | — | — |
| `user:manage` | ✔ | — | — | — |
