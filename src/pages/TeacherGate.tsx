import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { KeyRound, LockKeyhole } from 'lucide-react';
import { Link, useOutletContext } from 'react-router';
import { Teacher, type TeacherProps } from './VentPanels';
import { TeacherClassroom } from './Classroom';

type TeacherAccess = { token: string; expiresAt: number };

export default function TeacherGate({ mode = 'records' }: { mode?: 'records' | 'classroom' }) {
  const records = useOutletContext<TeacherProps>();
  const [access, setAccess] = useState<TeacherAccess | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const field = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);

  const lock = useCallback((message: string) => {
    request.current?.abort();
    request.current = null;
    setAccess(null); setBusy(false); setError(''); setNotice(message);
    requestAnimationFrame(() => field.current?.focus());
  }, []);
  const expired = useCallback(() => lock('잠금이 풀린 시간이 만료됐어요. PIN을 다시 입력해 주세요.'), [lock]);

  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) lock('선생님 보기를 잠갔어요.');
    };
    window.addEventListener('pageshow', onPageShow);
    return () => { request.current?.abort(); window.removeEventListener('pageshow', onPageShow); };
  }, [lock]);
  useEffect(() => {
    if (!access) return;
    const timer = window.setTimeout(expired, Math.max(0, access.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [access, expired]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (request.current) return;
    const form = event.currentTarget;
    const pin = String(new FormData(form).get('pin') ?? '');
    const controller = new AbortController();
    request.current = controller;
    form.reset(); setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/teacher-unlock', {
        method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
      });
      if (controller.signal.aborted) return;
      if (response.status === 401) { setError('PIN이 맞지 않아요. 다시 입력해 주세요.'); return; }
      if (response.status === 429) { setError('시도가 너무 많아요. 잠시 후 다시 입력해 주세요.'); return; }
      if (response.status === 503) { setError('공통 교사용 PIN이 아직 설정되지 않았어요.'); return; }
      if (!response.ok) throw Error();
      const result: TeacherAccess = await response.json();
      if (typeof result?.token !== 'string' || !result.token || !Number.isFinite(result.expiresAt) || result.expiresAt <= Date.now()) throw Error();
      if (!controller.signal.aborted) setAccess(result);
    } catch {
      if (!controller.signal.aborted) setError('PIN을 확인할 수 없어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      if (request.current === controller && !controller.signal.aborted) {
        request.current = null;
        setBusy(false); requestAnimationFrame(() => field.current?.focus());
      }
    }
  }

  if (access) return <div className="vent-teacher-unlocked">
    <div className="co2-toplinks"><Link className="vent-btn" to={mode === 'records' ? '/teacher/co2' : '/teacher'}>{mode === 'records' ? '교사용 CO₂ 모니터' : '이 브라우저의 행동 기록'}</Link><div className="vent-teacher-lockbar"><button type="button" className="vent-btn" onClick={() => lock('선생님 보기를 잠갔어요.')}><LockKeyhole size={16} aria-hidden="true"/>잠그기</button></div></div>
    {mode === 'classroom' ? <TeacherClassroom token={access.token} onExpired={expired}/> : <Teacher {...records}/>}
  </div>;

  return <section className="vent-pin" aria-labelledby="teacher-pin-title">
    <span className="vent-pin-icon" aria-hidden="true"><LockKeyhole size={25}/></span>
    <h1 id="teacher-pin-title">{mode === 'classroom' ? '교사용 CO₂ 모니터' : '선생님 보기'}</h1>
    <p>{mode === 'classroom' ? '시범 교실을 관리하려면 공통 교사용 PIN을 입력해 주세요.' : '기록을 보려면 공통 교사용 PIN을 입력해 주세요.'}</p>
    {notice && <p role="status" className="vent-message">{notice}</p>}
    <form className="vent-form" onSubmit={submit}>
      <label><span>교사용 PIN</span><input ref={field} name="pin" type="password" autoComplete="off" required maxLength={256} readOnly={busy} aria-invalid={Boolean(error)} aria-describedby="teacher-pin-hint"/></label>
      <p id="teacher-pin-hint" className="vent-pin-hint">화면을 나가거나 새로고침하면 다시 잠겨요.</p>
      {error && <p className="vent-error" role="alert">{error}</p>}
      <button className="vent-btn vent-primary" disabled={busy}><KeyRound size={16} aria-hidden="true"/>{busy ? '확인 중…' : '잠금 풀기'}</button>
    </form>
  </section>;
}
