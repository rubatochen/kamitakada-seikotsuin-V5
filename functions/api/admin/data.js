import { json, optionResponse, withCors, requireAdmin, settings, tokyoNow, isValidDate } from '../../lib/utils.js';
export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') return optionResponse(context.request);
  if (!await requireAdmin(context.request, context.env)) return withCors(json({error:'Unauthorized'},401),context.request);
  const url = new URL(context.request.url);
  const today = tokyoNow().date;
  const date = url.searchParams.get('date') || today;
  if (!isValidDate(date)) return withCors(json({error:'Invalid date'},400),context.request);
  const [appointments, breaks, s] = await Promise.all([
    context.env.DB.prepare("SELECT id,date,time,name,phone,email,note,status,created_at,duration_minutes FROM appointments WHERE date = ? ORDER BY time").bind(date).all(),
    context.env.DB.prepare("SELECT id,date,start_time as startTime,end_time as endTime,created_at FROM breaks WHERE date IN (?,?) ORDER BY date,start_time").bind(date,today).all(),
    settings(context.env)
  ]);
  return withCors(json({appointments:appointments.results||[],breaks:breaks.results||[],temporaryPausePeriods:s.temporaryPausePeriods||[],businessHours:s.businessHours,slotMinutes:s.slotMinutes}),context.request);
}
