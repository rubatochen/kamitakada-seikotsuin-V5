import { onRequest as availability } from '../../functions/api/availability.js';
import { onRequest as login } from '../../functions/api/login.js';
import { onRequest as logout } from '../../functions/api/logout.js';
import { onRequest as reserve } from '../../functions/api/reserve.js';
import { onRequest as status } from '../../functions/api/status.js';
import { onRequest as adminBreaksDelete } from '../../functions/api/admin/breaks-delete.js';
import { onRequest as adminBreaks } from '../../functions/api/admin/breaks.js';
import { onRequest as adminCancel } from '../../functions/api/admin/cancel.js';
import { onRequest as adminData } from '../../functions/api/admin/data.js';
import { onRequest as adminDelete } from '../../functions/api/admin/delete.js';
import { onRequest as adminExtend } from '../../functions/api/admin/extend.js';
import { onRequest as adminExport } from '../../functions/api/admin/export.js';
import { onRequest as adminHolidayDelete } from '../../functions/api/admin/holiday-delete.js';
import { onRequest as adminHoliday } from '../../functions/api/admin/holiday.js';
import { onRequest as adminHours } from '../../functions/api/admin/hours.js';
import { onRequest as adminReserve } from '../../functions/api/admin/reserve.js';
import { onRequest as adminUpdate } from '../../functions/api/admin/update.js';
import { onRequest as adminPause } from '../../functions/api/admin/pause.js';

const ROUTES = {
  '/api/availability': availability,
  '/api/login': login,
  '/api/logout': logout,
  '/api/reserve': reserve,
  '/api/status': status,
  '/api/admin/breaks-delete': adminBreaksDelete,
  '/api/admin/breaks': adminBreaks,
  '/api/admin/cancel': adminCancel,
  '/api/admin/data': adminData,
  '/api/admin/delete': adminDelete,
  '/api/admin/extend': adminExtend,
  '/api/admin/export': adminExport,
  '/api/admin/holiday-delete': adminHolidayDelete,
  '/api/admin/holiday': adminHoliday,
  '/api/admin/hours': adminHours,
  '/api/admin/reserve': adminReserve,
  '/api/admin/update': adminUpdate,
  '/api/admin/pause': adminPause,
};

function contextFor(request, env, ctx) {
  return {
    request,
    env,
    params: {},
    waitUntil: promise => ctx.waitUntil(promise),
    passThroughOnException: () => ctx.passThroughOnException(),
    functionPath: new URL(request.url).pathname,
  };
}

function tokyoDateParts() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  return Object.fromEntries(
    parts.filter(x => x.type !== 'literal').map(x => [x.type, x.value])
  );
}

function threeMonthsAgoTokyoDate() {
  const p = tokyoDateParts();
  const date = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)));
  date.setUTCMonth(date.getUTCMonth() - 3);
  return date.toISOString().slice(0, 10);
}

async function cleanupOldAppointments(env) {
  const cutoff = threeMonthsAgoTokyoDate();
  const result = await env.DB.prepare(
    "DELETE FROM appointments WHERE date < ?"
  ).bind(cutoff).run();

  console.log(JSON.stringify({
    task: 'cleanup_old_appointments',
    cutoff,
    deleted: result.meta?.changes ?? 0,
  }));
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const handler = ROUTES[url.pathname];

    if (handler) {
      return handler(contextFor(request, env, ctx));
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(cleanupOldAppointments(env));
  },
};
