import { patternTimes, routeCompare, routesAtStop, secondsNow } from './schedule.ts';
import type { Pattern, Route, RouteData, ServiceCalendar, StopIndex, StopsData } from './types.ts';

export interface StopGroup {
  name: string;
  stops: number[];
}

/** Остановки с одинаковым названием (разные платформы/направления) считаются одним «местом». */
export function buildNameGroups(stops: StopsData): Map<string, number[]> {
  const m = new Map<string, number[]>();
  stops.name.forEach((n, i) => {
    const a = m.get(n);
    if (a) a.push(i);
    else m.set(n, [i]);
  });
  return m;
}

export interface DirectResult {
  route: number;
  pattern: number;
  /** позиции в варианте */
  from: number;
  to: number;
  stopsBetween: number;
}

/** Линии без пересадок: едут от любой остановки группы A к любой остановке группы B (A раньше B по ходу). */
export function findDirect(
  a: number[],
  b: number[],
  stopIndex: StopIndex,
  routeData: (r: number) => RouteData,
): DirectResult[] {
  const bSet = new Set(b);
  const aSet = new Set(a);
  const routes = new Set<number>();
  for (const s of a) for (const r of routesAtStop(stopIndex, s)) routes.add(r);
  const best = new Map<string, DirectResult & { trips: number }>();
  for (const r of routes) {
    const rd = routeData(r);
    rd.patterns.forEach((p, pi) => {
      let from = -1;
      for (let i = 0; i < p.stops.length - 1; i++)
        if (aSet.has(p.stops[i])) {
          from = i;
          break;
        }
      if (from < 0) return;
      let to = -1;
      for (let j = from + 1; j < p.stops.length; j++)
        if (bSet.has(p.stops[j])) {
          to = j;
          break;
        }
      if (to < 0) return;
      const key = `${r}|${p.dir}`;
      const cur = best.get(key);
      if (!cur || p.trips > cur.trips) best.set(key, { route: r, pattern: pi, from, to, stopsBetween: to - from, trips: p.trips });
    });
  }
  return [...best.values()].map(({ trips: _t, ...x }) => x);
}

/** Медианное время в пути между позициями, секунды. */
export function rideSeconds(p: Pattern, from: number, to: number): number {
  const n = p.stops.length;
  const d: number[] = [];
  for (let t = 0; t < p.trips; t++) d.push(p.times[t * n + to] - p.times[t * n + from]);
  d.sort((x, y) => x - y);
  return d.length ? d[d.length >> 1] : 0;
}

export interface Enriched extends DirectResult {
  rideSec: number;
  /** ближайшие отправления с остановки посадки (сек от полуночи), сегодня */
  next: number[];
  /** время прибытия по ближайшему рейсу, сек от полуночи; null — сегодня рейсов больше нет */
  arrive: number | null;
}

export function enrich(
  list: DirectResult[],
  routeData: (r: number) => RouteData,
  cal: ServiceCalendar,
  date: Date,
  nowSec: number | null,
): Enriched[] {
  const out = list.map((x) => {
    const p = routeData(x.route).patterns[x.pattern];
    const ride = rideSeconds(p, x.from, x.to);
    const times = patternTimes(cal, p, x.from, date);
    const upcoming = nowSec === null ? times : times.filter((t) => t >= nowSec);
    return { ...x, rideSec: ride, next: upcoming.slice(0, 3), arrive: upcoming.length ? upcoming[0] + ride : null };
  });
  return out;
}

export function sortResults(list: Enriched[], routes: Route[]): Enriched[] {
  return [...list].sort((a, b) => {
    if (a.arrive !== null && b.arrive !== null) return a.arrive - b.arrive;
    if (a.arrive !== null) return -1;
    if (b.arrive !== null) return 1;
    return a.rideSec - b.rideSec || routeCompare(routes[a.route], routes[b.route]);
  });
}

export function nowSeconds(): number {
  return secondsNow();
}
