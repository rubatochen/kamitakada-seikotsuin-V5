import { json, optionResponse, withCors, requireAdmin, isValidTime, randomId, tokyoNow } from '../../lib/utils.js';
export async function onRequest(context) {
  if (context.request.method==='OPTIONS') return optionResponse(context.request);
  if (!await requireAdmin(context.request,context.env)) return withCors(json({error:'Unauthorized'},401),context.request);
  const b=await context.request.json().catch(()=>({}));
  if(!isValidTime(b.start)||!isValidTime(b.end)||b.start>=b.end) return withCors(json({error:'休息時間が正しくありません'},400),context.request);
  const date=tokyoNow(new Date()).date;
  await context.env.DB.prepare('INSERT INTO breaks(id,date,start_time,end_time,created_at) VALUES(?,?,?,?,?)').bind(randomId(),date,b.start,b.end,new Date().toISOString()).run();
  return withCors(json({ok:true,date}),context.request);
}
