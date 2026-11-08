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
  isValidJapanesePhone,
  settings,
  findMenu
} from '../../lib/utils.js';
import { occupiedMinutes as menuOccupied, DEFAULT_MENU_ID, DEFAULT_LANE_ID } from '../../lib/config.js';
import { updateIntoFreeLane } from '../../lib/reservation-events.js';

function fail(request, status, code, error) {
  return withCors(json({ ok: false, code, error }, status), request);
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return optionResponse(request);
  if (request.method !== 'POST') return fail(request, 405, 'method_not_allowed', 'Method not allowed');
  if (!await requireAdmin(request, env)) return fail(request, 401, 'unauthorized', 'Unauthorized');

  const body = await request.json().catch(() => ({}));
  const str = v => typeof v === 'string' ? v.trim() : '';
  const id = str(body.id), date = str(body.date), time = str(body.time), name = str(body.name), phone = str(body.phone), note = str(body.note);
  const extensionMinutes = Number(body.extensionMinutes || 0);

  if (!id) return fail(request, 400, 'invalid_id', '予約IDが正しくありません。');
  if (!isValidDate(date)) return fail(request, 400, 'invalid_date', '予約日が正しくありません。');
  if (!isValidTime(time)) return fail(request, 400, 'invalid_time', '予約時間が正しくありません。');
  if (!name) return fail(request, 400, 'invalid_name', 'お名前を入力してください。');
  if (phone && !isValidJapanesePhone(phone)) return fail(request, 400, 'invalid_phone', '電話番号の形式が正しくありません。例：090-1234-5678');  // optional for staff
  if (name.length > 80 || phone.length > 40 || note.length > 500) return fail(request, 400, 'input_too_long', '入力内容が長すぎます。');

  const current = await env.DB.prepare(
    "SELECT id,date,time,name,phone,email,note,status,created_at,duration_minutes,menu_id,lane_id FROM appointments WHERE id = ?"
  ).bind(id).first();
  if (!current) return fail(request, 404, 'not_found', '予約が見つかりません。');
  if (current.status !== 'confirmed') return fail(request, 409, 'not_editable', 'キャンセル済みの予約は変更できません。');
  if (hasSlotStartedInTokyo(date, time)) return fail(request, 409, 'past_time', '開始済みまたは過去の時間は変更できません。');

  const s = await settings(env);
  const menu = findMenu(s, str(body.menuId) || current.menu_id || DEFAULT_MENU_ID);
  if (!menu) return fail(request, 400, 'invalid_menu', 'メニューが正しくありません。');
  if (!menu.extensions.includes(extensionMinutes)) return fail(request, 400, 'invalid_extension', '延長時間が正しくありません。');
  const laneChoice = str(body.laneId) || 'auto';
  if (laneChoice !== 'auto' && !menu.lanes.includes(laneChoice)) return fail(request, 400, 'invalid_lane', 'このメニューはその枠では予約できません。');

  const availability = await buildSlots(env, date, new Date(), {
    menuId: menu.id, extension: extensionMinutes, excludeId: id, staff: true,
    laneId: laneChoice === 'auto' ? null : laneChoice,
  });
  const slot = availability.slots.find(x => x.time === time);
  if (!slot) return fail(request, 409, 'unavailable', 'この時間は予約できません。');
  if (slot.status !== 'available') {
    const code = slot.status === 'past' ? 'past_time' : slot.status === 'booked' ? 'already_booked' : slot.status === 'break' ? 'break_time' : 'unavailable';
    return fail(request, 409, code, 'この時間は予約できません。');
  }

  let finalNote = note;
  if (String(current.note || '').startsWith('電話受付')) {
    finalNote = note.startsWith('電話受付') ? note : (note ? `電話受付 · ${note}` : '電話受付');
  }
  const occupied = menuOccupied(menu, extensionMinutes);
  const currentLane = current.lane_id || DEFAULT_LANE_ID;
  const lanes = slot.lanes.includes(currentLane) ? [currentLane, ...slot.lanes.filter(x => x !== currentLane)] : slot.lanes;

  let laneId;
  try {
    laneId = await updateIntoFreeLane(env, lanes, {
      id, date, time, name, phone, note: finalNote, duration: occupied, menuId: menu.id,
      startMinutes: minutesOf(time),
      eventType: (current.date !== date || current.time !== time) ? 'moved' : 'updated',
      fromDate: current.date, fromTime: current.time,
    });
  } catch (error) {
    console.error('Unable to update admin appointment', error);
    return fail(request, 503, 'update_failed', '予約を変更できませんでした。');
  }
  if (!laneId) return fail(request, 409, 'already_booked', 'この時間は先ほど予約された可能性があります。別の時間を選択してください。');

  return withCors(json({
    ok: true,
    appointment: {
      id, date, time, name, phone, email: current.email || null, note: finalNote, status: 'confirmed',
      created_at: current.created_at, duration_minutes: occupied, menu_id: menu.id, lane_id: laneId,
    }
  }), request);
}
