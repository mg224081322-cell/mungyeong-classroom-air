import { BellRing, Clock3, Info, Play, Square, Timer, Wind } from 'lucide-react';
import type { useBoard } from '../lib/use-board';
import { adviceFor, clock, dayKey } from '../lib/ventilation';
import { VentMetric } from './VentMetric';

export function TimerBoard({ timer, lastWindow, storageError }: { timer: ReturnType<typeof useBoard>['timer']; lastWindow: number | null; storageError: string }) {
  const { lesson, air } = timer;
  const alert = lesson?.active;
  const currentAdvice = adviceFor(air?.grade ?? null);
  const advice = alert?.advice === currentAdvice ? currentAdvice : '바깥 미세먼지 확인 필요';
  const remaining = Math.max(0, Math.ceil(((lesson?.nextAt ?? timer.now) - timer.now) / 1000));
  const countdown = `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`;
  const lastDay = lastWindow === null ? '' : dayKey(lastWindow);
  const airDetail = air?.source === 'gyeongbuk' ? `PM10 ${air.pm10} ㎍/㎥ · ${clock(air.measuredAt)} 관측 · 경상북도 문경시` : air ? `${clock(air.measuredAt)} 측정 · 에어코리아` : '현재 관측 등급을 확인할 수 없어요.';

  return <>
    <div className="vent-context"><div><span className="vent-context-icon"><Timer size={19} aria-hidden="true"/></span><span>타이머 모드</span></div><span className="vent-rule"><Info size={15} aria-hidden="true"/>설정한 시간에 알림</span></div>
    <section className={`vent-hero vent-timer-hero${alert ? ' alert' : ''}`} aria-labelledby="timer-title">
      <div className="vent-orbit" aria-hidden="true"><i/><i/><i/><div>{alert ? <BellRing size={38}/> : <Timer size={38}/>}</div></div>
      <div className="vent-hero-content">
        <span className="vent-source"><i/>{lesson ? '수업 진행 중' : '센서 없이 사용'}</span>
        <h1 id="timer-title" aria-live="polite">{alert ? '환기를 확인할 시간이에요' : lesson ? '다음 알림까지 남은 시간' : '수업 타이머'}</h1>
        {alert ? <>
          <p className="vent-advice">{advice}</p><p className="vent-subtitle">{airDetail}</p>
          <div className="vent-hero-controls">
            <button className="vent-btn" onClick={() => timer.act('창문 열었어요')}>창문 열었어요</button>
            <button className="vent-btn" onClick={() => timer.act('공기청정기 켰어요')}>공기청정기 켰어요</button>
          </div>
          {advice !== '창문을 열어 주세요' && <p className="vent-demo-hint">버튼은 이미 한 행동을 기록하는 용도예요.</p>}
        </> : lesson ? <>
          <p className="vent-countdown" role="timer" aria-label={`남은 시간 ${Math.floor(remaining / 60)}분 ${remaining % 60}초`}>{countdown}</p>
          <p className="vent-subtitle">{lesson.interval / 60_000}분 간격 · 다음 알림 {clock(lesson.nextAt)}</p>
        </> : <>
          <p className="vent-subtitle">수업을 시작하면 설정한 간격마다 환기를 확인할 시간을 알려드려요.</p>
          <form className="vent-timer-setup" onSubmit={e => { e.preventDefault(); timer.start(); }}>
            <label><span>알림 간격</span><select name="interval" value={timer.interval} onChange={e => timer.changeInterval(Number(e.target.value))}>
              {[1, 5, 10, 15, 20, 25, 30, 40, 45, 50, 60, 90, 120].map(minutes => <option key={minutes} value={minutes}>{minutes}분{minutes === 1 ? ' (테스트용)' : ''}</option>)}
            </select></label>
            <button className="vent-btn vent-primary" type="submit"><Play size={17} fill="currentColor" aria-hidden="true"/>수업 시작</button>
          </form>
        </>}
        {lesson && <button className="vent-text-btn vent-end-lesson" onClick={timer.end}><Square size={14} aria-hidden="true"/>수업 종료</button>}
      </div>
    </section>
    {(timer.notice || storageError) && <p className="vent-message" role="status">{[timer.notice, storageError].filter(Boolean).join(' ')}</p>}
    <div className="vent-metrics vent-timer-metrics">
      <VentMetric icon={<Clock3 size={20}/>} label="마지막 창문 환기 시각" detail={lastWindow === null ? '창문을 열었다고 기록하면 여기에 표시돼요.' : `${lastDay} · 한국 시각`}>{lastWindow === null ? '기록 없음' : clock(lastWindow)}</VentMetric>
      <VentMetric icon={<Wind size={20}/>} label="바깥 미세먼지" detail={airDetail}>{air?.grade ?? '확인 필요'}</VentMetric>
    </div>
    <div className="vent-last"><p>같은 탭에서 새로고침해도 타이머가 이어져요. 행동 기록은 이 브라우저에만 남아요.</p></div>
  </>;
}
