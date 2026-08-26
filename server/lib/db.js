// การเชื่อมต่อฐานข้อมูล (node:sqlite — Node 22+)
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(__dirname, '..', '..');
export const DB_PATH = process.env.RAG_DB || join(ROOT, 'data', 'rag.db');

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec(readFileSync(join(__dirname, '..', 'schema.sql'), 'utf8'));

// ---------- Migration: เพิ่มคอลัมน์ที่ยังไม่มี (ปลอดภัยกับฐานข้อมูลเดิม) ----------
const hasColumn = (table, col) =>
  db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);

const addColumn = (table, col, def) => {
  if (!hasColumn(table, col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
};

addColumn('zones', 'warehouse_id', 'INTEGER REFERENCES warehouses(warehouse_id)');
addColumn('zones', 'color', "TEXT NOT NULL DEFAULT '#2563eb'");
addColumn('rags', 'pos_x', 'INTEGER');   // ตำแหน่งบนผังพื้นคลัง (คอลัมน์)
addColumn('rags', 'pos_y', 'INTEGER');   // ตำแหน่งบนผังพื้นคลัง (แถว)

// สร้างคลังเริ่มต้นและผูกโซนที่ยังไม่มีคลังเข้าไป
const orphanZones = db.prepare('SELECT COUNT(*) AS n FROM zones WHERE warehouse_id IS NULL').get().n;
if (orphanZones) {
  let wh = db.prepare('SELECT warehouse_id FROM warehouses ORDER BY warehouse_id LIMIT 1').get();
  if (!wh) {
    db.prepare('INSERT INTO warehouses (wh_code, wh_name) VALUES (?,?)').run('WH1', 'คลังสินค้าหลัก');
    wh = db.prepare('SELECT warehouse_id FROM warehouses ORDER BY warehouse_id LIMIT 1').get();
  }
  db.prepare('UPDATE zones SET warehouse_id = ? WHERE warehouse_id IS NULL').run(wh.warehouse_id);
}

// ---------- มุมมองรวม: สินค้าที่อยู่ในคลังพร้อมตำแหน่ง ----------
db.exec(`
DROP VIEW IF EXISTS v_stock;
CREATE VIEW v_stock AS
SELECT i.item_id, i.lot_no, i.exp_date, i.quantity, i.note, i.stored_at,
       s.sku_id, s.sku_code, s.sku_name, s.category, s.unit,
       l.location_id, l.location_code, l.level, l.depth,
       r.rag_id, r.rag_no, z.zone_id, z.zone_code, z.zone_name,
       w.warehouse_id, w.wh_code, w.wh_name,
       CASE WHEN i.exp_date IS NULL THEN NULL
            ELSE CAST(julianday(i.exp_date) - julianday(date('now','localtime')) AS INTEGER) END AS days_to_expiry
FROM stock_items i
JOIN skus s      ON s.sku_id = i.sku_id
JOIN locations l ON l.location_id = i.location_id
JOIN rags r      ON r.rag_id = l.rag_id
JOIN zones z     ON z.zone_id = r.zone_id
LEFT JOIN warehouses w ON w.warehouse_id = z.warehouse_id
WHERE i.status = 'IN_STOCK';
`);

/** SELECT หลายแถว */
export const all = (sql, ...params) => db.prepare(sql).all(...params);
/** SELECT แถวเดียว */
export const get = (sql, ...params) => db.prepare(sql).get(...params);
/** INSERT/UPDATE/DELETE */
export const run = (sql, ...params) => db.prepare(sql).run(...params);

/** ครอบการทำงานหลายคำสั่งใน Transaction เดียว (atomic) */
export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export const nowStr = () =>
  new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 19).replace('T', ' ');
export const todayStr = () => nowStr().slice(0, 10);
