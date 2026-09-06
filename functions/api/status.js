import { json, optionResponse, withCors, settings, tokyoNow } from '../lib/utils.js';

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') return optionResponse(context.request);
  if (context.request.method !== 'GET') return withCors(json({ error: 'Method not allowed' }, 405), context.request);
  const s = await settings(context.env);
  const now = tokyoNow(new Date());
  const active = (s.temporaryPausePeriods || []).find(p => String(p.startDate || '') <= now.date && now.date < String(p.reopeningDate || ''));
  return withCors(json({ paused: !!active, reopeningDate: active ? active.reopeningDate : null, reopeningAt: active ? active.reopeningDate : null }), context.request);
}
