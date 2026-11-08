// Brute-force protection for the staff login, stored in D1 so it holds across
// every Worker instance (the in-memory limiter only sees one instance).
const WINDOW_MS = 15 * 60 * 1000;
const PER_IP_LIMIT = 5;      // failed attempts per IP per 15 minutes
const GLOBAL_LIMIT = 30;     // failed attempts from all IPs per 15 minutes

let tableReady = false;
async function ensureTable(db) {
  if (tableReady) return;
  await db.prepare('CREATE TABLE IF NOT EXISTS login_failures (ip TEXT NOT NULL, at INTEGER NOT NULL)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_login_failures_at ON login_failures(at)').run();
  tableReady = true;
}

export function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

export async function loginBlocked(db, ip, now = Date.now()) {
  await ensureTable(db);
  const since = now - WINDOW_MS;
  const mine = await db.prepare('SELECT COUNT(*) AS c, MIN(at) AS first FROM login_failures WHERE ip = ? AND at > ?').bind(ip, since).first();
  if (Number(mine?.c || 0) >= PER_IP_LIMIT) {
    return { blocked: true, retryAfter: Math.max(1, Math.ceil((Number(mine.first) + WINDOW_MS - now) / 1000)) };
  }
  const all = await db.prepare('SELECT COUNT(*) AS c FROM login_failures WHERE at > ?').bind(since).first();
  if (Number(all?.c || 0) >= GLOBAL_LIMIT) return { blocked: true, retryAfter: Math.ceil(WINDOW_MS / 1000) };
  return { blocked: false };
}

export async function recordLoginFailure(db, ip, now = Date.now()) {
  await ensureTable(db);
  await db.prepare('INSERT INTO login_failures(ip, at) VALUES(?, ?)').bind(ip, now).run();
  await db.prepare('DELETE FROM login_failures WHERE at < ?').bind(now - 24 * 60 * 60 * 1000).run();
}

export async function clearLoginFailures(db, ip) {
  await ensureTable(db);
  await db.prepare('DELETE FROM login_failures WHERE ip = ?').bind(ip).run();
}

// Compare passwords without leaking how many leading characters matched.
export async function passwordMatches(input, expected) {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(String(input))),
    crypto.subtle.digest('SHA-256', enc.encode(String(expected))),
  ]);
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
