import { createHmac, timingSafeEqual } from 'node:crypto';

export function json(res, status, value) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (!res.hasHeader('Cache-Control')) res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(value));
}

export async function body(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return null;
  const length = Number(req.headers['content-length'] || 0);
  if (length > 8192) return null;
  let text = '';
  try {
    const parsed = req.body;
    if (parsed !== undefined) return typeof parsed === 'string' ? JSON.parse(parsed) : parsed;
    for await (const chunk of req) { text += chunk; if (text.length > 8192) return null; }
    return JSON.parse(text);
  } catch { return null; }
}

export const code = () => process.env.CLASSROOM_DEVICE_CODE?.length >= 32 ? process.env.CLASSROOM_DEVICE_CODE : null;
const SIGNED_LIFETIME = 90 * 86400;
export function equal(a, b) {
  const digest = str => createHmac('sha256', 'classroom-air-constant-time-comparison').update(str).digest();
  return timingSafeEqual(digest(a), digest(b));
}
function signature(secret, expires) { return createHmac('sha256', secret).update(`classroom-air-write-v1:${expires}`).digest('base64url'); }
export function deviceCookie(secret) {
  const expires = Math.floor(Date.now() / 1000) + SIGNED_LIFETIME;
  return `classroom_writer=${expires}.${signature(secret, expires)}; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=${SIGNED_LIFETIME}`;
}
export function canWrite(req) {
  const secret = code();
  const cookie = /(?:^|;\s*)classroom_writer=(\d{10})\.([\w-]{43})(?:;|$)/.exec(req.headers.cookie ?? '');
  return Boolean(secret && cookie && Number(cookie[1]) >= Date.now() / 1000 && equal(cookie[2], signature(secret, cookie[1])));
}
