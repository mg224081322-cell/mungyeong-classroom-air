import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { verifyTeacherAccess } from '../server/teacher-token.ts';
import { classroomReading, DEFAULT_POLICY, nextAboveSince, ROOM } from '../src/lib/classroom.ts';

type RoomRow = {
  device_digest: string | null; threshold: number; minutes: number; ppm: number | null;
  measured_at: number | null; received_at: number | null; above_since: number | null; disconnected: number; revision: number;
};
// Minimal storage interface shared by D1, SQLite preview and PostgreSQL on Vercel.
type ClassroomDb = {
  prepare(sql: string): { bind(...values: (string | number | null)[]): {
    first<T>(): Promise<T | null>;
    run(): Promise<{ meta: { changes: number } }>;
  } };
};
type Env = { Bindings: { DB: ClassroomDb; TEACHER_PIN?: string }; Variables: { deviceDigest: string } };
const app = new Hono<Env>();
const base = '/classrooms/:room';
const getRoom = (db: ClassroomDb) => db.prepare('SELECT * FROM classroom_live WHERE room = ?').bind(ROOM).first<RoomRow>();
const read = (row: RoomRow | null, now = Date.now()) => classroomReading(row?.ppm ?? null, row?.measured_at ?? null, row?.received_at ?? null, Boolean(row?.disconnected), now);
const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
const digest = async (value: string) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
const inRange = (n: unknown, min: number, max: number): n is number => typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max;
const changed = (result: { meta: { changes: number } }) => result.meta.changes > 0;

app.onError((_error, c) => c.json({ error: 'classroom storage unavailable' }, 503, { 'Cache-Control': 'no-store' }));

app.use(`${base}/*`, async (c, next) => {
  if (c.req.param('room') !== ROOM) return c.json({ error: 'classroom not found' }, 404, { 'Cache-Control': 'no-store' });
  await next();
  c.header('Cache-Control', 'no-store');
});
app.use(`${base}/teacher/*`, async (c, next) => {
  if (!await verifyTeacherAccess(c.env.TEACHER_PIN, c.req.header('Authorization'))) return c.json({ error: 'teacher access required' }, 401);
  await next();
});
app.use(`${base}/device/*`, async (c, next) => {
  const raw = /^Bearer co2_([a-f0-9]{64})$/.exec(c.req.header('Authorization') ?? '');
  if (!raw) return c.json({ error: 'device access required' }, 401);
  c.set('deviceDigest', await digest(`co2_${raw[1]}`));
  await next();
});

app.get(`${base}/latest`, async c => c.json(read(await getRoom(c.env.DB))));

app.get(`${base}/teacher/state`, async c => {
  const row = await getRoom(c.env.DB);
  const reading = read(row);
  const warning = reading.status === 'measuring' && row?.above_since != null && row.measured_at != null && row.measured_at - row.above_since >= row.minutes * 60_000 ? row.above_since : null;
  return c.json({ reading, warning, registered: Boolean(row?.device_digest), threshold: row?.threshold ?? DEFAULT_POLICY.threshold, minutes: row?.minutes ?? DEFAULT_POLICY.minutes });
});

app.put(`${base}/teacher/policy`, bodyLimit({ maxSize: 2048 }), async c => {
  const input = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!inRange(input?.threshold, 400, 5000) || !inRange(input?.minutes, 1, 60)) return c.json({ error: 'invalid policy' }, 400);
  await c.env.DB.prepare(`INSERT INTO classroom_live (room, threshold, minutes) VALUES (?, ?, ?)
    ON CONFLICT(room) DO UPDATE SET threshold = excluded.threshold, minutes = excluded.minutes, above_since = NULL, revision = classroom_live.revision + 1
    WHERE classroom_live.threshold != excluded.threshold OR classroom_live.minutes != excluded.minutes`).bind(ROOM, input.threshold, input.minutes).run();
  return c.json({ ok: true });
});

app.post(`${base}/teacher/device`, async c => {
  const token = `co2_${hex(crypto.getRandomValues(new Uint8Array(32)))}`;
  const result = await c.env.DB.prepare(`INSERT INTO classroom_live (room, device_digest) VALUES (?, ?)
    ON CONFLICT(room) DO UPDATE SET device_digest = excluded.device_digest, above_since = NULL, revision = classroom_live.revision + 1
    WHERE classroom_live.device_digest IS NULL`).bind(ROOM, await digest(token)).run();
  if (!changed(result)) return c.json({ error: 'a device is already registered' }, 409);
  return c.json({ token }, 201);
});

app.delete(`${base}/teacher/device`, async c => {
  await c.env.DB.prepare(`UPDATE classroom_live SET device_digest = NULL, disconnected = CASE WHEN measured_at IS NULL THEN 0 ELSE 1 END,
    above_since = NULL, revision = revision + 1 WHERE room = ? AND device_digest IS NOT NULL`).bind(ROOM).run();
  return c.json({ ok: true });
});

app.post(`${base}/device/reading`, bodyLimit({ maxSize: 2048 }), async c => {
  if (!/^application\/json(?:;|$)/i.test(c.req.header('Content-Type') ?? '')) return c.json({ error: 'JSON required' }, 415);
  const now = Date.now();
  const input = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!input || Object.keys(input).length !== 2 || !inRange(input.ppm, 250, 10000) || !inRange(input.measuredAt, now - 30_000, now + 5_000)) return c.json({ error: 'invalid reading' }, 400);
  const { ppm, measuredAt } = input;
  const device = c.get('deviceDigest');
  for (let i = 0; i < 3; i++) {
    const row = await getRoom(c.env.DB);
    if (!row || row.device_digest !== device) return c.json({ error: 'device not registered' }, 401);
    if ((row.measured_at !== null && measuredAt <= row.measured_at) || (row.received_at !== null && now <= row.received_at)) return c.json({ error: 'out-of-order reading' }, 409);
    const since = nextAboveSince({ measuredAt: row.measured_at, receivedAt: row.received_at, aboveSince: row.above_since, disconnected: Boolean(row.disconnected) }, ppm, measuredAt, now, row.threshold);
    const result = await c.env.DB.prepare(`UPDATE classroom_live SET ppm = ?, measured_at = ?, received_at = ?, above_since = ?, disconnected = 0,
      revision = revision + 1 WHERE room = ? AND revision = ? AND device_digest = ?`).bind(ppm, measuredAt, now, since, ROOM, row.revision, device).run();
    if (changed(result)) return c.json({ ok: true }, 201);
  }
  return c.json({ error: 'please retry' }, 409);
});

app.post(`${base}/device/disconnect`, async c => {
  const result = await c.env.DB.prepare(`UPDATE classroom_live SET disconnected = 1, above_since = NULL, revision = revision + 1
    WHERE room = ? AND device_digest = ?`).bind(ROOM, c.get('deviceDigest')).run();
  return changed(result) ? c.json({ ok: true }) : c.json({ error: 'device not registered' }, 401);
});

export default app;
