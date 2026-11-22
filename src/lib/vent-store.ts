import type { SensorLog } from './ventilation';

export const EVENT_KEY = 'classroom-air-events-v1';
export const CLOCK_KEY = 'classroom-air-clocks-v1';

export function load<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback; } catch { return fallback; }
}
export function save(key: string, value: unknown) { localStorage.setItem(key, JSON.stringify(value)); }

let database: Promise<IDBDatabase> | undefined;
export async function localSensor(row: SensorLog) {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('classroom-air-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('sensor_logs', { keyPath: 'id' });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
  const db = await database;
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('sensor_logs', 'readwrite');
    tx.objectStore('sensor_logs').add(row);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
}
