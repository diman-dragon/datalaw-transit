/**
 * GTFS → набор данных приложения. Нужны только отправления от начальной остановки каждого направления,
 * поэтому из stop_times берутся лишь первая и последняя остановка рейса (экономит память).
 */
import { dateToInt } from '../format.ts';
import { addDays } from '../schedule.ts';
import type { DayKind, Direction, Line, Dataset, RouteKind } from '../types.ts';
import { DATA_FORMAT } from '../types.ts';
import { deriveCat } from '../validate.ts';
import { parseCsv, parseTime } from './csv.ts';

export interface FeedInput {
  key: string;
  name: string;
  /** файлы GTFS по базовому имени в нижнем регистре: 'stops.txt' */
  files: Record<string, Uint8Array>;
}

export const SOURCE_NAME = 'data.gov.rs';

export function routeKind(t: number): RouteKind {
  if (t === 0 || (t >= 900 && t < 1000)) return 'tram';
  if (t === 11 || t === 800) return 'trolley';
  if (t === 2 || (t >= 100 && t < 200)) return 'rail';
  if (t === 3 || (t >= 700 && t < 800)) return 'bus';
  return 'other';
}

function need(files: Record<string, Uint8Array>, name: string, feed: string): Uint8Array {
  const f = files[name];
  if (!f) throw new Error(`«${feed}»: в архиве нет файла ${name} — это не GTFS`);
  return f;
}

const KIND_DOW: Record<DayKind, number> = { weekday: 2, sat: 5, sun: 6 }; // среда, суббота, воскресенье (0 = пн)
const KINDS: DayKind[] = ['weekday', 'sat', 'sun'];
const dow0 = (d: Date) => (d.getDay() + 6) % 7;

interface Cal {
  mask: number;
  start: number;
  end: number;
}

