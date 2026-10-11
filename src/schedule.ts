import type { Pattern, Route, RouteData, ServiceCalendar, StopIndex } from './types.ts';

export const DAY = 86400;

export function dateInt(d: Date): number {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** 0 = понедельник … 6 = воскресенье */
export function dowMon0(d: Date): number {
  return (d.getDay() + 6) % 7;
}

const activeCache = new WeakMap<ServiceCalendar, Map<number, Uint8Array>>();

/** Флаги «сервис ходит в этот день» по индексам сервисов. */
export function activeServices(cal: ServiceCalendar, d: Date): Uint8Array {
  let byDate = activeCache.get(cal);
  if (!byDate) activeCache.set(cal, (byDate = new Map()));
  const di = dateInt(d);
  const cached = byDate.get(di);
  if (cached) return cached;
  const dow = dowMon0(d);
  const n = cal.ids.length;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const s = cal.start[i];
    const e = cal.end[i];
    if (s && di >= s && (!e || di <= e) && (cal.mask[i] >> dow) & 1) out[i] = 1;
  }
  for (const k in cal.add) if (cal.add[k].includes(di)) out[+k] = 1;
  for (const k in cal.remove) if (cal.remove[k].includes(di)) out[+k] = 0;
  byDate.set(di, out);
  return out;
}

/** Направление варианта линии: «Начальная → Конечная». */
export function patternLabel(stopName: (s: number) => string, p: Pattern): string {
  return `${stopName(p.stops[0])} → ${stopName(p.stops[p.stops.length - 1])}`;
}

/** Куда едет: название конечной остановки варианта. */
export function patternDest(stopName: (s: number) => string, p: Pattern): string {
  return stopName(p.stops[p.stops.length - 1]);
}

/** Уникальные линии, которые отправляются с остановки. */
export function routesAtStop(stopIndex: StopIndex, stop: number): number[] {
  const list = stopIndex[stop];
  if (!list) return [];
  const seen = new Set<number>();
  for (let k = 0; k < list.length; k += 3) seen.add(list[k]);
  return [...seen];
}

/** Времена отправления варианта линии с позиции pos на дату. */
export function patternTimes(cal: ServiceCalendar, pat: Pattern, pos: number, date: Date): number[] {
  const today = activeServices(cal, date);
  const prev = activeServices(cal, addDays(date, -1));
  const n = pat.stops.length;
  const out: number[] = [];
  for (let t = 0; t < pat.trips; t++) {
    const time = pat.times[t * n + pos];
    const s = pat.svc[t];
    if (time < DAY && today[s]) out.push(time);
    else if (time >= DAY && prev[s]) out.push(time - DAY);
  }
  out.sort((a, b) => a - b);
  return out;
}

export function fmtTime(sec: number): string {
  const s = ((sec % DAY) + DAY) % DAY;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h < 10 ? '0' : ''}${h}:${m < 10 ? '0' : ''}${m}`;
}

export function secondsNow(d = new Date()): number {
  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
}

/** Естественная сортировка номеров линий: 2, 3, 7, 26, 26Л, 101, A1, E2, N15 … */
export function routeCompare(a: Route, b: Route): number {
  const ka = kindOrder(a.kind);
  const kb = kindOrder(b.kind);
  if (ka !== kb) return ka - kb;
  return shortCompare(a.short, b.short);
}

function kindOrder(k: Route['kind']): number {
  return k === 'tram' ? 0 : k === 'trolley' ? 1 : k === 'bus' ? 2 : k === 'rail' ? 3 : 4;
}

export function shortCompare(a: string, b: string): number {
  const ma = /^(\d+)(.*)$/.exec(a);
  const mb = /^(\d+)(.*)$/.exec(b);
  if (ma && mb) return +ma[1] - +mb[1] || ma[2].localeCompare(mb[2], 'sr');
  if (ma) return -1;
  if (mb) return 1;
  return a.localeCompare(b, 'sr', { numeric: true });
}

// ---------- типы дней: будни / суббота / воскресенье

export type DayKind = 'weekday' | 'sat' | 'sun';

const KIND_DOW: Record<DayKind, number> = { weekday: 2, sat: 5, sun: 6 }; // среда, суббота, воскресенье

const excCache = new WeakMap<ServiceCalendar, Set<number>>();

function exceptionDates(cal: ServiceCalendar): Set<number> {
  let s = excCache.get(cal);
  if (!s) {
    s = new Set<number>();
    for (const k in cal.add) for (const d of cal.add[k]) s.add(d);
    for (const k in cal.remove) for (const d of cal.remove[k]) s.add(d);
    excCache.set(cal, s);
  }
  return s;
}

/**
 * Ближайшая «обычная» дата нужного типа (среда / суббота / воскресенье), начиная с `from`.
 * Праздничные исключения календаря и даты вне периода действия расписания пропускаются.
 */
export function typicalDate(cal: ServiceCalendar, kind: DayKind, from: Date): Date {
  const exc = exceptionDates(cal);
  let first: Date | null = null;
  for (let i = 0; i < 120; i++) {
    const d = addDays(from, i);
    if (dowMon0(d) !== KIND_DOW[kind]) continue;
    first ??= d;
    if (exc.has(dateInt(d))) continue;
    if (activeServices(cal, d).some((x) => x === 1)) return d;
  }
  return first ?? from;
}

/** Какой тип дня сегодня: по реальным действующим сервисам (праздник, работающий по-воскресному, определяется верно). */
export function dayKindOf(cal: ServiceCalendar, d: Date): DayKind {
  const act = activeServices(cal, d);
  const key = (a: Uint8Array) => a.join('');
  const mine = key(act);
  const dow = dowMon0(d);
  const natural: DayKind = dow === 5 ? 'sat' : dow === 6 ? 'sun' : 'weekday';
  if (!act.some((x) => x === 1)) return natural;
  if (key(activeServices(cal, typicalDate(cal, natural, d))) === mine) return natural;
  for (const k of ['weekday', 'sat', 'sun'] as DayKind[]) {
    if (key(activeServices(cal, typicalDate(cal, k, d))) === mine) return k;
  }
  return natural;
}

/** Дата, по которой показываем расписание для типа дня: сегодня — сама сегодняшняя дата, иначе ближайший «обычный» день. */
export function dateForKind(cal: ServiceCalendar, kind: DayKind, today: Date): Date {
  return dayKindOf(cal, today) === kind ? today : typicalDate(cal, kind, today);
}

export interface Validity {
  /** yyyymmdd, 0 — неизвестно */
  from: number;
  to: number;
}

/** Срок действия расписания линий на дату: последнее начало и ближайшее окончание среди действующих сервисов. */
export function validityOn(cal: ServiceCalendar, patterns: Pattern[], d: Date): Validity {
  const act = activeServices(cal, d);
  const seen = new Set<number>();
  let from = 0;
  let to = 0;
  for (const p of patterns)
    for (let t = 0; t < p.trips; t++) {
      const s = p.svc[t];
      if (seen.has(s)) continue;
      seen.add(s);
      if (!act[s]) continue;
      if (cal.start[s] > from) from = cal.start[s];
      if (cal.end[s] && (!to || cal.end[s] < to)) to = cal.end[s];
    }
  return { from, to };
}
