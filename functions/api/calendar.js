import { json, optionResponse, withCors, isValidDate, tokyoNow } from '../lib/utils.js';

function addDays(date, days) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') return optionResponse(context.request);
  if (context.request.method !== 'GET') {
    return withCors(json({ error: 'Method not allowed' }, 405), context.request);
  }

  const today = tokyoNow(new Date()).date;
  const dates = Array.from({ length: 14 }, (_, i) => addDays(today, i));

  const rows = await context.env.DB.prepare('SELECT date FROM holidays').all();
  const holidayDates = new Set((rows.results || []).map(row => String(row.date)));

  const settingsRows = await context.env.DB
    .prepare("SELECT key,value FROM settings WHERE key IN ('business_hours','temporary_pause_periods')")
    .all();
  const values = Object.fromEntries((settingsRows.results || []).map(row => [row.key, row.value]));

  let businessHours = {};
  try { businessHours = JSON.parse(values.business_hours || '{}'); } catch { businessHours = {}; }

  let pausePeriods = [];
  try {
    const parsed = JSON.parse(values.temporary_pause_periods || '[]');
    pausePeriods = Array.isArray(parsed) ? parsed : [];
  } catch { pausePeriods = []; }

  const result = dates.map(date => {
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const weeklyClosed = !businessHours[String(weekday)];
    const holiday = holidayDates.has(date);
    const paused = pausePeriods.some(p =>
      date >= String(p.startDate || '') && date < String(p.reopeningDate || '')
    );
    return { date, closed: weeklyClosed || holiday || paused };
  });

  return withCors(json({ ok: true, dates: result }), context.request);
}
