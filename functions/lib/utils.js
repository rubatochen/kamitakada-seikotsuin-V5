import { parseConfig, laneWindow, occupiedMinutes, isOffered, planForDate, poolClosedSpans, DEFAULT_MENU_ID, DEFAULT_LANE_ID } from './config.js';

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
  return `session=${encodeURIComponent(token)}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

export function clearSessionCookie() {
  return "session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict";
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
  const rows = await env.DB.prepare("SELECT key,value FROM settings WHERE key IN ('business_hours','slot_minutes','temporary_pause_periods','lanes','menus','capacity')").all();
  const out = {};
  for (const r of rows.results || []) out[r.key] = r.value;
  const { lanes, menus: rawMenus, capacity } = parseConfig(out.lanes, out.menus, out.capacity);
  // `offered` is derived, never stored: on, and one of its lanes is on.
  const menus = rawMenus.map(m => ({ ...m, offered: isOffered(m, lanes) }));

  return {
    businessHours: JSON.parse(out.business_hours || '{}'),
    slotMinutes: Number(out.slot_minutes || 30),
    temporaryPausePeriods: (() => { try { const v = JSON.parse(out.temporary_pause_periods || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } })(),
    lanes,
    menus,
    capacity,
  };
}

export function findMenu(s, menuId) {
  return s.menus.find(m => m.id === menuId) || null;
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

/**
 * Bookable start times for one menu on one date.
 *
 * opts.menuId     menu to book (default: the first active menu / 'seikotsu')
 * opts.extension  extra minutes on top of the menu's own length
 * opts.excludeId  appointment to ignore (when moving an existing booking)
 * opts.laneId     only consider this lane (admin picking a lane by hand)
 * opts.staff      true for the admin page: ignores "book N minutes ahead"
 *
 * A start time is available when at least one of the menu's lanes is open
 * and free (no booking in that lane, no break for that lane or for all
 * lanes) for the whole occupied length. slot.lanes lists those lanes in
 * preference order; callers try them one by one with an atomic insert.
 */
export async function buildSlots(env, date, currentTime = new Date(), opts = {}) {
  if (typeof opts === 'number') opts = { occupied: opts };
  const s = await settings(env);
  const now = tokyoNow(currentTime);
  const menu = findMenu(s, opts.menuId) || findMenu(s, DEFAULT_MENU_ID) || s.menus[0];
  const extension = Number(opts.extension || 0);
  const occupied = Number(opts.occupied) || occupiedMinutes(menu, extension);
  const pausePeriods = Array.isArray(s.temporaryPausePeriods) ? s.temporaryPausePeriods : [];
  const pausePeriod = pausePeriods.find(p => date >= String(p.startDate || '') && date < String(p.reopeningDate || ''));
  const pauseActive = !!pausePeriod;
  const base = { slots: [], holiday: false, past: false, breaks: [], booked: [], unavailable: [], settings: s, menu, occupied,
    paused: pauseActive, reopeningAt: pauseActive ? pausePeriod.reopeningDate : null, laneWindows: {} };

  if (date < now.date) return { ...base, past: true };
  if (pauseActive) return { ...base, paused: true, temporarilyClosed: true };

  // One-day closures configured in the existing holidays table are authoritative.
  const holidayRow = await env.DB.prepare('SELECT date FROM holidays WHERE date = ?').bind(date).first();
  if (holidayRow) return { ...base, holiday: true };

  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();

  const [breaksResult, bookedResult] = await Promise.all([
    env.DB.prepare("SELECT id,start_time,end_time,lane_id FROM breaks WHERE date = ? ORDER BY start_time").bind(date).all(),
    env.DB.prepare("SELECT id,time,name,duration_minutes,menu_id,lane_id FROM appointments WHERE date = ? AND status = 'confirmed' ORDER BY time").bind(date).all(),
  ]);
  const breaks = breaksResult.results || [];
  const booked = bookedResult.results || [];

  const laneWindows = {};
  for (const lane of s.lanes) {
    const w = laneWindow(lane, weekday, s.businessHours);
    if (w) laneWindows[lane.id] = { start: minutesOf(w[0]), end: minutesOf(w[1]) };
  }
  const candidates = menu.lanes
    .filter(id => laneWindows[id] && (!opts.laneId || opts.laneId === id));

  if (!s.businessHours[String(weekday)] || !candidates.length) {
    return { ...base, breaks, booked, laneWindows };
  }

  // Pool lanes (枠1〜3) beyond the day's capacity plan count as closed.
  const plan = planForDate(s.capacity, date);
  const bh = s.businessHours[String(weekday)];
  const closedSpans = poolClosedSpans(plan, minutesOf(bh[0]), minutesOf(bh[1]));
  const busy = {};
  for (const id of candidates) {
    busy[id] = [
      ...(closedSpans[id] || []).map(x => ({ ...x, type: 'closed' })),
      ...booked.filter(x => (x.lane_id || DEFAULT_LANE_ID) === id && String(x.id) !== String(opts.excludeId || ''))
        .map(x => ({ start: minutesOf(x.time), end: minutesOf(x.time) + (Number(x.duration_minutes) || 30), type: 'booked' })),
      ...breaks.filter(x => !x.lane_id || x.lane_id === id)
        .map(x => ({ start: minutesOf(x.start_time), end: minutesOf(x.end_time), type: 'break' })),
    ];
  }

  const dayStart = Math.min(...candidates.map(id => laneWindows[id].start));
  const dayEnd = Math.max(...candidates.map(id => laneWindows[id].end));
  const nowAbs = minutesOf(now.time);
  const dayOffset = daysFromTokyoToday(date, currentTime) * 1440;
  const notice = opts.staff ? 0 : menu.noticeMinutes;

  const result = [];
  for (let t = dayStart; t + occupied <= dayEnd; t += 1) {
    const time = timeString(t);
    const abs = dayOffset + t;
    if (abs <= nowAbs) { result.push({ time, status: 'past', lanes: [] }); continue; }
    if (abs < nowAbs + notice) { result.push({ time, status: 'notice', lanes: [] }); continue; }

    const free = [];
    let blockedByBreakOnly = false;
    for (const id of candidates) {
      const w = laneWindows[id];
      if (t < w.start || t + occupied > w.end) continue;
      const hits = busy[id].filter(x => t < x.end && t + occupied > x.start);
      if (!hits.length) free.push(id);
      else if (hits.every(x => x.type === 'break')) blockedByBreakOnly = true;
    }
    result.push({
      time,
      status: free.length ? 'available' : (blockedByBreakOnly ? 'break' : 'booked'),
      lanes: free,
    });
  }

  // Minutes in which every lane for this menu is booked, on a break or closed.
  const fullyBusy = [];
  let runStart = null;
  for (let m = dayStart; m <= dayEnd; m++) {
    const idle = m < dayEnd && candidates.some(id => {
      const w = laneWindows[id];
      return m >= w.start && m < w.end && !busy[id].some(x => m >= x.start && m < x.end);
    });
    if (!idle && m < dayEnd && runStart === null) runStart = m;
    if ((idle || m === dayEnd) && runStart !== null) { fullyBusy.push({ start: runStart, end: m }); runStart = null; }
  }
  // Only report spans caused by bookings/breaks, not a lane simply being closed all day.
  const unavailable = mergeIntervals(fullyBusy).filter(x => candidates.some(id => busy[id].some(b => b.type !== 'closed' && b.start < x.end && b.end > x.start)));

  return {
    ...base,
    slots: result,
    breaks,
    booked,
    laneWindows,
    closedSpans,
    unavailable: unavailable.map(x => ({ startTime: timeString(x.start), endTime: timeString(x.end) })),
  };
}
