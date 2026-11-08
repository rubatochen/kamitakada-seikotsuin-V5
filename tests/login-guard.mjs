// Login brute-force guard: real Worker + SQLite-backed D1 shim.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createD1 } from './_d1.mjs';
const DB = createD1(fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
const db = DB.raw;
const worker = (await import('../dist/worker/index.js')).default;
const env = { DB, ADMIN_PASSWORD: 'correct-horse', ASSETS: { fetch: () => new Response('x') } };
const ctx = { waitUntil(){}, passThroughOnException(){} };
const login = (password, ip='203.0.113.5') => worker.fetch(new Request('https://x.test/api/login', {
  method:'POST', headers:{'content-type':'application/json','CF-Connecting-IP':ip}, body:JSON.stringify({password})}), env, ctx);

let r = await login('correct-horse');
assert.equal(r.status, 200);
assert.match(r.headers.get('set-cookie'), /SameSite=Strict/);
assert.equal(r.headers.get('cache-control'), 'no-store');
assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
console.log('PASS: correct password logs in, Strict cookie, no-store + nosniff headers');

for (let i = 0; i < 5; i++) assert.equal((await login('wrong')).status, 401);
r = await login('correct-horse');
assert.equal(r.status, 429);
assert.ok(Number(r.headers.get('retry-after')) > 0);
console.log('PASS: 5 wrong passwords lock that IP, even for the right password');

assert.equal((await login('correct-horse', '198.51.100.9')).status, 200);
console.log('PASS: other IPs are not affected by one IP being locked');

r = await login('wrong', '198.51.100.9'); assert.equal(r.status, 401);
assert.equal((await login('correct-horse', '198.51.100.9')).status, 200);
const left = db.prepare("SELECT COUNT(*) c FROM login_failures WHERE ip='198.51.100.9'").get().c;
assert.equal(Number(left), 0);
console.log('PASS: successful login clears that IP\'s failure count');
