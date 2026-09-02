import {
  json,
  optionResponse,
  withCors,
  setSessionCookie,
  randomId
} from '../lib/utils.js';

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return optionResponse(context.request);
  }

  if (context.request.method !== 'POST') {
    return withCors(
      json({ error: 'Method not allowed' }, 405),
      context.request
    );
  }

  const body = await context.request.json().catch(() => ({}));

  // ① 先检查 Secret 是否真的进入当前 Worker
  if (!context.env.ADMIN_PASSWORD) {
    return withCors(
      json({
        ok: false,
        error: 'ADMIN_PASSWORD is not configured on this Worker version'
      }, 500),
      context.request
    );
  }

  // ② Secret 存在，再检查密码
  if (body.password !== context.env.ADMIN_PASSWORD) {
    return withCors(
      json({
        ok: false,
        error: 'Invalid password'
      }, 401),
      context.request
    );
  }

  // ③ 密码正确，创建登录 Session
  const token = randomId();

  await context.env.DB
    .prepare('DELETE FROM sessions WHERE expires_at <= ?')
    .bind(Date.now())
    .run();

  await context.env.DB
    .prepare('INSERT INTO sessions(token, expires_at) VALUES(?, ?)')
    .bind(token, Date.now() + 8 * 60 * 60 * 1000)
    .run();

  return withCors(
    json({ ok: true }, 200, {
      'Set-Cookie': setSessionCookie(token)
    }),
    context.request
  );
}
