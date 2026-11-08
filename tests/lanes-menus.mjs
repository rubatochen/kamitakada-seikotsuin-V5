// Lanes (枠) + menus: migration, capacity, acupuncture rules, breaks, staff tools.
// Runs the packaged Worker against real SQLite (tests/_d1.mjs).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createD1, nextWeekday, tokyoDate } from './_d1.mjs';

const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
const worker = (await import('../dist/worker/index.js')).default;
const ctx = { waitUntil() {}, passThroughOnException() {} };
const ASSETS = { fetch: () => new Response('asset') };
const json = { 'content-type': 'application/json' };
let ipSeq = 0; // a different client IP per request keeps the per-IP rate limiter out of the way
function api(db, path, body, admin = false) {
  const headers = { ...(body ? json : {}), ...(admin ? { Cookie: 'session=staff' } : {}), 'CF-Connecting-IP': `198.51.100.${++ipSeq % 250}` };
  return worker.fetch(new Request('https://x.test' + path, body ? { method: 'POST', headers, body: JSON.stringify(body) } : { headers }), { DB: db, ASSETS }, ctx);
}
const book = (db, date, time, extra = {}) => api(db, '/api/reserve', { date, time, name: extra.name || '患者', phone: extra.phone || '090-1234-5678', ...extra });
const staffLogin = db => db.raw.prepare('INSERT OR REPLACE INTO sessions(token,expires_at) VALUES(?,?)').run('staff', Date.now() + 3600e3);
const allOpen = JSON.stringify(Object.fromEntries([0,1,2,3,4,5,6].map(d => [d, ['10:00', '19:00']])));
function freshDB() {
  const db = createD1(schema);
  db.raw.prepare("UPDATE settings SET value=? WHERE key='business_hours'").run(allOpen);
  staffLogin(db);
  return db;
}
async function setConfig(db, mutate) {
  const cfg = await (await api(db, '/api/admin/config', null, true)).json();
  mutate(cfg);
  const r = await api(db, '/api/admin/config', { lanes: cfg.lanes, menus: cfg.menus }, true);
  assert.equal(r.status, 200, await r.clone().text());
  return r.json();
}
const D = nextWeekday(2);

