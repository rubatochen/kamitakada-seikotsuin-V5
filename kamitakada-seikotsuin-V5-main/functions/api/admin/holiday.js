import { json, optionResponse, withCors, requireAdmin, isValidDate } from '../../lib/utils.js';
export async function onRequest(context) {
  if (context.request.method==='OPTIONS') return optionResponse(context.request);
  if (!await requireAdmin(context.request,context.env)) return withCors(json({error:'Unauthorized'},401),context.request);
  const b=await context.request.json().catch(()=>({}));
  if(!isValidDate(b.date)) return withCors(json({error:'日期不正确'},400),context.request);
  await context.env.DB.prepare('INSERT OR REPLACE INTO holidays(date,reason) VALUES(?,?)').bind(b.date,String(b.reason||'')).run();
  return withCors(json({ok:true}),context.request);
}
