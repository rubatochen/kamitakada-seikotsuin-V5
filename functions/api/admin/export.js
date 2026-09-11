import { optionResponse, withCors, requireAdmin } from '../../lib/utils.js';

function csvCell(value) {
  let s = value == null ? '' : String(value);
  // Prevent spreadsheet formula injection when opened in Excel/Sheets.
  if (/^[=+\\-@]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

function dateParam(value) {
  return /^\\d{4}-\\d{2}-\\d{2}$/.test(value || '') ? value : '';
}

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') return optionResponse(context.request);
  if (context.request.method !== 'GET') return withCors(new Response('Method Not Allowed', { status: 405 }), context.request);
  if (!await requireAdmin(context.request, context.env)) {
    return withCors(new Response('Unauthorized', { status: 401 }), context.request);
  }

  const url = new URL(context.request.url);
  const start = dateParam(url.searchParams.get('start'));
  const end = dateParam(url.searchParams.get('end'));
  if (start && end && start > end) {
    return withCors(new Response('Invalid date range', { status: 400 }), context.request);
  }

  const conditions = [];
  const binds = [];
  if (start) { conditions.push('date >= ?'); binds.push(start); }
  if (end) { conditions.push('date <= ?'); binds.push(end); }
  const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';

  const query = `SELECT id,date,time,name,phone,email,note,status,created_at,duration_minutes FROM appointments${where} ORDER BY date,time,id`;
  const result = await context.env.DB.prepare(query).bind(...binds).all();
  const rows = result.results || [];

  const header = ['ID','予約日','予約時間','氏名','電話番号','メールアドレス','備考','状態','登録日時','占用時間(分)'];
  const lines = [header.map(csvCell).join(',')];
  for (const x of rows) {
    lines.push([
      x.id, x.date, x.time, x.name, x.phone, x.email, x.note,
      x.status === 'cancelled' ? 'キャンセル' : '確定', x.created_at, x.duration_minutes ?? 30
    ].map(csvCell).join(','));
  }

  const body = '\\uFEFF' + lines.join('\\r\\n') + '\\r\\n';
  const filename = `appointments${start ? `_${start}` : ''}${end ? `_${end}` : ''}.csv`;
  return withCors(new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    }
  }), context.request);
}
