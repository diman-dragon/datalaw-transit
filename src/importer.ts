import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { FEEDS } from './feeds.ts';
import type { Dataset } from './types.ts';
import type { WorkerMessage, WorkerRequest } from './gtfs/worker.ts';

export type Progress = (msg: string) => void;

export function isZip(b: Uint8Array): boolean {
  return b.length > 4 && b[0] === 0x50 && b[1] === 0x4b;
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Скачивает zip. На телефоне — через нативный HTTP (без ограничений CORS). Ошибки — с понятным текстом. */
export async function downloadZip(url: string): Promise<Uint8Array> {
  let bytes: Uint8Array;
  try {
    if (Capacitor.isNativePlatform()) {
      const res = await CapacitorHttp.get({ url, responseType: 'arraybuffer', connectTimeout: 30000, readTimeout: 180000 });
      if (res.status < 200 || res.status >= 300) throw new Error(`сервер ответил кодом ${res.status}`);
      const d: unknown = res.data;
      if (typeof d === 'string') bytes = b64ToBytes(d);
      else if (d instanceof ArrayBuffer) bytes = new Uint8Array(d);
      else throw new Error('неожиданный формат ответа сервера');
    } else {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`сервер ответил кодом ${res.status}`);
      bytes = new Uint8Array(await res.arrayBuffer());
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/сервер|формат/.test(msg)) throw new Error(msg);
    throw new Error('нет соединения с интернетом или сервер недоступен');
  }
  if (!bytes.length) throw new Error('сервер вернул пустой файл');
  if (!isZip(bytes)) throw new Error('сервер вернул не zip-архив (возможно, ссылка устарела)');
  return bytes;
}

/**
 * Скачивает все источники с data.gov.rs и собирает набор данных. Ничего не сохраняет:
 * применяет результат вызывающий код после подтверждения. Если не скачался любой источник — ошибка, данные не трогаются.
 */
export async function fetchSchedule(progress: Progress): Promise<Dataset> {
  const req: WorkerRequest = { feeds: [], now: Date.now() };
  for (const f of FEEDS) {
    progress(`Скачиваю: ${f.name}…`);
    try {
      req.feeds.push({ key: f.key, name: f.name, zip: await downloadZip(f.url) });
    } catch (e) {
      throw new Error(`${f.name}: не удалось скачать — ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  progress('Обработка данных…');
  return runWorker(req, progress);
}

export interface LocalFeed {
  key: string;
  name: string;
  zip: Uint8Array;
}

/** Собирает расписание из архивов, выбранных пользователем (тот же GTFS-формат, что и на data.gov.rs). */
export async function buildFromZips(feeds: LocalFeed[], progress: Progress): Promise<Dataset> {
  progress('Обработка данных…');
  return runWorker({ feeds, now: Date.now() }, progress);
}

/** Читает выбранный файл как zip. */
export async function readZipFile(f: File): Promise<Uint8Array> {
  const bytes = new Uint8Array(await f.arrayBuffer());
  if (!bytes.length) throw new Error(`${f.name}: файл пустой`);
  if (!isZip(bytes)) throw new Error(`${f.name}: это не zip-архив`);
  return bytes;
}

function runWorker(req: WorkerRequest, progress: Progress): Promise<Dataset> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./gtfs/worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const m = e.data;
      if (m.type === 'progress') progress(m.message);
      else if (m.type === 'done') {
        w.terminate();
        resolve(m.dataset);
      } else {
        w.terminate();
        reject(new Error(m.message));
      }
    };
    w.onerror = (e) => {
      w.terminate();
      reject(new Error(e.message || 'Ошибка обработки данных'));
    };
    w.postMessage(req);
  });
}
