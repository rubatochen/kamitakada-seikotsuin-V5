import { json, optionResponse, withCors, buildSlots, isValidDate, isWithinWebBookingWindow, settings, findMenu } from '../lib/utils.js';
import { publicMenu } from '../lib/config.js';

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') return optionResponse(context.request);
  const url = new URL(context.request.url);
  const date = url.searchParams.get('date');
  const extension = Number(url.searchParams.get('extension') || 0);
  if (!isValidDate(date)) return withCors(json({error:'Invalid date'},400),context.request);
  if (!isWithinWebBookingWindow(date)) {
    return withCors(json({error:'Web予約は本日から14日先まで受け付けています。'},400),context.request);
  }
  try {
    const s = await settings(context.env);
    const requested = url.searchParams.get('menu');
    const menu = requested ? findMenu(s, requested) : (s.menus.find(m => m.offered && m.web) || s.menus[0]);
    if (!menu || !menu.offered || !menu.web) return withCors(json({error:'このメニューはWeb予約できません。',code:'menu_unavailable'},400),context.request);
    if (!menu.extensions.includes(extension)) return withCors(json({error:'Invalid extension'},400),context.request);

    const result = await buildSlots(context.env, date, new Date(), { menuId: menu.id, extension });
    // Never expose patient records or lane assignments on a public endpoint.
    // Only slot status and anonymous busy intervals are needed by the booking page.
    const publicResult = {
      menu: publicMenu(menu),
      slots: result.slots.map(x => ({ time: x.time, status: x.status })),
      holiday: result.holiday,
      past: result.past,
      unavailable: result.unavailable,
      temporarilyClosed: Boolean(result.temporarilyClosed),
      paused: Boolean(result.paused),
      reopeningAt: result.reopeningAt,
      businessHours: result.settings.businessHours,
    };
    return withCors(json(publicResult,200,{'Cache-Control':'no-store'}),context.request);
  } catch (error) {
    console.error('Unable to load availability', error);
    return withCors(json({ok:false, code:'service_unavailable', error:'現在予約可能状況を取得できません。'},503),context.request);
  }
}
