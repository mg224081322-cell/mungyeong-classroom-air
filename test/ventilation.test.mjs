import test from 'node:test';
import assert from 'node:assert/strict';
import { adviceFor, demoSamples, elapsedSince, lastWindowAt, MIN, nextAlert, predict, report, SAMPLE_MS, usableAir } from '../src/lib/ventilation.ts';
import { mapCsv, parseSerialLine, readCsv, serialSampleSlot } from '../src/lib/vent-input.ts';
import { MIN_READINGS, THRESHOLD, predictNeedVent, ventProbability } from '../src/lib/predict.js';
import { parseAir } from '../api/air.mjs';
import logs, { writeRow } from '../api/logs.mjs';
import unlock from '../api/teacher-unlock.mjs';
import { issueTeacherAccess, verifyTeacherAccess, ACCESS_MS } from '../server/teacher-token.ts';
import { canWrite, deviceCookie } from '../server/http.mjs';

const sample = (at, temperature, humidity = 48.75) => ({ at: at * MIN, temperature, humidity, noise: null });

test('teacher PIN is server-only, access expires, and old record sharing is disabled', async t => {
  const secret = crypto.randomUUID();
  const old = process.env.TEACHER_PIN;
  t.after(() => { if (old === undefined) delete process.env.TEACHER_PIN; else process.env.TEACHER_PIN = old; });
  async function call(handler, request) {
    const headers = new Map();
    const res = { setHeader: (key, value) => headers.set(key, value), hasHeader: key => headers.has(key), end(value) { this.data = JSON.parse(value); } };
    await handler({ socket: { remoteAddress: 'test-teacher-address' }, ...request }, res);
    assert.equal(headers.get('Cache-Control'), 'no-store');
    return [res.statusCode, res.data];
  }
  const submit = pin => call(unlock, { method: 'POST', headers: { 'content-type': 'application/json' }, body: { pin } });
  const verify = token => verifyTeacherAccess(process.env.TEACHER_PIN, token ? `Bearer ${token}` : undefined);
  delete process.env.TEACHER_PIN;
  assert.equal((await submit(secret))[0], 503);
  process.env.TEACHER_PIN = secret;
  assert.equal((await submit(crypto.randomUUID()))[0], 401);
  assert.equal(await verify(), false);
  const [status, { token, expiresAt }] = await submit(secret);
  assert.equal(status, 200);
  assert.ok(token && !token.includes(secret) && expiresAt > Date.now());
  assert.equal(await verify(token), true);
  assert.equal(await verify(`${token}x`), false);
  assert.equal(await verify((await issueTeacherAccess(secret, Date.now() - ACCESS_MS)).token), false);
  for (const method of ['GET', 'POST']) assert.equal((await call(logs, { method, headers: { authorization: `Bearer ${token}` } }))[0], 410);
  process.env.TEACHER_PIN = crypto.randomUUID();
  assert.equal(await verify(token), false);
});

const observations = (last = 21.8) => Array.from({ length: 41 }, (_, i) => sample(i / 2, i === 40 ? last : 21.8, 42));
const modelInput = rows => rows.map(({ humidity, temperature }) => ({ humidity, temp: temperature }));

test('model requires 41 observations and matches both classes of the original logistic regression', () => {
  assert.equal(MIN_READINGS, 41);
  assert.equal(THRESHOLD, 0.7);
  const tooShort = observations().slice(1);
  assert.equal(predictNeedVent(modelInput(tooShort)), null);
  assert.equal(predict(tooShort), 'measuring');
  for (const [rows, expected, display] of [[observations(), 0, 'ok'], [observations(22.3), 1, 'ventilate']]) {
    assert.equal(predictNeedVent(modelInput(rows)), expected);
    assert.equal(predict(rows), display);
    assert.equal(predict(rows.toReversed()), display);
  }
  // These fixture scores are on opposite sides of 0.7, not merely opposite sides of 0.5.
  for (const [temp, expected, display] of [[21.91, 0, 'ok'], [21.98, 1, 'ventilate']]) {
    const rows = observations(temp);
    assert.ok(ventProbability(modelInput(rows)) > 0.5);
    assert.equal(predictNeedVent(modelInput(rows)), expected);
    assert.equal(predict(rows), display);
  }
});

