// การเข้าสู่ระบบและสิทธิ์การใช้งาน (3 บทบาท)
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { get, run, all, nowStr } from './db.js';
import { unauthorized, forbidden } from './http.js';

const SESSION_HOURS = 12;

export function hashSecret(secret) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${scryptSync(secret, salt, 64).toString('hex')}`;
}

function verifySecret(secret, stored) {
  if (!stored) return false;
  const [algo, salt, hex] = stored.split('$');
  if (algo !== 'scrypt') return false;
  const a = scryptSync(secret, salt, 64);
  const b = Buffer.from(hex, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

// view = ค้นหา/ดูแผนผัง/ดูประวัติ · move = จัดเก็บ/หยิบออก/ย้าย · manage = ข้อมูลหลักและผู้ใช้
export const PERMISSIONS = {
  ADMIN:  ['view', 'move', 'manage'],
  STAFF:  ['view', 'move'],
  VIEWER: ['view'],
};
export const ROLE_NAME = { ADMIN: 'ผู้ดูแลระบบ', STAFF: 'พนักงานคลัง', VIEWER: 'ผู้ดูข้อมูล' };

export const can = (user, perm) => Boolean(user) && (PERMISSIONS[user.role] ?? []).includes(perm);

export function requirePerm(user, perm) {
  if (!user) throw unauthorized();
  if (!can(user, perm)) throw forbidden(`บทบาท "${ROLE_NAME[user.role]}" ไม่มีสิทธิ์ใช้งานส่วนนี้`);
  return user;
}

export function login({ username, password }) {
  const user = get('SELECT * FROM users WHERE username = ? AND status = ?', String(username ?? ''), 'ACTIVE');
  if (!user || !verifySecret(String(password ?? ''), user.password_hash))
    throw unauthorized('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');

  const token = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_HOURS * 3600_000).toISOString().slice(0, 19).replace('T', ' ');
  run('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)', token, user.user_id, expires);
  run('DELETE FROM sessions WHERE expires_at <= ?', nowStr());
  return { token, user: publicUser(user) };
}

export const logout = (token) => token && run('DELETE FROM sessions WHERE token = ?', token);

export function userFromRequest(req) {
  const header = req.headers['authorization'] ?? '';
  if (!header.startsWith('Bearer ')) return null;
  const row = get(
    `SELECT u.* FROM sessions s JOIN users u ON u.user_id = s.user_id
      WHERE s.token = ? AND s.expires_at > ? AND u.status = 'ACTIVE'`,
    header.slice(7), nowStr(),
  );
  return row ? publicUser(row) : null;
}

export const publicUser = (u) => ({
  user_id: u.user_id,
  username: u.username,
  full_name: u.full_name,
  role: u.role,
  role_name: ROLE_NAME[u.role],
  permissions: PERMISSIONS[u.role],
});

export const listUsers = () =>
  all('SELECT user_id, username, full_name, role, status, created_at FROM users ORDER BY user_id');
