import { json, optionResponse, withCors, buildSlots, isValidDate, isValidTime, randomId } from '../lib/utils.js';
export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') return optionResponse(context.request);
  if (context.request.method !== 'POST') return withCors(json({error:'Method not allowed'},405),context.request);
  const body = await context.request.json().catch(()=>null);
  if (!body || !isValidDate(body.date) || !isValidTime(body.time)) return withCors(json({error:'予約日時が正しくありません。'},400),context.request);
  const name = String(body.name||'').trim(), phone = String(body.phone||'').trim();
  if (!name || !phone) return withCors(json({error:'お名前と電話番号を入力してください。'},400),context.request);
  if (name.length>80 || phone.length>40 || String(body.email||'').length>120 || String(body.note||'').length>500) return withCors(json({error:'入力内容が長すぎます。'},400),context.request);
  const now = new Date();
  const today = new Date();
  today.setHours(0,0,0,0);
  const requested = new Date(`${body.date}T${body.time}:00`);
  if (requested < today) return withCors(json({error:'過去の日付は予約できません。'},400),context.request);
  const availability = await buildSlots(context.env, body.date);
  const slot = availability.slots.find(s=>s.time===body.time);
  if (!slot || slot.status !== 'available') return withCors(json({error:'この時間はすでに予約済み、または予約できません。'},409),context.request);
  try {
    await context.env.DB.prepare('INSERT INTO appointments(id,date,time,name,phone,email,note,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .bind(randomId(),body.date,body.time,name,phone,String(body.email||'').trim(),String(body.note||'').trim(),'confirmed',new Date().toISOString()).run();
  } catch (e) {
    return withCors(json({error:'この時間は先ほど予約された可能性があります。別の時間を選択してください。'},409),context.request);
  }
  return withCors(json({ok:true,date:body.date,time:body.time}),context.request);
}
