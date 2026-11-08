// Public/admin API smoke test against real SQLite (see tests/_d1.mjs).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createD1, nextWeekday } from './_d1.mjs';

const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
const worker = (await import('../dist/worker/index.js')).default;
const ctx = { waitUntil() {}, passThroughOnException() {} };
const ASSETS = { fetch: () => { throw new Error('route missing'); } };
const call = (db, path, init) => worker.fetch(new Request('https://example.test' + path, init), { DB: db, ASSETS }, ctx);

// The fake DB has Sunday closed, so pick a non-Sunday date (the old fixed
// +2 days failed whenever it hit a Sunday).
const date = nextWeekday(2);
const db = createD1(schema);
db.raw.prepare("INSERT INTO appointments(id,date,time,name,phone,status,created_at,duration_minutes) VALUES('SHOULD_HIDE_ID',?,'14:30','SHOULD_HIDE_NAME','09000000000','confirmed','x',30)").run(date);

const response = await call(db, `/api/availability?date=${date}&extension=0`);
assert.equal(response.status, 200);
const payload = await response.json();
assert.equal('booked' in payload, false);
assert.equal('breaks' in payload, false);
assert.equal('settings' in payload, false);
assert(!JSON.stringify(payload).includes('SHOULD_HIDE'));
assert(!JSON.stringify(payload.slots).includes('lanes'));
assert.equal(payload.slots.find(x => x.time === '14:30')?.status, 'booked');
console.log('PASS: public availability preserves booked state without patient info or lanes');

const holidayDB = createD1(schema);
holidayDB.raw.prepare('INSERT INTO holidays(date) VALUES(?)').run(date);
const holiday = await (await call(holidayDB, `/api/availability?date=${date}`)).json();
assert.equal(holiday.holiday, true);
assert.equal(holiday.slots.length, 0);
console.log('PASS: configured holiday has no available times');

assert.equal((await call(db, '/api/admin/events')).status, 401);
console.log('PASS: anonymous access to notification feed denied');

// Notification feed: baseline, then an event with no patient data.
db.raw.prepare('INSERT INTO sessions(token,expires_at) VALUES(?,?)').run('valid', Date.now() + 3600e3);
const headers = { Cookie: 'session=valid' };
const base = await (await call(db, '/api/admin/events', { headers })).json();
assert.equal(base.events.length, 0);
const res = await call(db, '/api/reserve', { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ date, time: '11:00', name: '通知テスト', phone: '090-1111-2222' }) });
assert.equal(res.status, 200);
const next = await (await call(db, '/api/admin/events?after=' + encodeURIComponent(base.cursor), { headers })).json();
assert.deepEqual(next.events.map(e => e.type), ['created']);
assert.equal(next.events[0].menuId, 'seikotsu');
assert(!JSON.stringify(next).includes('通知テスト'));
console.log('PASS: first-open baseline then authorized booking event, no PII');
