// RAG Management System — HTTP Server (Node.js zero-framework)
import './lib/env.js';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { routes, csvExports } from './api/routes.js';
import { HttpError, json, readBody, notFound } from './lib/http.js';
import { userFromRequest, requirePerm, hashSecret } from './lib/auth.js';
import { ROOT, get, run, migrate } from './lib/db.js';

const PORT = Number(process.env.PORT || 4000);
const PUBLIC = join(ROOT, 'public');

// ---------- เตรียมฐานข้อมูล: สร้างตาราง/view ถ้ายังไม่มี ----------
await migrate();

// ---------- บูตครั้งแรก: สร้างบัญชีผู้ดูแลระบบถ้าฐานข้อมูลยังว่าง ----------
if (!(await get('SELECT COUNT(*) AS n FROM users')).n) {
  if (process.env.RAG_SEED === 'demo') {
    console.log('ฐานข้อมูลว่าง + RAG_SEED=demo — กำลังสร้างข้อมูลตัวอย่าง…');
    await import('./seed.js');
  } else {
    const pw = process.env.RAG_ADMIN_PASSWORD || randomBytes(9).toString('base64url');
    await run('INSERT INTO users (username, full_name, role, password_hash) VALUES (?,?,?,?)',
      'admin', 'ผู้ดูแลระบบ', 'ADMIN', hashSecret(pw));
    console.log(`
  ╔════════════════════════════════════════════════════════════════╗
  ║  เริ่มต้นระบบครั้งแรก — สร้างบัญชีผู้ดูแลระบบแล้ว
  ║     ชื่อผู้ใช้ : admin
  ║     รหัสผ่าน  : ${pw}
  ║  ${process.env.RAG_ADMIN_PASSWORD ? 'มาจากตัวแปร RAG_ADMIN_PASSWORD' : '⚠️ สุ่มให้อัตโนมัติ — บันทึกไว้แล้วเปลี่ยนทันทีหลังเข้าระบบ'}
  ║  (ต้องการข้อมูลตัวอย่างสำหรับทดลองใช้ ให้ตั้ง RAG_SEED=demo)
  ╚════════════════════════════════════════════════════════════════╝
`);
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

// ---------- Route matching (รองรับ :param) ----------
const compiled = routes.map(([method, path, perm, handler]) => ({
  method,
  perm,
  handler,
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

async function serveStatic(res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const file = join(PUBLIC, normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(PUBLIC)) return json(res, 403, { error: 'Forbidden' });
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not a file');
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=60',
    });
    res.end(body);
  } catch {
    // SPA fallback
    if (!extname(rel)) return serveStatic(res, '/index.html');
    json(res, 404, { error: 'ไม่พบไฟล์' });
  }
}

const server = createServer(async (req, res) => {
  const started = Date.now();
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const query = Object.fromEntries(url.searchParams);

  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      });
      return res.end();
    }

    // ---- ดาวน์โหลด CSV: /api/export/{stock|movements}.csv ----
    const csvMatch = url.pathname.match(/^\/api\/export\/([a-z]+)\.csv$/);
    if (csvMatch && req.method === 'GET') {
      const user = await userFromRequest(req);
      requirePerm(user, 'view');
      const exporter = csvExports[csvMatch[1]];
      if (!exporter) throw notFound('ไม่พบข้อมูลที่ต้องการ Export');
      const { filename, body } = await exporter(query);
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      });
      return res.end(body);
    }

    const hit = match(req.method, url.pathname);
    if (!hit) {
      if (req.method === 'GET' && !url.pathname.startsWith('/api/')) return serveStatic(res, url.pathname);
      throw notFound(`ไม่พบ endpoint ${req.method} ${url.pathname}`);
    }

    const user = await userFromRequest(req);
    if (hit.route.perm) requirePerm(user, hit.route.perm);
    const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
    const result = await hit.route.handler({ req, res, params: hit.params, query, body, user });

    // หน้าพิมพ์ป้าย คืนเป็น HTML
    if (result && typeof result === 'object' && typeof result.html === 'string' && url.pathname.startsWith('/labels')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(result.html);
    }
    json(res, req.method === 'POST' ? 201 : 200, result ?? { ok: true });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status >= 500) console.error('[ERROR]', req.method, url.pathname, err);
    json(res, status, { error: err.message, code: err.code ?? null });
  } finally {
    if (url.pathname.startsWith('/api/') && process.env.RAG_LOG !== 'off')
      console.log(`${req.method} ${url.pathname} — ${Date.now() - started}ms`);
  }
});

server.listen(PORT, () => {
  console.log(`\n  🏭 ระบบบริหารจัดการชั้นวางสินค้า (RAG) — De Leaf`);
  console.log(`  ➜  http://localhost:${PORT}\n`);
});
