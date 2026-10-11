/// <reference lib="webworker" />
import { unzipSync } from 'fflate';
import { buildDataset } from './build.ts';
import { CUSTOM_FEED_KEY } from '../overlay.ts';
import type { Dataset, FeedInput } from '../types.ts';

export interface WorkerRequest {
  feeds: { key: string; name: string; zip: Uint8Array }[];
  /** свой файл расписания: собирается отдельным набором, слияние выполняет основной поток */
  custom?: { name: string; zip: Uint8Array };
}
export type WorkerMessage =
  | { type: 'progress'; message: string }
  | { type: 'done'; dataset: Dataset; custom?: Dataset }
  | { type: 'error'; message: string };

const NEEDED = new Set([
  'stops.txt',
  'routes.txt',
  'trips.txt',
  'stop_times.txt',
  'calendar.txt',
  'calendar_dates.txt',
  'feed_info.txt',
]);

function post(m: WorkerMessage, transfer: Transferable[] = []): void {
  (self as unknown as Worker).postMessage(m, transfer);
}

function unpack(f: { key: string; name: string; zip: Uint8Array }): FeedInput {
  post({ type: 'progress', message: `${f.name}: распаковка` });
  const files = unzipSync(f.zip, {
    filter: (info) => NEEDED.has(info.name.split('/').pop()!.toLowerCase()),
  });
  const byName: Record<string, Uint8Array> = {};
  for (const [path, bytes] of Object.entries(files)) byName[path.split('/').pop()!.toLowerCase()] = bytes;
  return { key: f.key, name: f.name, files: byName };
}

function buffers(ds: Dataset, out: Transferable[]): void {
  for (const rd of ds.routeData) for (const p of rd.patterns) out.push(p.svc.buffer as ArrayBuffer, p.times.buffer as ArrayBuffer);
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  try {
    const progress = (message: string) => post({ type: 'progress', message });
    const dataset = buildDataset(e.data.feeds.map(unpack), progress);
    let custom: Dataset | undefined;
    if (e.data.custom) {
      const c = e.data.custom;
      custom = buildDataset([unpack({ key: CUSTOM_FEED_KEY, name: c.name, zip: c.zip })], progress);
    }
    const transfer: Transferable[] = [];
    buffers(dataset, transfer);
    if (custom) buffers(custom, transfer);
    post({ type: 'done', dataset, custom }, transfer);
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
