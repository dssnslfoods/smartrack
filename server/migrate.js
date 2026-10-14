// สร้างตาราง / view / index บน Supabase (รันซ้ำได้ ไม่ทำลายข้อมูลเดิม)
import './lib/env.js';
import { migrate, get, close } from './lib/db.js';

await migrate({ force: true });
const n = (await get('SELECT COUNT(*) AS n FROM users')).n;
console.log(`เตรียมโครงสร้างฐานข้อมูลเรียบร้อย — มีผู้ใช้งานในระบบ ${n} คน`);
await close();
