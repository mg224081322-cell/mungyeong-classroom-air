import { useEffect, useRef, useState } from 'react';
import { parseSerialLine, serialSampleSlot } from './vent-input';
import { CLOCK_KEY, EVENT_KEY, load, localSensor, save } from './vent-store';
import { adviceFor, demoSamples, isObservation, MIN, nextAlert, predict, RESPONSE, SAMPLE_MS, usableAir, WINDOW, type Action, type Air, type Alert, type LogEvent, type Prediction, type Reading, type ReadingSource, type SensorLog } from './ventilation';

type SerialPort = { readable: ReadableStream<Uint8Array> | null; open(options: { baudRate: number }): Promise<void>; close(): Promise<void> };
type Session = {
  source: ReadingSource; id: string; now: number; latest: Reading | null; samples: Reading[];
  prediction: Prediction; active: Alert | null; holdUntil: number;
  rows: Reading[]; index: number; speed: number; paused: boolean; ended: boolean;
};
const createSession = (source: ReadingSource, now: number, rows: Reading[] = [], speed = 1): Session => ({
  source, id: crypto.randomUUID(), now, latest: null, samples: [], prediction: 'measuring', active: null, holdUntil: 0,
  rows, index: 0, speed, paused: false, ended: false,
});

type Lesson = { id: string; interval: number; nextAt: number; active: Alert | null };
const TIMER_INTERVAL_KEY = 'classroom-air-timer-interval-v1';
const LESSON_KEY = 'classroom-air-active-lesson-v1';
const validInterval = (value: number) => Number.isInteger(value) && value >= 1 && value <= 120;

function restoreLesson(): Lesson | null {
  try {
    const saved: Lesson | null = JSON.parse(sessionStorage.getItem(LESSON_KEY) ?? 'null');
    if (!saved || typeof saved.id !== 'string' || !validInterval(saved.interval / MIN) || !Number.isSafeInteger(saved.nextAt)) return null;
    return saved;
  } catch { return null; }
}

