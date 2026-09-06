import { json, optionResponse, withCors, settings, tokyoNow } from '../lib/utils.js';

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') return optionResponse(context.request);
  if (context.request.method !== 'GET') return withCors(json({ error: 'Method not allowed' }, 405), context.request);

  const s = await settings(context.env);
  const now = tokyoNow(new Date());
  const nowKey = `${now.date}T${now.time}`;
  const reopeningAt = s.temporaryPauseUntil || '';
  const paused = !!reopeningAt && reopeningAt > nowKey;

  return withCors(json({
    paused,
    reopeningAt: paused ? reopeningAt : null,
  }), context.request);
}
