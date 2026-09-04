import { json, optionResponse, withCors, clearSessionCookie, cookieToken } from '../lib/utils.js';
export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') return optionResponse(context.request);
  const token = cookieToken(context.request);
  if (token) await context.env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
  return withCors(json({ok:true},200,{"Set-Cookie":clearSessionCookie()}), context.request);
}
