type ModelReading = { humidity: number; temp: number };
export const MIN_READINGS: 41;
export const THRESHOLD: 0.7;
export function ventProbability(readings: readonly ModelReading[]): number | null;
export function predictNeedVent(readings: readonly ModelReading[]): 0 | 1 | null;
