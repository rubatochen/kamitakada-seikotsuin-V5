import { json, optionResponse, withCors, buildSlots, isValidDate, isWithinWebBookingWindow } from '../lib/utils.js';
export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') return optionResponse(context.request);
  const url = new URL(context.request.url);
  const date = url.searchParams.get('date');
  if (!isValidDate(date)) return withCors(json({error:'Invalid date'},400),context.request);
  if (!isWithinWebBookingWindow(date)) {
    return withCors(json({error:'Web予約は本日から14日先まで受け付けています。'},400),context.request);
  }
  return withCors(json(await buildSlots(context.env,date)),context.request);
}
