import { useEffect, useState, type FormEvent } from 'react';
import { CalendarDays, Download, FileSpreadsheet, Play } from 'lucide-react';
import { fields, mapCsv, readCsv, type Mapping } from '../lib/vent-input';
import { clock, dayKey, report, type LogEvent, type ManualAction, type Reading, type Source } from '../lib/ventilation';

const labels = { timestamp: '측정 시각', humidity: '습도 (%)', temperature: '온도 (°C)', noise: '소음 (선택)' };
export function CsvForm({ onPlay }: { onPlay: (rows: Reading[], speed: number) => void }) {
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Mapping>({ timestamp: -1, humidity: -1, temperature: -1, noise: -1 });
  const [speed, setSpeed] = useState(240);
  const [error, setError] = useState('');
  async function upload(file?: File) {
    setError(''); setRows([]);
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error('2MB 이하의 CSV를 올려 주세요.');
      const parsed = readCsv(await file.text());
      setMapping(Object.fromEntries(fields.map(field => [field, parsed[0].findIndex(label => label.toLowerCase() === field)])) as Mapping);
      setRows(parsed);
    } catch (e) { setError((e as Error).message); }
  }
  function play(e: FormEvent) {
    e.preventDefault();
    try { onPlay(mapCsv(rows, mapping), speed); setError(''); } catch (err) { setError((err as Error).message); }
  }
  return <form className="vent-form" onSubmit={play}>
    <p>측정값을 CSV의 시각으로 재생해요. 이 기록은 실측 기록과 분리돼 이 브라우저에만 남아요.</p>
    <label><span>측정 파일</span><input type="file" accept=".csv,text/csv" onChange={e => void upload(e.target.files?.[0])}/></label>
    <a className="vent-text-btn" href="/example.csv" download><Download size={16}/>예시 CSV 다운로드</a>
    {rows.length > 0 && <><p>{rows.length - 1}개 측정값 · CSV 열을 아래 항목에 연결해 주세요.</p><div className="vent-mapping">{fields.map(key => <label key={key}><span>{labels[key]}</span><select value={mapping[key]} onChange={e => setMapping({ ...mapping, [key]: Number(e.target.value) })}><option value={-1}>{key === 'noise' ? '사용 안 함' : '열 선택'}</option>{rows[0].map((label, i) => <option key={i} value={i}>{i + 1}. {label || '(이름 없음)'}</option>)}</select></label>)}</div></>}
    <label><span>재생 속도</span><select value={speed} onChange={e => setSpeed(Number(e.target.value))}><option value={1}>1배속 · 실제 시간</option><option value={60}>60배속</option><option value={240}>240배속 · 빠른 재생</option></select></label>
    {error && <p role="alert" className="vent-error">{error}</p>}
    <button className="vent-btn vent-primary" disabled={rows.length === 0}><Play size={16}/>재생 시작</button>
  </form>;
}

type RecordSource = Source | 'manual';

export type TeacherProps = { events: LogEvent[]; manual: ManualAction[]; clocks: Record<string, number>; initialSource: RecordSource; initialDay: string };

export function Teacher({ events, manual, clocks, initialSource, initialDay }: TeacherProps) {
  const [source, setSource] = useState(initialSource);
  const [day, setDay] = useState(initialDay);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (source !== 'serial' && source !== 'timer') return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [source]);
  const matching = events.filter(e => e.source === source);
  const rows = report(matching, clocks, now).filter(row => dayKey(row.alert.at) === day);
  const manualRows = source === 'manual' ? manual.filter(row => dayKey(row.at) === day).sort((a, b) => b.at - a.at) : [];
  return <section className="vent-teacher" aria-labelledby="teacher-title">
    <div className="vent-teacher-head"><div><h1 id="teacher-title">선생님 보기</h1><p>이 브라우저에 남은 날짜별 환기 안내와 행동을 확인해요.</p></div><div className="vent-teacher-filters"><label><span><CalendarDays size={16}/>기록 날짜</span><input type="date" value={day} onChange={e => setDay(e.target.value)}/></label><label><span>기록 출처</span><select value={source} onChange={e => setSource(e.target.value as RecordSource)}><option value="serial">센서 · 이 브라우저</option><option value="timer">타이머 · 이 브라우저</option><option value="demo">데모 · 가상 기록</option><option value="csv">CSV · 재생 기록</option><option value="manual">수동 · 이 브라우저</option></select></label></div></div>
    {source === 'manual' ? <>
      <p className="vent-message">수동 기록은 이 브라우저에만 남고 알림 응답 건수에 포함되지 않아요.</p>
      <div className="vent-table-wrap vent-manual-table"><table><thead><tr><th scope="col">기록 시각</th><th scope="col">행동</th></tr></thead><tbody>
        {manualRows.map(row => <tr key={row.id}><td>{clock(row.at)}</td><td>{row.action}</td></tr>)}
        {!manualRows.length && <tr><td colSpan={2} className="vent-empty">이 날짜의 수동 기록이 없어요.</td></tr>}
      </tbody></table></div>
    </> : <>
    <div className="vent-counts"><div><span>선택한 날의 알림</span><strong>{rows.length}<small>회</small></strong></div><div><span>알림 뒤 10분 안에 행동</span><strong>{rows.filter(row => row.result === '완료').length}<small>회</small></strong></div></div>
    <div className="vent-table-wrap"><table><thead><tr><th scope="col">알림 시각</th><th scope="col">안내</th><th scope="col">행동</th><th scope="col">결과</th></tr></thead><tbody>
      {rows.map(({ alert, action, result }) => <tr key={alert.id}><td>{clock(alert.at)}</td><td>{alert.advice}</td><td>{action ? <>{action.action}<small>{clock(action.at)} 기록{action.action === '공기청정기 켰어요' ? ' · 환기 여부 미확인' : ''}</small></> : '—'}</td><td><span className="vent-result" data-result={result}>{result}</span></td></tr>)}
      {!rows.length && <tr><td colSpan={4} className="vent-empty"><FileSpreadsheet size={24}/><strong>표시할 알림 기록이 없어요</strong><span>날짜나 기록 출처를 바꿔 확인해 보세요.</span></td></tr>}
    </tbody></table></div>
    <p className="vent-table-note">한국 시각 기준으로 표시해요. ‘완료’는 10분 안에 행동이 기록됐다는 뜻이에요.</p>
    </>}
  </section>;
}
