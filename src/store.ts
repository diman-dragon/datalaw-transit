import { loadDataset } from './db.ts';
import { LineSearch } from './search.ts';
import type { Dataset, Line } from './types.ts';

let ds: Dataset | null = null;
let byId: Map<string, Line> | null = null;
let search: LineSearch | null = null;

export function hasData(): boolean {
  return ds !== null && ds.lines.length > 0;
}

export function data(): Dataset {
  if (!ds) throw new Error('Расписание не загружено');
  return ds;
}

export function setDataset(next: Dataset | null): void {
  ds = next;
  byId = null;
  search = next ? new LineSearch(next.lines) : null;
}

export async function initStore(): Promise<void> {
  setDataset(await loadDataset());
}

export function lineById(id: string): Line | undefined {
  if (!ds) return undefined;
  if (!byId) byId = new Map(ds.lines.map((l) => [l.id, l]));
  return byId.get(id);
}

export function lineSearch(): LineSearch {
  if (!search) throw new Error('Расписание не загружено');
  return search;
}
