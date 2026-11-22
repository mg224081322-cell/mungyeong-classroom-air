import { AIR_MAX_AGE, type Air, type Grade } from '../src/lib/ventilation.ts';
import { MUNGYEONG_AIR_TABLE } from '../src/lib/mungyeong-air.ts';

const grades: Grade[] = ['좋음', '보통', '나쁨', '매우 나쁨'];
const dayInKorea = (at: number) => new Date(at + 9 * 3600_000).toISOString().slice(0, 10);

// The caption on the source is static; identify the station by the selection result and code.
export function parseMungyeongTable(html: string, day: string, now: number): { air: Air | null; hasRows: boolean } {
  const empty = { air: null, hasRows: false };
  const invalid = { air: null, hasRows: true };
  if (!/<p\b[^>]*\bid="result"[^>]*>\s*문경시\s+문경시\s*<\/p>/i.test(html) ||
      !/<input\b(?=[^>]*\bname="code2")(?=[^>]*\bvalue="769")[^>]*>/i.test(html) ||
      !Array.from(html.matchAll(/<input\b(?=[^>]*\bname="start_date")[^>]*\bvalue="(\d{4}-\d{2}-\d{2})"[^>]*>/gi)).some(match => match[1] === day)) return invalid;

  const table = html.match(/<table\b[^>]*\bclass="tbl_basic tbl_all_td_center legend"[^>]*>([\s\S]*?)<\/table>/i)?.[1];
  const head = table?.match(/<thead\b[^>]*>([\s\S]*?)<\/thead>/i)?.[1];
  const cols = Array.from(head?.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi) ?? []);
  // The first heading is the row's time cell; use the exact PM10 heading, never PM2.5.
  const column = cols.findIndex(([, label]) => /\bPM-10\s*\(/i.test(label)) - 1;
  const body = table?.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i)?.[1];
  if (column < 0 || body === undefined) return invalid;

  let latest: { at: number; cell?: string } | undefined;
  for (const [, row] of body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const hour = row.match(/<th\b[^>]*>\s*([01]\d|2[0-3])시\s*<\/th>/i)?.[1];
    if (!hour) continue;
    const at = Date.parse(`${day}T${hour}:00:00+09:00`);
    if (!Number.isFinite(at) || at > now || (latest && latest.at > at)) continue;
    if (latest?.at === at) return invalid;
    latest = { at, cell: Array.from(row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi))[column]?.[1] };
  }
  if (!latest) return empty;
  if (now - latest.at >= AIR_MAX_AGE) return invalid;
  const value = latest.cell?.match(/^\s*<span\s+class="type([1-4])">\s*<em>\s*([1-4])\s*<\/em>\s*<\/span>\s*(\d{1,5})\s*$/i);
  if (!value || value[1] !== value[2]) return invalid;
  return { hasRows: true, air: { measuredAt: latest.at, grade: grades[Number(value[1]) - 1], pm10: Number(value[3]), source: 'gyeongbuk' } };
}

export async function lookupMungyeong(now = Date.now()): Promise<Air | null> {
  const signal = AbortSignal.timeout(5500);
  const day = dayInKorea(now);
  const days = now - Date.parse(`${day}T00:00:00+09:00`) < AIR_MAX_AGE ? [day, dayInKorea(now - 24 * 3600_000)] : [day];
  try {
    for (const date of days) {
      const url = new URL(MUNGYEONG_AIR_TABLE);
      for (const [key, value] of Object.entries({ term: 'term1', start_date: date, startTime: '00', endTime: '23' })) url.searchParams.set(key, value);
      const response = await fetch(url, { signal, redirect: 'error' });
      if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('text/html')) return null;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let bytes = 0, text = '';
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 512 * 1024) { await reader.cancel(); return null; }
        text += decoder.decode(chunk.value, { stream: true });
      }
      const { air, hasRows } = parseMungyeongTable(text + decoder.decode(), date, now);
      if (hasRows) return air;
    }
  } catch { /* Source unavailable: do not substitute an older or different station reading. */ }
  return null;
}

export function airCacheSeconds(air: Air | null, now = Date.now()) {
  return air ? Math.max(0, Math.min(300, Math.floor((air.measuredAt + AIR_MAX_AGE - now) / 1000))) : 60;
}
