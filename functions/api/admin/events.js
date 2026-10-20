import { json, optionResponse, withCors, requireAdmin } from '../../lib/utils.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return optionResponse(request);
  if (request.method !== 'GET') return withCors(json({error:'Method not allowed'},405),request);
  if (!await requireAdmin(request,env)) return withCors(json({error:'Unauthorized'},401),request);
  const afterParam = new URL(request.url).searchParams.get('after');
  const after = afterParam === null ? null : afterParam;
  if (after !== null && !/^reservation_event:\d{13}:[0-9a-f-]{36}$/.test(after)) {
    return withCors(json({error:'Invalid cursor'},400),request);
  }
  try {
    if (after === null) {
      // Initial login: establish a baseline; no mass narration of old events.
      const latest = await env.DB.prepare(
        "SELECT MAX(key) AS cursor FROM settings WHERE key GLOB 'reservation_event:*'"
      ).first();
      return withCors(json({ok:true, cursor:latest?.cursor||'reservation_event:0000000000000:00000000-0000-0000-0000-000000000000', events:[]},200,{'Cache-Control':'no-store'}),request);
    }
    const earliest = 'reservation_event:' + String(Date.now() - 14 * 86400000).padStart(13,'0');
    const rows = await env.DB.prepare(
      "SELECT key AS id, value FROM settings WHERE key GLOB 'reservation_event:*' AND key > ? AND key >= ? ORDER BY key LIMIT 100"
    ).bind(after,earliest).all();
    const events = (rows.results || []).map(r => {
      let e = null;
      try { e = JSON.parse(r.value); } catch { return null; }
      if (!['created','cancelled','moved'].includes(e.type)) return null;
      return { id:r.id, type:e.type, date:e.date, time:e.time, nextDate:e.nextDate, nextTime:e.nextTime };
    }).filter(Boolean);
    const allRows = rows.results || [];
    const cursor = allRows.length ? allRows[allRows.length-1].id : after;
    return withCors(json({ok:true,cursor,events},200,{'Cache-Control':'no-store'}),request);
  } catch (error) {
    console.error('Unable to read reservation events',error);
    return withCors(json({ok:false,code:'service_unavailable',error:'通知情報を取得できません。'},503),request);
  }
}
