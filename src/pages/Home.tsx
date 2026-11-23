import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useMatch, useNavigate, useOutlet } from 'react-router';
import { Activity, ArrowLeft, Check, Clock3, Droplets, FileSpreadsheet, GraduationCap, Info, Pause, Play, Radio, ShieldCheck, Thermometer, Timer, Usb, Wind, X } from 'lucide-react';
import { useBoard } from '../lib/use-board';
import { adviceFor, clock, dayKey, elapsedSince, lastWindowAt, type Action, type ManualAction, type ReadingSource } from '../lib/ventilation';
import { load, save } from '../lib/vent-store';
import { CsvForm, type TeacherProps } from './VentPanels';
import { STUDENT_PATH } from '../lib/classroom';
import { MUNGYEONG_AIR_TABLE } from '../lib/mungyeong-air';
import { TimerBoard } from './TimerBoard';
import { VentMetric } from './VentMetric';
import './vent-board.css';

const sourceLabel: Record<ReadingSource, string> = { demo: '데모 · 가상 데이터', csv: 'CSV · 재생 데이터', serial: '센서 · 실측 데이터' };
const MANUAL_KEY = 'classroom-air-manual-actions-v1';

export default function Home() {
  const board = useBoard();
  const overviewRoute = useMatch('/');
  const teacher = Boolean(useMatch('/teacher/*'));
  const navigate = useNavigate();
  const [timerMode, setTimerMode] = useState(false);
  const [manual, setManual] = useState(() => load<ManualAction[]>(MANUAL_KEY, []));
  const [manualNotice, setManualNotice] = useState('');
  const [overviewNow, setOverviewNow] = useState(Date.now);
  const dialog = useRef<HTMLDialogElement>(null);
  const { s, air } = board;
  const provincialAir = air?.source === 'gyeongbuk' ? air : null;
  const tableLink = <a className="vent-text-btn underline underline-offset-2" href={MUNGYEONG_AIR_TABLE} target="_blank" rel="noopener noreferrer">{provincialAir ? '경상북도 · 문경시 측정소' : '문경시 실측값 보기'} (새 탭)</a>;
  const outlet = useOutlet({ events: board.events, manual, clocks: board.clocks,
    initialSource: timerMode ? 'timer' : s?.source ?? (manual.length ? 'manual' : board.events.some(e => e.source === 'demo') ? 'demo' : 'serial'),
    initialDay: dayKey(timerMode ? Date.now() : s?.now ?? Date.now()),
  } satisfies TeacherProps);
  const lastWindow = useMemo(() => lastWindowAt(board.events, manual), [board.events, manual]);
  const replaying = s?.source === 'demo' || s?.source === 'csv';
  const latest = replaying || board.connected ? s?.latest : null;
  const unmeasured = !replaying && !latest;
  const canDemo = !replaying && !board.connected;
  const active = s?.active;
  const status = active ? 'alert' : s?.prediction === 'ok' ? 'ok' : s?.prediction === 'ventilate' ? 'hold' : 'measuring';
  const headline = unmeasured && !board.connected && !active ? '교실 공기 상태 미측정' : { alert: '곧 환기가 필요해요', ok: '괜찮아요', hold: '환기 상태를 살피는 중', measuring: '측정 중' }[status];
  const subtitle = unmeasured ? board.connected ? '센서에서 첫 측정값을 기다리고 있어요.' : '센서를 연결하면 교실 온도와 습도가 표시돼요.' : status === 'ok' ? '모델이 30분 안에 환기가 필요할 가능성을 낮게 봤어요.' : status === 'hold' ? '같은 안내가 반복되지 않도록 잠시 기다리고 있어요.' : '30초 간격의 유효한 온도·습도 기록 41개(20분)가 연속으로 모이면 예측해요.';
  const displayedAdvice = active && adviceFor(air?.grade ?? null) === active.advice ? active.advice : '바깥 미세먼지 확인 필요';
  const stop = () => board.stop();
  useEffect(() => {
    if (teacher || timerMode || replaying) return;
    const update = () => setOverviewNow(Date.now());
    update();
    const timer = window.setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [teacher, timerMode, replaying]);

  function recordManually(action: Action) {
    const at = Date.now();
    const next = [...load<ManualAction[]>(MANUAL_KEY, []), { id: crypto.randomUUID(), at, action }];
    try {
      save(MANUAL_KEY, next);
      setManual(next);
      setOverviewNow(at);
      setManualNotice(action === '창문 열었어요' ? '창문을 연 시각을 기록했어요.' : '공기청정기를 켠 시각을 기록했어요. 마지막 창문 열기 시각은 바뀌지 않아요.');
    } catch { setManualNotice('이 브라우저에 행동을 저장하지 못했어요. 저장 공간을 확인해 주세요.'); }
  }

  if (!overviewRoute && !teacher) return outlet;

  return <div className="vent-app">
    <a className="vent-skip" href="#vent-main">본문 바로가기</a>
    <header className="vent-top"><div className="vent-shell vent-top-inner">
      <Link to="/" className="vent-brand" onClick={() => { setTimerMode(false); if (replaying) stop(); }}><span><Wind size={24}/></span>교실 환기 알림판</Link>
      <nav aria-label="주 메뉴">
        <button className="vent-btn" disabled={board.connecting} onClick={() => { if (teacher) void navigate('/'); setTimerMode(false); if (board.connected) stop(); else void board.connectSensor(); }}><Usb size={17}/>{board.connecting ? '연결 중…' : board.connected ? '센서 해제' : '센서 연결'}</button>
        <button className="vent-btn" disabled={board.connecting} onClick={() => dialog.current?.showModal()}><FileSpreadsheet size={17}/>CSV 재생</button>
        <button className="vent-btn vent-timer-nav" aria-pressed={timerMode && !teacher} onClick={() => { if (teacher) void navigate('/'); setTimerMode(teacher || !timerMode); void board.timer.refreshAir(); }}><Timer size={18} aria-hidden="true"/>타이머 모드{board.timer.lesson && <><span className={`vent-timer-dot${board.timer.lesson.active ? ' is-due' : ''}`} aria-hidden="true"/><span className="sr-only">{board.timer.lesson.active ? '환기 확인 알림 있음' : '수업 진행 중'}</span></>}</button>
        {teacher ? <Link to="/" className="vent-btn vent-tinted" onClick={() => { setTimerMode(false); if (replaying) stop(); }}><ArrowLeft size={17} aria-hidden="true"/>교실 현황으로</Link> : <Link to="/teacher" className="vent-btn vent-tinted"><GraduationCap size={18} aria-hidden="true"/>선생님 보기</Link>}
      </nav>
    </div></header>
    <main id="vent-main" tabIndex={-1} className="vent-shell vent-main">
      {teacher ? outlet : timerMode ? <TimerBoard timer={board.timer} lastWindow={lastWindow} storageError={board.storageError}/> : <>
        <div className="vent-context"><div><span className="vent-context-icon"><Radio size={19}/></span><span>{replaying ? sourceLabel[s.source] : '교실 현황'}</span></div><div className="co2-context-tools">{!replaying && <a className="vent-text-btn" href="#co2-home-title">CO₂ 실시간 조회</a>}<span className="vent-rule"><Info size={15}/>{unmeasured && !board.connected ? '실시간 현황' : '로지스틱 회귀 예측'}</span></div></div>
        <section className={`vent-hero ${status}${unmeasured ? ' vent-unmeasured' : ''}`} aria-labelledby="vent-status-title">
          <div className="vent-orbit" aria-hidden="true"><i/><i/><i/><div>{active ? <Wind size={40}/> : status === 'ok' ? <Check size={40}/> : <Activity size={40}/>}</div></div>
          <div className="vent-hero-content">
            <span className="vent-source"><i/>{!replaying && !board.connected ? '센서 미연결' : s ? sourceLabel[s.source] : '입력 대기 중'}</span>
            <h1 id="vent-status-title" aria-live="polite">{headline}</h1>
            {active ? <><p className="vent-advice">{displayedAdvice}</p><p className="vent-subtitle">바깥 미세먼지 {air ? `${air.grade} · ${clock(air.measuredAt)} 측정` : '등급을 확인할 수 없어요.'}</p>
              <div className="vent-hero-controls"><button className="vent-btn" onClick={() => board.act('창문 열었어요')}>창문 열었어요</button><button className="vent-btn" onClick={() => board.act('공기청정기 켰어요')}>공기청정기 켰어요</button></div></> : <p className="vent-subtitle">{subtitle}</p>}
            {canDemo && <div className="vent-hero-controls"><button className="vent-btn vent-primary" disabled={board.connecting} onClick={board.startDemo}><Play size={17} fill="currentColor"/>데모 시작</button><Link to="/demo/air" className="vent-btn"><Wind size={17} aria-hidden="true"/>미세먼지 안내 테스트</Link></div>}
            {canDemo && <p className="vent-demo-hint">센서 없이 가상 데이터로 체험할 수 있어요</p>}
            {s && s.source !== 'serial' && <div className="vent-replay"><Clock3 size={15}/><span>재생 시각 {clock(s.now)} · {s.ended ? '재생 완료' : `${s.speed}배속`}</span>{!s.ended && <button className="vent-text-btn" onClick={board.playToggle}>{s.paused ? <Play size={15}/> : <Pause size={15}/>} {s.paused ? '계속 재생' : '일시 정지'}</button>}<button className="vent-text-btn" onClick={stop}>{s.ended ? '닫기' : '재생 종료'}</button></div>}
          </div>
        </section>
        {(board.notice || board.storageError) && <div role="status" className="vent-message">{[board.notice, board.storageError].filter(Boolean).join(' ')}</div>}
        <div className="vent-metrics">
          <VentMetric icon={<Droplets size={20}/>} label="교실 습도" detail={latest ? '상대 습도' : '미측정'}><span>{latest?.humidity.toFixed(1) ?? '—'}</span> {latest && <small>%</small>}</VentMetric>
          <VentMetric icon={<Thermometer size={20}/>} label="교실 온도" detail={latest ? '실내 온도' : '미측정'}><span>{latest?.temperature.toFixed(2) ?? '—'}</span> {latest && <small>°C</small>}</VentMetric>
           <VentMetric icon={<Wind size={20}/>} label="바깥 미세먼지" detail={provincialAir ? <><div>PM10 {provincialAir.pm10} ㎍/㎥ · {clock(provincialAir.measuredAt)} 관측</div>{tableLink}</> : air ? `관측 ${clock(air.measuredAt)}${s?.source === 'demo' ? ' · 가상' : ' · 에어코리아'}` : s?.source === 'csv' ? '재생 시각의 관측값 없음' : replaying ? '유효한 관측값이 없어요' : tableLink}><span className={`vent-air-value${!air && !replaying ? ' vent-air-unknown' : ''}`}>{air?.grade ?? (replaying ? '확인 필요' : '바깥 미세먼지 확인 필요')}</span></VentMetric>
        </div>
        {!replaying && <section className="vent-window" aria-label="창문 열기 기록">
          <div className="vent-window-time"><h2 className="vent-metric-label"><span aria-hidden="true"><Clock3 size={20}/></span>마지막 창문 열기 시각</h2><div className="vent-window-value" aria-live="polite">{lastWindow === null ? <strong className="vent-window-empty">기록 없음</strong> : <strong><time dateTime={new Date(lastWindow).toISOString()}>{clock(lastWindow)}</time></strong>}</div><p>{lastWindow === null ? '이 브라우저에 남은 창문 열기 기록이 없어요.' : <>{dayKey(lastWindow) === dayKey(overviewNow) ? '오늘' : dayKey(lastWindow)} · {elapsedSince(lastWindow, overviewNow)} 지남</>}</p></div>
          {!active && <div className="vent-manual"><h2>새 행동 기록</h2><p>방금 한 행동을 남겨요. 알림 응답 건수에는 포함되지 않아요.</p><div><button className="vent-btn" onClick={() => recordManually('창문 열었어요')}>창문 열었어요</button><button className="vent-btn" onClick={() => recordManually('공기청정기 켰어요')}>공기청정기 켰어요</button></div>{manualNotice && <p className="vent-manual-feedback" role="status">{manualNotice}</p>}</div>}
        </section>}
        <div className="vent-last"><div><Clock3 size={17}/><span>마지막 측정 <b>{latest ? clock(latest.at) : '—'}</b></span><span className="vent-separator"/><span>{replaying ? '재생 데이터의 시각 기준' : '실시간 측정은 30초 간격'}</span></div>{!canDemo && <Link to="/demo/air" className="vent-text-btn"><Wind size={16} aria-hidden="true"/>미세먼지 안내 테스트</Link>}</div>
        {!replaying && <section className="co2-home-links co2-tool" aria-labelledby="co2-home-title"><h2 id="co2-home-title">시범 교실 CO₂</h2><p>등록된 측정 기기의 최신 CO₂ 값을 확인해 보세요.</p><div className="co2-buttons"><Link className="vent-btn" to={STUDENT_PATH}><Radio size={16} aria-hidden="true"/>학생용 실시간 조회</Link><Link className="vent-btn" to="/teacher/co2"><ShieldCheck size={16} aria-hidden="true"/>교사용 CO₂ 모니터</Link><Link className="vent-btn" to="/demo/co2"><Play size={16} aria-hidden="true"/>CO₂ 데모</Link></div></section>}
      </>}
    </main>
    <dialog ref={dialog} className="vent-dialog" aria-labelledby="vent-dialog-title"><div className="vent-dialog-head"><h2 id="vent-dialog-title">CSV 재생</h2><button className="vent-icon-btn" aria-label="닫기" onClick={() => dialog.current?.close()}><X size={20}/></button></div>
      <CsvForm onPlay={(rows, speed) => { board.replay('csv', rows, speed); if (teacher) void navigate('/'); setTimerMode(false); dialog.current?.close(); }}/>
    </dialog>
  </div>;
}
