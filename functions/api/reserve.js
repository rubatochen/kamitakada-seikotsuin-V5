import {
  json,
  optionResponse,
  withCors,
  buildSlots,
  hasSlotStartedInTokyo,
  isValidDate,
  isValidTime,
  randomId,
  minutesOf,
  isWithinWebBookingWindow,
  isValidJapanesePhone,
  settings,
  findMenu
} from '../lib/utils.js';
import { occupiedMinutes as menuOccupied } from '../lib/config.js';
import { rateLimit } from '../lib/rate-limit.js';
import { readJsonObject, isReasonableEmail } from '../lib/request-validation.js';
import { insertIntoFreeLane } from '../lib/reservation-events.js';

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') return optionResponse(context.request);
  if (context.request.method !== 'POST') return withCors(json({error:'Method not allowed'},405),context.request);

  const limit = rateLimit(context.request, 'reserve', 10, 60 * 1000);
  if (!limit.allowed) {
    return withCors(json({ ok:false, code:'rate_limited', error:'アクセスが集中しています。しばらくしてから再度お試しください。' },429,{ 'Retry-After': String(limit.retryAfter) }), context.request);
  }

  const parsed = await readJsonObject(context.request, 16 * 1024);
  if (!parsed.ok) {
    return withCors(json({ok:false, code:parsed.tooLarge ? 'request_too_large' : 'invalid_json', error:parsed.tooLarge ? '入力内容が大きすぎます。' : '入力内容が正しくありません。'},400),context.request);
  }
  const body = parsed.value;
  if (!isValidDate(body.date) || !isValidTime(body.time)) {
    return withCors(json({error:'予約日時が正しくありません。'},400),context.request);
  }

  const name = String(body.name||'').trim();
  const phone = String(body.phone||'').trim();
  const extension = Number(body.extensionMinutes || 0);
  let menu;
  try {
    const s = await settings(context.env);
    menu = body.menuId === undefined ? (s.menus.find(m => m.offered && m.web) || s.menus[0]) : findMenu(s, String(body.menuId));
  } catch (error) {
    console.error('Unable to load menus', error);
    return withCors(json({ok:false, code:'service_unavailable', error:'現在予約を確認できません。しばらくしてから再度お試しください。'},503),context.request);
  }
  if (!menu || !menu.offered || !menu.web) {
    return withCors(json({ok:false,code:'menu_unavailable',error:'このメニューはWeb予約できません。'},400),context.request);
  }
  if (!menu.extensions.includes(extension)) {
    return withCors(json({error:'延長時間が正しくありません。'},400),context.request);
  }
  const occupiedMinutes = menuOccupied(menu, extension);

  if (!name || !phone) {
    return withCors(json({error:'お名前と電話番号を入力してください。'},400),context.request);
  }

  if (!isValidJapanesePhone(phone)) {
    return withCors(json({error:'電話番号の形式が正しくありません。例：090-1234-5678'},400),context.request);
  }

  if (!isWithinWebBookingWindow(body.date)) {
    return withCors(json({error:'Web予約は本日から14日先まで受け付けています。'},400),context.request);
  }

  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (
    name.length > 80 ||
    phone.length > 40 ||
    email.length > 120 ||
    note.length > 500 ||
    !isReasonableEmail(email) ||
    (body.name !== undefined && typeof body.name !== 'string') ||
    (body.phone !== undefined && typeof body.phone !== 'string') ||
    (body.email !== undefined && typeof body.email !== 'string') ||
    (body.note !== undefined && typeof body.note !== 'string')
  ) {
    return withCors(json({error:'入力内容が長すぎます。'},400),context.request);
  }

  if (hasSlotStartedInTokyo(body.date, body.time)) {
    return withCors(json({error:'開始済みまたは過去の時間は予約できません。'},400),context.request);
  }

  let availability;
  try {
    availability = await buildSlots(context.env, body.date, new Date(), { menuId: menu.id, extension });
  } catch (error) {
    console.error('Unable to check reservation availability', error);
    return withCors(json({ok:false, code:'service_unavailable', error:'現在予約を確認できません。しばらくしてから再度お試しください。'},503),context.request);
  }
  if (availability.temporarilyClosed) {
    return withCors(json({error:'現在は臨時休業中です。',code:'temporarily_closed',reopeningDate:availability.reopeningAt || null},409), context.request);
  }
  const slot = availability.slots.find(s=>s.time===body.time);

  if (slot && slot.status === 'notice') {
    return withCors(json({ok:false,code:'too_soon',error:`このメニューは${Math.round(menu.noticeMinutes/60*10)/10}時間前までのご予約が必要です。`},409),context.request);
  }
  if (!slot || slot.status !== 'available') {
    return withCors(json({error:'この時間はすでに予約済み、または予約できません。'},409),context.request);
  }

  // Lanes that are free for the whole occupied time; the insert re-checks
  // each lane atomically, so a simultaneous booking cannot double-book.
  const requestedStart = minutesOf(body.time);
  const appointmentId = randomId();
  let laneId;
  try {
    laneId = await insertIntoFreeLane(context.env, slot.lanes, {
      id: appointmentId, date: body.date, time: body.time, name, phone, email, note,
      createdAt: new Date().toISOString(), duration: occupiedMinutes, menuId: menu.id,
      startMinutes: requestedStart,
    });
  } catch (error) {
    console.error('Unable to save reservation',error);
    return withCors(json({ok:false,code:'reservation_failed',error:'現在予約を保存できません。しばらくしてから再度お試しください。'},503),context.request);
  }
  if (!laneId) {
    return withCors(json({ok:false,code:'already_booked',error:'この時間は先ほど予約された可能性があります。別の時間を選択してください。'},409),context.request);
  }

  return withCors(json({ok:true,date:body.date,time:body.time,extensionMinutes:extension,occupiedMinutes,menuId:menu.id,menuName:menu.name,treatMinutes:menu.treatMinutes+extension}),context.request);
}
