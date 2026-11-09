// The privacy policy promises that Web booking records are deleted about
// 3 months after the booking date. The Cloudflare build (Pages functions)
// has no cron handler, so this runs at most once per Tokyo day, piggybacking
// on the first API request of the day (see functions/_middleware.js).
const LAST_KEY = 'last_cleanup_date';

function tokyoToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function threeMonthsAgoTokyoDate(today = tokyoToday()) {
  const [y, m, d] = today.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCMonth(date.getUTCMonth() - 3);
  return date.toISOString().slice(0, 10);
}

export async function cleanupOldAppointments(env) {
  const cutoff = threeMonthsAgoTokyoDate();
  const result = await env.DB.prepare('DELETE FROM appointments WHERE date < ?').bind(cutoff).run();
  console.log(JSON.stringify({ task: 'cleanup_old_appointments', cutoff, deleted: result.meta?.changes ?? 0 }));
}

// Claims today's run atomically (only one request per day wins), then cleans up.
export async function dailyCleanup(env) {
  const today = tokyoToday();
  const claim = await env.DB.prepare(
    'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE settings.value < excluded.value'
  ).bind(LAST_KEY, today).run();
  if (!(claim.meta?.changes > 0)) return false;
  await cleanupOldAppointments(env);
  return true;
}
