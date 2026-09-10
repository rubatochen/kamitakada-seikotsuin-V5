// Lightweight per-instance rate limiter for public Worker endpoints.
// This is intentionally an additional safety layer; normal users should never hit it.
const buckets = new Map();

function nowMs() {
  return Date.now();
}

function cleanup(now) {
  if (buckets.size < 5000) return;
  for (const [key, value] of buckets) {
    if (value.resetAt <= now) buckets.delete(key);
  }
}

function getClientKey(request, scope) {
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
  return `${scope}:${ip}`;
}

export function rateLimit(request, scope, limit, windowMs) {
  const now = nowMs();
  cleanup(now);
  const key = getClientKey(request, scope);
  let entry = buckets.get(key);

  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowMs };
  }

  entry.count += 1;
  buckets.set(key, entry);

  if (entry.count <= limit) {
    return { allowed: true, remaining: Math.max(0, limit - entry.count) };
  }

  return {
    allowed: false,
    remaining: 0,
    retryAfter: Math.max(1, Math.ceil((entry.resetAt - now) / 1000))
  };
}
