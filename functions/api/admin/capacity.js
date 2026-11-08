import { json, optionResponse, withCors, requireAdmin, settings, tokyoNow, isValidDate, minutesOf } from '../../lib/utils.js';
import { normalizeCapacityPlan, planForDate, poolClosedSpans, POOL_LANE_IDS } from '../../lib/config.js';

// How many 枠 (1–3) are open, by time of day.
//
//   POST { default: plan, applyToOpenDays: false }
//        Changes the plan that newly opened days start with. Days that are
//        already open for web booking (today … +14 days) keep the plan they
//        had, unless applyToOpenDays is true.
//   POST { date, plan }       Sets one day's plan.
//   POST { date, reset: true } That day goes back to the standard plan.
//
// A plan is { base: 1–3, ranges: [{ start:'10:00', end:'13:00', count: 2 }] }.
// Existing bookings are never moved or cancelled; the response lists any
// booking that now sits in a 枠 that is closed at that time, so staff can
// look at it.

const OPEN_DAYS = 15; // today + 14 days, same as the web booking window

function addDays(date, n) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function conflictsFor(env, s, capacity, dates) {
  if (!dates.length) return [];
  const rows = await env.DB.prepare(
    `SELECT date,time,duration_minutes,lane_id FROM appointments
     WHERE status = 'confirmed' AND date IN (${dates.map(() => '?').join(',')}) AND lane_id IN ('L2','L3')`
  ).bind(...dates).all();
  const out = [];
  for (const r of rows.results || []) {
    const weekday = new Date(`${r.date}T12:00:00Z`).getUTCDay();
    const bh = s.businessHours[String(weekday)];
    if (!bh) continue;
    const spans = poolClosedSpans(planForDate(capacity, r.date), minutesOf(bh[0]), minutesOf(bh[1]))[r.lane_id] || [];
    const st = minutesOf(r.time), en = st + (Number(r.duration_minutes) || 30);
    if (spans.some(x => st < x.end && en > x.start)) out.push({ date: r.date, time: r.time, laneId: r.lane_id });
  }
  return out;
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return optionResponse(request);
  if (!await requireAdmin(request, env)) return withCors(json({ error: 'Unauthorized' }, 401), request);
  const s = await settings(env);
  if (request.method === 'GET') return withCors(json({ ok: true, capacity: s.capacity }), request);
  if (request.method !== 'POST') return withCors(json({ error: 'Method not allowed' }, 405), request);

  const body = await request.json().catch(() => ({}));
  const today = tokyoNow().date;
  const capacity = { default: s.capacity.default, days: {} };
  // Forget plans for days that are over.
  for (const [d, p] of Object.entries(s.capacity.days)) if (d >= today) capacity.days[d] = p;

  let touched = [];
  if (body.date !== undefined) {
    if (!isValidDate(body.date) || body.date < today) {
      return withCors(json({ ok: false, code: 'invalid_date', error: '日付が正しくありません。' }, 400), request);
    }
    if (body.reset) delete capacity.days[body.date];
    else capacity.days[body.date] = normalizeCapacityPlan(body.plan);
    touched = [body.date];
  } else if (body.default) {
    const next = normalizeCapacityPlan(body.default);
    const old = capacity.default;
    for (let i = 0; i < OPEN_DAYS; i++) {
      const d = addDays(today, i);
      if (capacity.days[d]) continue;
      if (body.applyToOpenDays) touched.push(d);
      else if (!same(old, next)) capacity.days[d] = old; // open days keep what customers already saw
    }
    capacity.default = next;
  } else {
    return withCors(json({ ok: false, code: 'invalid_capacity', error: '設定内容が正しくありません。' }, 400), request);
  }

  await env.DB.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('capacity',?)").bind(JSON.stringify(capacity)).run();
  const conflicts = await conflictsFor(env, s, capacity, touched);
  return withCors(json({ ok: true, capacity, conflicts, poolLanes: POOL_LANE_IDS }), request);
}
