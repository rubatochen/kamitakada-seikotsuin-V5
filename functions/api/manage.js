import {
  json,
  optionResponse,
  withCors,
  buildSlots,
  hasSlotStartedInTokyo,
  isValidDate,
  isValidTime,
  minutesOf,
  isWithinWebBookingWindow,
  isValidJapanesePhone,
  normalizeJapanesePhone
} from '../lib/utils.js';
import { rateLimit } from '../lib/rate-limit.js';
import { readJsonObject } from '../lib/request-validation.js';

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function invalidReservation() {
  return json({
    ok: false,
    code: 'not_found',
    error: '予約情報を確認できませんでした。'
  }, 404);
}

async function findAppointment(env, { date, time, name, phone }) {
  const normalizedPhone = normalizeJapanesePhone(phone);
  const rows = await env.DB.prepare(
    "SELECT id,date,time,name,phone,email,note,status,created_at,duration_minutes FROM appointments WHERE date = ? AND time = ? AND status = 'confirmed'"
  ).bind(date, time).all();

  const found = (rows.results || []).find(row =>
    String(row.name || '').trim() === name &&
    normalizeJapanesePhone(row.phone) === normalizedPhone
  );

  return found || null;
}

function appointmentPayload(row) {
  return {
    id: row.id,
    date: row.date,
    time: row.time,
    name: row.name,
    phone: row.phone,
    email: row.email || null,
    note: row.note || '',
    status: row.status,
    created_at: row.created_at,
    duration_minutes: Number(row.duration_minutes) || 30
  };
}

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') return optionResponse(context.request);

  const limit = rateLimit(context.request, 'manage', 30, 60 * 1000);
  if (!limit.allowed) {
    return withCors(json({ ok:false, code:'rate_limited', error:'アクセスが集中しています。しばらくしてから再度お試しください。' },429,{ 'Retry-After': String(limit.retryAfter) }), context.request);
  }

  if (context.request.method === 'GET') {
    const url = new URL(context.request.url);
    const date = clean(url.searchParams.get('date'));
    if (!isValidDate(date) || !isWithinWebBookingWindow(date)) {
      return withCors(json({ ok:false, code:'invalid_date', error:'予約日が正しくありません。' },400), context.request);
    }

    let rows;
    try {
      rows = await context.env.DB.prepare(
        "SELECT time FROM appointments WHERE date = ? AND status = 'confirmed' ORDER BY time"
      ).bind(date).all();
    } catch (error) {
      console.error('Unable to load management slots', error);
      return withCors(json({ok:false, code:'service_unavailable', error:'現在予約情報を取得できません。'},503), context.request);
    }

    return withCors(json({
      ok: true,
      date,
      slots: (rows.results || []).map(row => row.time).filter(isValidTime)
    }), context.request);
  }

  if (context.request.method !== 'POST') {
    return withCors(json({ ok:false, error:'Method not allowed' },405), context.request);
  }

  const parsed = await readJsonObject(context.request, 16 * 1024);
  if (!parsed.ok) {
    return withCors(json({ok:false, code:parsed.tooLarge ? 'request_too_large' : 'invalid_json', error:parsed.tooLarge ? '入力内容が大きすぎます。' : '入力内容が正しくありません。'},400), context.request);
  }
  const body = parsed.value;
  const action = clean(body.action);
  let date = clean(body.date);
  let time = clean(body.time);
  let name = clean(body.name);
  let phone = clean(body.phone);

  if (action === 'update') {
    const original = body.original && typeof body.original === 'object' && !Array.isArray(body.original) ? body.original : {};
    date = clean(original.date);
    time = clean(original.time);
    name = clean(original.name);
    phone = clean(original.phone);
  }

  if (!['verify','update','cancel'].includes(action) || !isValidDate(date) || !isValidTime(time) || !name || !phone || !isValidJapanesePhone(phone)) {
    return withCors(invalidReservation(), context.request);
  }
  if (name.length > 80 || phone.length > 40) {
    return withCors(json({ ok:false, code:'input_too_long', error:'入力内容が長すぎます。' },400), context.request);
  }
  if (!isWithinWebBookingWindow(date)) {
    return withCors(json({ ok:false, code:'invalid_date', error:'Web予約の受付期間外です。' },400), context.request);
  }
  if (hasSlotStartedInTokyo(date, time)) {
    return withCors(json({ ok:false, code:'past_time', error:'開始済みまたは過去の予約は変更・キャンセルできません。' },409), context.request);
  }

  const current = await findAppointment(context.env, { date, time, name, phone });
  if (!current) return withCors(invalidReservation(), context.request);

  if (action === 'verify') {
    return withCors(json({ ok:true, appointment:appointmentPayload(current) }), context.request);
  }

  if (action === 'cancel') {
    try {
      await context.env.DB.prepare(
        "UPDATE appointments SET status = 'cancelled' WHERE id = ? AND status = 'confirmed'"
      ).bind(current.id).run();
    } catch (error) {
      console.error('Unable to cancel customer appointment', error);
      return withCors(json({ ok:false, code:'cancel_failed', error:'予約をキャンセルできませんでした。' },500), context.request);
    }
    return withCors(json({ ok:true, date:current.date, time:current.time }), context.request);
  }

  if (action === 'update') {
    const newDate = clean(body.date);
    const newTime = clean(body.time);
    const newName = clean(body.name);
    const newPhone = clean(body.phone);
    const extensionMinutes = Number(body.extensionMinutes || 0);
    const note = clean(body.note);
    const allowedExtensions = [0,10,20,30];
    const occupiedMinutes = 30 + extensionMinutes;

    const original = body.original && typeof body.original === 'object' && !Array.isArray(body.original) ? body.original : {};
    const originalDate = clean(original.date);
    const originalTime = clean(original.time);
    const originalName = clean(original.name);
    const originalPhone = clean(original.phone);

    // Re-check the original identity on every update request; no client-side
    // state or appointment ID alone is trusted.
    if (
      originalDate !== current.date ||
      originalTime !== current.time ||
      originalName !== current.name ||
      normalizeJapanesePhone(originalPhone) !== normalizeJapanesePhone(current.phone)
    ) {
      return withCors(invalidReservation(), context.request);
    }

    if (!isValidDate(newDate) || !isValidTime(newTime) || !newName || !isValidJapanesePhone(newPhone)) {
      return withCors(json({ ok:false, code:'invalid_input', error:'変更内容を正しく入力してください。' },400), context.request);
    }
    if (!allowedExtensions.includes(extensionMinutes) || newName.length > 80 || newPhone.length > 40 || note.length > 500 || typeof body.name !== 'string' || typeof body.phone !== 'string' || typeof body.note !== 'string') {
      return withCors(json({ ok:false, code:'invalid_input', error:'変更内容が正しくありません。' },400), context.request);
    }
    if (!isWithinWebBookingWindow(newDate)) {
      return withCors(json({ ok:false, code:'invalid_date', error:'Web予約は本日から14日先までです。' },400), context.request);
    }
    if (hasSlotStartedInTokyo(newDate, newTime)) {
      return withCors(json({ ok:false, code:'past_time', error:'開始済みまたは過去の時間には変更できません。' },409), context.request);
    }

    let availability;
    try {
      availability = await buildSlots(context.env, newDate, new Date(), occupiedMinutes);
    } catch (error) {
      console.error('Unable to check updated reservation availability', error);
      return withCors(json({ ok:false, code:'service_unavailable', error:'現在予約可能状況を確認できません。' },503), context.request);
    }
    if (availability.temporarilyClosed) {
      return withCors(json({ ok:false, code:'temporarily_closed', error:'現在は臨時休業中です。' },409), context.request);
    }

    const slot = (availability.slots || []).find(s => s.time === newTime);
    if (!slot) {
      return withCors(json({ ok:false, code:'unavailable', error:'この時間は予約できません。' },409), context.request);
    }

    const requestedStart = minutesOf(newTime);
    const requestedEnd = requestedStart + occupiedMinutes;
    const otherAppointments = (availability.booked || []).filter(x => String(x.id) !== String(current.id));
    const overlap = otherAppointments.some(x => {
      const start = minutesOf(x.time);
      const occupied = Number(x.duration_minutes) || 30;
      return requestedStart < start + occupied && requestedEnd > start;
    });

    if (overlap) {
      return withCors(json({ ok:false, code:'already_booked', error:'この時間はすでに予約されています。別の時間を選択してください。' },409), context.request);
    }

    const breakOverlap = (availability.breaks || []).some(x => {
      const start = minutesOf(x.start_time);
      const end = minutesOf(x.end_time);
      return requestedStart < end && requestedEnd > start;
    });
    if (breakOverlap) {
      return withCors(json({ ok:false, code:'break_time', error:'休憩時間のため変更できません。' },409), context.request);
    }

    try {
      await context.env.DB.prepare(
        "UPDATE appointments SET date = ?, time = ?, name = ?, phone = ?, note = ?, duration_minutes = ? WHERE id = ? AND status = 'confirmed'"
      ).bind(newDate,newTime,newName,newPhone,note,occupiedMinutes,current.id).run();
    } catch (error) {
      console.error('Unable to update customer appointment', error);
      const message = String(error && error.message ? error.message : '');
      if (message.includes('UNIQUE') || message.includes('unique')) {
        return withCors(json({ ok:false, code:'already_booked', error:'この時間は先ほど予約された可能性があります。別の時間を選択してください。' },409), context.request);
      }
      return withCors(json({ ok:false, code:'update_failed', error:'予約を変更できませんでした。' },500), context.request);
    }

    let updated;
    try {
      updated = await context.env.DB.prepare(
        "SELECT id,date,time,name,phone,email,note,status,created_at,duration_minutes FROM appointments WHERE id = ?"
      ).bind(current.id).first();
    } catch (error) {
      console.error('Unable to reload updated customer appointment', error);
      return withCors(json({ ok:false, code:'update_succeeded_reload_failed', error:'予約は変更されましたが、最新情報を取得できませんでした。' },503), context.request);
    }

    return withCors(json({ ok:true, appointment:appointmentPayload(updated || {
      id:current.id,date:newDate,time:newTime,name:newName,phone:newPhone,email:current.email,note,duration_minutes:occupiedMinutes,status:'confirmed',created_at:current.created_at
    }) }), context.request);
  }

  return withCors(json({ ok:false, code:'invalid_action', error:'操作を指定してください。' },400), context.request);
}
