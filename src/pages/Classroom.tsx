import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowLeft, BellRing, CircleAlert, Clipboard, Link2, Radio, Wind } from 'lucide-react';
import { Link } from 'react-router';
import { CLASSROOM_API, DEFAULT_POLICY, POLL_MS, STUDENT_PATH, classroomReading, nextAboveSince, type ClassroomReading, type ClassroomSettings } from '../lib/classroom';
import './classroom.css';

const TEACHER = `${CLASSROOM_API}/teacher`;
const timeFormat = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const number = new Intl.NumberFormat('ko-KR');
const empty: ClassroomReading = { ppm: null, measuredAt: null, status: 'waiting' };

function useClassroomPoll<T>(url: string, token?: string, onExpired?: () => void, refreshKey = 0) {
  const [data, setData] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let running = false;
    async function poll() {
      if (controller.signal.aborted || running) return;
      running = true;
      clearTimeout(timer);
      try {
        const res = await fetch(url, { cache: 'no-store', headers: token ? { Authorization: `Bearer ${token}` } : undefined, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(4500)]) });
        if (controller.signal.aborted) return;
        if (res.status === 401 && onExpired) { onExpired(); return; }
        if (!res.ok) throw Error();
        const next: T = await res.json();
        if (!controller.signal.aborted) { setData(next); setFailed(!navigator.onLine); }
      } catch { if (!controller.signal.aborted) setFailed(true); }
      finally {
        running = false;
        if (!controller.signal.aborted) timer = setTimeout(poll, POLL_MS);
      }
    }
    const offline = () => setFailed(true);
    const visible = () => { if (!document.hidden) void poll(); };
    void poll();
    window.addEventListener('offline', offline);
    window.addEventListener('online', poll);
    document.addEventListener('visibilitychange', visible);
    return () => {
      controller.abort(); clearTimeout(timer);
      window.removeEventListener('offline', offline); window.removeEventListener('online', poll);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [url, token, onExpired, refreshKey]);
  return { data, failed };
}

function ReadingBoard({ reading, failed, loading }: { reading: ClassroomReading; failed: boolean; loading: boolean }) {
  const status = failed ? 'stopped' : reading.status;
  const label = failed ? '측정 중단' : loading ? '측정값 확인 중…' : { waiting: '측정 대기', measuring: '측정 중', stopped: '측정 중단' }[status];
  return <section className="co2-meter" aria-label="CO₂ 측정값" data-state={status}>
    <div className="co2-meter-top"><span><Wind size={20} aria-hidden="true"/>교실 CO₂</span><strong className="co2-status" role="status"><i aria-hidden="true"/>{label}</strong></div>
    <div className="co2-number"><strong>{reading.ppm === null ? '—' : number.format(reading.ppm)}</strong><span>ppm</span></div>
    <dl><div><dt>{status === 'stopped' && reading.measuredAt !== null ? '마지막 측정 시각' : '측정 시각'}</dt><dd>{reading.measuredAt === null ? '—' : <time dateTime={new Date(reading.measuredAt).toISOString()}>{timeFormat.format(reading.measuredAt)} (한국 시각)</time>}</dd></div></dl>
  </section>;
}

function ClassroomFrame({ children, demoLink }: { children: ReactNode; demoLink?: ReactNode }) {
  return <div className="vent-app co2-frame">
    <a className="vent-skip" href="#co2-main">본문 바로가기</a>
    <header className="vent-top"><div className="vent-shell co2-frame-top"><span className="vent-brand"><span><Wind size={23} aria-hidden="true"/></span>교실 환기 알림판</span>{demoLink}</div></header>
    <main id="co2-main" tabIndex={-1} className="co2-frame-main">{children}</main>
  </div>;
}

export function StudentClassroom() {
  const { data, failed } = useClassroomPoll<ClassroomReading>(`${CLASSROOM_API}/latest`);
  return <ClassroomFrame>
    <header className="co2-heading"><p><Radio size={17} aria-hidden="true"/> 학생용 실시간 조회</p><h1>시범 교실</h1></header>
    <ReadingBoard reading={data ?? empty} failed={failed} loading={!data}/>
  </ClassroomFrame>;
}

function Warning({ threshold, minutes }: { threshold: number; minutes: number }) {
  return <aside className="co2-warning"><BellRing size={23} aria-hidden="true"/><div><strong>CO₂가 설정 기준을 넘었어요</strong><p>{number.format(threshold)} ppm 초과가 {minutes}분 이상 이어졌어요.</p></div></aside>;
}

