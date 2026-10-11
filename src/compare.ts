/**
 * Слепок расписания и сравнение старых данных с новыми.
 * Слепок: для каждой линии и направления — отправления от начальной остановки в будни, субботу и воскресенье.
 */
import { patternTimes, typicalDate } from './schedule.ts';
import type { DayKind } from './schedule.ts';
import type { Dataset, RouteKind, SnapDir, SnapLine, Snapshot } from './types.ts';

const KINDS: DayKind[] = ['weekday', 'sat', 'sun'];
export const DAY_KIND_NAME: Record<DayKind, string> = { weekday: 'будни', sat: 'суббота', sun: 'воскресенье' };

const KIND_NAME: Record<RouteKind, string> = {
  bus: 'автобус',
  tram: 'трамвай',
  trolley: 'троллейбус',
  rail: 'электричка',
  other: 'линия',
};

export function intToDate(n: number): Date {
  return new Date(Math.floor(n / 10000), Math.floor((n % 10000) / 100) - 1, n % 100);
}

export function fmtDateInt(n: number): string {
  if (!n) return '—';
  const s = String(n);
  return `${s.slice(6, 8)}.${s.slice(4, 6)}.${s.slice(0, 4)}`;
}

function dateToInt(d: Date): number {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

function hm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h < 10 ? '0' : ''}${h}:${m < 10 ? '0' : ''}${m}`;
}

export function makeSnapshot(ds: Dataset, today: Date = new Date()): Snapshot {
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const starts = ds.meta.feeds.map((f) => f.startDate).filter((x) => x > 0);
  let base = t0;
  if (starts.length) {
    const first = intToDate(Math.min(...starts));
    if (first > t0) base = first; // расписание ещё не началось — сравниваем по его первым дням
  }
  const refDates = {} as Record<DayKind, number>;
  const refs = {} as Record<DayKind, Date>;
  for (const k of KINDS) {
    refs[k] = typicalDate(ds.services, k, base);
    refDates[k] = dateToInt(refs[k]);
  }

  const used = new Map<string, number>();
  const lines: SnapLine[] = [];
  for (const rd of ds.routeData) {
    const r = ds.routes[rd.route];
    let key = `${r.kind}:${r.short}`;
    const n = used.get(key) ?? 0;
    used.set(key, n + 1);
    if (n) key += `#${n + 1}`;
    const dirs: SnapDir[] = [];
    const dirIds = [...new Set(rd.patterns.map((p) => p.dir))].sort();
    for (const d of dirIds) {
      let main = -1;
      rd.patterns.forEach((p, i) => {
        if (p.dir === d && (main < 0 || p.trips > rd.patterns[main].trips)) main = i;
      });
      const p = rd.patterns[main];
      const times = {} as Record<DayKind, number[]>;
      for (const k of KINDS) times[k] = patternTimes(ds.services, p, 0, refs[k]).map((t) => Math.floor(t / 60));
      dirs.push({ from: ds.stops.name[p.stops[0]], to: ds.stops.name[p.stops[p.stops.length - 1]], stops: p.stops.length, times });
    }
    lines.push({ key, short: r.short, long: r.long, kind: r.kind, dirs });
  }
  return {
    builtAt: ds.meta.builtAt,
    feeds: ds.meta.feeds.map((f) => ({ key: f.key, name: f.name, version: f.version, startDate: f.startDate, endDate: f.endDate })),
    refDates,
    lines,
  };
}

export interface LineChange {
  short: string;
  kind: RouteKind;
  notes: string[];
}

export interface Diff {
  /** старых данных не было — сравнивать не с чем */
  first: boolean;
  oldValidity: { start: number; end: number } | null;
  newValidity: { start: number; end: number };
  added: { short: string; kind: RouteKind; long: string }[];
  removed: { short: string; kind: RouteKind; long: string }[];
  changed: LineChange[];
  same: number;
  refDates: { old: Record<DayKind, number> | null; new: Record<DayKind, number> };
}

function validityOf(s: Snapshot): { start: number; end: number } {
  const starts = s.feeds.map((f) => f.startDate).filter((x) => x > 0);
  const ends = s.feeds.map((f) => f.endDate).filter((x) => x > 0);
  return { start: starts.length ? Math.min(...starts) : 0, end: ends.length ? Math.max(...ends) : 0 };
}

