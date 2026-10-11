import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { loadCore, loadRaw, loadSnapshot, saveDataset, saveLastDiff, saveRaw } from './db.ts';
import type { RawInfo } from './db.ts';
import { diffSnapshots } from './compare.ts';
import type { Diff } from './compare.ts';
import type { Dataset } from './types.ts';
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

export interface Staged {
  key: string;
  bytes: Uint8Array;
  source: RawInfo['source'];
}

/** Подготовленное обновление: данные собраны, но ещё не применены — пользователь сначала смотрит сравнение. */
export interface Pending {
  dataset: Dataset;
  staged: Staged[];
  diff: Diff;
  warnings: string[];
}

export async function readZipFile(file: File): Promise<Uint8Array> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isZip(bytes)) throw new Error('это не zip-архив GTFS');
  return bytes;
}

export interface PrepareOptions {
  /** какие источники скачать из сети (ключи фидов); остальные берутся из сохранённых файлов */
  download?: string[];
  /** файлы, выбранные вручную */
  files?: Record<string, Uint8Array>;
}

/**
 * Скачивает / принимает файлы, собирает набор данных и сравнивает его с текущим.
 * Ничего не записывает в память телефона до вызова applyPending().
 */
export async function prepareUpdate(feeds: FeedCfg[], opt: PrepareOptions, progress: Progress): Promise<Pending> {
  const enabled = feeds.filter((f) => f.enabled);
  if (!enabled.length) throw new Error('Не выбран ни один источник данных');
  const warnings: string[] = [];
  const staged: Staged[] = [];
  const req: WorkerRequest = { feeds: [] };
  for (const f of enabled) {
    let bytes: Uint8Array | undefined = opt.files?.[f.key];
    let source: RawInfo['source'] = 'file';
    if (!bytes && opt.download?.includes(f.key)) {
      progress(`Скачиваю: ${f.name}…`);
      try {
        bytes = await downloadZip(f.url);
        source = 'network';
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!(await loadRaw(f.key))) throw new Error(`${f.name}: не удалось скачать — ${msg}`);
        warnings.push(`${f.name}: не удалось скачать (${msg}), использована сохранённая версия`);
      }
    }
    if (bytes) staged.push({ key: f.key, bytes, source });
    else {
      const raw = await loadRaw(f.key);
      if (!raw) throw new Error(`${f.name}: нет файла. Нажмите «Скачать» или выберите zip вручную.`);
      bytes = raw.bytes;
    }
    req.feeds.push({ key: f.key, name: f.name, zip: bytes });
  }
  progress('Обработка данных…');
  const dataset = await runWorker(req, progress);
  progress('Сравниваю с текущими данными…');
  const diff = diffSnapshots(await loadSnapshot().catch(() => null), dataset.snapshot);
  return { dataset, staged, diff, warnings };
}

/** Записать подготовленное обновление в память телефона и переключить приложение на него. */
export async function applyPending(p: Pending, progress: Progress): Promise<void> {
  progress('Сохранение в память телефона…');
  for (const s of p.staged) await saveRaw(s.key, s.bytes, s.source);
  await saveDataset(p.dataset);
  await saveLastDiff(p.diff, new Date().toISOString());
  const core = await loadCore();
  if (!core) throw new Error('Не удалось прочитать сохранённые данные');
  setCore(core);
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
    // копия, чтобы сохранённые в IndexedDB байты не «отсоединялись»
    w.postMessage(req);
  });
}

export type { RawInfo };
