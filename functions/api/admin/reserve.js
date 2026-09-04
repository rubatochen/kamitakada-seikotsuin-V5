import {
  json,
  optionResponse,
  withCors,
  buildSlots,
  isValidDate,
  isValidTime,
  randomId
} from '../../lib/utils.js';

function getSessionToken(request) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(/(?:^|;\s*)session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

async function requireAdmin(context) {
  const token = getSessionToken(context.request);

  if (!token) {
    return false;
  }

  const session = await context.env.DB
    .prepare('SELECT token FROM sessions WHERE token = ? AND expires_at > ?')
    .bind(token, Date.now())
    .first();

  return !!session;
}

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return optionResponse(context.request);
  }

  if (context.request.method !== 'POST') {
    return withCors(
      json({ ok: false, error: 'Method not allowed' }, 405),
      context.request
    );
  }

  if (!(await requireAdmin(context))) {
    return withCors(
      json({ ok: false, code: 'unauthorized', error: 'Unauthorized' }, 401),
      context.request
    );
  }

  const body = await context.request.json().catch(() => ({}));

  const date = typeof body?.date === 'string' ? body.date.trim() : '';
  const time = typeof body?.time === 'string' ? body.time.trim() : '';
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  const note = typeof body?.note === 'string' ? body.note.trim() : '';

  if (!isValidDate(date)) {
    return withCors(
      json({ ok: false, code: 'invalid_date', error: 'Invalid date' }, 400),
      context.request
    );
  }

  if (!isValidTime(time)) {
    return withCors(
      json({ ok: false, code: 'invalid_time', error: 'Invalid time' }, 400),
      context.request
    );
  }

  if (!name) {
    return withCors(
      json({ ok: false, code: 'invalid_name', error: 'Name is required' }, 400),
      context.request
    );
  }

  if (!phone) {
    return withCors(
      json({ ok: false, code: 'invalid_phone', error: 'Phone is required' }, 400),
      context.request
    );
  }

  const availability = await buildSlots(context.env, date);
  const slot = availability.slots.find(x => x.time === time);

  if (!slot) {
    return withCors(
      json(
        {
          ok: false,
          code: 'unavailable',
          error: 'This time cannot be reserved'
        },
        409
      ),
      context.request
    );
  }

  if (slot.status !== 'available') {
    const code =
      slot.status === 'past'
        ? 'past_time'
        : slot.status === 'booked'
          ? 'already_booked'
          : slot.status === 'break'
            ? 'break_time'
            : 'unavailable';

    return withCors(
      json(
        {
          ok: false,
          code,
          error: 'This time cannot be reserved'
        },
        409
      ),
      context.request
    );
  }

  const id = randomId();
  const createdAt = new Date().toISOString();
  const finalNote = note ? `電話受付 · ${note}` : '電話受付';

  try {
    await context.env.DB
      .prepare(`
        INSERT INTO appointments
          (id, date, time, name, phone, email, note, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', ?)
      `)
      .bind(
        id,
        date,
        time,
        name,
        phone,
        email || null,
        finalNote,
        createdAt
      )
      .run();
  } catch (error) {
    console.error('Unable to create admin appointment', error);

    const message = String(error?.message || '');

    if (message.includes('UNIQUE') || message.includes('unique')) {
      return withCors(
        json(
          {
            ok: false,
            code: 'already_booked',
            error: 'This time has already been booked'
          },
          409
        ),
        context.request
      );
    }

    return withCors(
      json(
        {
          ok: false,
          code: 'reservation_failed',
          error: 'Failed to create reservation'
        },
        500
      ),
      context.request
    );
  }

  return withCors(
    json(
      {
        ok: true,
        appointment: {
          id,
          date,
          time,
          name,
          phone,
          email: email || null,
          note: finalNote,
          status: 'confirmed',
          created_at: createdAt
        }
      },
      200
    ),
    context.request
  );
}
```