function countDiff(a: number[], b: number[]): { added: number; removed: number } {
  const A = new Map<number, number>();
  for (const x of a) A.set(x, (A.get(x) ?? 0) + 1);
  let added = 0;
  for (const x of b) {
    const c = A.get(x) ?? 0;
    if (c > 0) A.set(x, c - 1);
    else added++;
  }
  let removed = 0;
  for (const v of A.values()) removed += v;
  return { added, removed };
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

function dirNotes(i: number, o: SnapDir, n: SnapDir): string[] {
  const notes: string[] = [];
  const tag = `Направление ${i + 1}`;
  if (o.from !== n.from || o.to !== n.to) notes.push(`${tag}: было ${o.from} → ${o.to}, стало ${n.from} → ${n.to}`);
  else if (o.stops !== n.stops) notes.push(`${tag} (${n.from} → ${n.to}): остановок ${o.stops} → ${n.stops}`);
  const dirName = `${n.from} → ${n.to}`;
  for (const k of KINDS) {
    const a = o.times[k];
    const b = n.times[k];
    const same = a.length === b.length && a.every((x, j) => x === b[j]);
    if (same) continue;
    const { added, removed } = countDiff(a, b);
    const parts: string[] = [];
    if (added) parts.push(`+${added}`);
    if (removed) parts.push(`−${removed}`);
    let txt = `${dirName}, ${DAY_KIND_NAME[k]}: ${parts.join(' ')} ${plural(added + removed, 'рейс', 'рейса', 'рейсов')}`;
    if (!a.length) txt = `${dirName}, ${DAY_KIND_NAME[k]}: появились рейсы (${b.length})`;
    else if (!b.length) txt = `${dirName}, ${DAY_KIND_NAME[k]}: рейсов больше нет`;
    else {
      const ext: string[] = [];
      if (a[0] !== b[0]) ext.push(`первый ${hm(a[0])} → ${hm(b[0])}`);
      if (a[a.length - 1] !== b[b.length - 1]) ext.push(`последний ${hm(a[a.length - 1])} → ${hm(b[b.length - 1])}`);
      if (ext.length) txt += ` (${ext.join(', ')})`;
    }
    notes.push(txt);
  }
  return notes;
}

export function diffSnapshots(oldS: Snapshot | null, newS: Snapshot): Diff {
  const newValidity = validityOf(newS);
  if (!oldS) {
    return {
      first: true,
      oldValidity: null,
      newValidity,
      added: [],
      removed: [],
      changed: [],
      same: 0,
      refDates: { old: null, new: newS.refDates },
    };
  }
  const oldBy = new Map(oldS.lines.map((l) => [l.key, l]));
  const newBy = new Map(newS.lines.map((l) => [l.key, l]));
  const added = newS.lines.filter((l) => !oldBy.has(l.key)).map(({ short, kind, long }) => ({ short, kind, long }));
  const removed = oldS.lines.filter((l) => !newBy.has(l.key)).map(({ short, kind, long }) => ({ short, kind, long }));
  const changed: LineChange[] = [];
  let same = 0;
  for (const nl of newS.lines) {
    const ol = oldBy.get(nl.key);
    if (!ol) continue;
    const notes: string[] = [];
    const m = Math.max(ol.dirs.length, nl.dirs.length);
    for (let i = 0; i < m; i++) {
      const o = ol.dirs[i];
      const n = nl.dirs[i];
      if (o && n) notes.push(...dirNotes(i, o, n));
      else if (n) notes.push(`Появилось направление ${n.from} → ${n.to}`);
      else if (o) notes.push(`Убрано направление ${o.from} → ${o.to}`);
    }
    if (notes.length) changed.push({ short: nl.short, kind: nl.kind, notes });
    else same++;
  }
  return {
    first: false,
    oldValidity: validityOf(oldS),
    newValidity,
    added,
    removed,
    changed,
    same,
    refDates: { old: oldS.refDates, new: newS.refDates },
  };
}

/** Короткая сводка для заголовка отчёта. */
export function diffSummary(d: Diff): string {
  if (d.first) return 'Первая загрузка: сравнивать пока не с чем.';
  const parts: string[] = [];
  if (d.added.length) parts.push(`новых линий: ${d.added.length}`);
  if (d.removed.length) parts.push(`убрано линий: ${d.removed.length}`);
  if (d.changed.length) parts.push(`изменено линий: ${d.changed.length}`);
  return parts.length ? `${parts.join(', ')}; без изменений: ${d.same}` : `Расписание не изменилось (${d.same} линий).`;
}

export function kindName(k: RouteKind): string {
  return KIND_NAME[k];
}
