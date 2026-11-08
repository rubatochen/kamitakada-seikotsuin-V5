// Lanes (枠) and treatment menus.
//
// A lane is one thing that can treat one patient at a time: a practitioner or
// a bed. Bookings never overlap inside one lane; two lanes can run in
// parallel. A menu says how long it takes and which lanes may take it.
//
// Both lists live in the settings table as JSON, so the clinic can change
// them from the admin page without a deploy.

// Two kinds of lanes:
//  - pool  : 枠1〜枠3. Anyone on duty can take them; nobody is named.
//            How many of them are open at a given time is set by the
//            capacity plan below (1–3), not by switching lanes on/off.
//  - staff : a lane that belongs to one practitioner (鍼灸). It has its own
//            on/off switch ("offer this") and its own weekly hours.
export const POOL_LANE_IDS = ['L1', 'L2', 'L3'];
export const MAX_POOL = POOL_LANE_IDS.length;

export const DEFAULT_LANES = [
  { id: 'L1', kind: 'pool', name: '枠1', active: true, hours: null },
  { id: 'L2', kind: 'pool', name: '枠2', active: true, hours: null },
  { id: 'L3', kind: 'pool', name: '枠3', active: true, hours: null },
  { id: 'ACU', kind: 'staff', name: '鍼灸', active: false, hours: null },
];

export const DEFAULT_MENUS = [
  {
    id: 'seikotsu', active: true, web: true,
    name: { ja: '通常', zh: '常规', en: 'Regular' },
    desc: { ja: '保険・自費', zh: '保险・自费', en: 'Insurance or self-pay' },
    treatMinutes: 25, bufferMinutes: 5,
    extensions: [0, 10, 20, 30], extensionPrice: 800,
    lanes: ['L1', 'L2', 'L3'], noticeMinutes: 0, reservationOnly: false,
  },
  {
    id: 'acu', active: true, web: true,
    name: { ja: '鍼灸', zh: '针灸', en: 'Acupuncture' },
    desc: { ja: '', zh: '', en: '' },
    treatMinutes: 60, bufferMinutes: 10,
    extensions: [0], extensionPrice: 0,
    lanes: ['ACU'], noticeMinutes: 180, reservationOnly: true,
  },
];

// How many pool lanes are open: a base number for the whole day, plus
// optional time ranges with a different number (e.g. 10:00–13:00 → 2).
export const DEFAULT_CAPACITY = { base: 1, ranges: [] };

export const DEFAULT_MENU_ID = 'seikotsu';
export const DEFAULT_LANE_ID = 'L1';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const ID = /^[A-Za-z0-9_-]{1,24}$/;

function str(v, max) { return typeof v === 'string' ? v.trim().slice(0, max) : ''; }
function int(v, min, max, fallback) {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}
function localized(v, max, fallback) {
  const src = v && typeof v === 'object' ? v : {};
  const ja = str(src.ja, max) || fallback;
  return { ja, zh: str(src.zh, max), en: str(src.en, max) };
}

function cleanHours(h) {
  if (h === null || h === undefined) return null;          // follow business hours
  if (typeof h !== 'object' || Array.isArray(h)) return null;
  const out = {};
  for (let d = 0; d < 7; d++) {
    const v = h[String(d)];
    out[String(d)] = Array.isArray(v) && v.length === 2 && TIME.test(v[0]) && TIME.test(v[1]) && v[0] < v[1] ? [v[0], v[1]] : null;
  }
  return out;
}

export function normalizeLanes(input) {
  const list = Array.isArray(input) ? input : [];
  const byId = new Map();
  for (const raw of list) if (raw && typeof raw === 'object' && typeof raw.id === 'string') byId.set(raw.id.trim(), raw);
  // The three pool lanes always exist, always in this order.
  const out = POOL_LANE_IDS.map((id, i) => ({
    id, kind: 'pool', name: str(byId.get(id)?.name, 30) || `枠${i + 1}`, active: true, hours: null,
  }));
  const seen = new Set(POOL_LANE_IDS);
  const source = list.length ? list : DEFAULT_LANES;
  for (const raw of source) {
    if (!raw || typeof raw !== 'object') continue;
    const id = str(raw.id, 24);
    if (!ID.test(id) || seen.has(id)) continue;
    if (out.length >= MAX_POOL + 4) break;
    seen.add(id);
    out.push({ id, kind: 'staff', name: str(raw.name, 30) || id, active: raw.active === true, hours: cleanHours(raw.hours) });
  }
  return out;
}

function clampCount(v, max) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(1, n)) : 1;
}