export function TeacherClassroom({ token, onExpired }: { token: string; onExpired: () => void }) {
  const [refreshKey, refresh] = useState(0);
  const [secret, setSecret] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const lastWarning = useRef<number | null>(null);
  const { data, failed } = useClassroomPoll<ClassroomSettings>(`${TEACHER}/state`, token, onExpired, refreshKey);
  const currentWarning = failed ? null : data?.warning ?? null;

  useEffect(() => {
    if (currentWarning === null) { setAnnouncement(''); return; }
    if (lastWarning.current === currentWarning) return;
    lastWarning.current = currentWarning;
    try {
      const key = 'classroom-co2-last-warning-v1';
      if (sessionStorage.getItem(key) === String(currentWarning)) return;
      sessionStorage.setItem(key, String(currentWarning));
    } catch { /* the open page still deduplicates */ }
    setAnnouncement('CO₂가 설정 기준을 넘었어요.');
  }, [currentWarning]);

  async function mutate(path: string, method: string, success: string, body?: object) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const res = await fetch(`${TEACHER}/${path}`, { method, cache: 'no-store', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(6500) });
      if (res.status === 401) { onExpired(); return; }
      if (res.status === 400) { setError('기준은 400~5,000 ppm, 지속 시간은 1~60분 사이의 정수로 입력해 주세요.'); return; }
      if (res.status === 409) { setError('이미 등록된 기기가 있어요. 다시 등록하려면 기존 기기를 먼저 해제해 주세요.'); refresh(n => n + 1); return; }
      if (!res.ok) throw Error();
      if (path === 'device') setSecret(method === 'POST' ? (await res.json()).token : '');
      setConfirmRevoke(false); setNotice(success); refresh(n => n + 1);
    } catch { setError('변경 내용을 확인하지 못했어요. 연결을 확인하고 다시 시도해 주세요.'); }
    finally { setBusy(false); }
  }
  async function copy(value: string, success: string) {
    setNotice(''); setError('');
    try { await navigator.clipboard.writeText(value); setNotice(success); }
    catch { setError('자동으로 복사하지 못했어요. 학생 화면의 주소창이나 표시된 전송 키에서 직접 복사해 주세요.'); }
  }
  function savePolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    void mutate('policy', 'PUT', '경고 기준을 저장했어요.', { threshold: Number(fields.get('threshold')), minutes: Number(fields.get('minutes')) });
  }

  return <section className="co2-teacher" aria-labelledby="co2-teacher-title">
    <header className="co2-heading"><p><Radio size={17} aria-hidden="true"/> 교사용 실시간 모니터</p><h1 id="co2-teacher-title">시범 교실 CO₂</h1><span>이 화면을 열고 잠금을 풀어 둔 동안 기준을 연속으로 넘으면 경고가 표시돼요.</span></header>
    <ReadingBoard reading={data?.reading ?? empty} failed={failed} loading={!data}/>
    <span className="sr-only" role="alert">{announcement}</span>
    {currentWarning !== null && data && <Warning threshold={data.threshold} minutes={data.minutes}/>}
    <div className="co2-tools">
      <section className="co2-tool"><h2>학생용 교실 링크</h2><p>로그인 없이 최신 CO₂와 측정 상태만 볼 수 있어요.</p><div className="co2-buttons"><Link className="vent-btn" to={STUDENT_PATH}><Link2 size={16} aria-hidden="true"/>학생 화면 열기</Link><button className="vent-btn" type="button" onClick={() => void copy(new URL(STUDENT_PATH, location.origin).href, '학생용 링크를 복사했어요.')}><Clipboard size={16} aria-hidden="true"/>링크 복사</button></div></section>
      <section className="co2-tool"><h2>경고 기준</h2><p>기준 이하로 내려가거나 측정이 끊기면 연속 시간을 다시 세요.</p>
        {data && <form className="co2-policy vent-form" onSubmit={savePolicy} key={`${data.threshold}:${data.minutes}`}>
          <label><span>CO₂ 기준 (ppm)</span><input autoComplete="off" type="number" name="threshold" min={400} max={5000} step={1} defaultValue={data.threshold} required/></label>
          <label><span>연속 시간 (분)</span><input autoComplete="off" type="number" name="minutes" min={1} max={60} step={1} defaultValue={data.minutes} required/></label>
          <button className="vent-btn vent-primary" disabled={busy || failed}>기준 저장</button>
        </form>}
      </section>
      <section className="co2-tool co2-device"><h2>교실 측정 기기</h2><p>{data ? data.registered || secret ? '측정 기기 1대가 등록되어 있어요.' : '등록된 기기가 없어요. 실측 센서를 준비한 뒤 기기를 등록해 주세요.' : '기기 상태를 확인하고 있어요.'}</p>
        {data && !data.registered && !secret && <button type="button" className="vent-btn vent-primary" disabled={busy || failed} onClick={() => void mutate('device', 'POST', '기기를 등록했어요.')}>기기 등록</button>}
        {data?.registered || secret ? confirmRevoke ? <div className="co2-confirm"><p>해제하면 이 기기는 더 이상 측정값을 보낼 수 없어요.</p><div className="co2-buttons"><button type="button" className="vent-btn" disabled={busy} onClick={() => setConfirmRevoke(false)}>취소</button><button type="button" className="vent-btn co2-danger" disabled={busy || failed} onClick={() => void mutate('device', 'DELETE', '기기 등록을 해제했어요.')}>기기 등록 해제</button></div></div> : <button type="button" className="vent-btn" disabled={busy || failed} onClick={() => setConfirmRevoke(true)}>등록 해제</button> : null}
        {secret && <div className="co2-device-key"><p>전송 키는 이번에만 표시돼요. 측정 기기에만 입력해 주세요.</p><label><span>기기 전송 키</span><input readOnly spellCheck={false} autoComplete="off" name="device-key" value={secret} onFocus={e => e.target.select()}/></label><div className="co2-buttons"><button type="button" className="vent-btn" onClick={() => void copy(secret, '기기 전송 키를 복사했어요.')}>키 복사</button><button type="button" className="vent-btn" onClick={() => setSecret('')}>키 숨기기</button></div></div>}
      </section>
    </div>
    {error && <p className="vent-error co2-feedback" role="alert">{error}</p>}
    <p className="co2-feedback" role="status">{notice}</p>
    <Link className="vent-text-btn" to="/demo/co2">센서 없이 CO₂ 경고를 데모로 시험하기</Link>
  </section>;
}

