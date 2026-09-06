import { json, optionResponse, withCors, requireAdmin, isValidDate, randomId } from '../../lib/utils.js';

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') return optionResponse(context.request);
  if (!await requireAdmin(context.request, context.env)) return withCors(json({ error: 'Unauthorized' }, 401), context.request);
  const body = await context.request.json().catch(() => ({}));
  const action = String(body.action || '');
  const settingsRows = await context.env.DB.prepare("SELECT key,value FROM settings WHERE key IN ('temporary_pause_periods','temporary_pause_until')").all();
  const values = Object.fromEntries((settingsRows.results || []).map(r => [r.key, r.value]));
  let periods = [];
  try { periods = JSON.parse(values.temporary_pause_periods || '[]'); } catch { periods = []; }
  if (!Array.isArray(periods)) periods = [];

  // Backward compatibility with the previous single-date pause setting.
  if (!periods.length && values.temporary_pause_until) {
    const until = String(values.temporary_pause_until).slice(0,10);
    const today = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    if (until && until > today) periods = [{ id: randomId(), startDate: today, reopeningDate: until }];
  }

  if (action === 'delete') {
    const id = String(body.id || '');
    if (!id) return withCors(json({ok:false,code:'invalid_id',error:'Invalid id'},400),context.request);
    periods = periods.filter(p => String(p.id) !== id);
  } else if (action === 'save') {
    const startDate = String(body.startDate || '').trim();
    const reopeningDate = String(body.reopeningDate || '').trim();
    if (!isValidDate(startDate) || !isValidDate(reopeningDate) || startDate >= reopeningDate) {
      return withCors(json({ok:false,code:'invalid_date_range',error:'Invalid date range'},400),context.request);
    }
    const id = String(body.id || '').trim() || randomId();
    const next = { id, startDate, reopeningDate };
    const index = periods.findIndex(p => String(p.id) === id);
    if (index >= 0) periods[index] = next; else periods.push(next);
    periods.sort((a,b)=>String(a.startDate).localeCompare(String(b.startDate)));
  } else {
    return withCors(json({ok:false,code:'invalid_action',error:'Invalid action'},400),context.request);
  }

  await context.env.DB.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('temporary_pause_periods',?)").bind(JSON.stringify(periods)).run();
  // Clear the legacy single-pause value so it cannot conflict with the new list.
  await context.env.DB.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('temporary_pause_until','')").run();
  const active = periods.find(p => p.startDate <= new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()) && new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()) < p.reopeningDate);
  return withCors(json({ok:true,periods,paused:!!active,reopeningAt:active?active.reopeningDate:null}),context.request);
}
