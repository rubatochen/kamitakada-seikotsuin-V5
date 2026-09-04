export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=UTF-8", ...extra },
  });
}

export function corsHeaders(request) {
  const origin = request.headers.get("Origin");
  const headers = {
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
  if (origin && origin === new URL(request.url).origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers.Vary = "Origin";
  }
  return headers;
}

export function optionResponse(request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export function withCors(response, request) {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(corsHeaders(request))) headers.set(k, v);
  return new Response(response.body, { status: response.status, headers });
}

export function cookieToken(request) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/(?:^|; )session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export async function requireAdmin(request, env) {
  const token = cookieToken(request);
  if (!token) return null;
  const row = await env.DB
    .prepare("SELECT token FROM sessions WHERE token = ? AND expires_at > ?")
    .bind(token, Date.now())
    .first();
  return row ? token : null;
}

export function setSessionCookie(token, maxAge = 60 * 60 * 8) {
  return `session=${encodeURIComponent(token)}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

export function clearSessionCookie() {
  return "session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax";
}

export function randomId() {
  return crypto.randomUUID();
}

export function isValidDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export function isValidTime(s) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

export function tokyoNow(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);

  const value = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );

  return {
    date: `${value.year}-${value.month}-${value.day}`,
    time: `${value.hour}:${value.minute}`,
  };
}

export function hasSlotStartedInTokyo(date, time, now = new Date()) {
  const tokyo = tokyoNow(now);
  return date < tokyo.date || (date === tokyo.date && time <= tokyo.time);
}

export function normalizeJapanesePhone(phone) {
  return String(phone || '')
    .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\s\-ー−―]/g, '');
}

export function isValidJapanesePhone(phone) {
  const normalized = normalizeJapanesePhone(phone);
  return /^0\d{9,10}$/.test(normalized);
}

export function daysFromTokyoToday(date, now = new Date()) {
  const today = tokyoNow(now).date;
  const target = new Date(`${date}T12:00:00Z`);
  const base = new Date(`${today}T12:00:00Z`);
  return Math.round((target - base) / 86400000);
}

export function isWithinWebBookingWindow(date, now = new Date()) {
  const days = daysFromTokyoToday(date, now);
  return days >= 0 && days <= 14;
}

export function minutesOf(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export function timeString(n) {
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
}

export async function settings(env) {
  const rows = await env.DB.prepare("SELECT key,value FROM settings").all();
  const out = {};
  for (const r of rows.results || []) out[r.key] = r.value;

  return {
    businessHours: JSON.parse(out.business_hours || '{}'),
    slotMinutes: Number(out.slot_minutes || 30),
  };
}

function mergeIntervals(intervals) {
  const sorted = intervals
    .filter(x => Number.isFinite(x.start) && Number.isFinite(x.end) && x.end > x.start)
    .sort((a, b) => a.start - b.start);

  const merged = [];

  for (const item of sorted) {
    const last = merged[merged.length - 1];

    if (!last || item.start > last.end) {
      merged.push({ start: item.start, end: item.end });
    } else {
      last.end = Math.max(last.end, item.end);
    }
  }

  return merged;
}

export async function buildSlots(env, date, currentTime = new Date()) {
  const s = await settings(env);
  const now = tokyoNow(currentTime);

  if (date < now.date) {
    return {
      slots: [],
      holiday: false,
      past: true,
      breaks: [],
      booked: [],
      unavailable: [],
      settings: s
    };
  }

  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();

  const holiday = await env.DB
    .prepare("SELECT date FROM holidays WHERE date = ?")
    .bind(date)
    .first();

  const breaksResult = await env.DB
    .prepare("SELECT id,start_time,end_time FROM breaks WHERE date = ? ORDER BY start_time")
    .bind(date)
    .all();

  const bookedResult = await env.DB
    .prepare("SELECT id,time,name FROM appointments WHERE date = ? AND status = 'confirmed' ORDER BY time")
    .bind(date)
    .all();

  const breaks = breaksResult.results || [];
  const booked = bookedResult.results || [];

  if (holiday || !s.businessHours[String(weekday)]) {
    return {
      slots: [],
      holiday: true,
      past: false,
      breaks,
      booked,
      unavailable: [],
      settings: s
    };
  }

  const [start, end] = s.businessHours[String(weekday)];
  const businessStart = minutesOf(start);
  const businessEnd = minutesOf(end);

  // 每个预约固定占用 30 分钟；开始时间按 1 分钟自由选择。
  const appointmentDuration = 30;

  const bookedIntervals = booked.map(x => ({
    start: minutesOf(x.time),
    end: minutesOf(x.time) + appointmentDuration,
    type: 'booked'
  }));

  const breakIntervals = breaks.map(x => ({
    start: minutesOf(x.start_time),
    end: minutesOf(x.end_time),
    type: 'break'
  }));

  const allIntervals = mergeIntervals([
    ...bookedIntervals,
    ...breakIntervals
  ]);

  const result = [];

  for (let t = businessStart; t + appointmentDuration <= businessEnd; t += 1) {
    const time = timeString(t);

    let status = "available";

    if (date === now.date && t <= minutesOf(now.time)) {
      status = "past";
    } else if (
      bookedIntervals.some(x => t < x.end && t + appointmentDuration > x.start)
    ) {
      status = "booked";
    } else if (
      breakIntervals.some(x => t < x.end && t + appointmentDuration > x.start)
    ) {
      status = "break";
    }

    result.push({ time, status });
  }

  return {
    slots: result,
    holiday: false,
    past: false,
    breaks,
    booked,
    unavailable: allIntervals.map(x => ({
      startTime: timeString(x.start),
      endTime: timeString(x.end)
    })),
    settings: s
  };
}
