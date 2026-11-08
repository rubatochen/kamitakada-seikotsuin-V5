import { json, optionResponse, withCors, requireAdmin, settings, tokyoNow, isValidDate } from '../../lib/utils.js';
import { laneWindow, planForDate, poolClosedSpans, planMax } from '../../lib/config.js';

const hhmm = n => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

function addDays(date, n) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') return optionResponse(context.request);
  if (!await requireAdmin(context.request, context.env)) return withCors(json({error:'Unauthorized'},401),context.request);
  const url = new URL(context.request.url);
  const today = tokyoNow().date;
  const date = url.searchParams.get('date') || today;
  if (!isValidDate(date)) return withCors(json({error:'Invalid date'},400),context.request);
  const last = addDays(today, 13);
  const [appointments, breaks, counts, holiday, s] = await Promise.all([
    context.env.DB.prepare("SELECT id,date,time,name,phone,email,note,status,created_at,duration_minutes,menu_id,lane_id FROM appointments WHERE date = ? ORDER BY time").bind(date).all(),
    context.env.DB.prepare("SELECT id,date,start_time as startTime,end_time as endTime,lane_id as laneId,created_at FROM breaks WHERE date IN (?,?) ORDER BY date,start_time").bind(date,today).all(),
    context.env.DB.prepare("SELECT date, COUNT(*) AS n FROM appointments WHERE status = 'confirmed' AND date >= ? AND date <= ? GROUP BY date").bind(today,last).all(),
    context.env.DB.prepare('SELECT date FROM holidays WHERE date = ?').bind(date).first(),
    settings(context.env)
  ]);
  // Open hours of each lane on the selected date, for drawing the timeline.
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const laneHours = {};
  for (const lane of s.lanes) laneHours[lane.id] = laneWindow(lane, weekday, s.businessHours);
  // 枠1〜3 that the day's capacity plan keeps closed, as time ranges.
  const plan = planForDate(s.capacity, date);
  const bh = s.businessHours[String(weekday)];
  const closed = {};
  if (bh) for (const [id, spans] of Object.entries(poolClosedSpans(plan, toMin(bh[0]), toMin(bh[1])))) {
    closed[id] = spans.map(x => [hhmm(x.start), hhmm(x.end)]);
  }
  const upcoming = {};
  for (const r of counts.results || []) upcoming[r.date] = Number(r.n) || 0;
  return withCors(json({
    today,
    date,
    holiday: Boolean(holiday),
    appointments: appointments.results || [],
    breaks: breaks.results || [],
    upcoming,
    laneHours,
    capacity: { plan, custom: Boolean(s.capacity.days[date]), max: planMax(plan), closed, standard: s.capacity.default, customDays: Object.keys(s.capacity.days).filter(d => d >= today) },
    lanes: s.lanes,
    menus: s.menus,
    temporaryPausePeriods: s.temporaryPausePeriods || [],
    businessHours: s.businessHours,
    slotMinutes: s.slotMinutes
  }),context.request);
}
