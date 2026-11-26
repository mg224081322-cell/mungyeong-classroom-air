import { useEffect, useState } from 'react';
import { CAMS_FORECAST_URL, nextForecastHours, type ForecastHour } from '../lib/air-forecast';

const seoulTime = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const concentration = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1 });

function ForecastResults() {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<ForecastHour[] | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(8_000)]);
    void (async () => {
      try {
        const res = await fetch(CAMS_FORECAST_URL, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
        if (!res.ok) throw new Error('Forecast unavailable');
        const data = nextForecastHours(await res.json(), Date.now());
        if (!controller.signal.aborted) setResult(data);
      } catch {
        if (!controller.signal.aborted) setResult([]);
      }
    })();
    return () => controller.abort();
  }, [attempt]);

  return <div className="vent-forecast-body">
    <p>공개 대기질 모델의 문경 일대 예측값이에요. 교실 실측이나 공식 미세먼지 등급이 아니며, 환기 알림에는 쓰지 않아요.</p>
    <div role="status">
      {result === null ? '미세먼지 예측을 불러오는 중…' : result.length === 0 ? '예측을 불러오지 못했어요. 위의 측정소 관측 상태를 확인하거나 다시 시도해 주세요.' : `${result.length}개 시각의 예측을 불러왔어요.`}
    </div>
    {result && result.length > 0 && <table>
      <caption>시간별 예상 농도 (㎍/㎥ · 한국 시각)</caption>
      <thead><tr><th scope="col">예측 시각</th><th scope="col">PM10</th><th scope="col">PM2.5</th></tr></thead>
      <tbody>{result.map(({ at, pm10, pm25 }) => <tr key={at}>
        <th scope="row"><time dateTime={new Date(at).toISOString()}>{seoulTime.format(at)}</time></th>
        <td>{pm10 === null ? '자료 없음' : concentration.format(pm10)}</td>
        <td>{pm25 === null ? '자료 없음' : concentration.format(pm25)}</td>
      </tr>)}</tbody>
    </table>}
    <div className="vent-forecast-links">
      <span>출처: <a href="https://atmosphere.copernicus.eu/" translate="no">CAMS</a> · <a href="https://open-meteo.com/en/docs/air-quality-api" translate="no">Open-Meteo</a></span>
      <button type="button" className="vent-btn" disabled={result === null} onClick={() => { setResult(null); setAttempt(n => n + 1); }}>
        {result?.length === 0 ? '다시 시도' : '예측 새로고침'}
      </button>
    </div>
  </div>;
}

export function AirForecast() {
  const [open, setOpen] = useState(false);
  return <details className="vent-forecast" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><strong>문경 미세먼지 예측</strong><span>앞으로 3시간 · 바깥 공기</span></summary>
    {open && <ForecastResults />}
  </details>;
}
