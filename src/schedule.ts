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

export interface Departure {
  /** секунды от полуночи выбранного дня, 0..86399 */
  time: number;
  route: number;
  pattern: number;
  trip: number;
  pos: number;
}

export interface ScheduleCtx {
  services: ServiceCalendar;
  stopIndex: StopIndex;
  routeData: (route: number) => RouteData;
  stopName: (stop: number) => string;
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

/** Все отправления с остановки на выбранную дату (с учётом рейсов «за полночь» с прошлого дня). */
export function departuresAt(ctx: ScheduleCtx, stop: number, date: Date, onlyRoute?: number): Departure[] {
  const today = activeServices(ctx.services, date);
  const prev = activeServices(ctx.services, addDays(date, -1));
  const list = ctx.stopIndex[stop] ?? [];
  const out: Departure[] = [];
  for (let k = 0; k < list.length; k += 3) {
    const r = list[k];
    if (onlyRoute !== undefined && r !== onlyRoute) continue;
    const p = list[k + 1];
    const pos = list[k + 2];
    const pat = ctx.routeData(r).patterns[p];
    const n = pat.stops.length;
    for (let t = 0; t < pat.trips; t++) {
      const time = pat.times[t * n + pos];
      const s = pat.svc[t];
      if (time < DAY && today[s]) out.push({ time, route: r, pattern: p, trip: t, pos });
      else if (time >= DAY && prev[s]) out.push({ time: time - DAY, route: r, pattern: p, trip: t, pos });
    }
  }
  out.sort((a, b) => a.time - b.time || a.route - b.route);
  return out;
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

export interface DepartureGroup {
  route: number;
  /** конечная остановка («куда едет») */
  head: string;
  /** направление целиком: «Мириево 4 → Дорчол» */
  label: string;
  times: number[];
}

/** Группировка отправлений по (линия, конечная остановка). */
export function groupDepartures(ctx: ScheduleCtx, deps: Departure[]): DepartureGroup[] {
  const map = new Map<string, DepartureGroup & { best: number }>();
  for (const d of deps) {
    const pat = ctx.routeData(d.route).patterns[d.pattern];
    const head = patternDest(ctx.stopName, pat);
    const key = `${d.route}|${head}`;
    let g = map.get(key);
    if (!g) map.set(key, (g = { route: d.route, head, label: '', times: [], best: -1 }));
    if (pat.trips > g.best) {
      g.best = pat.trips;
      g.label = patternLabel(ctx.stopName, pat);
    }
    g.times.push(d.time);
  }
  return [...map.values()].map(({ best: _b, ...g }) => g);
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
