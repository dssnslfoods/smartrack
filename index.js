// Cloud Functions for Firebase — entry point
//
// ตอนนี้ข้อมูลอยู่บน Supabase (PostgreSQL) แล้ว ระบบจึงไม่เก็บสถานะไว้ในเครื่อง
// deploy ขึ้น Cloud Functions ได้โดยข้อมูลไม่หาย (ต่างจากตอนใช้ SQLite ใน /tmp)
//
// ต้องตั้งค่า DATABASE_URL ให้ฟังก์ชันก่อนใช้งาน เช่น
//   firebase functions:secrets:set DATABASE_URL
// และรัน `npm run migrate` หนึ่งครั้งเพื่อสร้างตารางบน Supabase
import './server/lib/env.js';
import { onRequest } from 'firebase-functions/v2/https';

import { routes, csvExports } from './server/api/routes.js';
import { HttpError, notFound } from './server/lib/http.js';
import { userFromRequest, requirePerm } from './server/lib/auth.js';

const compiled = routes.map(([method, path, perm, handler]) => ({
  method, perm, handler,
  keys: path.split('/').filter(Boolean).map((s) => (s.startsWith(':') ? s.slice(1) : null)),
  parts: path.split('/').filter(Boolean),
}));

function match(method, pathname) {
  const parts = pathname.split('/').filter(Boolean);
  for (const r of compiled) {
    if (r.method !== method || r.parts.length !== parts.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < parts.length; i++) {
      if (r.keys[i]) params[r.keys[i]] = parts[i];
      else if (r.parts[i] !== parts[i]) { ok = false; break; }
    }
    if (ok) return { route: r, params };
  }
  return null;
}

export const api = onRequest(
  { region: 'asia-southeast1', memory: '512MiB', timeoutSeconds: 60, secrets: ['DATABASE_URL'] },
  async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const query = Object.fromEntries(url.searchParams);

    try {
      if (req.method === 'OPTIONS') {
        res.set({
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
        });
        return res.status(204).end();
      }

      // CSV exports
      const csvMatch = url.pathname.match(/^\/api\/export\/([a-z]+)\.csv$/);
      if (csvMatch && req.method === 'GET') {
        const user = await userFromRequest(req);
        requirePerm(user, 'view');
        const exporter = csvExports[csvMatch[1]];
        if (!exporter) throw notFound('ไม่พบข้อมูล');
        const { filename, body } = await exporter(query);
        res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"` });
        return res.end(body);
      }

      const hit = match(req.method, url.pathname);
      if (!hit) throw notFound(`ไม่พบ endpoint ${req.method} ${url.pathname}`);

      const user = await userFromRequest(req);
      if (hit.route.perm) requirePerm(user, hit.route.perm);
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? req.body : {};
      const result = await hit.route.handler({ req, res, params: hit.params, query, body, user });

      if (result && typeof result === 'object' && typeof result.html === 'string' && url.pathname.startsWith('/labels')) {
        res.set('Content-Type', 'text/html; charset=utf-8');
        return res.end(result.html);
      }

      return res.status(req.method === 'POST' ? 201 : 200).json(result ?? { ok: true });
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status >= 500) console.error('[ERROR]', req.method, url.pathname, err);
      return res.status(status).json({ error: err.message, code: err.code ?? null });
    }
  },
);
