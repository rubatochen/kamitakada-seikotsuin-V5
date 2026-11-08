// Brings an existing D1 database up to the lanes/menus schema on first use,
// so a deploy does not depend on someone remembering to run a migration.
// Every step is idempotent; migration-lanes-menus.sql does the same by hand.

// Remember per database binding (one per isolate in production).
const done = new WeakSet();
const pending = new WeakMap();

async function columns(db, table) {
  const r = await db.prepare(`PRAGMA table_info(${table})`).all();
  return new Set((r.results || []).map(c => c.name));
}

async function tryRun(db, sql) {
  try { await db.prepare(sql).run(); }
  catch (error) {
    // Another isolate may have applied the same step a moment earlier.
    if (!/duplicate column|already exists/i.test(String(error && error.message))) throw error;
  }
}

async function migrate(db) {
  const appt = await columns(db, 'appointments');
  if (!appt.has('menu_id')) await tryRun(db, "ALTER TABLE appointments ADD COLUMN menu_id TEXT NOT NULL DEFAULT 'seikotsu'");
  if (!appt.has('lane_id')) await tryRun(db, "ALTER TABLE appointments ADD COLUMN lane_id TEXT NOT NULL DEFAULT 'L1'");
  // One confirmed booking per start time PER LANE (was: per start time).
  await tryRun(db, 'DROP INDEX IF EXISTS idx_active_slot');
  await tryRun(db, "CREATE UNIQUE INDEX IF NOT EXISTS idx_active_slot_lane ON appointments(date, time, lane_id) WHERE status = 'confirmed'");
  const brk = await columns(db, 'breaks');
  if (!brk.has('lane_id')) await tryRun(db, 'ALTER TABLE breaks ADD COLUMN lane_id TEXT');
}

export async function ensureSchema(env) {
  const db = env && env.DB;
  if (!db || done.has(db)) return;
  if (!pending.has(db)) {
    pending.set(db, migrate(db).then(() => { done.add(db); }).finally(() => { pending.delete(db); }));
  }
  await pending.get(db);
}
