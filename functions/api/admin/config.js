import { json, optionResponse, withCors, requireAdmin, settings, tokyoNow } from '../../lib/utils.js';
import { normalizeLanes, normalizeMenus } from '../../lib/config.js';

// Read or replace the lane (枠) and menu settings.
export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return optionResponse(request);
  if (!await requireAdmin(request, env)) return withCors(json({ error: 'Unauthorized' }, 401), request);

  if (request.method === 'GET') {
    const s = await settings(env);
    return withCors(json({ ok: true, lanes: s.lanes, menus: s.menus }), request);
  }
  if (request.method !== 'POST') return withCors(json({ error: 'Method not allowed' }, 405), request);

  const body = await request.json().catch(() => ({}));
  if (!Array.isArray(body.lanes) || !Array.isArray(body.menus)) {
    return withCors(json({ ok: false, code: 'invalid_config', error: '設定内容が正しくありません。' }, 400), request);
  }
  const lanes = normalizeLanes(body.lanes);
  const menus = normalizeMenus(body.menus, lanes);
  if (!lanes.some(l => l.active)) {
    return withCors(json({ ok: false, code: 'no_active_lane', error: '有効な枠が1つ以上必要です。' }, 400), request);
  }
  if (!menus.some(m => m.active)) {
    return withCors(json({ ok: false, code: 'no_active_menu', error: '有効なメニューが1つ以上必要です。' }, 400), request);
  }

  // A lane or menu that still has upcoming bookings can be switched off,
  // but not deleted, so those bookings never lose their place on the timeline.
  const today = tokyoNow().date;
  const rows = await env.DB.prepare(
    "SELECT DISTINCT lane_id, menu_id FROM appointments WHERE status = 'confirmed' AND date >= ?"
  ).bind(today).all();
  const laneIds = new Set(lanes.map(l => l.id));
  const menuIds = new Set(menus.map(m => m.id));
  for (const r of rows.results || []) {
    if (r.lane_id && !laneIds.has(r.lane_id)) {
      return withCors(json({ ok: false, code: 'lane_in_use', error: `枠「${r.lane_id}」には今後の予約があるため削除できません。無効にしてください。` }, 409), request);
    }
    if (r.menu_id && !menuIds.has(r.menu_id)) {
      return withCors(json({ ok: false, code: 'menu_in_use', error: `メニュー「${r.menu_id}」には今後の予約があるため削除できません。非公開にしてください。` }, 409), request);
    }
  }

  await env.DB.batch([
    env.DB.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('lanes',?)").bind(JSON.stringify(lanes)),
    env.DB.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('menus',?)").bind(JSON.stringify(menus)),
  ]);
  return withCors(json({ ok: true, lanes, menus }), request);
}
