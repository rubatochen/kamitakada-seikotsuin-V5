import { json, optionResponse, withCors, requireAdmin } from '../../lib/utils.js';
export async function onRequest(context) {
  if (context.request.method==='OPTIONS') return optionResponse(context.request);
  if (!await requireAdmin(context.request,context.env)) return withCors(json({error:'Unauthorized'},401),context.request);
  const b=await context.request.json().catch(()=>({}));
  await context.env.DB.prepare('DELETE FROM breaks WHERE id=?').bind(String(b.id||'')).run();
  return withCors(json({ok:true}),context.request);
}
