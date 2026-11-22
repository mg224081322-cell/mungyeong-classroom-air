export const ACCESS_MS = 30 * 60 * 1000;

const encoder = new TextEncoder();
const encode = (data: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(data))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function verifyTeacherAccess(secret: string | undefined, authorization: string | undefined, now = Date.now()) {
  const match = /^Bearer (\d{13}\.[\w-]{22})\.([\w-]{43})$/.exec(authorization ?? '');
  if (!secret || !match) return false;
  const expires = Number(match[1].slice(0, 13));
  if (expires <= now || expires > now + ACCESS_MS) return false;
  const bytes = Uint8Array.from(atob(match[2].replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  if (encode(bytes) !== match[2]) return false;
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  return crypto.subtle.verify('HMAC', key, bytes, encoder.encode(`classroom-teacher-read-v1:${match[1]}`));
}

export async function signTeacherAccess(secret: string, payload: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return encode(await crypto.subtle.sign('HMAC', key, encoder.encode(`classroom-teacher-read-v1:${payload}`)));
}

export async function issueTeacherAccess(secret: string, now = Date.now()) {
  const expiresAt = now + ACCESS_MS;
  const payload = `${expiresAt}.${encode(crypto.getRandomValues(new Uint8Array(16)))}`;
  return { token: `${payload}.${await signTeacherAccess(secret, payload)}`, expiresAt };
}
