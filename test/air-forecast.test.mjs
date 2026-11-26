import assert from 'node:assert/strict';
import test from 'node:test';
import { nextForecastHours } from '../src/lib/air-forecast.ts';

const now = Date.parse('2026-11-26T23:26:00+09:00');
const h = 3600;
const base = Math.floor(now / (h * 1000)) * h;

test('returns the next three local hour slots across midnight and separates particulate measures', () => {
  const hourly = { time: [base + 3*h, base, base + h, base + 2*h, base + 4*h], pm10: [9, 99, 12, null, 8], pm2_5: [6, 99, 7, 5, 2] };
  assert.deepEqual(nextForecastHours({ hourly }, now), [
    { at: (base + h) * 1000, pm10: 12, pm25: 7 },
    { at: (base + 2*h) * 1000, pm10: null, pm25: 5 },
    { at: (base + 3*h) * 1000, pm10: 9, pm25: 6 },
  ]);
});

test('rejects malformed or unavailable forecasts without converting missing values to zero', () => {
  assert.deepEqual(nextForecastHours({ hourly: { time: [base + h], pm10: [], pm2_5: [0] } }, now), []);
  assert.deepEqual(nextForecastHours({ hourly: { time: [base + h], pm10: [-1], pm2_5: ['0'] } }, now), []);
  assert.deepEqual(nextForecastHours(null, now), []);
});