// ---------------------------------------------------------------- migration
{
  // A V14 database: no menu/lane columns, old unique index on (date,time).
  const old = createD1(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE appointments (id TEXT PRIMARY KEY, date TEXT NOT NULL, time TEXT NOT NULL, name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT, note TEXT, status TEXT NOT NULL DEFAULT 'confirmed', created_at TEXT NOT NULL, duration_minutes INTEGER NOT NULL DEFAULT 30);
    CREATE UNIQUE INDEX idx_active_slot ON appointments(date, time) WHERE status = 'confirmed';
    CREATE TABLE breaks (id TEXT PRIMARY KEY, date TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE holidays (date TEXT PRIMARY KEY, reason TEXT);
    CREATE TABLE sessions (token TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
  `);
  old.raw.prepare("INSERT INTO settings VALUES('business_hours',?)").run(allOpen);
  old.raw.prepare("INSERT INTO appointments(id,date,time,name,phone,status,created_at,duration_minutes) VALUES('old1',?,'10:00','既存','09011112222','confirmed','x',30)").run(D);
  const r = await api(old, `/api/availability?date=${D}`);
  assert.equal(r.status, 200);
  const row = old.raw.prepare("SELECT menu_id, lane_id FROM appointments WHERE id='old1'").get();
  assert.deepEqual({ ...row }, { menu_id: 'seikotsu', lane_id: 'L1' });
  const idx = old.raw.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='appointments'").all().map(x => x.name);
  assert(idx.includes('idx_active_slot_lane') && !idx.includes('idx_active_slot'));
  assert(old.raw.prepare('PRAGMA table_info(breaks)').all().some(c => c.name === 'lane_id'));
  // Second request on the same DB is a no-op (idempotent).
  assert.equal((await api(old, `/api/availability?date=${D}`)).status, 200);
  const slots = (await r.json()).slots;
  assert.equal(slots.find(s => s.time === '10:00').status, 'booked');
  console.log('PASS: V14 database upgrades itself; existing bookings become 整骨・枠1');
}

async function setCapacity(db, body) {
  const r = await api(db, '/api/admin/capacity', body, true);
  assert.equal(r.status, 200, await r.clone().text());
  return r.json();
}
const dataFor = async (db, date) => (await api(db, `/api/admin/data?date=${date}`, null, true)).json();

// ----------------------------------------------------- one 枠 (today's behavior)
{
  const db = freshDB();
  assert.equal((await book(db, D, '10:00')).status, 200);
  assert.equal((await book(db, D, '10:00')).status, 409);
  assert.equal((await book(db, D, '10:10')).status, 409);
  assert.equal((await book(db, D, '10:30')).status, 200);
  console.log('PASS: with one 枠 (the default), behavior is unchanged (no overlaps)');

  // -------------------------------------------- that day gets 2 枠
  await setCapacity(db, { date: D, plan: { base: 2, ranges: [] } });
  assert.equal((await book(db, D, '10:00')).status, 200, 'second person at 10:00 goes to 枠2');
  assert.equal((await book(db, D, '10:05')).status, 409, 'both 枠 busy at 10:05');
  const lanesAt10 = db.raw.prepare("SELECT lane_id FROM appointments WHERE date=? AND time='10:00' AND status='confirmed' ORDER BY lane_id").all(D).map(x => x.lane_id);
  assert.deepEqual(lanesAt10, ['L1', 'L2']);
  const avail = await (await api(db, `/api/availability?date=${D}`)).json();
  assert.equal(avail.slots.find(s => s.time === '10:00').status, 'booked');
  assert.equal(avail.slots.find(s => s.time === '11:00').status, 'available');
  console.log('PASS: 2 枠 lets two people book the same time, third is refused');

  const results = await Promise.all([1, 2, 3, 4].map(i => book(db, D, '15:00', { name: '同時' + i })));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 200, 409, 409]);
  console.log('PASS: four simultaneous bookings for one minute -> exactly two succeed');

  // -------------------------------------------- count by time of day
  // 1 枠 all day, 2 枠 from 10:00 to 12:00. The 15:00 booking in 枠2 is kept
  // but reported so staff can look at it.
  const cap = await setCapacity(db, { date: D, plan: { base: 1, ranges: [{ start: '10:00', end: '12:00', count: 2 }] } });
  assert.deepEqual(cap.conflicts.map(c => c.time + c.laneId), ['15:00L2']);
  assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM appointments WHERE date=? AND time='15:00' AND status='confirmed'").get(D).n, 2, 'nothing is cancelled');
  assert.equal((await book(db, D, '16:00')).status, 200);
  assert.equal((await book(db, D, '16:00')).status, 409, 'only 1 枠 after 12:00');
  assert.equal((await book(db, D, '11:00')).status, 200);
  assert.equal((await book(db, D, '11:00')).status, 200, '2 枠 in the morning');
  assert.equal((await book(db, D, '11:40')).status, 200, '枠1 free at 11:40');
  assert.equal((await book(db, D, '11:45')).status, 409, '枠2 would run past 12:00');
  const d1 = await dataFor(db, D);
  assert.equal(d1.capacity.custom, true);
  assert.equal(d1.capacity.max, 2);
  assert.deepEqual(d1.capacity.closed.L2, [['12:00', '19:00']]);
  assert.deepEqual(d1.capacity.closed.L3, [['10:00', '19:00']]);
  console.log('PASS: the number of 枠 can change by time of day; existing bookings are kept and reported');

  // At most 3, at least 1.
  const c3 = await setCapacity(db, { date: D, plan: { base: 9, ranges: [{ start: '10:00', end: '11:00', count: 0 }] } });
  assert.equal(c3.capacity.days[D].base, 3);
  assert.equal(c3.capacity.days[D].ranges[0].count, 1);
  await setCapacity(db, { date: D, reset: true });
  assert.equal((await dataFor(db, D)).capacity.custom, false);
  console.log('PASS: 1–3 枠 enforced; a day can go back to the standard plan');

  // Breaks: one 枠 vs all 枠.
  const D2 = nextWeekday(4);
  await setCapacity(db, { date: D2, plan: { base: 2, ranges: [] } });
  db.raw.prepare("INSERT INTO breaks(id,date,start_time,end_time,created_at,lane_id) VALUES('b1',?,'10:00','10:30','x','L1')").run(D2);
  db.raw.prepare("INSERT INTO breaks(id,date,start_time,end_time,created_at,lane_id) VALUES('b2',?,'11:00','11:30','x',NULL)").run(D2);
  assert.equal((await book(db, D2, '10:00')).status, 200, 'L1 on break, L2 still free');
  assert.equal((await book(db, D2, '10:00')).status, 409);
  assert.equal((await book(db, D2, '11:00')).status, 409, 'break for every 枠');
  const a2 = await (await api(db, `/api/availability?date=${D2}`)).json();
  assert.equal(a2.slots.find(s => s.time === '11:00').status, 'break');
  assert(a2.unavailable.some(x => x.startTime === '11:00' && x.endTime === '11:30'));
  console.log('PASS: a break can stop one 枠 or all 枠');

  // 枠1〜3 always exist; they cannot be removed through the config API.
  const cfg = await (await api(db, '/api/admin/config', null, true)).json();
  const r = await api(db, '/api/admin/config', { lanes: cfg.lanes.filter(l => l.id !== 'L2'), menus: cfg.menus }, true);
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).lanes.filter(l => l.kind === 'pool').map(l => l.id), ['L1', 'L2', 'L3']);
  console.log('PASS: 枠1〜3 are fixed');
}

// ------------------------------------------- standard plan for newly opened days
{
  const db = freshDB();
  const open = tokyoDate(5), later = tokyoDate(20), edge = tokyoDate(14), next = tokyoDate(15);
  const r = await setCapacity(db, { default: { base: 2, ranges: [] } });
  assert.equal((await dataFor(db, open)).capacity.plan.base, 1, 'already-open day keeps 1 枠');
  assert.equal((await dataFor(db, edge)).capacity.plan.base, 1, 'day 14 is already open');
  assert.equal((await dataFor(db, next)).capacity.plan.base, 2, 'day 15 opens with the new standard');
  assert.equal((await dataFor(db, later)).capacity.plan.base, 2);
  assert(Object.keys(r.capacity.days).length === 15);
  // Changing it again does not touch days that were frozen before.
  await setCapacity(db, { default: { base: 3, ranges: [] }, applyToOpenDays: true });
  assert.equal((await dataFor(db, open)).capacity.plan.base, 1);
  assert.equal((await dataFor(db, later)).capacity.plan.base, 3);
  // applyToOpenDays: open days without their own plan follow the new standard.
  const db2 = freshDB();
  await setCapacity(db2, { default: { base: 2, ranges: [] }, applyToOpenDays: true });
  assert.equal((await dataFor(db2, open)).capacity.plan.base, 2);
  assert.equal((await dataFor(db2, open)).capacity.custom, false);
  console.log('PASS: the standard 枠 count applies to newly opened days; open days keep theirs unless asked');
}

// ------------------------------------------------------------- acupuncture
{
  const db = freshDB();
  const pub0 = await (await api(db, '/api/status')).json();
  assert.deepEqual(pub0.menus.map(m => m.id), ['seikotsu'], 'acupuncture hidden until offered');
  assert.equal((await book(db, D, '10:00', { menuId: 'acu' })).status, 400);
  assert.equal((await api(db, '/api/admin/reserve', { date: D, time: '10:00', name: 'x', phone: '0312345678', menuId: 'acu' }, true)).status, 400);

  // One switch: offer 鍼灸.
  await setConfig(db, cfg => { cfg.lanes.find(l => l.id === 'ACU').active = true; });
  const pub = await (await api(db, '/api/status')).json();
  assert.deepEqual(pub.menus.map(m => m.id), ['seikotsu', 'acu']);
  assert.equal(pub.menus[1].name.ja, '鍼灸');
  assert(!JSON.stringify(pub).includes('ACU'), 'public menus do not name lanes');

  assert.equal((await book(db, D, '10:00')).status, 200);
  const r1 = await book(db, D, '10:00', { menuId: 'acu' });
  assert.equal(r1.status, 200, '整骨 and 鍼灸 share a time');
  assert.equal((await r1.json()).occupiedMinutes, 70);
  assert.equal((await book(db, D, '10:30', { menuId: 'acu' })).status, 409, '鍼灸 busy until 11:10');
  assert.equal((await book(db, D, '11:10', { menuId: 'acu' })).status, 200);
  assert.equal(db.raw.prepare("SELECT lane_id FROM appointments WHERE menu_id='acu' GROUP BY lane_id").all().map(x => x.lane_id).join(), 'ACU');
  console.log('PASS: acupuncture uses its own practitioner lane and its own length');

  const today = tokyoDate(0);
  const now = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
  const [h, m] = now.split(':').map(Number);
  const soon = h * 60 + m + 60;
  if (soon + 70 < 19 * 60 && soon >= 10 * 60) {
    const t = `${String(Math.floor(soon / 60)).padStart(2, '0')}:${String(soon % 60).padStart(2, '0')}`;
    const web = await book(db, today, t, { menuId: 'acu' });
    assert.equal(web.status, 409);
    assert.equal((await web.json()).code, 'too_soon');
    const staff = await api(db, '/api/admin/reserve', { date: today, time: t, name: '電話', phone: '0312345678', menuId: 'acu' }, true);
    assert.equal(staff.status, 200);
    console.log('PASS: acupuncture needs advance notice on the web; staff can override');
  } else {
    console.log('SKIP: notice test (outside clinic hours right now)');
  }

  const D3 = nextWeekday(3);
  const upd = await api(db, '/api/manage', { action: 'update', original: { date: D, time: '11:10', name: '患者', phone: '090-1234-5678' },
    date: D3, time: '13:00', name: '患者', phone: '090-1234-5678', extensionMinutes: 0, note: '' });
  assert.equal(upd.status, 200);
  const moved = (await upd.json()).appointment;
  assert.equal(moved.menu_id, 'acu');
  assert.equal(moved.duration_minutes, 70);
  console.log('PASS: customer change keeps the acupuncture menu and length');

  // Switching it off hides it again; bookings stay; the lane cannot be deleted.
  await setConfig(db, cfg => { cfg.lanes.find(l => l.id === 'ACU').active = false; });
  assert.deepEqual((await (await api(db, '/api/status')).json()).menus.map(m => m.id), ['seikotsu']);
  const cfg = await (await api(db, '/api/admin/config', null, true)).json();
  assert.equal((await api(db, '/api/admin/config', { lanes: cfg.lanes.filter(l => l.id !== 'ACU'), menus: cfg.menus }, true)).status, 409);
  console.log('PASS: the 鍼灸 switch hides/shows it; a practitioner lane with bookings cannot be deleted');
}

// ------------------------------------------------------------- staff tools
{
  const db = freshDB();
  await setCapacity(db, { date: D, plan: { base: 2, ranges: [] } });
  const r = await api(db, '/api/admin/reserve', { date: D, time: '12:00', name: '山田太郎', phone: '090-5555-6666', laneId: 'L2' }, true);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).appointment.lane_id, 'L2');
  assert.equal((await api(db, '/api/admin/reserve', { date: D, time: '12:00', name: 'x', phone: '0311112222', laneId: 'L3' }, true)).status, 409, '枠3 is closed that day');
  const id = db.raw.prepare("SELECT id FROM appointments WHERE name='山田太郎'").get().id;
  assert.equal((await api(db, '/api/admin/reserve', { date: D, time: '14:00', name: '別', phone: '0311112222', laneId: 'L2' }, true)).status, 200);
  const mv = await api(db, '/api/admin/update', { id, date: D, time: '14:00', name: '山田太郎', phone: '090-5555-6666', note: '', extensionMinutes: 0 }, true);
  assert.equal(mv.status, 200);
  assert.equal((await mv.json()).appointment.lane_id, 'L1');
  const byPhone = await (await api(db, '/api/admin/search?q=55556666', null, true)).json();
  assert.equal(byPhone.results[0].name, '山田太郎');
  const byName = await (await api(db, '/api/admin/search?q=' + encodeURIComponent('山田'), null, true)).json();
  assert.equal(byName.results.length, 1);
  assert.equal((await api(db, '/api/admin/search?q=x')).status, 401);
  assert.equal((await api(db, '/api/admin/capacity', { date: D, reset: true })).status, 401);
  const data = await dataFor(db, D);
  assert.equal(data.upcoming[D], 2);
  assert.deepEqual(data.laneHours.L1, ['10:00', '19:00']);
  assert(data.appointments.every(a => a.lane_id && a.menu_id));
  const today = tokyoDate(0);
  const ext = await api(db, '/api/admin/extend', { date: today, minutes: 30, laneId: 'L2' }, true);
  assert.equal(ext.status, 200);
  assert.equal(db.raw.prepare('SELECT lane_id FROM breaks WHERE date=?').get(today).lane_id, 'L2');
  const csv = await (await api(db, '/api/admin/export', null, true)).text();
  assert(csv.includes('"メニュー","枠"') && csv.includes('"通常","枠1"'));
  console.log('PASS: staff can pick a 枠, moves switch 枠 when needed, search, data, quick stop per 枠, CSV');
}