export function useBoard() {
  const session = useRef<Session | null>(null);
  const [restoredLesson] = useState(restoreLesson);
  const lesson = useRef<Lesson | null>(restoredLesson);
  const [timerNow, setTimerNow] = useState(Date.now);
  const [timerInterval, setTimerInterval] = useState(() => {
    const value = load(TIMER_INTERVAL_KEY, 30);
    return validInterval(value) ? value : 30;
  });
  const [timerNotice, setTimerNotice] = useState('');
  const events = useRef(load<LogEvent[]>(EVENT_KEY, []));
  const clocks = useRef(load<Record<string, number>>(CLOCK_KEY, {}));
  const liveAir = useRef<Air | null>(null);
  const checkedAir = useRef(0);
  const reader = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const [frame, setFrame] = useState(0);
  const [notice, setNotice] = useState('');
  const [storageError, setStorageError] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const redraw = () => setFrame(n => n + 1);

  function saveLesson() {
    try {
      if (lesson.current) sessionStorage.setItem(LESSON_KEY, JSON.stringify(lesson.current));
      else sessionStorage.removeItem(LESSON_KEY);
    } catch { setStorageError('수업 상태를 저장하지 못했어요. 새로고침하면 이어지지 않을 수 있어요.'); }
  }

  function persistEvent(event: LogEvent) {
    const added = [...events.current, event];
    try {
      save(EVENT_KEY, added);
      events.current = added;
      return true;
    } catch { setStorageError('브라우저 저장 공간을 사용할 수 없어요. 기록을 저장하지 못했어요.'); return false; }
  }

  function airFor(s: Session): Air | null {
    if (s.source === 'demo') return { grade: '좋음', measuredAt: s.rows[0].at };
    if (s.source === 'serial') return usableAir(liveAir.current, s.now);
    return null; // A live lookup is not a historical CSV measurement.
  }

  function checkAlert(s: Session, previous: Prediction) {
    const air = airFor(s), advice = adviceFor(air?.grade ?? null);
    const history = events.current.filter(row => row.source === s.source && (s.source === 'serial' || row.session === s.id));
    const related = new Set(history.filter(row => row.kind === 'alert' && row.advice === advice).map(row => row.id));
    const recent = history.slice().reverse();
    const latestAlert = recent.find(row => row.kind === 'alert' && row.advice === advice);
    const lastAction = recent.find(row => row.kind === 'action' && related.has(row.alertId))?.at;
    // A continuous, missed episode is not a reason to replace the original alert.
    const completed = latestAlert && history.some(row => row.kind === 'action' && row.alertId === latestAlert.id);
    if (previous === 'ventilate' && latestAlert && !completed) return;
    if (!nextAlert({ prediction: s.prediction, previous, lastAction, active: s.active, at: s.now })) return;
    const id = crypto.randomUUID();
    const alert: Alert = { id, alertId: id, session: s.id, source: s.source, kind: 'alert', at: s.now, grade: air?.grade ?? null, advice };
    if (persistEvent(alert)) s.active = alert;
  }

  function ingest(s: Session, value: Reading) {
    s.now = value.at;
    s.latest = isObservation(value) ? value : null;
    s.samples.push(value);
    while (s.samples[0].at < value.at - WINDOW) s.samples.shift();
    const past = s.prediction;
    s.prediction = predict(s.samples);
    if (s.prediction === 'measuring') s.active = null;
    if (s.latest) {
      const log: SensorLog = { ...value, id: crypto.randomUUID(), session: s.id, source: s.source, prediction: s.prediction };
      void localSensor(log).catch(() => setStorageError('브라우저 저장 공간에 측정값을 저장하지 못했어요.'));
    }
    checkAlert(s, past);
    if (s.source === 'demo' && past === 'measuring' && s.prediction === 'ok') s.holdUntil = performance.now() + 2200;
    if (s.source === 'demo' && s.active && past !== 'ventilate') s.paused = true;
  }

  function updateClock(s: Session, at: number) {
    s.now = at;
    if (s.active && at > s.active.at + RESPONSE) s.active = null;
  }

  async function refreshAir() {
    if (Date.now() - checkedAir.current < (liveAir.current ? 5 : 1) * MIN) return;
    checkedAir.current = Date.now();
    try {
      const res = await fetch('/api/air', { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw Error();
      liveAir.current = (await res.json()).air ?? null;
    } catch { liveAir.current = null; }
    redraw();
  }

  const tick = useRef<(elapsed: number) => void>(() => {});
  tick.current = elapsed => {
    const now = Date.now();
    const currentLesson = lesson.current;
    if (currentLesson) {
      void refreshAir();
      if (currentLesson.active && now > currentLesson.active.at + RESPONSE) {
        currentLesson.active = null;
        saveLesson();
      }
      if (!currentLesson.active && now >= currentLesson.nextAt) {
        const grade = usableAir(liveAir.current, now)?.grade ?? null;
        const id = crypto.randomUUID();
        const alert: Alert = { id, alertId: id, session: currentLesson.id, source: 'timer', kind: 'alert', at: now, grade, advice: adviceFor(grade) };
        // Still show the reminder if local storage is unavailable. The status below explains the failure.
        persistEvent(alert);
        currentLesson.active = alert;
        currentLesson.nextAt = now + currentLesson.interval;
        saveLesson();
        setTimerNotice('');
      }
      setTimerNow(now);
    }
    const s = session.current;
    if (!s) return;
    if (s.source === 'serial') {
      updateClock(s, Date.now());
      if (connected) void refreshAir();
      if (connected && s.samples.length && s.latest && serialSampleSlot(s.now) > s.latest.at + SAMPLE_MS) {
        s.samples = []; s.prediction = 'measuring'; s.active = null;
        setNotice('센서 측정값이 들어오지 않아요. USB와 센서 출력을 확인해 주세요.');
      }
      redraw();
      return;
    }
    if (s.paused || s.ended || performance.now() < s.holdUntil) return;
    const end = s.rows.at(-1)!.at + RESPONSE + 1;
    const target = Math.min(end, s.now + elapsed * s.speed);
    while (s.index < s.rows.length && s.rows[s.index].at <= target) {
      const row = s.rows[s.index++];
      updateClock(s, row.at);
      ingest(s, row);
      if (s.paused || performance.now() < s.holdUntil) break;
    }
    if (!s.paused && performance.now() >= s.holdUntil) {
      updateClock(s, target);
      const last = s.samples.at(-1);
      if (s.source === 'csv' && s.index < s.rows.length && last && target >= last.at + SAMPLE_MS) {
        s.prediction = 'measuring'; s.active = null;
      }
    }
    if (s.now >= end) s.ended = true;
    if (events.current.some(row => row.session === s.id)) {
      clocks.current[s.id] = s.now;
      try { save(CLOCK_KEY, clocks.current); }
      catch { setStorageError('재생 시각을 브라우저에 저장하지 못했어요.'); }
    }
    redraw();
  };

  useEffect(() => {
    let last = performance.now();
    const timer = window.setInterval(() => { const now = performance.now(); tick.current(Math.min(1000, now - last)); last = now; }, 250);
    const airTimer = window.setInterval(refreshAir, 60_000);
    void refreshAir();
    return () => { clearInterval(timer); clearInterval(airTimer); void reader.current?.cancel().catch(() => {}); };
  }, []);

  function replay(source: 'demo' | 'csv', rows: Reading[], speed: number) {
    if (reader.current) void reader.current.cancel().catch(() => {});
    setConnected(false);
    setNotice('');
    const s = createSession(source, rows[0]?.at ?? Date.now(), rows, speed);
    session.current = s;
    if (rows.length) ingest(s, rows[s.index++]);
    else s.ended = true;
    redraw();
  }

  function startDemo() { replay('demo', demoSamples(Date.now()), 300); }

  function changeTimerInterval(minutes: number) {
    if (!validInterval(minutes) || lesson.current) return;
    setTimerInterval(minutes);
    try { save(TIMER_INTERVAL_KEY, minutes); }
    catch { setStorageError('알림 간격을 이 브라우저에 저장하지 못했어요.'); }
  }

  function startLesson() {
    if (lesson.current) return;
    const now = Date.now();
    lesson.current = { id: crypto.randomUUID(), interval: timerInterval * MIN, nextAt: now + timerInterval * MIN, active: null };
    saveLesson();
    setTimerNow(now);
    setTimerNotice('');
    void refreshAir();
    redraw();
  }

  function endLesson() {
    lesson.current = null;
    saveLesson();
    setTimerNotice('수업 타이머를 종료했어요. 이미 저장된 기록은 선생님 보기에서 확인할 수 있어요.');
    redraw();
  }

  function actOnTimer(action: Action) {
    const current = lesson.current, alert = current?.active;
    if (!current || !alert) return;
    const now = Date.now();
    if (now > alert.at + RESPONSE) return;
    if (!events.current.some(event => event.id === alert.id) && !persistEvent(alert)) return;
    if (!persistEvent({ id: crypto.randomUUID(), alertId: alert.id, session: current.id, source: 'timer', kind: 'action', at: now, action })) return;
    current.active = null;
    current.nextAt = now + current.interval;
    saveLesson();
    setTimerNow(now);
    setTimerNotice(action === '창문 열었어요' ? '창문 환기 시각을 기록했어요.' : '공기청정기를 켠 행동을 기록했어요. 마지막 창문 환기 시각은 바뀌지 않아요.');
    redraw();
  }
  function playToggle() { if (session.current) { session.current.paused = !session.current.paused; redraw(); } }
  function stop() {
    if (reader.current) void reader.current.cancel().catch(() => {});
    setConnected(false); session.current = null; setNotice(''); redraw();
  }

  function act(action: Action) {
    const s = session.current, alert = s?.active;
    if (!s || !alert) return;
    if (s.source === 'serial') updateClock(s, Date.now());
    if (!s.active) { setNotice('행동 기록 시간이 지났어요.'); redraw(); return; }
    const accepted = persistEvent({ id: crypto.randomUUID(), alertId: alert.id, session: s.id, source: s.source, at: Math.trunc(s.now), kind: 'action', action });
    if (!accepted) return;
    s.active = null;
    setNotice(action === '공기청정기 켰어요' ? '공기청정기를 켠 행동을 기록했어요. 실제 환기 여부는 확인하지 않았어요.' : '창문을 열었다는 행동을 기록했어요.');
    redraw();
  }

  async function connectSensor() {
    const serial = (navigator as Navigator & { serial?: { requestPort(): Promise<SerialPort> } }).serial;
    if (!serial) { setNotice('Web Serial을 사용할 수 없어요. 데스크톱 Chrome에서 앱을 직접 열어 주세요.'); return; }
    if (reader.current || connecting) return;
    setConnecting(true);
    let port: SerialPort | undefined;
    let s: Session | undefined;
    try {
      port = await serial.requestPort();
      await port.open({ baudRate: 115200 });
      if (!port.readable) throw new Error('센서에서 데이터를 읽을 수 없어요.');
      const input = port.readable.getReader();
      reader.current = input;
      s = createSession('serial', Date.now());
      session.current = s;
      setConnecting(false); setConnected(true); setNotice(''); redraw();
      void refreshAir();
      const decoder = new TextDecoder();
      let buffer = '';
      while (session.current === s) {
        const { value, done } = await input.read();
        if (done || session.current !== s) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop()!;
        if (buffer.length > 8192) buffer = '';
        for (const line of lines) {
          const now = Date.now();
          const slot = serialSampleSlot(now);
          if (s.latest && slot <= s.latest.at) continue;
          const parsed = parseSerialLine(line.trim(), slot);
          if (parsed) {
            setNotice('');
            updateClock(s, slot); ingest(s, parsed); redraw();
          } else if (line.trim()) setNotice('센서 출력 형식을 확인해 주세요. 올바른 줄을 기다리고 있어요.');
        }
      }
    } catch (e) {
      const name = (e as Error).name;
      if (name !== 'NotFoundError' && name !== 'AbortError') setNotice('센서를 연결하거나 읽지 못했어요. 포트 권한과 USB 연결을 확인해 주세요.');
    } finally {
      reader.current?.releaseLock(); reader.current = null;
      if (port) await port.close().catch(() => {});
      if (s && session.current === s) { s.active = null; s.prediction = 'measuring'; setNotice('센서 연결이 끊겼어요. USB를 확인하고 다시 연결해 주세요.'); }
      setConnecting(false); setConnected(false); redraw();
    }
  }

  const s = session.current;
  return { s, frame, events: events.current, clocks: clocks.current, notice, storageError, connecting, connected,
    air: s ? airFor(s) : usableAir(liveAir.current, Date.now()), startDemo, replay, playToggle, stop, act, connectSensor,
    timer: { lesson: lesson.current, now: timerNow, air: usableAir(liveAir.current, Date.now()), interval: timerInterval, notice: timerNotice,
      changeInterval: changeTimerInterval, start: startLesson, end: endLesson, act: actOnTimer, refreshAir },
  };
}
