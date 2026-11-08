import {
  json,
  optionResponse,
  withCors,
  setSessionCookie,
  randomId
} from '../lib/utils.js';
import { rateLimit } from '../lib/rate-limit.js';
import { readJsonObject } from '../lib/request-validation.js';
import { clientIp, loginBlocked, recordLoginFailure, clearLoginFailures, passwordMatches } from '../lib/login-guard.js';

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

  // Cheap first layer against floods; the real lockout is the D1 guard below.
  const limit = rateLimit(context.request, 'admin-login', 20, 10 * 60 * 1000);
  if (!limit.allowed) {
    return withCors(
      json({ ok:false, code:'rate_limited', error:'試行回数が多すぎます。しばらくしてから再度お試しください。' },429,{ 'Retry-After': String(limit.retryAfter) }),
      context.request
    );
  }

  const parsed = await readJsonObject(context.request, 4 * 1024);
  if (!parsed.ok) {
    return withCors(json({ ok:false, code:parsed.tooLarge ? 'request_too_large' : 'invalid_json', error:'入力内容が正しくありません。' },400), context.request);
  }
  const body = parsed.value;
  const password = typeof body.password === 'string' ? body.password : '';
  if (body.password === undefined || typeof body.password !== 'string' || password.length > 256) {
    return withCors(json({ ok:false, code:'invalid_input', error:'入力内容が正しくありません。' },400), context.request);
  }

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

  // ② Secret 存在，再检查密码（失败次数记录在 D1，跨实例生效）
  const ip = clientIp(context.request);
  try {
    const guard = await loginBlocked(context.env.DB, ip);
    if (guard.blocked) {
      return withCors(
        json({ ok:false, code:'rate_limited', error:'試行回数が多すぎます。しばらくしてから再度お試しください。' },429,{ 'Retry-After': String(guard.retryAfter) }),
        context.request
      );
    }
  } catch (error) {
    console.error('Login guard unavailable', error);
    return withCors(json({ ok:false, code:'service_unavailable', error:'現在ログインできません。' },503), context.request);
  }

  if (!(await passwordMatches(password, context.env.ADMIN_PASSWORD))) {
    try { await recordLoginFailure(context.env.DB, ip); } catch (error) { console.error('Unable to record login failure', error); }
    return withCors(
      json({
        ok: false,
        code: 'invalid_password',
        error: 'Invalid password'
        
      }, 401),
      context.request
    );
  }

  // ③ 密码正确，创建登录 Session
  const token = randomId();
  try { await clearLoginFailures(context.env.DB, ip); } catch (error) { console.error('Unable to clear login failures', error); }

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
