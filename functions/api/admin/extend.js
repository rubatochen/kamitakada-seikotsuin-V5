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

  if (minutes !== 10 && minutes !== 30) {
    return withCors(json({ ok: false, code: 'invalid_minutes', error: '延長時間が正しくありません。' }, 400), context.request);
  }

  const now = tokyoNow();
  if (date < now.date) {
    return withCors(json({ ok: false, code: 'past_date', error: '過去の日付は延長できません。' }, 409), context.request);
  }

  // 「現在すでに予約できない時間」があれば、その連続した終点から延長。
  // なければ現在時刻から新しい一時停止時間を作る。
  const appointments = await context.env.DB.prepare(
    "SELECT time FROM appointments WHERE date = ? AND status = 'confirmed' ORDER BY time"
  ).bind(date).all();

  const breaks = await context.env.DB.prepare(
    "SELECT id,start_time,end_time FROM breaks WHERE date = ? ORDER BY start_time"
  ).bind(date).all();

  const intervals = [
    ...(appointments.results || []).map(x => ({
      start: minutesOf(x.time),
      end: minutesOf(x.time) + 30
    })),
    ...(breaks.results || []).map(x => ({
      start: minutesOf(x.start_time),
      end: minutesOf(x.end_time)
    }))
  ].filter(x => x.end > x.start).sort((a, b) => a.start - b.start);

  const nowMinutes = minutesOf(now.time);
  let start = date === now.date ? nowMinutes : 0;
  let end = start;

  // 找到当前时刻所在的不可预约区间，并沿连续/相接区间向后合并。
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of intervals) {
      if (item.start <= end && item.end > start && item.end > end) {
        end = item.end;
        changed = true;
      }
    }
  }

  if (end <= start) {
    end = start;
  }

  const newEnd = end + minutes;

  // 与现有 breaks 合并，避免连续点击产生很多重叠记录。
  const overlappingBreaks = (breaks.results || []).filter(x => {
    const s = minutesOf(x.start_time);
    const e = minutesOf(x.end_time);
    return s <= newEnd && e >= start;
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
