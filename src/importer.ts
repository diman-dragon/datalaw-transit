import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { loadRaw, saveDataset, saveRaw } from './db.ts';
import type { RawInfo } from './db.ts';
import { loadCore } from './db.ts';
import { setCore } from './store.ts';
import type { FeedCfg } from './prefs.ts';
import type { WorkerMessage, WorkerRequest } from './gtfs/worker.ts';

export type Progress = (msg: string) => void;

function isZip(b: Uint8Array): boolean {
  return b.length > 4 && b[0] === 0x50 && b[1] === 0x4b;
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Скачивает zip. На телефоне — через нативный HTTP (без ограничений CORS). */
export async function downloadZip(url: string): Promise<Uint8Array> {
  let bytes: Uint8Array;
  if (Capacitor.isNativePlatform()) {
    const res = await CapacitorHttp.get({
      url,
      responseType: 'arraybuffer',
      connectTimeout: 30000,
      readTimeout: 180000,
    });
    if (res.status < 200 || res.status >= 300) throw new Error(`сервер ответил ${res.status}`);
    const d: unknown = res.data;
    if (typeof d === 'string') bytes = b64ToBytes(d);
    else if (d instanceof ArrayBuffer) bytes = new Uint8Array(d);
    else throw new Error('неожиданный формат ответа');
  } else {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`сервер ответил ${res.status}`);
    bytes = new Uint8Array(await res.arrayBuffer());
  }
  if (!isZip(bytes)) throw new Error('получен не zip-архив (проверьте ссылку)');
  return bytes;
}

export async function importFile(feed: FeedCfg, file: File): Promise<void> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isZip(bytes)) throw new Error('это не zip-архив GTFS');
  await saveRaw(feed.key, bytes, 'file');
}

export interface UpdateResult {
  warnings: string[];
}

/** Скачать включённые фиды и пересобрать данные. */
export async function updateFromNetwork(feeds: FeedCfg[], progress: Progress): Promise<UpdateResult> {
  const enabled = feeds.filter((f) => f.enabled);
  if (!enabled.length) throw new Error('Не выбран ни один источник данных');
  const warnings: string[] = [];
  for (const f of enabled) {
    progress(`Скачиваю: ${f.name}…`);
    try {
      const bytes = await downloadZip(f.url);
      await saveRaw(f.key, bytes, 'network');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const had = await loadRaw(f.key);
      if (!had) throw new Error(`${f.name}: не удалось скачать — ${msg}`);
      warnings.push(`${f.name}: не удалось обновить (${msg}), оставлена прежняя версия`);
    }
  }
  await rebuild(feeds, progress);
  return { warnings };
}

/** Пересобрать данные из сохранённых zip (после загрузки из файла). */
export async function rebuild(feeds: FeedCfg[], progress: Progress): Promise<void> {
  const enabled = feeds.filter((f) => f.enabled);
  if (!enabled.length) throw new Error('Не выбран ни один источник данных');
  const req: WorkerRequest = { feeds: [] };
  for (const f of enabled) {
    const raw = await loadRaw(f.key);
    if (!raw) throw new Error(`${f.name}: нет файла. Нажмите «Скачать» или выберите zip из файла.`);
    req.feeds.push({ key: f.key, name: f.name, zip: raw.bytes });
  }
  progress('Обработка данных…');
  const dataset = await runWorker(req, progress);
  progress('Сохранение в память телефона…');
  await saveDataset(dataset);
  const core = await loadCore();
  if (!core) throw new Error('Не удалось прочитать сохранённые данные');
  setCore(core);
}

function runWorker(req: WorkerRequest, progress: Progress): Promise<import('./types.ts').Dataset> {
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
    // копия, чтобы сохранённые в IndexedDB байты не «отсоединялись»
    w.postMessage(req);
  });
}

export type { RawInfo };
