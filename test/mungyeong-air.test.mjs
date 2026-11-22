import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMungyeongTable } from '../server/mungyeong-air.ts';

const day = '2026-11-22';
const now = Date.parse(`${day}T16:25:00+09:00`);
const pm10 = (grade, value) => `<span class="type${grade}"><em>${grade}</em></span> ${value}`;
const row = (hour, value) => `<tr><th>${hour}시</th><td>${pm10(1, 8)}</td><td>${value}</td></tr>`;
const html = (...rows) => `<p id="result">문경시 문경시</p><input name="code2" value="769"><input name="start_date" value="${day}"><table class="tbl_basic tbl_all_td_center legend"><thead><tr><th>시간</th><th>PM-2.5(㎍/㎥)</th><th>PM-10(㎍/㎥)</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;

test('selects the latest observed PM10 (not PM2.5) with the source grade and Korean time', () => {
  assert.deepEqual(parseMungyeongTable(html(row('16', pm10(2, 45)), row('15', pm10(1, 10)), row('17', pm10(3, 99))), day, now), {
    hasRows: true, air: { measuredAt: Date.parse(`${day}T16:00:00+09:00`), pm10: 45, grade: '보통', source: 'gyeongbuk' },
  });
});

test('rejects a stale, missing, ambiguous, wrong-station or maintenance observation', () => {
  for (const doc of [html(row('14', pm10(1, 20))), html(row('15', pm10(1, 20)), row('16', pm10(5, '!'))), html(row('16', '')), html(row('16', pm10(1, 20)), row('16', pm10(2, 70))), html(row('16', pm10(1, 20))).replace('769', '700')]) {
    assert.equal(parseMungyeongTable(doc, day, now).air, null);
  }
  assert.equal(parseMungyeongTable(html(row('16', pm10(1, 20))), '2026-11-21', now).air, null);
});
