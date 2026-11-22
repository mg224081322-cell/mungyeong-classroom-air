import { equal } from './http.mjs';
import { ACCESS_MS, signTeacherAccess } from './teacher-token.ts';

export const teacherPin = () => process.env.TEACHER_PIN || '';

export async function canReadTeacherRecords(req, now = Date.now()) {
  const secret = teacherPin();
  const match = /^Bearer (\d{13}\.[\w-]{22})\.([\w-]{43})$/.exec(req.headers.authorization ?? '');
  if (!secret || !match) return false;
  const expires = Number(match[1].slice(0, 13));
  return expires > now && expires <= now + ACCESS_MS && equal(match[2], await signTeacherAccess(secret, match[1]));
}
