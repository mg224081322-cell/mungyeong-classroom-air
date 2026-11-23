import { body, equal, json } from '../server/http.mjs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { teacherPin } from '../server/teacher-access.ts';
import { issueTeacherAccess } from '../server/teacher-token.ts';
import { allowVercelUnlock, classroomPostgres } from '../server/classroom-postgres.mjs';

const attempts = new Map<string, { count: number; until: number }>();
const duration = 60_000;
let sweepAt = 0;

function retryAfter(req: IncomingMessage, now = Date.now()) {
  if (now >= sweepAt) {
    for (const [key, entry] of attempts) if (entry.until <= now) attempts.delete(key);
    sweepAt = now + duration;
  }
  const forwarded = process.env.VERCEL === '1' ? req.headers['x-vercel-forwarded-for'] : null;
  const key = (typeof forwarded === 'string' && forwarded.split(',')[0].trim()) || req.socket?.remoteAddress || 'local';
  let entry = attempts.get(key);
  if (!entry || entry.until <= now) {
    if (!entry && attempts.size >= 4096) return 60;
    entry = { count: 0, until: now + duration };
    attempts.set(key, entry);
  }
  if (entry.count >= 10) return Math.ceil((entry.until - now) / 1000);
  entry.count++;
  return 0;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return json(res, 405, { error: 'method' }); }
  const secret = teacherPin();
  if (!secret) return json(res, 503, { error: 'teacher access not configured' });
  const delay = retryAfter(req);
  if (delay) { res.setHeader('Retry-After', String(delay)); return json(res, 429, { error: 'too many attempts' }); }
  const input = await body(req);
  if (typeof input?.pin !== 'string' || !input.pin.length || input.pin.length > 256) return json(res, 400, { error: 'invalid input' });
  if (process.env.VERCEL === '1' || process.env.CLASSROOM_DATABASE_URL) {
    try {
      const sql = classroomPostgres();
      if (!sql) return json(res, 503, { error: 'classroom storage not configured' });
      if (!await allowVercelUnlock(sql)) { res.setHeader('Retry-After', '60'); return json(res, 429, { error: 'too many attempts' }); }
    } catch { return json(res, 503, { error: 'classroom storage unavailable' }); }
  }
  if (!equal(input.pin, secret)) return json(res, 401, { error: 'invalid PIN' });
  return json(res, 200, await issueTeacherAccess(secret));
}
