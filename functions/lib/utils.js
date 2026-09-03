export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=UTF-8", ...extra },
  });
}

export function corsHeaders(request) {
  const origin = request.headers.get("Origin");
  const headers = { "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
  // The application calls its API from the same origin.  Do not reflect an
  // arbitrary Origin header, which would expose the login endpoint to other
  // sites unnecessarily.
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
  const row = await env.DB.prepare("SELECT token FROM sessions WHERE token = ? AND expires_at > ?").bind(token, Date.now()).first();
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

export function isValidDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s); }
export function isValidTime(s) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(s); }

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
    parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value])
  );
  return {
    date: `${value.year}-${value.month}-${value.day}`,
    time: `${value.hour}:${value.minute}`,
  };
}

// A slot is unavailable from its exact start time.  Both operands use fixed
// width YYYY-MM-DD and HH:MM strings, so lexical comparison is chronological.
export function hasSlotStartedInTokyo(date, time, now = new Date()) {
  const tokyo = tokyoNow(now);
  return date < tokyo.date || (date === tokyo.date && time <= tokyo.time);
}

export function minutesOf(t) { const [h,m] = t.split(":").map(Number); return h*60+m; }
export function timeString(n) { return `${String(Math.floor(n/60)).padStart(2,"0")}:${String(n%60).padStart(2,"0")}`; }

export async function settings(env) {
  const rows = await env.DB.prepare("SELECT key,value FROM settings").all();
  const out = {};
  for (const r of rows.results || []) out[r.key] = r.value;
  return {
    businessHours: JSON.parse(out.business_hours || '{}'),
    slotMinutes: Number(out.slot_minutes || 30),
  };
}

export async function buildSlots(env, date, currentTime = new Date()) {
  const s = await settings(env);
  const now = tokyoNow(currentTime);
  if (date < now.date) {
    return { slots: [], holiday: false, past: true, breaks: [], settings: s };
  }
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const holiday = await env.DB.prepare("SELECT date FROM holidays WHERE date = ?").bind(date).first();
  const breaks = await env.DB.prepare("SELECT id,start_time,end_time FROM breaks WHERE date = ? ORDER BY start_time").bind(date).all();
  const booked = await env.DB.prepare("SELECT time FROM appointments WHERE date = ? AND status = 'confirmed'").bind(date).all();
  const bookedSet = new Set((booked.results || []).map(x => x.time));
  if (holiday || !s.businessHours[String(weekday)]) {
    return { slots: [], holiday: true, breaks: breaks.results || [], settings: s };
  }
  const [start,end] = s.businessHours[String(weekday)];
  const result = [];
  for (let t = minutesOf(start); t < minutesOf(end); t += s.slotMinutes) {
    const time = timeString(t);
    const inBreak = (breaks.results || []).some(b => t < minutesOf(b.end_time) && t + s.slotMinutes > minutesOf(b.start_time));
    const status = date === now.date && time <= now.time
      ? "past"
      : bookedSet.has(time)
        ? "booked"
        : inBreak
          ? "break"
          : "available";
    result.push({ time, status });
  }
  return { slots: result, holiday: false, breaks: breaks.results || [], settings: s };
}
