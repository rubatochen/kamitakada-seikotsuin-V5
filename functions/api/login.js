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
  const password = typeof body?.password === 'string' ? body.password : '';

  // ① 先检查 Secret 是否真的进入当前 Worker
  if (typeof context.env.ADMIN_PASSWORD !== 'string' || !context.env.ADMIN_PASSWORD) {
    return withCors(
      json({
        ok: false,
        code: 'admin_password_not_configured',
        error: '管理者ログインは現在設定されていません。'
      }, 503),
      context.request
    );
  }

  // ② Secret 存在，再检查密码
  if (password !== context.env.ADMIN_PASSWORD) {
    return withCors(
      json({
        ok: false,
        code: 'invalid_password',
        error: 'Invalid password',
        debug: {
          configured: true,
          secretLength: context.env.ADMIN_PASSWORD.length,
          inputLength: password.length
        }
      }, 401),
      context.request
    );
  }

  // ③ 密码正确，创建登录 Session
  const token = randomId();

  try {
    await context.env.DB
      .prepare('DELETE FROM sessions WHERE expires_at <= ?')
      .bind(Date.now())
      .run();

    await context.env.DB
      .prepare('INSERT INTO sessions(token, expires_at) VALUES(?, ?)')
      .bind(token, Date.now() + 8 * 60 * 60 * 1000)
      .run();
  } catch (error) {
    console.error('Unable to create admin session', error);
    return withCors(
      json({
        ok: false,
        code: 'session_creation_failed',
        error: 'ログインセッションを作成できませんでした。'
      }, 500),
      context.request
    );
  }

  return withCors(
    json({ ok: true }, 200, {
      'Set-Cookie': setSessionCookie(token)
    }),
    context.request
  );
}
