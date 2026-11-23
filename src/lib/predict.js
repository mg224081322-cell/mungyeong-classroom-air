// predict.js — 교실 환기 예측 (로지스틱 회귀, 자동 생성 파일)
// readings: 30초마다 받은 기록 배열 [{humidity, temp}, ...] (오래된 것 → 최신 순)
// predictNeedVent: 1 = 30분 안에 환기 필요, 0 = 괜찮음, null = 기록 부족('측정 중')

export const MIN_READINGS = 41;   // 20분 + 1개
export const THRESHOLD = 0.7;
const MEAN = [42.835191, 21.783631, -0.001928, -0.000841, 0.001472, -0.001788, 0.029127, 0.000315];
const SCALE = [3.055934, 0.594626, 0.569846, 0.069038, 0.918943, 0.114954, 1.528737, 0.201092];
const WEIGHT = [0.150351, -0.451348, 0.129449, -0.055269, -0.330231, 0.812964, -0.953230, 1.865433];
const BIAS = -0.793848;

export function ventProbability(r) {
  const n = r.length;
  if (n < MIN_READINGS) return null;
  const x = [
    r[n-1].humidity,
    r[n-1].temp,
    r[n-1].humidity - r[n-1-10].humidity,
    r[n-1].temp - r[n-1-10].temp,
    r[n-1].humidity - r[n-1-20].humidity,
    r[n-1].temp - r[n-1-20].temp,
    r[n-1].humidity - r[n-1-40].humidity,
    r[n-1].temp - r[n-1-40].temp
  ];
  let z = BIAS;
  for (let i = 0; i < x.length; i++) z += WEIGHT[i] * (x[i] - MEAN[i]) / SCALE[i];
  return 1 / (1 + Math.exp(-z));
}

export function predictNeedVent(r) {
  const p = ventProbability(r);
  return p === null ? null : (p >= THRESHOLD ? 1 : 0);
}