function cleanRanges(input, max) {
  const out = [];
  for (const r of Array.isArray(input) ? input.slice(0, 12) : []) {
    if (!r || !TIME.test(r.start) || !TIME.test(r.end) || r.start >= r.end) continue;
    out.push({ start: r.start, end: r.end, count: clampCount(r.count, max) });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

export function normalizeCapacityPlan(input) {
  const src = input && typeof input === 'object' ? input : DEFAULT_CAPACITY;
  return { base: clampCount(src.base, MAX_POOL), ranges: cleanRanges(src.ranges, MAX_POOL) };
}

// { default: plan, days: { 'YYYY-MM-DD': plan } }
export function normalizeCapacity(input) {
  const src = input && typeof input === 'object' ? input : {};
  const days = {};
  if (src.days && typeof src.days === 'object') {
    for (const [date, plan] of Object.entries(src.days).slice(0, 400)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) days[date] = normalizeCapacityPlan(plan);
    }
  }
  return { default: normalizeCapacityPlan(src.default), days };
}

export function planForDate(capacity, date) {
  return capacity.days[date] || capacity.default;
}

function toMin(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }

// Pool lane number k (1-based) is open at minute m when the plan's count
// at m is at least k. Returns, for each pool lane, its CLOSED spans
// (in minutes) inside [dayStart, dayEnd).
export function poolClosedSpans(plan, dayStart, dayEnd) {
  const countAt = m => {
    let c = plan.base;
    for (const r of plan.ranges) if (m >= toMin(r.start) && m < toMin(r.end)) c = r.count;
    return c;
  };
  const cuts = new Set([dayStart, dayEnd]);
  for (const r of plan.ranges) { cuts.add(Math.min(dayEnd, Math.max(dayStart, toMin(r.start)))); cuts.add(Math.min(dayEnd, Math.max(dayStart, toMin(r.end)))); }
  const points = [...cuts].sort((a, b) => a - b);
  const out = {};
  POOL_LANE_IDS.forEach((id, i) => {
    const spans = [];
    for (let j = 0; j + 1 < points.length; j++) {
      const a = points[j], b = points[j + 1];
      if (b <= a || countAt(a) > i) continue;
      const last = spans[spans.length - 1];
      if (last && last.end === a) last.end = b; else spans.push({ start: a, end: b });
    }
    out[id] = spans;
  });
  return out;
}

// The most pool lanes the plan ever opens (for drawing the day view).
export function planMax(plan) {
  return Math.max(plan.base, ...plan.ranges.map(r => r.count));
}

export function normalizeMenus(input, lanes) {
  const laneIds = new Set(lanes.map(l => l.id));
  const list = Array.isArray(input) ? input : [];
  const seen = new Set();
  const out = [];
  for (const raw of list.slice(0, 12)) {
    if (!raw || typeof raw !== 'object') continue;
    const id = str(raw.id, 24);
    if (!ID.test(id) || seen.has(id)) continue;
    seen.add(id);
    const extensions = [...new Set((Array.isArray(raw.extensions) ? raw.extensions : [0])
      .map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 60 && n % 5 === 0))].sort((a, b) => a - b);
    if (!extensions.includes(0)) extensions.unshift(0);
    const menuLanes = (Array.isArray(raw.lanes) ? raw.lanes : []).map(String).filter(x => laneIds.has(x));
    out.push({
      id,
      active: raw.active !== false,
      web: raw.web !== false,
      name: localized(raw.name, 40, id),
      desc: localized(raw.desc, 60, ''),
      treatMinutes: int(raw.treatMinutes, 5, 240, 25),
      bufferMinutes: int(raw.bufferMinutes, 0, 60, 5),
      extensions: extensions.slice(0, 7),
      extensionPrice: int(raw.extensionPrice, 0, 100000, 0),
      lanes: menuLanes.length ? [...new Set(menuLanes)] : [...POOL_LANE_IDS],
      noticeMinutes: int(raw.noticeMinutes, 0, 7 * 24 * 60, 0),
      reservationOnly: raw.reservationOnly === true,
    });
  }
  if (!out.length) return normalizeMenus(DEFAULT_MENUS, lanes);
  return out;
}

export function parseConfig(rawLanes, rawMenus, rawCapacity) {
  let lanesJson = null, menusJson = null, capJson = null;
  try { lanesJson = rawLanes ? JSON.parse(rawLanes) : null; } catch {}
  try { menusJson = rawMenus ? JSON.parse(rawMenus) : null; } catch {}
  try { capJson = rawCapacity ? JSON.parse(rawCapacity) : null; } catch {}
  const lanes = normalizeLanes(lanesJson || DEFAULT_LANES);
  const menus = normalizeMenus(menusJson || DEFAULT_MENUS, lanes);
  return { lanes, menus, capacity: normalizeCapacity(capJson) };
}

// A menu is offered when it is switched on AND at least one of its lanes is
// on (switching the 鍼灸 lane off hides every menu that only it can take).
export function isOffered(menu, lanes) {
  return !!menu && menu.active && menu.lanes.some(id => lanes.some(l => l.id === id && l.active));
}

export function occupiedMinutes(menu, extension = 0) {
  return menu.treatMinutes + menu.bufferMinutes + extension;
}

// The open window of one lane on one weekday, clipped to clinic hours.
export function laneWindow(lane, weekday, businessHours) {
  const bh = businessHours && businessHours[String(weekday)];
  if (!lane.active || !Array.isArray(bh)) return null;
  const own = lane.hours ? lane.hours[String(weekday)] : bh;
  if (!Array.isArray(own)) return null;
  const start = own[0] > bh[0] ? own[0] : bh[0];
  const end = own[1] < bh[1] ? own[1] : bh[1];
  return start < end ? [start, end] : null;
}

// What the public booking page may know about a menu.
export function publicMenu(menu) {
  return {
    id: menu.id, name: menu.name, desc: menu.desc,
    treatMinutes: menu.treatMinutes,
    occupiedMinutes: occupiedMinutes(menu, 0),
    extensions: menu.extensions, extensionPrice: menu.extensionPrice,
    noticeMinutes: menu.noticeMinutes, reservationOnly: menu.reservationOnly,
  };
}
