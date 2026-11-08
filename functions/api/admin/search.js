import { json, optionResponse, withCors, requireAdmin, tokyoNow, normalizeJapanesePhone } from '../../lib/utils.js';

// Find bookings by name or phone across all dates (for "when was my booking?" calls).
// With an empty query, lists upcoming bookings for the next 14 days.
export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return optionResponse(request);
  if (request.method !== 'GET') return withCors(json({ error: 'Method not allowed' }, 405), request);
  if (!await requireAdmin(request, env)) return withCors(json({ error: 'Unauthorized' }, 401), request);

  const url = new URL(request.url);
  const q = String(url.searchParams.get('q') || '').trim().slice(0, 40);
  const today = tokyoNow().date;
  const cols = 'id,date,time,name,phone,note,status,duration_minutes,menu_id,lane_id';
  let rows;
  if (!q) {
    const end = new Date(`${today}T12:00:00Z`); end.setUTCDate(end.getUTCDate() + 13);
    rows = await env.DB.prepare(
      `SELECT ${cols} FROM appointments WHERE status = 'confirmed' AND date >= ? AND date <= ? ORDER BY date, time LIMIT 300`
    ).bind(today, end.toISOString().slice(0, 10)).all();
  } else {
    const digits = normalizeJapanesePhone(q).replace(/\D/g, '');
    const like = `%${q.replace(/[%_]/g, '')}%`;
    rows = await env.DB.prepare(
      `SELECT ${cols} FROM appointments
       WHERE name LIKE ? OR (? <> '' AND replace(replace(replace(phone,'-',''),' ',''),'ー','') LIKE ?)
       ORDER BY CASE WHEN date >= ? THEN 0 ELSE 1 END, CASE WHEN date >= ? THEN date END ASC, date DESC, time
       LIMIT 60`
    ).bind(like, digits, `%${digits}%`, today, today).all();
  }
  return withCors(json({ ok: true, today, query: q, results: rows.results || [] }), request);
}
