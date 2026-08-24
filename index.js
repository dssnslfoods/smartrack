// Cloud Functions for Firebase — entry point
// ทำหน้าที่ proxy HTTP request ไปยัง server ที่มีอยู่เดิม
import { onRequest } from 'firebase-functions/v2/https';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { existsSync } from 'node:fs';

// Seed DB ใน /tmp ถ้ายังไม่มี (Cloud Functions filesystem เป็น read-only ยกเว้น /tmp)
if (process.env.FUNCTIONS_EMULATOR || process.env.K_SERVICE) {
  process.env.RAG_DB = process.env.RAG_DB || '/tmp/rag.db';
}

import { routes, csvExports } from './server/api/routes.js';
import { HttpError, json, readBody, notFound } from './server/lib/http.js';
import { userFromRequest, requirePerm } from './server/lib/auth.js';
import { db, get } from './server/lib/db.js';

// Auto-seed ถ้าฐานข้อมูลว่างเปล่า
if (!get('SELECT COUNT(*) AS n FROM users').n) {
  await import('./server/seed.js');
}

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

const int = (v, def) => { const n = Number(v); return Number.isFinite(n) ? n : def ?? null; };

export const api = onRequest(
  { region: 'asia-southeast1', memory: '512MiB', timeoutSeconds: 60 },
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
        const user = userFromRequest(req);
        requirePerm(user, 'view');
        const exporter = csvExports[csvMatch[1]];
        if (!exporter) throw notFound('ไม่พบข้อมูล');
        const { filename, body } = exporter(query);
        res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"` });
        return res.end(body);
      }

      const hit = match(req.method, url.pathname);
      if (!hit) throw notFound(`ไม่พบ endpoint ${req.method} ${url.pathname}`);

      const user = userFromRequest(req);
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
