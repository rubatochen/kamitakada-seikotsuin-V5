import {
  json,
  optionResponse,
  withCors,
  requireAdmin,
  buildSlots,
  hasSlotStartedInTokyo,
  isValidDate,
  isValidTime,
  randomId,
  minutesOf,
  isValidJapanesePhone
} from '../../lib/utils.js';

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return optionResponse(context.request);
  }

  if (context.request.method !== 'POST') {
    return withCors(
      json({ ok: false, error: 'Method not allowed' }, 405),
      context.request
    );
  }

  if (!await requireAdmin(context.request, context.env)) {
    return withCors(
      json({ ok: false, code: 'unauthorized', error: 'Unauthorized' }, 401),
      context.request
    );
  }

  const body = await context.request.json().catch(() => ({}));

  const date = typeof body.date === 'string' ? body.date.trim() : '';
  const time = typeof body.time === 'string' ? body.time.trim() : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const note = typeof body.note === 'string' ? body.note.trim() : '';

  if (!isValidDate(date)) {
    return withCors(
      json({
        ok: false,
        code: 'invalid_date',
        error: '予約日が正しくありません。'
      }, 400),
      context.request
    );
  }

  if (!isValidTime(time)) {
    return withCors(
      json({
        ok: false,
        code: 'invalid_time',
        error: '予約時間が正しくありません。'
      }, 400),
      context.request
    );
  }

  if (!name) {
    return withCors(
      json({
        ok: false,
        code: 'invalid_name',
        error: 'お名前を入力してください。'
      }, 400),
      context.request
    );
  }

  if (!phone) {
    return withCors(
      json({
        ok: false,
        code: 'invalid_phone',
        error: '電話番号を入力してください。'
      }, 400),
      context.request
    );
  }

  if (!isValidJapanesePhone(phone)) {
    return withCors(
      json({
        ok: false,
        code: 'invalid_phone',
        error: '電話番号の形式が正しくありません。例：090-1234-5678'
      }, 400),
      context.request
    );
  }

  if (
    name.length > 80 ||
    phone.length > 40 ||
    email.length > 120 ||
    note.length > 500
  ) {
    return withCors(
      json({
        ok: false,
        code: 'input_too_long',
        error: '入力内容が長すぎます。'
      }, 400),
      context.request
    );
  }

  if (hasSlotStartedInTokyo(date, time)) {
    return withCors(
      json({
        ok: false,
        code: 'past_time',
        error: '開始済みまたは過去の時間は予約できません。'
      }, 409),
      context.request
    );
  }

  const availability = await buildSlots(context.env, date);
  const slot = availability.slots.find(function (s) {
    return s.time === time;
  });

  if (!slot) {
    return withCors(
      json({
        ok: false,
        code: 'unavailable',
        error: 'この時間は予約できません。'
      }, 409),
      context.request
    );
  }

  if (slot.status !== 'available') {
    let code = 'unavailable';

    if (slot.status === 'past') {
      code = 'past_time';
    } else if (slot.status === 'booked') {
      code = 'already_booked';
    } else if (slot.status === 'break') {
      code = 'break_time';
    }

    return withCors(
      json({
        ok: false,
        code: code,
        error: 'この時間は予約できません。'
      }, 409),
      context.request
    );
  }

  const requestedStart = minutesOf(time);
  const requestedEnd = requestedStart + 30;

  const existing = await context.env.DB.prepare(
    "SELECT time FROM appointments WHERE date = ? AND status = 'confirmed'"
  ).bind(date).all();

  const overlap = (existing.results || []).some(function (x) {
    const start = minutesOf(x.time);
    return requestedStart < start + 30 && requestedEnd > start;
  });

  if (overlap) {
    return withCors(
      json({
        ok: false,
        code: 'already_booked',
        error: 'この時間はすでに予約されています。'
      }, 409),
      context.request
    );
  }

  const id = randomId();
  const createdAt = new Date().toISOString();
  const finalNote = note
    ? '電話受付 · ' + note
    : '電話受付';

  try {
    await context.env.DB
      .prepare(
        'INSERT INTO appointments ' +
        '(id,date,time,name,phone,email,note,status,created_at) ' +
        'VALUES (?,?,?,?,?,?,?,?,?)'
      )
      .bind(
        id,
        date,
        time,
        name,
        phone,
        email || null,
        finalNote,
        'confirmed',
        createdAt
      )
      .run();
  } catch (error) {
    console.error('Unable to create admin appointment', error);

    const message = String(error && error.message ? error.message : '');

    if (
      message.includes('UNIQUE') ||
      message.includes('unique')
    ) {
      return withCors(
        json({
          ok: false,
          code: 'already_booked',
          error: 'この時間は先ほど予約された可能性があります。別の時間を選択してください。'
        }, 409),
        context.request
      );
    }

    return withCors(
      json({
        ok: false,
        code: 'reservation_failed',
        error: '予約を登録できませんでした。'
      }, 500),
      context.request
    );
  }

  return withCors(
    json({
      ok: true,
      appointment: {
        id: id,
        date: date,
        time: time,
        name: name,
        phone: phone,
        email: email || null,
        note: finalNote,
        status: 'confirmed',
        created_at: createdAt
      }
    }),
    context.request
  );
}
