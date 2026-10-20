import { atomicAppointmentWrite, eventInsertStatement } from '../../lib/reservation-events.js';
import { json, optionResponse, withCors, requireAdmin } from '../../lib/utils.js';
export async function onRequest(context) {
  if (context.request.method==='OPTIONS') return optionResponse(context.request);
  if (!await requireAdmin(context.request,context.env)) return withCors(json({error:'Unauthorized'},401),context.request);
  const b=await context.request.json().catch(()=>({}));
  const id=String(b.id||'');
  const row=await context.env.DB.prepare("SELECT date,time FROM appointments WHERE id=? AND status='confirmed'").bind(id).first();
  if (!row) return withCors(json({ok:false,code:'not_found',error:'予約が見つかりません。'},404),context.request);
  const changed=await atomicAppointmentWrite(context.env,
    context.env.DB.prepare("UPDATE appointments SET status='cancelled' WHERE id=? AND status='confirmed'").bind(id),
    eventInsertStatement(context.env,'cancelled',row.date,row.time,null,null,id,'cancelled')
  );
  return withCors(json({ok:changed}),context.request);
}
