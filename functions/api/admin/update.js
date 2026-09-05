import {
  json,
  optionResponse,
  withCors,
  requireAdmin,
  buildSlots,
  hasSlotStartedInTokyo,
  isValidDate,
  isValidTime,
  minutesOf,
  isValidJapanesePhone
} from '../../lib/utils.js';

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return optionResponse(context.request);
  }

  if (context.request.method !== 'POST') {
    return withCors(json({ ok: false, error: 'Method not allowed' }, 405), context.request);
  }

  if (!await requireAdmin(context.request, context.env)) {
    return withCors(json({ ok: false, code: 'unauthorized', error: 'Unauthorized' }, 401), context.request);
  }

  const body = await context.request.json().catch(() => ({}));
  const id = typeof body.id === 'string' ? body.id.trim() : '';
  const date = typeof body.date === 'string' ? body.date.trim() : '';
  const time = typeof body.time === 'string' ? body.time.trim() : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  const extensionMinutes = Number(body.extensionMinutes || 0);
  const allowedExtensions = [0, 10, 20, 30];
  const occupiedMinutes = 30 + extensionMinutes;

  if (!id) {
    return withCors(json({ ok:false, code:'invalid_id', error:'予約IDが正しくありません。' },400),context.request);
  }
  if (!allowedExtensions.includes(extensionMinutes)) {
    return withCors(json({ ok:false, code:'invalid_extension', error:'延長時間が正しくありません。' },400),context.request);
  }
  if (!isValidDate(date)) {
    return withCors(json({ ok:false, code:'invalid_date', error:'予約日が正しくありません。' },400),context.request);
  }
  if (!isValidTime(time)) {
    return withCors(json({ ok:false, code:'invalid_time', error:'予約時間が正しくありません。' },400),context.request);
  }
  if (!name) {
    return withCors(json({ ok:false, code:'invalid_name', error:'お名前を入力してください。' },400),context.request);
  }
  if (!phone || !isValidJapanesePhone(phone)) {
    return withCors(json({ ok:false, code:'invalid_phone', error:'電話番号の形式が正しくありません。例：090-1234-5678' },400),context.request);
  }
  if (name.length > 80 || phone.length > 40 || note.length > 500) {
    return withCors(json({ ok:false, code:'input_too_long', error:'入力内容が長すぎます。' },400),context.request);
  }

  const current = await context.env.DB.prepare(
    "SELECT id,date,time,name,phone,email,note,status,created_at,duration_minutes FROM appointments WHERE id = ?"
  ).bind(id).first();

  if (!current) {
    return withCors(json({ ok:false, code:'not_found', error:'予約が見つかりません。' },404),context.request);
  }
  if (current.status !== 'confirmed') {
    return withCors(json({ ok:false, code:'not_editable', error:'キャンセル済みの予約は変更できません。' },409),context.request);
  }

  if (hasSlotStartedInTokyo(date, time)) {
    return withCors(json({ ok:false, code:'past_time', error:'開始済みまたは過去の時間は変更できません。' },409),context.request);
  }

  const availability = await buildSlots(context.env, date, new Date(), occupiedMinutes);
  const slot = availability.slots.find(s => s.time === time);

  if (!slot) {
    return withCors(json({ ok:false, code:'unavailable', error:'この時間は予約できません。' },409),context.request);
  }

  if (slot.status === 'past') {
    return withCors(json({ ok:false, code:'past_time', error:'開始済みまたは過去の時間は変更できません。' },409),context.request);
  }

  const requestedStart = minutesOf(time);
  const requestedEnd = requestedStart + occupiedMinutes;
  const otherAppointments = (availability.booked || []).filter(x => String(x.id) !== id);
  const overlap = otherAppointments.some(x => {
    const start = minutesOf(x.time);
    const occupied = Number(x.duration_minutes) || 30;
    return requestedStart < start + occupied && requestedEnd > start;
  });

  if (overlap) {
    return withCors(json({ ok:false, code:'already_booked', error:'この時間はすでに予約されています。' },409),context.request);
  }

  const breakOverlap = (availability.breaks || []).some(x => {
    const start = minutesOf(x.start_time);
    const end = minutesOf(x.end_time);
    return requestedStart < end && requestedEnd > start;
  });

  if (breakOverlap) {
    return withCors(json({ ok:false, code:'break_time', error:'休憩時間のため変更できません。' },409),context.request);
  }

  let finalNote = note;
  const oldNote = String(current.note || '');
  if (oldNote.startsWith('電話受付')) {
    finalNote = note.startsWith('電話受付') ? note : (note ? `電話受付 · ${note}` : '電話受付');
  }

  try {
    await context.env.DB.prepare(
      "UPDATE appointments SET date = ?, time = ?, name = ?, phone = ?, note = ?, duration_minutes = ? WHERE id = ? AND status = 'confirmed'"
    ).bind(date, time, name, phone, finalNote, occupiedMinutes, id).run();
  } catch (error) {
    console.error('Unable to update admin appointment', error);
    const message = String(error && error.message ? error.message : '');
    if (message.includes('UNIQUE') || message.includes('unique')) {
      return withCors(json({ ok:false, code:'already_booked', error:'この時間は先ほど予約された可能性があります。別の時間を選択してください。' },409),context.request);
    }
    return withCors(json({ ok:false, code:'update_failed', error:'予約を変更できませんでした。' },500),context.request);
  }

  return withCors(json({
    ok: true,
    appointment: {
      id,
      date,
      time,
      name,
      phone,
      email: current.email || null,
      note: finalNote,
      status: 'confirmed',
      created_at: current.created_at,
      duration_minutes: occupiedMinutes
    }
  }), context.request);
}