test('missing, duplicate and irregular observations break the window until 41 fresh rows arrive', () => {
  const rows = observations();
  assert.equal(predict([...rows, rows[0]]), 'measuring');
  assert.equal(predict(rows.map((row, i) => i === 7 ? { ...row, at: row.at + 1 } : row)), 'measuring');
  assert.equal(predict(rows.map((row, i) => i === 7 ? { ...row, humidity: NaN } : row)), 'measuring');
  assert.equal(predict(rows.map((row, i) => i === 7 ? { ...row, temperature: null } : row)), 'measuring');
  const later = rows.map(row => ({ ...row, at: row.at + rows.at(-1).at + 2 * SAMPLE_MS }));
  assert.equal(predict([...rows, ...later.slice(0, 40)]), 'measuring');
  assert.equal(predict([...rows, ...later]), 'ok');
});

test('CSV rejects every duplicated timestamp and missing-value row without blocking later valid replay', () => {
  const rows = observations();
  const csv = (r, temp = r.temperature) => `${new Date(r.at).toISOString()},${r.humidity},${temp}`;
  const parse = lines => mapCsv(readCsv(['timestamp,humidity,temperature', ...lines].join('\n')), { timestamp: 0, humidity: 1, temperature: 2, noise: -1 });
  assert.equal(predict(parse(rows.toReversed().map(r => csv(r)))), 'ok');
  assert.equal(predict(parse(rows.map((r, i) => csv(r, i === 14 ? '' : r.temperature)))), 'measuring');
  assert.equal(predict(parse([...rows.map(r => csv(r)), csv(rows[0])])), 'measuring');
  assert.equal(predict(parse([])), 'measuring');
});

test('USB clock slots use real parsed readings and leave skipped slots missing', () => {
  const rows = observations(22.3).map((r, i) => parseSerialLine(JSON.stringify(r), serialSampleSlot(r.at + 1 + (i % 5) * 8)));
  assert.equal(predict(rows), 'ventilate');
  assert.equal(predict(rows.filter((_, i) => i !== 15)), 'measuring');
});

test('demo visits measuring, normal, then ventilation', () => {
  const rows = demoSamples(0);
  const sequence = rows.map((_, i) => predict(rows.slice(0, i + 1)));
  assert.deepEqual([...new Set(sequence)], ['measuring', 'ok', 'ventilate']);
});

test('alert dedup and cooldown use the supplied clock', () => {
  const alert = { id: 'a', alertId: 'a', kind: 'alert', at: 5 * MIN, source: 'csv', session: 's', grade: null, advice: adviceFor(null) };
  const input = { prediction: 'ventilate', previous: 'ventilate', active: null, at: 25 * MIN };
  assert.equal(nextAlert(input), false);
  assert.equal(nextAlert({ ...input, previous: 'ok', active: alert }), false);
  assert.equal(nextAlert({ ...input, lastAction: 5 * MIN + 1 }), false);
  assert.equal(nextAlert({ ...input, lastAction: 5 * MIN }), true);
  assert.equal(report([alert], { s: 15 * MIN }, 999999999)[0].result, '대기 중');
  assert.equal(report([alert], { s: 15 * MIN + 1 }, 0)[0].result, '놓침');
  assert.equal(report([alert, { id: 'b', alertId: 'a', kind: 'action', at: 15 * MIN, action: '공기청정기 켰어요' }], {}, 0)[0].result, '완료');
});

test('CSV custom column mapping, optional noise and serial parser', () => {
  const rows = readCsv('\uFEFF습도,날짜,온도,비고\r\n48.5,2026-11-19 09:00,23.2,"안내, 예시"');
  assert.deepEqual(mapCsv(rows, { timestamp: 1, humidity: 0, temperature: 2, noise: -1 }), [{ at: Date.parse('2026-11-19T00:00Z'), humidity: 48.5, temperature: 23.2, noise: null }]);
  assert.throws(() => mapCsv(rows, { timestamp: 1, humidity: 2, temperature: 2, noise: -1 }));
  assert.deepEqual(parseSerialLine('{"humidity":48.2,"temperature":23.25}', 42), { at: 42, humidity: 48.2, temperature: 23.25, noise: null });
  assert.equal(parseSerialLine('{"humidity":-1,"temperature":23}', 42), null);
});

