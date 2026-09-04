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
  isValidJapanesePhone
} from '../lib/utils.js';

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') return optionResponse(context.request);
  if (context.request.method !== 'POST') return withCors(json({error:'Method not allowed'},405),context.request);

  const body = await context.request.json().catch(()=>null);
  if (!body || !isValidDate(body.date) || !isValidTime(body.time)) {
    return withCors(json({error:'予約日時が正しくありません。'},400),context.request);
  }

  const name = String(body.name||'').trim();
  const phone = String(body.phone||'').trim();

  if (!name || !phone) {
    return withCors(json({error:'お名前と電話番号を入力してください。'},400),context.request);
  }

  if (!isValidJapanesePhone(phone)) {
    return withCors(json({error:'電話番号の形式が正しくありません。例：090-1234-5678'},400),context.request);
  }

  if (!isWithinWebBookingWindow(body.date)) {
    return withCors(json({error:'Web予約は本日から14日先まで受け付けています。'},400),context.request);
  }

  if (
    name.length>80 ||
    phone.length>40 ||
    String(body.email||'').length>120 ||
    String(body.note||'').length>500
  ) {
    return withCors(json({error:'入力内容が長すぎます。'},400),context.request);
  }

  if (hasSlotStartedInTokyo(body.date, body.time)) {
    return withCors(json({error:'開始済みまたは過去の時間は予約できません。'},400),context.request);
  }

  const availability = await buildSlots(context.env, body.date);
  const slot = availability.slots.find(s=>s.time===body.time);

  if (!slot || slot.status !== 'available') {
    return withCors(json({error:'この時間はすでに予約済み、または予約できません。'},409),context.request);
  }

  // 1 分単位の開始時刻でも、予約全体 30 分が他の予約と重ならないことを
  // サーバー側でも再確認する。
  const requestedStart = minutesOf(body.time);
  const requestedEnd = requestedStart + 30;

  const existing = await context.env.DB.prepare(
    "SELECT time FROM appointments WHERE date = ? AND status = 'confirmed'"
  ).bind(body.date).all();

  const overlap = (existing.results || []).some(x => {
    const start = minutesOf(x.time);
    return requestedStart < start + 30 && requestedEnd > start;
  });

  if (overlap) {
    return withCors(json({error:'この時間はすでに予約済みです。別の時間を選択してください。'},409),context.request);
  }

  try {
    await context.env.DB.prepare(
      'INSERT INTO appointments(id,date,time,name,phone,email,note,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)'
    )
      .bind(
        randomId(),
        body.date,
        body.time,
        name,
        phone,
        String(body.email||'').trim(),
        String(body.note||'').trim(),
        'confirmed',
        new Date().toISOString()
      )
      .run();
  } catch (e) {
    return withCors(
      json({error:'この時間は先ほど予約された可能性があります。別の時間を選択してください。'},409),
      context.request
    );
  }

  return withCors(json({ok:true,date:body.date,time:body.time}),context.request);
}
