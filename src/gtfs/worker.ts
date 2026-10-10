/// <reference lib="webworker" />
import { unzipSync } from 'fflate';
import { buildDataset } from './build.ts';
import type { Dataset, FeedInput } from '../types.ts';

export interface WorkerRequest {
  feeds: { key: string; name: string; zip: Uint8Array }[];
}
export type WorkerMessage =
  | { type: 'progress'; message: string }
  | { type: 'done'; dataset: Dataset }
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

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  try {
    const feeds: FeedInput[] = e.data.feeds.map((f) => {
      post({ type: 'progress', message: `${f.name}: распаковка` });
      const files = unzipSync(f.zip, {
        filter: (info) => NEEDED.has(info.name.split('/').pop()!.toLowerCase()),
      });
      const byName: Record<string, Uint8Array> = {};
      for (const [path, bytes] of Object.entries(files)) byName[path.split('/').pop()!.toLowerCase()] = bytes;
      return { key: f.key, name: f.name, files: byName };
    });
    const dataset = buildDataset(feeds, (message) => post({ type: 'progress', message }));
    const transfer: Transferable[] = [];
    for (const rd of dataset.routeData)
      for (const p of rd.patterns) transfer.push(p.svc.buffer as ArrayBuffer, p.times.buffer as ArrayBuffer);
    post({ type: 'done', dataset }, transfer);
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