type DemoState = { ppm: number | null; at: number; aboveSince: number | null; disconnected: boolean };
const demoInitial = (): DemoState => ({ ppm: null, at: Date.now(), aboveSince: null, disconnected: false });
export function ClassroomDemo() {
  const [demo, setDemo] = useState(demoInitial);
  const [step, setStep] = useState('가상 측정값을 선택해 보세요.');
  function simulate(ppm: number, count: number, message: string) {
    setDemo(state => {
      let next = state;
      for (let i = 0; i < count; i++) {
        const at = next.at + 30_000;
        const prevAt = next.ppm === null ? null : next.at;
        next = { ppm, at, disconnected: false, aboveSince: nextAboveSince({ measuredAt: prevAt, receivedAt: prevAt, aboveSince: next.aboveSince, disconnected: next.disconnected }, ppm, at, at, DEFAULT_POLICY.threshold) };
      }
      return next;
    });
    setStep(message);
  }
  const at = demo.ppm === null ? null : demo.at;
  const reading = classroomReading(demo.ppm, at, at, demo.disconnected, demo.at);
  const warning = reading.status === 'measuring' && demo.aboveSince !== null && demo.at - demo.aboveSince >= DEFAULT_POLICY.minutes * 60_000;

  return <ClassroomFrame demoLink={<Link className="vent-btn" to="/"><ArrowLeft size={16} aria-hidden="true"/>교실 현황으로</Link>}>
    <header className="co2-heading"><p><CircleAlert size={17} aria-hidden="true"/> 데모 · 가상 CO₂</p><h1>CO₂ 경고 체험</h1><span>시범 기본 기준을 사용해요. 가상 값은 실제 교실이나 학생 링크에 나타나지 않아요.</span></header>
    <ReadingBoard reading={reading} failed={false} loading={false}/>
    {warning && <Warning threshold={DEFAULT_POLICY.threshold} minutes={DEFAULT_POLICY.minutes}/>}
    <section className="co2-tool co2-demo-tool"><h2>측정 상황 바꾸기</h2><p>기본 기준: 1,000 ppm 초과가 5분 연속</p>
      <div className="co2-buttons"><button type="button" className="vent-btn" onClick={() => simulate(1350, 1, '기준 초과 가상 측정값을 받았어요.')}>높은 값 한 번</button><button type="button" className="vent-btn vent-primary" onClick={() => simulate(1350, 11, '높은 값이 5분 연속 이어지는 상황을 재현했어요.')}>5분 연속 초과 재현</button><button type="button" className="vent-btn" onClick={() => simulate(740, 1, '기준 이하로 돌아왔어요.')}>정상값으로 복구</button><button type="button" className="vent-btn" onClick={() => { setDemo(state => ({ ...state, disconnected: true, aboveSince: null })); setStep('가상 센서가 끊겼어요.'); }}>연결 끊기</button><button type="button" className="vent-btn" onClick={() => { setDemo(demoInitial()); setStep('데모를 처음 상태로 돌렸어요.'); }}>초기화</button></div>
      <p className="co2-feedback" role="status">{step}</p>
    </section>
  </ClassroomFrame>;
}
