import { json, optionResponse, withCors, requireAdmin, isValidTime, isValidDate, randomId, tokyoNow, settings } from '../../lib/utils.js';

// Stop taking bookings for a time range, for every lane or one lane.
export async function onRequest(context) {
  if (context.request.method==='OPTIONS') return optionResponse(context.request);
  if (!await requireAdmin(context.request,context.env)) return withCors(json({error:'Unauthorized'},401),context.request);
  const b=await context.request.json().catch(()=>({}));
  if(!isValidTime(b.start)||!isValidTime(b.end)||b.start>=b.end) return withCors(json({error:'休憩時間が正しくありません'},400),context.request);
  const date = b.date === undefined ? tokyoNow(new Date()).date : String(b.date);
  if (!isValidDate(date) || date < tokyoNow(new Date()).date) return withCors(json({error:'日付が正しくありません'},400),context.request);
  let laneId = null;
  if (b.laneId) {
    const s = await settings(context.env);
    if (!s.lanes.some(l => l.id === b.laneId)) return withCors(json({error:'枠が正しくありません'},400),context.request);
    laneId = b.laneId;
  }
  await context.env.DB.prepare('INSERT INTO breaks(id,date,start_time,end_time,created_at,lane_id) VALUES(?,?,?,?,?,?)').bind(randomId(),date,b.start,b.end,new Date().toISOString(),laneId).run();
  return withCors(json({ok:true,date}),context.request);
}