export function buildDataset(feeds: FeedInput[], today: Date = new Date(), progress: (m: string) => void = () => {}): Dataset {
  const lines: Line[] = [];
  let validTo = 0;

  for (const feed of feeds) {
    const F = feed.files;
    const label = feed.name;

    progress(`${label}: остановки`);
    const stopName = new Map<string, string>();
    parseCsv(need(F, 'stops.txt', label), ['stop_id', 'stop_name'], (v) => stopName.set(v[0], v[1].trim()));

    progress(`${label}: линии`);
    const routes = new Map<string, { short: string; long: string; kind: RouteKind }>();
    parseCsv(need(F, 'routes.txt', label), ['route_id', 'route_short_name', 'route_long_name', 'route_type'], (v) => {
      routes.set(v[0], { short: v[1].trim() || v[2].trim() || v[0], long: v[2].trim(), kind: routeKind(parseInt(v[3], 10)) });
    });

    progress(`${label}: календарь`);
    const cal = new Map<string, Cal>();
    const exc = new Map<string, { add: Set<number>; rem: Set<number> }>();
    const excDates = new Set<number>();
    let minStart = 0;
    let maxEnd = 0;
    if (F['calendar.txt'])
      parseCsv(F['calendar.txt'], ['service_id', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'start_date', 'end_date'], (v) => {
        let m = 0;
        for (let d = 0; d < 7; d++) if (v[1 + d].trim() === '1') m |= 1 << d;
        const s = parseInt(v[8], 10) || 0;
        const e = parseInt(v[9], 10) || 0;
        cal.set(v[0], { mask: m, start: s, end: e });
        if (s && (!minStart || s < minStart)) minStart = s;
        if (e > maxEnd) maxEnd = e;
      });
    if (F['calendar_dates.txt'])
      parseCsv(F['calendar_dates.txt'], ['service_id', 'date', 'exception_type'], (v) => {
        const date = parseInt(v[1], 10);
        if (!date) return;
        let x = exc.get(v[0]);
        if (!x) exc.set(v[0], (x = { add: new Set(), rem: new Set() }));
        const t = v[2].trim();
        if (t === '1') x.add.add(date);
        else if (t === '2') x.rem.add(date);
        else return;
        excDates.add(date);
      });
    if (maxEnd > validTo) validTo = maxEnd;

    // типичные даты: среда, суббота, воскресенье — не праздники, внутри срока действия
    let base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (minStart) {
      const f = new Date(Math.floor(minStart / 10000), Math.floor((minStart % 10000) / 100) - 1, minStart % 100);
      if (f > base) base = f;
    }
    const ref = {} as Record<DayKind, Date>;
    for (const k of KINDS) {
      let first: Date | null = null;
      let pick: Date | null = null;
      for (let i = 0; i < 150 && !pick; i++) {
        const d = addDays(base, i);
        if (dow0(d) !== KIND_DOW[k]) continue;
        first ??= d;
        const di = dateToInt(d);
        if (excDates.has(di) || (maxEnd && di > maxEnd)) continue;
        pick = d;
      }
      ref[k] = pick ?? first ?? base;
    }
    const activeOn = (service: string, d: Date): boolean => {
      const di = dateToInt(d);
      const x = exc.get(service);
      if (x?.rem.has(di)) return false;
      if (x?.add.has(di)) return true;
      const c = cal.get(service);
      return !!c && !!c.start && di >= c.start && (!c.end || di <= c.end) && ((c.mask >> dow0(d)) & 1) === 1;
    };

    progress(`${label}: рейсы`);
    const tripIdx = new Map<string, number>();
    const tRoute: string[] = [];
    const tSvc: string[] = [];
    const tDir: number[] = [];
    parseCsv(need(F, 'trips.txt', label), ['trip_id', 'route_id', 'service_id', 'direction_id'], (v) => {
      if (!routes.has(v[1])) return;
      tripIdx.set(v[0], tRoute.length);
      tRoute.push(v[1]);
      tSvc.push(v[2]);
      tDir.push(parseInt(v[3], 10) === 1 ? 1 : 0);
    });
    const n = tRoute.length;

    progress(`${label}: времена отправления`);
    const fSeq = new Int32Array(n).fill(2147483647);
    const lSeq = new Int32Array(n).fill(-1);
    const fStop: string[] = new Array(n).fill('');
    const lStop: string[] = new Array(n).fill('');
    const fTime = new Int32Array(n).fill(-1);
    let rows = 0;
    parseCsv(need(F, 'stop_times.txt', label), ['trip_id', 'stop_id', 'stop_sequence', 'arrival_time', 'departure_time'], (v) => {
      const t = tripIdx.get(v[0]);
      if (t === undefined) return;
      const seq = parseInt(v[2], 10) || 0;
      if (seq < fSeq[t]) {
        fSeq[t] = seq;
        fStop[t] = v[1];
        let tm = parseTime(v[4]);
        if (tm < 0) tm = parseTime(v[3]);
        fTime[t] = tm;
      }
      if (seq > lSeq[t]) {
        lSeq[t] = seq;
        lStop[t] = v[1];
      }
      if ((++rows & 0x7ffff) === 0) progress(`${label}: времена отправления (${(rows / 1e6).toFixed(1)} млн)`);
    });

    progress(`${label}: сборка линий`);
    const byRoute = new Map<string, number[]>();
    for (let t = 0; t < n; t++) {
      if (fTime[t] < 0 || !fStop[t] || lSeq[t] <= fSeq[t]) continue;
      let a = byRoute.get(tRoute[t]);
      if (!a) byRoute.set(tRoute[t], (a = []));
      a.push(t);
    }

    const name = (id: string) => stopName.get(id) || id;
    for (const [rid, trips] of byRoute) {
      const info = routes.get(rid)!;
      // группы-направления: по direction_id, а если он один — по начальной остановке
      const dirIds = new Set(trips.map((t) => tDir[t]));
      const keyOf = (t: number) => (dirIds.size >= 2 ? String(tDir[t]) : fStop[t]);
      const groups = new Map<string, number[]>();
      for (const t of trips) {
        const k = keyOf(t);
        let g = groups.get(k);
        if (!g) groups.set(k, (g = []));
        g.push(t);
      }
      const ordered = [...groups.values()].sort((a, b) => (dirIds.size >= 2 ? tDir[a[0]] - tDir[b[0]] : b.length - a.length)).slice(0, 2);
      const dirs: Direction[] = [];
      for (const g of ordered) {
        // основной вариант — самое частое сочетание «от → до»; отправления берём со всех рейсов от той же начальной
        const cnt = new Map<string, number>();
        for (const t of g) cnt.set(`${fStop[t]}>${lStop[t]}`, (cnt.get(`${fStop[t]}>${lStop[t]}`) ?? 0) + 1);
        const best = [...cnt].sort((a, b) => b[1] - a[1])[0][0];
        const [from, to] = best.split('>');
        const times: Record<DayKind, number[]> = { weekday: [], sat: [], sun: [] };
        let validFrom = 0;
        for (const t of g) {
          if (fStop[t] !== from) continue;
          const min = Math.floor(fTime[t] / 60);
          let used = false;
          for (const k of KINDS)
            if (activeOn(tSvc[t], ref[k])) {
              times[k].push(min);
              used = true;
            }
          if (used) {
            const s = cal.get(tSvc[t])?.start ?? 0;
            if (s > validFrom) validFrom = s;
          }
        }
        for (const k of KINDS) times[k] = [...new Set(times[k])].sort((a, b) => a - b);
        if (!times.weekday.length && !times.sat.length && !times.sun.length) continue;
        dirs.push({ from: name(from), to: name(to), stops: [name(from), name(to)], validFrom, times });
      }
      if (!dirs.length) continue;
      // ночная линия: все отправления между 22:00 и 05:00
      const all = dirs.flatMap((d) => [...d.times.weekday, ...d.times.sat, ...d.times.sun]);
      const night = info.kind === 'bus' && all.every((m) => m % 1440 >= 1320 || m % 1440 <= 300);
      const cat = deriveCat(info.short, info.kind, feed.key === 'p' && info.kind === 'bus' && !night ? 'suburban' : undefined, night);
      lines.push({ id: `${feed.key}:${rid}`, short: info.short, long: info.long, kind: info.kind, cat, dirs });
    }
  }

  if (!lines.length) throw new Error('В загруженных данных нет ни одной линии с отправлениями');
  return { format: DATA_FORMAT, builtAt: new Date().toISOString(), fileName: SOURCE_NAME, generated: '', source: SOURCE_NAME, validTo, lines };
}
