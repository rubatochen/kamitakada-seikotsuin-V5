import { json, optionResponse, withCors, requireAdmin, settings } from '../../lib/utils.js';
export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') return optionResponse(context.request);
  if (!await requireAdmin(context.request, context.env)) return withCors(json({error:'Unauthorized'},401),context.request);
  const [appointments, breaks, holidays, s] = await Promise.all([
    context.env.DB.prepare("SELECT id,date,time,name,phone,email,note,status,created_at,duration_minutes FROM appointments ORDER BY date,time").all(),
    context.env.DB.prepare("SELECT id,date,start_time as startTime,end_time as endTime,created_at FROM breaks ORDER BY date,start_time").all(),
    context.env.DB.prepare("SELECT date FROM holidays ORDER BY date").all(),
    settings(context.env)
  ]);
  return withCors(json({appointments:appointments.results||[],breaks:breaks.results||[],holidays:(holidays.results||[]).map(x=>x.date),businessHours:s.businessHours,slotMinutes:s.slotMinutes}),context.request);
}
