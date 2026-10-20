// Appointment notifications without a D1 migration. The existing settings
// table is used as an append-only event ledger; values contain NO patient data.
import { randomId } from './utils.js';

const EVENT_PREFIX = 'reservation_event:';
function eventKey() { return EVENT_PREFIX + String(Date.now()).padStart(13, '0') + ':' + randomId(); }

export function eventInsertStatement(env, type, date, time, nextDate = null, nextTime = null, appointmentId = null, requiredStatus = 'confirmed') {
  const value = JSON.stringify({ type, date, time, nextDate, nextTime });
  // For conditional inserts, do not emit an event if the appointment INSERT
  // was skipped due to a conflicting slot. Other writes validate before batch.
  if (appointmentId) {
    return env.DB.prepare(
      'INSERT INTO settings(key,value) SELECT ?,? WHERE EXISTS (SELECT 1 FROM appointments WHERE id = ? AND status = ?)'
    ).bind(eventKey(), value, appointmentId, requiredStatus);
  }
  return env.DB.prepare('INSERT INTO settings(key,value) VALUES(?,?)').bind(eventKey(), value);
}

export function cleanupEventStatement(env) {
  // Primary-key order matches event creation timestamps; keep 14 days.
  const cutoff = EVENT_PREFIX + String(Date.now() - 14 * 86400000).padStart(13, '0');
  return env.DB.prepare('DELETE FROM settings WHERE key >= ? AND key < ?')
    .bind(EVENT_PREFIX, cutoff);
}

export const NON_OVERLAP_INSERT_SQL = `
INSERT INTO appointments(id,date,time,name,phone,email,note,status,created_at,duration_minutes)
SELECT ?,?,?,?,?,?,?,?,?,?
WHERE NOT EXISTS (
  SELECT 1 FROM appointments
  WHERE date = ? AND status = 'confirmed'
    AND (CAST(substr(time,1,2) AS INTEGER)*60 + CAST(substr(time,4,2) AS INTEGER)) < ?
    AND (CAST(substr(time,1,2) AS INTEGER)*60 + CAST(substr(time,4,2) AS INTEGER) + COALESCE(duration_minutes,30)) > ?
)`;

export const NON_OVERLAP_UPDATE_SQL = `
UPDATE appointments SET date = ?,time = ?,name = ?,phone = ?,note = ?,duration_minutes = ?
WHERE id = ? AND status = 'confirmed'
  AND NOT EXISTS (
    SELECT 1 FROM appointments AS other
    WHERE other.date = ? AND other.status = 'confirmed' AND other.id <> ?
      AND (CAST(substr(other.time,1,2) AS INTEGER)*60 + CAST(substr(other.time,4,2) AS INTEGER)) < ?
      AND (CAST(substr(other.time,1,2) AS INTEGER)*60 + CAST(substr(other.time,4,2) AS INTEGER) + COALESCE(other.duration_minutes,30)) > ?
  )`;

export async function atomicAppointmentWrite(env, writeStmt, eventStmt) {
  // D1 batch executes statements transactionally. If the write fails, no
  // notification is persisted. If the conditional write changes zero rows,
  // the caller returns a conflict rather than an apparent success.
  const results = await env.DB.batch([writeStmt, eventStmt, cleanupEventStatement(env)]);
  return (results[0]?.meta?.changes || 0) > 0;
}
