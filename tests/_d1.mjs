// Minimal Cloudflare D1 stand-in backed by real SQLite (node:sqlite),
// so tests run the same SQL as production. No network, no real D1.
import { DatabaseSync } from 'node:sqlite';

export function createD1(schemaSql) {
  const db = new DatabaseSync(':memory:');
  if (schemaSql) db.exec(schemaSql);
  class Stmt {
    constructor(sql) { this.sql = sql; this.params = []; }
    bind(...a) { this.params = a.map(v => v === undefined ? null : v); return this; }
    _s() { return db.prepare(this.sql); }
    async all() { return { results: this._s().all(...this.params) }; }
    async first() { return this._s().get(...this.params) ?? null; }
    async run() { const r = this._s().run(...this.params); return { meta: { changes: Number(r.changes) } }; }
  }
  return {
    raw: db,
    prepare: sql => new Stmt(sql),
    async batch(list) {
      db.exec('BEGIN');
      try {
        const out = list.map(s => { const r = s._s().run(...s.params); return { meta: { changes: Number(r.changes) } }; });
        db.exec('COMMIT');
        return out;
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}

export function tokyoDate(offsetDays = 0) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const d = new Date(`${p}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

// First date at least `offset` days ahead whose weekday is in `weekdays`.
export function nextWeekday(offset, weekdays = [1, 2, 3, 4, 5, 6]) {
  for (let i = offset; i < offset + 14; i++) {
    const d = tokyoDate(i);
    if (weekdays.includes(new Date(`${d}T12:00:00Z`).getUTCDay())) return d;
  }
  throw new Error('no date');
}
