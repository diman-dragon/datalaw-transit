import { IntBuf, parseCsv, parseTime } from './csv.ts';
import { DATA_FORMAT } from '../types.ts';
import type {
  Dataset,
  FeedInput,
  FeedMeta,
  Pattern,
  Route,
  RouteData,
  RouteKind,
  ServiceCalendar,
  StopIndex,
  StopsData,
} from '../types.ts';

export function routeKind(t: number): RouteKind {
  if (t === 0 || (t >= 900 && t < 1000)) return 'tram';
  if (t === 11 || t === 800) return 'trolley';
  if (t === 2 || (t >= 100 && t < 200)) return 'rail';
  if (t === 3 || (t >= 700 && t < 800)) return 'bus';
  return 'other';
}

interface LocalRoute {
  id: string;
  short: string;
  long: string;
  kind: RouteKind;
  color: string;
  textColor: string;
}

interface PatternBuilder {
  route: number; // индекс в локальном массиве маршрутов
  dir: number;
  stops: number[]; // локальные индексы остановок
  heads: Map<string, number>;
  trips: { svc: number; times: number[] }[];
}

function cleanColor(c: string): string {
  const s = c.trim().replace(/^#/, '');
  return /^[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : '';
}

function need(files: Record<string, Uint8Array>, name: string, feed: string): Uint8Array {
  const f = files[name];
  if (!f) throw new Error(`В фиде «${feed}» нет файла ${name}`);
  return f;
}

export function buildDataset(feeds: FeedInput[], progress: (msg: string) => void = () => {}): Dataset {
  const stops: StopsData = { id: [], code: [], name: [], lat: [], lon: [] };
  const routes: Route[] = [];
  const routeData: RouteData[] = [];
  const stopIndex: StopIndex = {};
  const services: ServiceCalendar = { ids: [], start: [], end: [], mask: [], add: {}, remove: {} };
  const feedsMeta: FeedMeta[] = [];
  let totalTrips = 0;

  feeds.forEach((feed, fi) => {
    const F = feed.files;
    const label = feed.name;

    // ---- stops
    progress(`${label}: остановки`);
    const stopInfo = new Map<string, { code: string; name: string; lat: number; lon: number }>();
    parseCsv(need(F, 'stops.txt', label), ['stop_id', 'stop_code', 'stop_name', 'stop_lat', 'stop_lon'], (v) => {
      stopInfo.set(v[0], { code: v[1].trim(), name: v[2].trim(), lat: +v[3] || 0, lon: +v[4] || 0 });
    });

    // ---- routes
    progress(`${label}: линии`);
    const lroutes: LocalRoute[] = [];
    const routeLocal = new Map<string, number>();
    parseCsv(
      need(F, 'routes.txt', label),
      ['route_id', 'route_short_name', 'route_long_name', 'route_type', 'route_color', 'route_text_color'],
      (v) => {
        routeLocal.set(v[0], lroutes.length);
        lroutes.push({
          id: v[0],
          short: v[1].trim(),
          long: v[2].trim(),
          kind: routeKind(parseInt(v[3], 10)),
          color: cleanColor(v[4]),
          textColor: cleanColor(v[5]),
        });
      },
    );

    // ---- services
    progress(`${label}: календарь`);
    const svcMap = new Map<string, number>();
    const getSvc = (id: string): number => {
      let i = svcMap.get(id);
      if (i === undefined) {
        i = services.ids.length;
        svcMap.set(id, i);
        services.ids.push(`${feed.key}:${id}`);
        services.start.push(0);
        services.end.push(0);
        services.mask.push(0);
      }
      return i;
    };
    let minStart = 0;
    let maxEnd = 0;
    if (F['calendar.txt']) {
      parseCsv(
        F['calendar.txt'],
        ['service_id', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'start_date', 'end_date'],
        (v) => {
          const i = getSvc(v[0]);
          let m = 0;
          for (let d = 0; d < 7; d++) if (v[1 + d].trim() === '1') m |= 1 << d;
          const s = parseInt(v[8], 10) || 0;
          const e = parseInt(v[9], 10) || 0;
          services.mask[i] = m;
          services.start[i] = s;
          services.end[i] = e;
          if (s && (!minStart || s < minStart)) minStart = s;
          if (e > maxEnd) maxEnd = e;
        },
      );
    }
    if (F['calendar_dates.txt']) {
      parseCsv(F['calendar_dates.txt'], ['service_id', 'date', 'exception_type'], (v) => {
        const i = getSvc(v[0]);
        const date = parseInt(v[1], 10);
        if (!date) return;
        const t = v[2].trim();
        const target = t === '1' ? services.add : t === '2' ? services.remove : null;
        if (!target) return;
        (target[i] ??= []).push(date);
      });
    }

    // ---- trips
    progress(`${label}: рейсы`);
    const tripMap = new Map<string, number>();
    const tripRoute: number[] = [];
    const tripSvc: number[] = [];
    const tripDir: number[] = [];
    const tripHead: string[] = [];
    parseCsv(
      need(F, 'trips.txt', label),
      ['trip_id', 'route_id', 'service_id', 'trip_headsign', 'direction_id'],
      (v) => {
        const r = routeLocal.get(v[1]);
        if (r === undefined) return;
        tripMap.set(v[0], tripRoute.length);
        tripRoute.push(r);
        tripSvc.push(getSvc(v[2]));
        tripDir.push(parseInt(v[4], 10) === 1 ? 1 : 0);
        tripHead.push(v[3].trim());
      },
    );
    const nTrips = tripRoute.length;

    // ---- stop_times
    progress(`${label}: времена отправления`);
    const localStop = new Map<string, number>();
    const localStopIds: string[] = [];
    const bTrip = new IntBuf();
    const bSeq = new IntBuf();
    const bStop = new IntBuf();
    const bTime = new IntBuf();
    const seen = new Uint8Array(nTrips);
    let prevTrip = -1;
    let prevSeq = -1;
    let sorted = true;
    let rows = 0;
    parseCsv(
      need(F, 'stop_times.txt', label),
      ['trip_id', 'stop_id', 'stop_sequence', 'arrival_time', 'departure_time'],
      (v) => {
        const t = tripMap.get(v[0]);
        if (t === undefined) return;
        let s = localStop.get(v[1]);
        if (s === undefined) {
          s = localStopIds.length;
          localStop.set(v[1], s);
          localStopIds.push(v[1]);
        }
        const seq = parseInt(v[2], 10) || 0;
        let time = parseTime(v[4]);
        if (time < 0) time = parseTime(v[3]);
        if (t !== prevTrip) {
          if (seen[t]) sorted = false;
          seen[t] = 1;
        } else if (seq < prevSeq) sorted = false;
        prevTrip = t;
        prevSeq = seq;
        bTrip.push(t);
        bSeq.push(seq);
        bStop.push(s);
        bTime.push(time);
        rows++;
        if ((rows & 0x3ffff) === 0) progress(`${label}: времена отправления (${(rows / 1e6).toFixed(1)} млн)`);
      },
    );

    let order: Uint32Array | null = null;
    if (!sorted) {
      progress(`${label}: сортировка`);
      order = new Uint32Array(rows);
      for (let i = 0; i < rows; i++) order[i] = i;
      const tt = bTrip.a;
      const ss = bSeq.a;
      order.sort((a, b) => tt[a] - tt[b] || ss[a] - ss[b]);
    }

    // ---- patterns
    progress(`${label}: сборка линий`);
    const globalStop = new Int32Array(localStopIds.length).fill(-1);
    const gs = (local: number): number => {
      let g = globalStop[local];
      if (g < 0) {
        g = stops.id.length;
        globalStop[local] = g;
        const id = localStopIds[local];
        const info = stopInfo.get(id);
        stops.id.push(`${feed.key}:${id}`);
        stops.code.push(info?.code ?? '');
        stops.name.push(info?.name || id);
        stops.lat.push(info?.lat ?? 0);
        stops.lon.push(info?.lon ?? 0);
      }
      return g;
    };

    const patterns = new Map<string, PatternBuilder>();
    let i = 0;
    while (i < rows) {
      const t = bTrip.a[order ? order[i] : i];
      let j = i;
      while (j < rows && bTrip.a[order ? order[j] : j] === t) j++;
      const n = j - i;
      if (n >= 2) {
        const st = new Array<number>(n);
        const tm = new Array<number>(n);
        for (let k = 0; k < n; k++) {
          const r = order ? order[i + k] : i + k;
          st[k] = bStop.a[r];
          tm[k] = bTime.a[r];
        }
        // заполнить пропущенные времена
        let firstKnown = -1;
        for (let k = 0; k < n; k++)
          if (tm[k] >= 0) {
            firstKnown = k;
            break;
          }
        if (firstKnown >= 0) {
          for (let k = 0; k < firstKnown; k++) tm[k] = tm[firstKnown];
          for (let k = firstKnown + 1; k < n; k++) if (tm[k] < 0) tm[k] = tm[k - 1];
          const key = `${tripRoute[t]}|${tripDir[t]}|${st.join(',')}`;
          let pb = patterns.get(key);
          if (!pb) {
            pb = { route: tripRoute[t], dir: tripDir[t], stops: st, heads: new Map(), trips: [] };
            patterns.set(key, pb);
          }
          const h = tripHead[t];
          if (h) pb.heads.set(h, (pb.heads.get(h) ?? 0) + 1);
          pb.trips.push({ svc: tripSvc[t], times: tm });
        }
      }
      i = j;
    }

    // группировка по линиям
    const byRoute = new Map<number, PatternBuilder[]>();
    for (const pb of patterns.values()) {
      let a = byRoute.get(pb.route);
      if (!a) byRoute.set(pb.route, (a = []));
      a.push(pb);
    }

    let feedRoutes = 0;
    let feedTrips = 0;
    const sortedRoutes = [...byRoute.keys()].sort((a, b) => a - b);
    for (const lr of sortedRoutes) {
      const info = lroutes[lr];
      const routeIdx = routes.length;
      routes.push({
        id: `${feed.key}:${info.id}`,
        short: info.short || info.long || info.id,
        long: info.long,
        kind: info.kind,
        color: info.color,
        textColor: info.textColor,
        feed: fi,
      });
      const pbs = byRoute.get(lr)!;
      pbs.sort((a, b) => a.dir - b.dir || b.trips.length - a.trips.length);
      const out: Pattern[] = pbs.map((pb) => {
        pb.trips.sort((a, b) => a.times[0] - b.times[0]);
        const n = pb.stops.length;
        const times = new Int32Array(pb.trips.length * n);
        const svc = new Int32Array(pb.trips.length);
        pb.trips.forEach((tr, k) => {
          svc[k] = tr.svc;
          times.set(tr.times, k * n);
        });
        let head = '';
        let best = 0;
        for (const [h, c] of pb.heads) if (c > best) (best = c), (head = h);
        const gstops = pb.stops.map(gs);
        if (!head) head = stops.name[gstops[n - 1]];
        feedTrips += pb.trips.length;
        return { dir: pb.dir, head, stops: gstops, trips: pb.trips.length, svc, times };
      });
      out.forEach((p, pi) => {
        for (let pos = 0; pos < p.stops.length - 1; pos++) {
          const s = p.stops[pos];
          (stopIndex[s] ??= []).push(routeIdx, pi, pos);
        }
      });
      routeData.push({ route: routeIdx, patterns: out });
      feedRoutes++;
    }

    let version = '';
    if (F['feed_info.txt']) {
      parseCsv(F['feed_info.txt'], ['feed_version'], (v) => {
        if (!version) version = v[0].trim();
      });
    }
    totalTrips += feedTrips;
    feedsMeta.push({
      key: feed.key,
      name: feed.name,
      version,
      startDate: minStart,
      endDate: maxEnd,
      routes: feedRoutes,
      trips: feedTrips,
    });
  });

  return {
    meta: {
      format: DATA_FORMAT,
      builtAt: new Date().toISOString(),
      feeds: feedsMeta,
      stops: stops.id.length,
      routes: routes.length,
      trips: totalTrips,
    },
    stops,
    routes,
    routeData,
    stopIndex,
    services,
  };
}
