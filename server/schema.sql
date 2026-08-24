-- ============================================================
-- ระบบบริหารจัดการชั้นวางสินค้า (RAG) — โครงสร้างฐานข้อมูล
-- แนวคิด: ตำแหน่งจัดเก็บ 1 ช่อง เก็บสินค้าได้ 1 รายการ
--         ทุกการเคลื่อนย้ายถูกบันทึกเป็นประวัติที่ลบไม่ได้
-- ============================================================
PRAGMA foreign_keys = ON;

-- ---------- ผู้ใช้งาน ----------
CREATE TABLE IF NOT EXISTS users (
  user_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  full_name     TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('ADMIN','STAFF','VIEWER')),
  password_hash TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(user_id),
  expires_at TEXT NOT NULL
);

-- ---------- โครงสร้างคลัง: คลังสินค้า → โซน → ชั้นวาง (RACK) → ตำแหน่ง ----------
CREATE TABLE IF NOT EXISTS warehouses (
  warehouse_id INTEGER PRIMARY KEY AUTOINCREMENT,
  wh_code      TEXT NOT NULL UNIQUE,
  wh_name      TEXT NOT NULL,
  address      TEXT,
  grid_cols    INTEGER NOT NULL DEFAULT 10 CHECK (grid_cols BETWEEN 1 AND 40),
  grid_rows    INTEGER NOT NULL DEFAULT 8  CHECK (grid_rows BETWEEN 1 AND 40),
  note         TEXT,
  status       TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS zones (
  zone_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  zone_code  TEXT NOT NULL UNIQUE,
  zone_name  TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS rags (
  rag_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  rag_no       TEXT NOT NULL UNIQUE,
  zone_id      INTEGER NOT NULL REFERENCES zones(zone_id),
  total_levels INTEGER NOT NULL CHECK (total_levels BETWEEN 1 AND 20),
  total_depths INTEGER NOT NULL CHECK (total_depths BETWEEN 1 AND 30),
  note         TEXT,
  status       TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS locations (
  location_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  location_code TEXT NOT NULL UNIQUE,          -- เช่น FG-A01-L2-D3
  rag_id        INTEGER NOT NULL REFERENCES rags(rag_id) ON DELETE CASCADE,
  level         INTEGER NOT NULL,              -- ชั้น (1 = ล่างสุด)
  depth         INTEGER NOT NULL,              -- ความลึก (1 = หน้าสุด)
  status        TEXT NOT NULL DEFAULT 'EMPTY' CHECK (status IN ('EMPTY','OCCUPIED','DISABLED')),
  UNIQUE (rag_id, level, depth)
);

-- ---------- สินค้า ----------
CREATE TABLE IF NOT EXISTS skus (
  sku_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  sku_code   TEXT NOT NULL UNIQUE,
  sku_name   TEXT NOT NULL,
  category   TEXT,
  unit       TEXT NOT NULL DEFAULT 'ชิ้น',
  barcode    TEXT,
  status     TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ---------- สินค้าที่จัดเก็บอยู่ในตำแหน่ง (1 ตำแหน่ง = 1 รายการ) ----------
CREATE TABLE IF NOT EXISTS stock_items (
  item_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  sku_id      INTEGER NOT NULL REFERENCES skus(sku_id),
  location_id INTEGER UNIQUE REFERENCES locations(location_id),   -- NULL = หยิบออกไปแล้ว
  lot_no      TEXT,
  exp_date    TEXT,
  quantity    INTEGER NOT NULL CHECK (quantity >= 0),
  note        TEXT,
  status      TEXT NOT NULL DEFAULT 'IN_STOCK' CHECK (status IN ('IN_STOCK','REMOVED')),
  stored_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ---------- ประวัติการเคลื่อนย้าย (ลบและแก้ไขไม่ได้) ----------
CREATE TABLE IF NOT EXISTS movements (
  movement_id      INTEGER PRIMARY KEY AUTOINCREMENT,
  movement_type    TEXT NOT NULL CHECK (movement_type IN ('STORE','REMOVE','MOVE','EDIT')),
  moved_at         TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  item_id          INTEGER REFERENCES stock_items(item_id),
  sku_id           INTEGER NOT NULL REFERENCES skus(sku_id),
  lot_no           TEXT,
  quantity         INTEGER,
  from_location_id INTEGER REFERENCES locations(location_id),
  to_location_id   INTEGER REFERENCES locations(location_id),
  user_id          INTEGER NOT NULL REFERENCES users(user_id),
  note             TEXT
);

CREATE TRIGGER IF NOT EXISTS trg_movement_no_update BEFORE UPDATE ON movements
BEGIN SELECT RAISE(ABORT, 'ประวัติการเคลื่อนย้ายแก้ไขไม่ได้'); END;
CREATE TRIGGER IF NOT EXISTS trg_movement_no_delete BEFORE DELETE ON movements
BEGIN SELECT RAISE(ABORT, 'ประวัติการเคลื่อนย้ายลบไม่ได้'); END;

-- ---------- Index สำหรับการค้นหา ----------
CREATE INDEX IF NOT EXISTS idx_item_sku      ON stock_items(sku_id);
CREATE INDEX IF NOT EXISTS idx_item_status   ON stock_items(status);
CREATE INDEX IF NOT EXISTS idx_item_lot      ON stock_items(lot_no);
CREATE INDEX IF NOT EXISTS idx_loc_rag       ON locations(rag_id, level, depth);
CREATE INDEX IF NOT EXISTS idx_loc_status    ON locations(status);
CREATE INDEX IF NOT EXISTS idx_sku_name      ON skus(sku_name);
CREATE INDEX IF NOT EXISTS idx_move_time     ON movements(moved_at);
CREATE INDEX IF NOT EXISTS idx_move_sku      ON movements(sku_id);
CREATE INDEX IF NOT EXISTS idx_move_item     ON movements(item_id);

-- หมายเหตุ: มุมมอง v_stock ถูกสร้างใน lib/db.js หลังรัน migration
-- เพราะอ้างถึงคอลัมน์ zones.warehouse_id ที่เพิ่มด้วย ALTER TABLE
