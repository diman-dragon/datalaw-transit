import type { Dataset, LineCat } from './types.ts';
import { CAT_ORDER, DATA_FORMAT } from './types.ts';
import type { ScheduleCheck } from './validate.ts';

export function makeDataset(c: ScheduleCheck, fileName: string): Dataset {
  return {
    format: DATA_FORMAT,
    builtAt: new Date().toISOString(),
    fileName,
    generated: c.generated,
    source: c.source,
    validTo: c.validTo,
    lines: c.lines,
  };
}

export function datasetStats(ds: Dataset): { lines: number; dirs: number; departures: number; validFrom: number } {
  let dirs = 0;
  let departures = 0;
  let validFrom = 0;
  for (const l of ds.lines)
    for (const d of l.dirs) {
      dirs++;
      departures += d.times.weekday.length + d.times.sat.length + d.times.sun.length;
      if (d.validFrom && (!validFrom || d.validFrom < validFrom)) validFrom = d.validFrom;
    }
  return { lines: ds.lines.length, dirs, departures, validFrom };
}

export function categoriesPresent(ds: Dataset): LineCat[] {
  const s = new Set(ds.lines.map((l) => l.cat));
  return CAT_ORDER.filter((c) => s.has(c));
}
