/// <reference lib="webworker" />
import { unzipSync } from 'fflate';
import type { Dataset } from '../types.ts';
import { buildDataset } from './build.ts';
import type { FeedInput } from './build.ts';

export interface WorkerRequest {
  feeds: { key: string; name: string; zip: Uint8Array }[];
  /** «сегодня» в мс — от него считаются типичные дни */
  now: number;
}
export type WorkerMessage = { type: 'progress'; message: string } | { type: 'done'; dataset: Dataset } | { type: 'error'; message: string };

const NEEDED = new Set(['stops.txt', 'routes.txt', 'trips.txt', 'stop_times.txt', 'calendar.txt', 'calendar_dates.txt']);

function post(m: WorkerMessage): void {
  (self as unknown as Worker).postMessage(m);
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  try {
    const feeds: FeedInput[] = e.data.feeds.map((f) => {
      post({ type: 'progress', message: `${f.name}: распаковка` });
      let files: Record<string, Uint8Array>;
      try {
        files = unzipSync(f.zip, { filter: (info) => NEEDED.has(info.name.split('/').pop()!.toLowerCase()) });
      } catch {
        throw new Error(`«${f.name}»: архив повреждён или это не ZIP`);
      }
      const byName: Record<string, Uint8Array> = {};
      for (const [path, bytes] of Object.entries(files)) byName[path.split('/').pop()!.toLowerCase()] = bytes;
      return { key: f.key, name: f.name, files: byName };
    });
    post({ type: 'done', dataset: buildDataset(feeds, new Date(e.data.now), (message) => post({ type: 'progress', message })) });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
