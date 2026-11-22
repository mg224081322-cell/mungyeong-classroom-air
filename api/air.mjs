import { json } from '../server/http.mjs';
import { airCacheSeconds, lookupMungyeong } from '../server/mungyeong-air.ts';

const HOUR = 3600000;
const DEFAULT_STATION = '문경시';
const grades = { 1: '좋음', 2: '보통', 3: '나쁨', 4: '매우 나쁨' };
let cache, pending;

export function parseAir(items, now) {
  if (!Array.isArray(items)) return null;
  // Use the latest observation, not a past grade when a newer station row is missing/invalid.
  const latest = items.flatMap(item => {
    if (!/^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(item?.dataTime ?? '')) return [];
    const measuredAt = Date.parse(`${item.dataTime.replace(' ', 'T')}:00+09:00`);
    return Number.isFinite(measuredAt) ? [{ ...item, measuredAt }] : [];
  }).sort((a, b) => b.measuredAt - a.measuredAt)[0];
  const validGrade = /^[1-4]$/.test(String(latest?.pm10Grade1h ?? '')) ? grades[latest.pm10Grade1h] : null;
  if (!validGrade || String(latest.pm10Flag ?? '').trim() || latest.measuredAt > now || now - latest.measuredAt >= 2 * HOUR) return null;
  return { grade: validGrade, measuredAt: latest.measuredAt };
}

async function lookup(key, station) {
  const url = new URL('https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getMsrstnAcctoRltmMesureDnsty');
  url.search = new URLSearchParams({ serviceKey: key, stationName: station, returnType: 'json', numOfRows: '4', pageNo: '1', dataTerm: 'DAILY', ver: '1.3' });
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4500), redirect: 'error' });
    if (!res.ok) return null;
    const data = (await res.json()).response;
    if (data?.header?.resultCode !== '00') return null;
    return parseAir(data.body?.items, Date.now());
  } catch { return null; }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return json(res, 405, { error: 'method' }); }
  const key = process.env.AIRKOREA_SERVICE_KEY?.trim();
  const station = process.env.AIRKOREA_STATION_NAME?.trim() || DEFAULT_STATION;
  if (!key && station !== DEFAULT_STATION) return json(res, 200, { air: null, station });
  if (!cache || cache.until <= Date.now()) {
    const refresh = () => station === DEFAULT_STATION ? lookupMungyeong() : lookup(key, station);
    pending ??= refresh().then(air => { cache = { air, until: Date.now() + airCacheSeconds(air) * 1000 }; }).finally(() => { pending = undefined; });
    await pending;
  }
  const air = cache.air && Date.now() - cache.air.measuredAt < 2 * HOUR ? cache.air : null;
  const ttl = Math.max(0, Math.floor((Math.min(cache.until, air ? air.measuredAt + 2 * HOUR : cache.until) - Date.now()) / 1000));
  res.setHeader('Vercel-CDN-Cache-Control', `public, s-maxage=${ttl}`);
  return json(res, 200, { air, station });
}
