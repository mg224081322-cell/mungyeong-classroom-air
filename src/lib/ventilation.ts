export const MIN = 60_000;
export const WINDOW = 20 * MIN;
export const RESPONSE = 10 * MIN;
export const AIR_MAX_AGE = 120 * MIN;
export type ReadingSource = 'demo' | 'csv' | 'serial';
export type Source = ReadingSource | 'timer';
export const isSharedSource = (source: Source) => source === 'serial' || source === 'timer';
export type Reading = { at: number; humidity: number; temperature: number; noise: number | null };
export type Prediction = 'measuring' | 'ok' | 'ventilate';
export type Grade = '좋음' | '보통' | '나쁨' | '매우 나쁨';
export type Air = { grade: Grade; measuredAt: number; pm10?: number; source?: 'gyeongbuk' };
export type Advice = '창문을 열어 주세요' | '공기청정기를 켜 주세요' | '바깥 미세먼지 확인 필요';
export type Action = '창문 열었어요' | '공기청정기 켰어요';
export type ManualAction = { id: string; at: number; action: Action };
export type SensorLog = Reading & { id: string; session: string; source: ReadingSource; prediction: Prediction };
type Base = { id: string; alertId: string; source: Source; session: string; at: number };
export type Alert = Base & { kind: 'alert'; grade: Grade | null; advice: Advice };
export type ActionEvent = Base & { kind: 'action'; action: Action };
export type LogEvent = Alert | ActionEvent;

export function predict(samples: Reading[]): Prediction {
  const current = samples.at(-1);
  if (!current) return 'measuring';
  const cutoff = current.at - WINDOW;
  let i = samples.length - 1;
  while (i >= 0 && samples[i].at > cutoff) i--;
  if (i < 0) return 'measuring';
  const before = samples[i], after = samples[i + 1];
  const baseline = before.at === cutoff ? before.temperature : before.temperature + (after.temperature - before.temperature) * (cutoff - before.at) / (after.at - before.at);
  return current.temperature - baseline > 0.05 + 1e-10 && current.humidity <= 48.75 ? 'ventilate' : 'ok';
}

export function usableAir(air: Air | null, at: number) {
  if (!air || !['좋음', '보통', '나쁨', '매우 나쁨'].includes(air.grade) || !Number.isFinite(air.measuredAt) || air.measuredAt > at || at - air.measuredAt >= AIR_MAX_AGE) return null;
  return air;
}

export function adviceFor(grade: Grade | null): Advice {
  return grade === '좋음' || grade === '보통' ? '창문을 열어 주세요' : grade === '나쁨' || grade === '매우 나쁨' ? '공기청정기를 켜 주세요' : '바깥 미세먼지 확인 필요';
}

export function nextAlert({ prediction, previous, lastAction, active, at }: {
  prediction: Prediction; previous: Prediction; lastAction?: number; active: Alert | null; at: number;
}) {
  if (prediction !== 'ventilate' || active) return false;
  if (lastAction !== undefined) return at - lastAction >= WINDOW;
  return previous !== 'ventilate';
}

const dayFormatter = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
const clockFormatter = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export const dayKey = (at: number) => dayFormatter.format(at);
export const clock = (at: number) => clockFormatter.format(at);

export function lastWindowAt(events: LogEvent[], manual: ManualAction[] = []) {
  const manualWindow = manual.reduce<number | null>((last, event) => event.action === '창문 열었어요' ? Math.max(last ?? event.at, event.at) : last, null);
  return events.reduce<number | null>((last, event) => {
    if (event.kind !== 'action' || event.action !== '창문 열었어요' || (event.source !== 'timer' && event.source !== 'serial')) return last;
    return Math.max(last ?? event.at, event.at);
  }, manualWindow);
}

export function elapsedSince(at: number, now: number) {
  const minutes = Math.max(0, Math.floor((now - at) / MIN));
  if (minutes < 1) return '1분 미만';
  if (minutes < 60) return `${minutes}분`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours < 24) return `${hours}시간${remainder ? ` ${remainder}분` : ''}`;
  const days = Math.floor(hours / 24);
  return `${days}일${hours % 24 ? ` ${hours % 24}시간` : ''}`;
}

export function report(events: LogEvent[], clocks: Record<string, number>, now: number) {
  const actions = new Map<string, ActionEvent>();
  for (const row of events) if (row.kind === 'action') actions.set(row.alertId, row);
  return events.flatMap(row => {
    if (row.kind !== 'alert') return [];
    const action = actions.get(row.id);
    const done = action && action.at >= row.at && action.at <= row.at + RESPONSE;
    const current = isSharedSource(row.source) ? now : clocks[row.session] ?? row.at;
    return [{ alert: row, action, result: done ? '완료' : current > row.at + RESPONSE ? '놓침' : '대기 중' }];
  }).sort((a, b) => b.alert.at - a.alert.at);
}

export function demoSamples(now: number): Reading[] {
  // Start earlier on the same Korean calendar day so all demo entries are easy to find.
  const start = Date.parse(`${dayKey(now)}T09:00:00+09:00`);
  return Array.from({ length: 53 }, (_, i) => ({ at: start + i * 30_000,
    humidity: i >= 47 ? 48.4 : Number((53.2 - i * 0.08).toFixed(2)),
    temperature: Number((23.4 + Math.max(0, i - 39) * 0.035).toFixed(2)), noise: 36 + i % 6,
  }));
}
