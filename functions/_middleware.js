// Runs in front of every /api/* function when the site is built with
// `wrangler pages functions build` (the Cloudflare build command), where
// dist/worker/index.js is regenerated and its own wrapper is not used.
// It does the same three jobs as that wrapper:
//   1. bring the D1 database up to the current schema (idempotent),
//   2. add security headers to API responses,
//   3. turn unexpected errors into JSON instead of a bare 500 page.
import { ensureSchema } from './lib/schema.js';

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Robots-Tag', 'noindex');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function jsonError(status, code, error, detail) {
  return new Response(JSON.stringify({ ok: false, code, error, detail }), {
    status, headers: { 'content-type': 'application/json; charset=UTF-8' },
  });
}

export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (!url.pathname.startsWith('/api/')) return context.next();

  try {
    await ensureSchema(context.env);
  } catch (error) {
    console.error('Schema upgrade failed', error && error.stack || error);
    return withSecurityHeaders(jsonError(503, 'service_unavailable', '現在ご利用いただけません。',
      url.pathname.startsWith('/api/admin/') ? String(error && error.message || error).slice(0, 300) : undefined));
  }

  try {
    return withSecurityHeaders(await context.next());
  } catch (error) {
    console.error('API error', url.pathname, error && error.stack || error);
    return withSecurityHeaders(jsonError(500, 'server_error', 'サーバーでエラーが発生しました。',
      url.pathname.startsWith('/api/admin/') ? String(error && error.message || error).slice(0, 300) : undefined));
  }
}
