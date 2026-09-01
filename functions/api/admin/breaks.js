import { json, optionResponse, withCors, requireAdmin, isValidDate, isValidTime, randomId } from '../../lib/utils.js';
export async function onRequest(context) {
  if (context.request.method==='OPTIONS') return optionResponse(context.request);
  if (!await requireAdmin(context.request,context.env)) return withCors(json({error:'Unauthorized'},401),context.request);
  const b=await context.request.json().catch(()=>({}));
  if(!isValidDate(b.date)||!isValidTime(b.start)||!isValidTime(b.end)||b.start>=b.end) return withCors(json({error:'休息时间不正确'},400),context.request);
  await context.env.DB.prepare('INSERT INTO breaks(id,date,start_time,end_time,created_at) VALUES(?,?,?,?,?)').bind(randomId(),b.date,b.start,b.end,new Date().toISOString()).run();
  return withCors(json({ok:true}),context.request);
}
