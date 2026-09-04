import {
  json,
  optionResponse,
  withCors,
  requireAdmin,
  isValidDate,
  tokyoNow,
  minutesOf,
  timeString,
  randomId
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
  const date = typeof body.date === 'string' ? body.date.trim() : '';
  const minutes = Number(body.minutes);

  if (!isValidDate(date)) {
    return withCors(json({ ok: false, code: 'invalid_date', error: '予約日が正しくありません。' }, 400), context.request);
  }

  if (![30, 40, 50, 60].includes(minutes)) {
    return withCors(json({ ok: false, code: 'invalid_minutes', error: '延長時間が正しくありません。' }, 400), context.request);
  }

  const now = tokyoNow();
  if (date < now.date) {
    return withCors(json({ ok: false, code: 'past_date', error: '過去の日付は延長できません。' }, 409), context.request);
  }

  // 延長は「現在時刻」から指定分だけ予約停止にする。
  // 既存の一時停止時間と重なる場合は、その区間を維持したまま結合する。
  const breaks = await context.env.DB.prepare(
    "SELECT id,start_time,end_time FROM breaks WHERE date = ? ORDER BY start_time"
  ).bind(date).all();

  const nowMinutes = minutesOf(now.time);
  const start = nowMinutes;
  const newEnd = start + minutes;

  // 今日以外はこのボタンでは扱わない。
  if (date !== now.date) {
    return withCors(json({ ok: false, code: 'today_only', error: '延長は本日のみです。' }, 400), context.request);
  }

  const overlappingBreaks = (breaks.results || []).filter(x => {
    const s = minutesOf(x.start_time);
    const e = minutesOf(x.end_time);
    return s < newEnd && e > start;
  });

  try {
    if (overlappingBreaks.length) {
      const mergedStart = Math.min(
        start,
        ...overlappingBreaks.map(x => minutesOf(x.start_time))
      );
      const mergedEnd = Math.max(
        newEnd,
        ...overlappingBreaks.map(x => minutesOf(x.end_time))
      );

      const keep = overlappingBreaks[0];

      await context.env.DB.prepare(
        "UPDATE breaks SET start_time = ?, end_time = ? WHERE id = ?"
      ).bind(
        timeString(mergedStart),
        timeString(mergedEnd),
        keep.id
      ).run();

      for (const extra of overlappingBreaks.slice(1)) {
        await context.env.DB.prepare("DELETE FROM breaks WHERE id = ?").bind(extra.id).run();
      }

      return withCors(json({
        ok: true,
        date,
        startTime: timeString(mergedStart),
        endTime: timeString(mergedEnd)
      }), context.request);
    }

    const id = randomId();

    await context.env.DB.prepare(
      "INSERT INTO breaks(id,date,start_time,end_time,created_at) VALUES(?,?,?,?,?)"
    ).bind(
      id,
      date,
      timeString(start),
      timeString(newEnd),
      new Date().toISOString()
    ).run();

    return withCors(json({
      ok: true,
      date,
      startTime: timeString(start),
      endTime: timeString(newEnd)
    }), context.request);
  } catch (error) {
    console.error('Unable to extend unavailable time', error);
    return withCors(json({
      ok: false,
      code: 'extension_failed',
      error: '延長できませんでした。'
    }, 500), context.request);
  }
}
