// The Cloudflare build runs `wrangler pages functions build`, which ignores
// dist/worker/index.js and routes by file name under functions/. This test
// mimics that: file-based routes + functions/_middleware.js, on an OLD (V14)
// database, and checks the admin page's data loads (schema upgraded on the fly).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createD1 } from './_d1.mjs';

const root = new URL('../functions/', import.meta.url).pathname;
const routes = {};
(function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) { if (f !== 'lib') walk(p); continue; }
    if (!f.endsWith('.js') || f.startsWith('_')) continue;
    routes['/' + path.relative(root, p).replace(/\.js$/, '')] = p;
  }
})(root);
// Every route of the hand-written worker exists as a file route too.
const workerSrc = fs.readFileSync(new URL('../dist/worker/index.js', import.meta.url), 'utf8');
for (const m of workerSrc.matchAll(/'(\/api\/[^']+)':/g)) assert(routes[m[1]], `missing file route for ${m[1]}`);

const middleware = (await import(path.join(root, '_middleware.js'))).onRequest;
async function call(env, url, init) {
  const request = new Request('https://x.test' + url, init);
  const p = new URL(request.url).pathname;
  const mod = routes[p] ? await import(routes[p]) : null;
  const ctx = { request, env, params: {}, waitUntil() {}, next: async () => mod ? mod.onRequest({ request, env, params: {}, waitUntil() {} }) : new Response('asset') };
  return middleware(ctx);
}

const old = createD1(`
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE appointments (id TEXT PRIMARY KEY, date TEXT NOT NULL, time TEXT NOT NULL, name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT, note TEXT, status TEXT NOT NULL DEFAULT 'confirmed', created_at TEXT NOT NULL, duration_minutes INTEGER NOT NULL DEFAULT 30);
  CREATE UNIQUE INDEX idx_active_slot ON appointments(date, time) WHERE status = 'confirmed';
  CREATE TABLE breaks (id TEXT PRIMARY KEY, date TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE holidays (date TEXT PRIMARY KEY, reason TEXT);
  CREATE TABLE sessions (token TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
  INSERT INTO settings VALUES('business_hours','{"0":["10:00","19:00"],"1":["10:00","19:00"],"2":["10:00","19:00"],"3":["10:00","19:00"],"4":["10:00","19:00"],"5":["10:00","19:00"],"6":["10:00","19:00"]}');
`);
const env = { DB: old, ADMIN_PASSWORD: 'pw', ASSETS: { fetch: () => new Response('asset') } };
const login = await call(env, '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '203.0.113.9' }, body: JSON.stringify({ password: 'pw' }) });
assert.equal(login.status, 200);
const cookie = login.headers.get('set-cookie').split(';')[0];
const data = await call(env, '/api/admin/data', { headers: { Cookie: cookie } });
assert.equal(data.status, 200, await data.clone().text());
const body = await data.json();
assert(Array.isArray(body.lanes) && body.capacity && Array.isArray(body.menus));
assert.equal(data.headers.get('x-content-type-options'), 'nosniff');
assert(old.raw.prepare('PRAGMA table_info(appointments)').all().some(c => c.name === 'lane_id'));
console.log('PASS: Pages-style build: middleware upgrades an old DB, admin data loads, API headers set');

// A handler that throws gives JSON with the reason (admin) instead of a bare 500.
const boom = { ...env, DB: { ...old, prepare: sql => { if (/FROM appointments WHERE date = \? ORDER BY time/.test(sql)) throw new Error('D1_ERROR: test'); return old.prepare(sql); }, batch: old.batch } };
const r = await call(boom, '/api/admin/data', { headers: { Cookie: cookie } });
assert.equal(r.status, 500);
const j = await r.json();
assert.equal(j.code, 'server_error'); assert.match(j.detail, /D1_ERROR: test/);
console.log('PASS: unexpected errors come back as JSON with the reason for the admin page');
