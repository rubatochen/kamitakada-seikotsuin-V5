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
  isValidJapanesePhone,
  settings,
  findMenu
} from '../../lib/utils.js';
import { occupiedMinutes as menuOccupied, DEFAULT_MENU_ID } from '../../lib/config.js';
import { insertIntoFreeLane } from '../../lib/reservation-events.js';

function fail(request, status, code, error) {
  return withCors(json({ ok: false, code, error }, status), request);
}

// Staff booking (phone or walk-in). Unlike the web, staff can book any active
// menu, any lane, any date and without the "N hours ahead" rule; lanes and
// overlaps are still enforced the same way.
export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return optionResponse(request);
  if (request.method !== 'POST') return fail(request, 405, 'method_not_allowed', 'Method not allowed');
  if (!await requireAdmin(request, env)) return fail(request, 401, 'unauthorized', 'Unauthorized');

  const body = await request.json().catch(() => ({}));
  const str = v => typeof v === 'string' ? v.trim() : '';
  const date = str(body.date), time = str(body.time), name = str(body.name), phone = str(body.phone);
  const email = str(body.email), note = str(body.note);
  const extensionMinutes = Number(body.extensionMinutes || 0);
  const laneChoice = str(body.laneId) || 'auto';

  const s = await settings(env);
  const menu = findMenu(s, str(body.menuId) || DEFAULT_MENU_ID);
  if (!menu || !menu.offered) return fail(request, 400, 'invalid_menu', 'メニューが正しくありません。');
  if (!menu.extensions.includes(extensionMinutes)) return fail(request, 400, 'invalid_extension', '延長時間が正しくありません。');
  if (laneChoice !== 'auto' && !menu.lanes.includes(laneChoice)) return fail(request, 400, 'invalid_lane', 'このメニューはその枠では予約できません。');
  if (!isValidDate(date)) return fail(request, 400, 'invalid_date', '予約日が正しくありません。');
  if (!isValidTime(time)) return fail(request, 400, 'invalid_time', '予約時間が正しくありません。');
  if (!name) return fail(request, 400, 'invalid_name', 'お名前を入力してください。');
  if (!phone) return fail(request, 400, 'invalid_phone', '電話番号を入力してください。');
  if (!isValidJapanesePhone(phone)) return fail(request, 400, 'invalid_phone', '電話番号の形式が正しくありません。例：090-1234-5678');
  if (name.length > 80 || phone.length > 40 || email.length > 120 || note.length > 500) return fail(request, 400, 'input_too_long', '入力内容が長すぎます。');
  if (hasSlotStartedInTokyo(date, time)) return fail(request, 409, 'past_time', '開始済みまたは過去の時間は予約できません。');

  const availability = await buildSlots(env, date, new Date(), {
    menuId: menu.id, extension: extensionMinutes, staff: true,
    laneId: laneChoice === 'auto' ? null : laneChoice,
  });
  const slot = availability.slots.find(x => x.time === time);
  if (!slot) return fail(request, 409, 'unavailable', 'この時間は予約できません。');
  if (slot.status !== 'available') {
    const code = slot.status === 'past' ? 'past_time' : slot.status === 'booked' ? 'already_booked' : slot.status === 'break' ? 'break_time' : 'unavailable';
    return fail(request, 409, code, 'この時間は予約できません。');
  }

  const id = randomId();
  const createdAt = new Date().toISOString();
  const occupied = menuOccupied(menu, extensionMinutes);
  const finalNote = note ? '電話受付 · ' + note : '電話受付';
  let laneId;
  try {
    laneId = await insertIntoFreeLane(env, slot.lanes, {
      id, date, time, name, phone, email: email || null, note: finalNote,
      createdAt, duration: occupied, menuId: menu.id, startMinutes: minutesOf(time),
    });
  } catch (error) {
    console.error('Unable to create admin appointment', error);
    return fail(request, 503, 'reservation_failed', '予約を登録できませんでした。');
  }
  if (!laneId) return fail(request, 409, 'already_booked', 'この時間は先ほど予約された可能性があります。別の時間を選択してください。');

  return withCors(json({
    ok: true,
    appointment: {
      id, date, time, name, phone, email: email || null, note: finalNote, status: 'confirmed',
      created_at: createdAt, extension_minutes: extensionMinutes, duration_minutes: occupied,
      menu_id: menu.id, lane_id: laneId,
    }
  }), request);
}
