import { json, optionResponse, withCors, settings, tokyoNow } from '../lib/utils.js';
import { publicMenu } from '../lib/config.js';

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') return optionResponse(context.request);
  if (context.request.method !== 'GET') return withCors(json({ error: 'Method not allowed' }, 405), context.request);
  let s;
  try {
    s = await settings(context.env);
  } catch (error) {
    console.error('Unable to load status settings', error);
    return withCors(json({ ok: false, code: 'service_unavailable', error: '現在営業状況を取得できません。' }, 503), context.request);
  }
  const now = tokyoNow(new Date());
  const active = (s.temporaryPausePeriods || []).find(p => String(p.startDate || '') <= now.date && now.date < String(p.reopeningDate || ''));
  return withCors(json({
    paused: !!active,
    reopeningDate: active ? active.reopeningDate : null,
    reopeningAt: active ? active.reopeningDate : null,
    // Public weekly hours so the homepage always matches the admin setting.
    businessHours: s.businessHours || {},
    // Menus a patient can book on the web (no lanes, no staff details).
    menus: (s.menus || []).filter(m => m.offered && m.web).map(publicMenu),
  }, 200, { 'Cache-Control': 'no-store' }), context.request);
}
