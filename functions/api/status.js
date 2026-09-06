import { json, optionResponse, withCors, settings, tokyoNow } from '../lib/utils.js';

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') return optionResponse(context.request);
  if (context.request.method !== 'GET') return withCors(json({ error: 'Method not allowed' }, 405), context.request);

  const s = await settings(context.env);
  const now = tokyoNow(new Date());
  const reopeningDate = s.temporaryPauseUntil || '';
  const paused = !!reopeningDate && reopeningDate > now.date;

  return withCors(json({
    paused,
    reopeningDate: paused ? reopeningDate : null,
    reopeningAt: paused ? reopeningDate : null,
  }), context.request);
}
