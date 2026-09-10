// Small, dependency-free request validation helpers for public APIs.
// Limits are intentionally generous for normal customers and mainly protect
// the Worker from oversized or malformed requests.

export async function readJsonObject(request, maxBytes = 16 * 1024) {
  const contentLength = request.headers.get('Content-Length');
  if (contentLength && Number(contentLength) > maxBytes) {
    return { ok: false, tooLarge: true, value: null };
  }

  let text;
  try {
    text = await request.text();
  } catch {
    return { ok: false, tooLarge: false, value: null };
  }

  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    return { ok: false, tooLarge: true, value: null };
  }

  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, tooLarge: false, value: null };
    }
    return { ok: true, tooLarge: false, value };
  } catch {
    return { ok: false, tooLarge: false, value: null };
  }
}

export function stringLength(value) {
  return typeof value === 'string' ? value.length : 0;
}

export function isReasonableEmail(value) {
  if (value === '') return true;
  if (typeof value !== 'string' || value.length > 120) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
