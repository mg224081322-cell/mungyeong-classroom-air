// A fixed regional forecast point, not device location or a campus sensor.
export const CAMS_FORECAST_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality?latitude=36.59&longitude=128.19&hourly=pm10,pm2_5&domains=cams_global&forecast_days=2&timeformat=unixtime';

export type ForecastHour = { at: number; pm10: number | null; pm25: number | null };
const HOUR = 3_600_000;

function concentration(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export function nextForecastHours(payload: unknown, now: number): ForecastHour[] {
  if (!payload || typeof payload !== 'object' || !('hourly' in payload)) return [];
  const hourly = payload.hourly;
  if (!hourly || typeof hourly !== 'object') return [];
  const { time, pm10, pm2_5 } = hourly as Record<string, unknown>;
  if (!Array.isArray(time) || !Array.isArray(pm10) || !Array.isArray(pm2_5)) return [];
  if (time.length !== pm10.length || time.length !== pm2_5.length) return [];
  const hours = new Map<number, ForecastHour>();
  const first = Math.floor(now / HOUR) * HOUR + HOUR;
  time.forEach((seconds, i) => {
    if (typeof seconds !== 'number' || !Number.isSafeInteger(seconds)) return;
    const at = seconds * 1000;
    if (at < first || at > first + 2 * HOUR || at % HOUR !== 0) return;
    const coarse = concentration(pm10[i]);
    const fine = concentration(pm2_5[i]);
    if (coarse !== null || fine !== null) hours.set(at, { at, pm10: coarse, pm25: fine });
  });
  return [...hours.values()].sort((a, b) => a.at - b.at);
}