test('timer uses real response time and purifier and simulated actions do not change the last window record', () => {
  const alert = { id: 't', alertId: 't', session: 's', source: 'timer', at: 0, kind: 'alert', grade: null, advice: adviceFor(null) };
  const window = { ...alert, id: 'w', kind: 'action', action: '창문 열었어요', at: MIN };
  const purifier = { ...window, id: 'p', action: '공기청정기 켰어요', at: 2 * MIN };
  assert.equal(report([alert], { s: 0 }, 10 * MIN + 1)[0].result, '놓침');
  assert.equal(report([alert, purifier], {}, 20 * MIN)[0].result, '완료');
  assert.equal(lastWindowAt([purifier, { ...window, source: 'demo' }, { ...window, source: 'csv' }]), null);
  assert.equal(lastWindowAt([window, purifier, { ...window, source: 'demo', at: 30 * MIN }]), MIN);
});

test('manual window actions contribute to the overview, independently of the alert log', () => {
  const entries = [{ id: 'w', at: 2 * MIN, action: '창문 열었어요' }, { id: 'p', at: 3 * MIN, action: '공기청정기 켰어요' }];
  assert.equal(lastWindowAt([], entries), 2 * MIN);
  assert.equal(report([], {}, 3 * MIN).length, 0);
  assert.equal(elapsedSince(2 * MIN, 2 * MIN + 1), '1분 미만');
  assert.equal(elapsedSince(2 * MIN, 67 * MIN), '1시간 5분');
});

test('air lookup rejects invalid, future and old observations', () => {
  const now = Date.parse('2026-11-19T10:30:00+09:00');
  const row = { dataTime: '2026-11-19 10:00', pm10Grade1h: '3' };
  const air = parseAir([row], now);
  assert.equal(adviceFor(air.grade), '공기청정기를 켜 주세요');
  assert.equal(adviceFor('보통'), '창문을 열어 주세요');
  assert.equal(usableAir(air, now + 90 * MIN), null);
  assert.equal(parseAir([{ ...row, pm10Flag: '장비점검' }], now), null);
  assert.equal(parseAir([{ ...row, dataTime: '2026-11-19 11:00' }], now), null);
  assert.equal(parseAir([row], now + 90 * MIN), null);
  assert.equal(adviceFor(null), '바깥 미세먼지 확인 필요');
});

test('the legacy writer is disabled even though its record formats and cookies still validate', async () => {
  const row = { ...sample(10, 23.4), id: crypto.randomUUID(), session: crypto.randomUUID(), source: 'serial', prediction: 'measuring' };
  assert.equal(writeRow({ row, table: 'sensor_logs' }).data.source, 'serial');
  assert.equal(writeRow({ row: { ...row, source: 'demo' }, table: 'sensor_logs' }), null);
  const timer = { ...row, alertId: row.id, source: 'timer', kind: 'alert', grade: null, advice: adviceFor(null) };
  assert.equal(writeRow({ row: timer, table: 'sensor_logs' }), null);
  assert.equal(writeRow({ row: timer, table: 'alert_logs' }).data.source, 'timer');
  const action = { ...timer, id: crypto.randomUUID(), kind: 'action', action: '공기청정기 켰어요' };
  assert.equal(writeRow({ row: action, table: 'alert_logs' }).data.alert_id, timer.id);
  for (const source of ['demo', 'csv']) assert.equal(writeRow({ row: { ...timer, source }, table: 'alert_logs' }), null);
  const res = { setHeader() {}, hasHeader() { return false; }, end() {} };
  await logs({ method: 'POST', headers: {} }, res);
  assert.equal(res.statusCode, 410);
  const tempSecret = crypto.randomUUID();
  const saved = process.env.CLASSROOM_DEVICE_CODE;
  try {
    process.env.CLASSROOM_DEVICE_CODE = tempSecret;
    const cookie = deviceCookie(tempSecret).split(';')[0];
    assert.equal(canWrite({ headers: { cookie } }), true);
    await logs({ method: 'POST', headers: { cookie } }, res);
    assert.equal(res.statusCode, 410);
    assert.equal(canWrite({ headers: { cookie: `${cookie}fake` } }), false);
  } finally {
    if (saved === undefined) delete process.env.CLASSROOM_DEVICE_CODE;
    else process.env.CLASSROOM_DEVICE_CODE = saved;
  }
});
