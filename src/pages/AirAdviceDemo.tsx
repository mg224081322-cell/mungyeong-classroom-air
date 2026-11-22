import { useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, Check, Wind } from 'lucide-react';
import { adviceFor, type Action, type Grade } from '../lib/ventilation';

const scenarios = [
  { label: '좋음·보통', grade: '좋음' },
  { label: '나쁨·매우 나쁨', grade: '나쁨' },
  { label: '확인 불가', grade: null },
] satisfies { label: string; grade: Grade | null }[];

export default function AirAdviceDemo() {
  const [selected, setSelected] = useState(0);
  const [action, setAction] = useState<Action | null>(null);
  const scenario = scenarios[selected];

  return <div className="vent-app">
    <a className="vent-skip" href="#vent-main">본문 바로가기</a>
    <header className="vent-top"><div className="vent-shell vent-top-inner vent-demo-top">
      <Link to="/" className="vent-brand"><span><Wind size={24} aria-hidden="true"/></span>교실 환기 알림판</Link>
      <Link to="/" className="vent-btn"><ArrowLeft size={17} aria-hidden="true"/>교실 현황으로</Link>
    </div></header>
    <main id="vent-main" tabIndex={-1} className="vent-shell vent-main">
      <header className="vent-air-demo-heading">
        <h1>미세먼지 안내 테스트</h1>
        <p>같은 환기 알림에서 미세먼지 등급만 바꿔 안내를 비교해 보세요.</p>
      </header>
      <fieldset className="vent-air-scenarios">
        <legend>가상 미세먼지 등급</legend>
        <div>{scenarios.map(({ label }, index) => <label key={label}>
          <input type="radio" name="demo-air-grade" checked={selected === index} onChange={() => { setSelected(index); setAction(null); }}/>
          {label}
        </label>)}</div>
      </fieldset>
      <section className="vent-hero alert vent-air-demo-preview" aria-labelledby="demo-alert-title">
        <div className="vent-orbit" aria-hidden="true"><i/><i/><div><Wind size={31}/></div></div>
        <div className="vent-hero-content">
          <span className="vent-source"><i/>데모 · 가상 미세먼지</span>
          <h2 id="demo-alert-title">곧 환기가 필요해요</h2>
          <p className="vent-advice" aria-live="polite">{adviceFor(scenario.grade)}</p>
          <div className="vent-hero-controls" aria-label="데모 행동">
            <button type="button" className="vent-btn" onClick={() => setAction('창문 열었어요')}>창문 열었어요</button>
            <button type="button" className="vent-btn" onClick={() => setAction('공기청정기 켰어요')}>공기청정기 켰어요</button>
          </div>
          <p className="vent-air-demo-feedback" role="status">{action ? <><Check size={15} aria-hidden="true"/>체험한 행동: {action}. 실제 기록에는 남지 않아요.</> : '행동 버튼은 체험용이며 실제 기록에는 남지 않아요.'}</p>
        </div>
      </section>
    </main>
  </div>;
}
