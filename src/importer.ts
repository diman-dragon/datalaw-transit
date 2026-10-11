import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { deleteCustomLayer, loadCore, loadCustomLayer, loadRaw, loadSnapshot, saveCustom, saveDataset, saveLastDiff, saveRaw } from './db.ts';
import type { RawInfo } from './db.ts';
import { diffSnapshots } from './compare.ts';
import type { Diff } from './compare.ts';
import { applyLayer, CUSTOM_FEED_KEY, mergeDatasets, planCustom, resolveChoices } from './overlay.ts';
import type { Choice, CustomPlan } from './overlay.ts';
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
  /** true — при применении сохранённый свой файл удаляется */
  dropCustom?: boolean;
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
  /** не накладывать сохранённый свой файл (и удалить его при применении) */
  dropCustom?: boolean;
}

export const customLabel = (fileName: string): string => `Свой файл: ${fileName}`;

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
  // свой файл, подключённый ранее, накладывается на свежие официальные данные с сохранёнными решениями
  const layer = opt.dropCustom ? undefined : await loadCustomLayer().catch(() => undefined);
  if (layer) {
    const raw = await loadRaw(CUSTOM_FEED_KEY).catch(() => undefined);
    if (raw) req.custom = { name: customLabel(layer.fileName), zip: raw.bytes };
    else warnings.push(`Свой файл «${layer.fileName}» не найден в памяти приложения и не применён.`);
  }
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
  const built = await runWorker(req, progress);
  let dataset = built.dataset;
  if (layer && built.custom) {
    progress('Накладываю свой файл…');
    const r = applyLayer(built.dataset, built.custom, layer.choices);
    dataset = r.dataset;
    warnings.push(`Поверх данных наложен свой файл «${layer.fileName}».`);
    if (r.undecided) warnings.push(`Новых конфликтов со своим файлом: ${r.undecided} — для них оставлена текущая версия. Пересмотреть: «Свой файл расписания» ниже.`);
  }
  progress('Сравниваю с текущими данными…');
  const diff = diffSnapshots(await loadSnapshot().catch(() => null), dataset.snapshot);
  return { dataset, staged, diff, warnings, dropCustom: opt.dropCustom };
}

/** Записать подготовленное обновление в память телефона и переключить приложение на него. */
export async function applyPending(p: Pending, progress: Progress): Promise<void> {
  progress('Сохранение в память телефона…');
  for (const s of p.staged) await saveRaw(s.key, s.bytes, s.source);
  if (p.dropCustom) await deleteCustomLayer();
  await saveDataset(p.dataset);
  await saveLastDiff(p.diff, new Date().toISOString());
  const core = await loadCore();
  if (!core) throw new Error('Не удалось прочитать сохранённые данные');
  setCore(core);
}

function runWorker(req: WorkerRequest, progress: Progress): Promise<{ dataset: Dataset; custom?: Dataset }> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./gtfs/worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const m = e.data;
      if (m.type === 'progress') progress(m.message);
      else if (m.type === 'done') {
        w.terminate();
        resolve({ dataset: m.dataset, custom: m.custom });
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

// ---------- свой файл расписания: сравнение с текущими данными и разрешение конфликтов

/** Сравнение своего файла с текущими данными. Решения принимает пользователь; запись в память — только в applyCustom(). */
export interface CustomPending {
  /** текущие (официальные) данные, собранные из сохранённых файлов */
  base: Dataset;
  custom: Dataset;
  plan: CustomPlan;
  fileName: string;
  bytes: Uint8Array;
  /** решения, с которых начинается выбор */
  initial: Record<string, Choice>;
  /** имя уже подключённого своего файла — он будет заменён */
  replaces: string | null;
}

/**
 * Собирает свой zip отдельным набором и сравнивает с текущими официальными данными по линиям.
 * Текущие данные берутся из сохранённых zip-файлов (не из сети), поэтому предварительно данные должны быть загружены.
 * previous — ранее принятые решения (при повторном пересмотре уже подключённого файла).
 */
export async function prepareCustom(feeds: FeedCfg[], file: { fileName: string; bytes: Uint8Array }, progress: Progress, previous?: Record<string, Choice>): Promise<CustomPending> {
  const enabled = feeds.filter((f) => f.enabled);
  if (!enabled.length) throw new Error('Не выбран ни один источник данных');
  const req: WorkerRequest = { feeds: [], custom: { name: customLabel(file.fileName), zip: file.bytes } };
  for (const f of enabled) {
    const raw = await loadRaw(f.key);
    if (!raw) throw new Error(`${f.name}: нет файла. Сначала загрузите официальное расписание — со своим файлом сравнивать пока не с чем.`);
    req.feeds.push({ key: f.key, name: f.name, zip: raw.bytes });
  }
  progress('Обработка данных…');
  const { dataset: base, custom } = await runWorker(req, progress);
  if (!custom) throw new Error('Не удалось обработать свой файл');
  if (!custom.routes.length) throw new Error('В своём файле не нашлось ни одной линии с рейсами');
  progress('Сравниваю со своим файлом…');
  const plan = planCustom(base, custom);
  const old = await loadCustomLayer().catch(() => undefined);
  return {
    base,
    custom,
    plan,
    fileName: file.fileName,
    bytes: file.bytes,
    initial: resolveChoices(plan, previous),
    replaces: old && !previous ? old.fileName : null,
  };
}

/** Применить свой файл с принятыми решениями: собрать итоговый набор, сохранить файл, решения и данные. */
export async function applyCustom(p: CustomPending, choices: Record<string, Choice>, progress: Progress): Promise<void> {
  const resolved = resolveChoices(p.plan, choices);
  progress('Собираю итоговое расписание…');
  const dataset = mergeDatasets(p.base, p.custom, p.plan, resolved);
  const diff = diffSnapshots(await loadSnapshot().catch(() => null), dataset.snapshot);
  progress('Сохранение в память телефона…');
  // сначала самый «тяжёлый» и вероятно падающий шаг (набор данных), затем файл и решения одной транзакцией
  await saveDataset(dataset);
  await saveCustom({ fileName: p.fileName, size: p.bytes.length, savedAt: new Date().toISOString(), choices: resolved }, p.bytes);
  await saveLastDiff(diff, new Date().toISOString());
  const core = await loadCore();
  if (!core) throw new Error('Не удалось прочитать сохранённые данные');
  setCore(core);
}

/** Для повторного пересмотра: сохранённый свой файл и принятые решения. */
export async function loadStoredCustom(): Promise<{ fileName: string; bytes: Uint8Array; choices: Record<string, Choice> } | null> {
  const layer = await loadCustomLayer().catch(() => undefined);
  const raw = layer ? await loadRaw(CUSTOM_FEED_KEY).catch(() => undefined) : undefined;
  return layer && raw ? { fileName: layer.fileName, bytes: raw.bytes, choices: layer.choices } : null;
}

export type { RawInfo };
