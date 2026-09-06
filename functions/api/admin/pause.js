import { json, optionResponse, withCors, requireAdmin, isValidDate, isValidTime, tokyoNow } from '../../lib/utils.js';

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') return optionResponse(context.request);
  if (!await requireAdmin(context.request, context.env)) return withCors(json({ error: 'Unauthorized' }, 401), context.request);

  const body = await context.request.json().catch(() => ({}));
  const action = String(body.action || '');

  if (action === 'resume') {
    await context.env.DB.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('temporary_pause_until','')").run();
    return withCors(json({ ok: true, paused: false, reopeningAt: null }), context.request);
  }

  if (action !== 'pause') {
    return withCors(json({ ok: false, code: 'invalid_action', error: 'Invalid action' }, 400), context.request);
  }

  const reopeningAt = String(body.reopeningAt || '').trim();
  const match = reopeningAt.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/);
  if (!match || !isValidDate(match[1]) || !isValidTime(match[2])) {
    return withCors(json({ ok: false, code: 'invalid_reopening_time', error: 'Invalid reopening time' }, 400), context.request);
  }

  const now = tokyoNow(new Date());
  const nowKey = `${now.date}T${now.time}`;
  if (reopeningAt <= nowKey) {
    return withCors(json({ ok: false, code: 'invalid_reopening_time', error: 'Reopening time must be in the future' }, 400), context.request);
  }

  await context.env.DB.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('temporary_pause_until',?)")
    .bind(reopeningAt)
    .run();

  return withCors(json({ ok: true, paused: true, reopeningAt }), context.request);
}
