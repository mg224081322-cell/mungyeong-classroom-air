import { json } from '../server/http.mjs';

const uuid = value => typeof value === 'string' && /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value);
const grades = ['좋음', '보통', '나쁨', '매우 나쁨', null];
const advice = ['창문을 열어 주세요', '창문을 열어 주세요', '공기청정기를 켜 주세요', '공기청정기를 켜 주세요', '바깥 미세먼지 확인 필요'];
const actions = ['창문 열었어요', '공기청정기 켰어요'];
const sharedSources = ['serial', 'timer'];
const range = (val, low, high) => typeof val === 'number' && val >= low && val <= high;

export function writeRow(input, now = Date.now()) {
  const { table, row } = input ?? {};
  if (!row || !sharedSources.includes(row.source) || !uuid(row.id) || !uuid(row.session) || !Number.isSafeInteger(row.at) || row.at < 0 || row.at > now + 300000) return null;
  const base = { id: row.id, session_id: row.session, source: row.source };
  const at = new Date(row.at).toISOString();
  if (table === 'sensor_logs' && row.source === 'serial' && range(row.humidity, 0, 100) && range(row.temperature, -50, 100) && (row.noise === null || range(row.noise, 0, 1000)) && ['measuring', 'ok', 'ventilate'].includes(row.prediction)) {
    return { table, data: { ...base, measured_at: at, humidity: row.humidity, temperature: row.temperature, noise: row.noise, prediction: row.prediction } };
  }
  if (table !== 'alert_logs' || !uuid(row.alertId)) return null;
  const event = { ...base, alert_id: row.alertId, event_at: at };
  if (row.kind === 'alert' && row.id === row.alertId && grades.includes(row.grade) && advice[grades.indexOf(row.grade)] === row.advice) return { table, data: { ...event, kind: 'alert', air_grade: row.grade, advice: row.advice } };
  if (row.kind === 'action' && row.id !== row.alertId && actions.includes(row.action)) return { table, data: { ...event, kind: 'action', action: row.action } };
  return null;
}

export default async function handler(req, res) {
  return json(res, 410, { error: 'record sharing discontinued' });
}
