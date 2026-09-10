import { json, optionResponse, withCors, settings, tokyoNow } from '../lib/utils.js';

function dateKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}-${String(date.getUTCDate()).padStart(2,'0')}`;
}

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') return optionResponse(context.request);
  if (context.request.method !== 'GET') return withCors(json({error:'Method not allowed'},405),context.request);

  let s;
  try {
    s = await settings(context.env);
  } catch (error) {
    console.error('Unable to load calendar settings', error);
    return withCors(json({ok:false, code:'service_unavailable', error:'現在カレンダーを取得できません。'},503), context.request);
  }
  const now = tokyoNow(new Date());
  const base = new Date(`${now.date}T12:00:00Z`);
  const dates = [];
  for (let i=0;i<14;i++) {
    const d = new Date(base);
    d.setUTCDate(base.getUTCDate()+i);
    dates.push(dateKey(d));
  }

  let rows;
  try {
    rows = await context.env.DB.prepare(
      "SELECT date, COUNT(*) AS count FROM appointments WHERE status = 'confirmed' AND date >= ? AND date <= ? GROUP BY date"
    ).bind(dates[0], dates[dates.length-1]).all();
  } catch (error) {
    console.error('Unable to load calendar bookings', error);
    return withCors(json({ok:false, code:'service_unavailable', error:'現在カレンダーを取得できません。'},503), context.request);
  }
  const bookedCounts = new Map((rows.results || []).map(r => [String(r.date), Number(r.count)||0]));
  const pauses = Array.isArray(s.temporaryPausePeriods) ? s.temporaryPausePeriods : [];

  const result = dates.map(date => {
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const closedByHours = !s.businessHours[String(weekday)];
    const pause = pauses.find(p => date >= String(p.startDate||'') && date < String(p.reopeningDate||''));
    return {
      date,
      closed: closedByHours || !!pause,
      reason: pause ? 'temporary_pause' : (closedByHours ? 'closed_day' : null),
      bookedCount: bookedCounts.get(date) || 0
    };
  });

  return withCors(json({dates:result}),context.request);
}
