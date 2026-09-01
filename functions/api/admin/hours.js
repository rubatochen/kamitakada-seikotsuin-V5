import { json, optionResponse, withCors, requireAdmin } from '../../lib/utils.js';
export async function onRequest(context) {
  if (context.request.method==='OPTIONS') return optionResponse(context.request);
  if (!await requireAdmin(context.request,context.env)) return withCors(json({error:'Unauthorized'},401),context.request);
  const b=await context.request.json().catch(()=>({}));
  const mins=Number(b.slotMinutes);
  if(![15,30,60].includes(mins)) return withCors(json({error:'预约间隔不正确'},400),context.request);
  await context.env.DB.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('business_hours',?)").bind(JSON.stringify(b.businessHours||{})).run();
  await context.env.DB.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('slot_minutes',?)").bind(String(mins)).run();
  return withCors(json({ok:true}),context.request);
}
