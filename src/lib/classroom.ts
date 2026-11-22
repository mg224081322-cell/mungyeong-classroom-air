export const ROOM = 'pilot';
export const STUDENT_PATH = `/classroom/${ROOM}`;
export const CLASSROOM_API = `/api/classrooms/${ROOM}`;
export const STALE_MS = 90_000;
export const POLL_MS = 5_000;
export const DEFAULT_POLICY = { threshold: 1000, minutes: 5 };

export type ReadingStatus = 'waiting' | 'measuring' | 'stopped';
export type ClassroomReading = { ppm: number | null; measuredAt: number | null; status: ReadingStatus };
export type ClassroomSettings = {
  threshold: number; minutes: number; registered: boolean; warning: number | null; reading: ClassroomReading;
};

export function classroomReading(ppm: number | null, measuredAt: number | null, receivedAt: number | null, disconnected: boolean, now: number): ClassroomReading {
  const status = disconnected ? 'stopped' : measuredAt === null || receivedAt === null ? 'waiting' : now - Math.min(measuredAt, receivedAt) > STALE_MS ? 'stopped' : 'measuring';
  return { ppm, measuredAt, status };
}

export function nextAboveSince(previous: { measuredAt: number | null; receivedAt: number | null; aboveSince: number | null; disconnected: boolean }, ppm: number, measuredAt: number, receivedAt: number, threshold: number) {
  if (ppm <= threshold) return null;
  if (previous.disconnected || previous.aboveSince === null || previous.measuredAt === null || previous.receivedAt === null || measuredAt - previous.measuredAt > STALE_MS || receivedAt - Math.min(previous.measuredAt, previous.receivedAt) > STALE_MS) return measuredAt;
  return previous.aboveSince;
}
