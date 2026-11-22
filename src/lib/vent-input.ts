import type { Reading } from './ventilation';

function number(value: unknown) {
  return (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) ? Number(value) : NaN;
}

function reading(raw: Record<string, unknown>, at: number): Reading | null {
  const humidity = number(raw.humidity), temperature = number(raw.temperature);
  const noise = raw.noise == null || raw.noise === '' ? null : number(raw.noise);
  if (!Number.isFinite(at) || !(humidity >= 0 && humidity <= 100) || !(temperature >= -50 && temperature <= 100) || (noise !== null && !(noise >= 0 && noise <= 1000))) return null;
  return { at, humidity, temperature, noise };
}

// USB contract: UTF-8 newline-delimited JSON. The app uses the host's sampling clock.
export function parseSerialLine(line: string, at: number): Reading | null {
  try {
    const raw = JSON.parse(line);
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? reading(raw, at) : null;
  } catch { return null; }
}

export type Field = 'timestamp' | 'humidity' | 'temperature' | 'noise';
export const fields: Field[] = ['timestamp', 'humidity', 'temperature', 'noise'];
export type Mapping = Record<Field, number>;

export function readCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false, closed = false;
  const addField = () => { row.push(field.trim()); field = ''; closed = false; };
  const addRow = () => { addField(); if (row.some(Boolean)) rows.push(row); row = []; };
  const input = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (input[i + 1] === '"') { field += '"'; i++; }
      else { quoted = false; closed = true; }
    } else if (c === ',') addField();
    else if (c === '\n' || c === '\r') { if (c === '\r' && input[i + 1] === '\n') i++; addRow(); }
    else if (c === '"' && !field && !closed) quoted = true;
    else if (c === '"' || (closed && !/\s/.test(c))) throw new Error('CSV 따옴표 형식을 확인해 주세요.');
    else field += c;
  }
  if (quoted) throw new Error('CSV에 닫히지 않은 따옴표가 있어요.');
  addRow();
  if (rows.length < 2 || rows[0].length < 3) throw new Error('머리글과 측정 데이터가 있는 쉼표 구분 CSV를 올려 주세요.');
  if (rows.length > 20_001) throw new Error('한 번에 측정값 20,000개까지 재생할 수 있어요.');
  return rows;
}

export function mapCsv(rows: string[][], mapping: Mapping): Reading[] {
  const selected = fields.map(key => mapping[key]).filter(i => i >= 0);
  if (fields.slice(0, 3).some(key => mapping[key] < 0)) throw new Error('측정 시각, 습도, 온도 열을 선택해 주세요.');
  if (new Set(selected).size !== selected.length) throw new Error('한 열을 여러 항목에 연결할 수 없어요.');
  const seen = new Set<number>();
  return rows.slice(1).map((row, i) => {
    const timestamp = row[mapping.timestamp]?.replace(' ', 'T') ?? '';
    const hasTime = /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(timestamp);
    const at = hasTime ? Date.parse(/(?:Z|[+-]\d\d:?\d\d)$/i.test(timestamp) ? timestamp : `${timestamp}+09:00`) : NaN;
    const parsed = reading({ humidity: row[mapping.humidity], temperature: row[mapping.temperature], noise: row[mapping.noise] }, at);
    if (!parsed || selected.some(index => index >= row.length)) throw new Error(`데이터 ${i + 1}번째 행의 시각과 숫자를 확인해 주세요.`);
    if (seen.has(at)) throw new Error(`데이터 ${i + 1}번째 행의 측정 시각이 중복돼요.`);
    seen.add(at);
    return parsed;
  }).sort((a, b) => a.at - b.at);
}
