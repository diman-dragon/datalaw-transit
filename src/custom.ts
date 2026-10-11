/**
 * Свой файл расписания (datalaw-schedule.json). Делается скриптом tools/collect_gsp.py или вручную.
 *
 * {
 *   "format": "datalaw-schedule/1",
 *   "generated": "2026-10-11T12:00:00Z",
 *   "source": "gsp.rs",
 *   "validTo": "2026-12-31",              // необязательно: общий срок окончания
 *   "lines": [{
 *     "id": "26", "short": "26", "long": "Дорћол - Браће Јерковић",
 *     "kind": "bus" | "tram" | "trolley" | "rail" | "other",
 *     "dirs": [{
 *       "from": "ДОРЋОЛ", "to": "БРАЋЕ ЈЕРКОВИЋ",
 *       "stops": ["ДОРЋОЛ", "…", "БРАЋЕ ЈЕРКОВИЋ"],     // названия по порядку, первая и последняя — конечные
 *       "validFrom": "2025-03-17",                       // «Важи од»
 *       "times": { "weekday": ["04:10", …], "sat": [...], "sun": [...] }  // отправления от начальной остановки,
 *                                                                          // часы могут быть 24+ для рейсов после полуночи
 *     }]
 *   }]
 * }
 */
import type { FeedInput, RouteKind } from './types.ts';

export const CUSTOM_FORMAT = 'datalaw-schedule/1';

export interface CustomDir {
  from: string;
  to: string;
  stops?: string[];
  validFrom?: string | null;
  times: { weekday?: string[]; sat?: string[]; sun?: string[] };
}

export interface CustomLine {
  id: string;
  short?: string;
  long?: string;
  kind?: RouteKind;
  dirs: CustomDir[];
}

export interface CustomFile {
  format: string;
  generated?: string;
  source?: string;
  validTo?: string | null;
  lines: CustomLine[];
}

export function parseCustom(bytes: Uint8Array): CustomFile {
  let j: unknown;
  try {
    j = JSON.parse(new TextDecoder('utf-8').decode(bytes));
  } catch {
    throw new Error('это не JSON-файл расписания');
  }
  const f = j as Partial<CustomFile>;
  if (!f || typeof f.format !== 'string' || !f.format.startsWith('datalaw-schedule/'))
    throw new Error('в файле нет метки формата datalaw-schedule (создайте его скриптом tools/collect_gsp.py)');
  if (f.format !== CUSTOM_FORMAT) throw new Error(`формат ${f.format} не поддерживается этой версией приложения`);
  if (!Array.isArray(f.lines) || !f.lines.length) throw new Error('в файле нет линий');
  return f as CustomFile;
}

function dateNum(s: string | null | undefined): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s ?? '');
  return m ? +m[1] * 10000 + +m[2] * 100 + +m[3] : 0;
}

function q(s: string): string {
  const t = s.replace(/[\r\n]+/g, ' ').trim();
  return /[",]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

const ROUTE_TYPE: Record<RouteKind, number> = { bus: 3, tram: 0, trolley: 11, rail: 2, other: 3 };
const SERVICE_DAYS: Record<'weekday' | 'sat' | 'sun', string> = { weekday: '1,1,1,1,1,0,0', sat: '0,0,0,0,0,1,0', sun: '0,0,0,0,0,0,1' };

function normTime(t: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m || +m[2] > 59 || +m[1] > 47) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}:00`;
}

/** Превращает файл расписания во внутренний вид GTFS — дальше работает обычная сборка данных. */
export function customToFeed(file: CustomFile, key: string, name: string): FeedInput {
  const generated = dateNum(file.generated) || 20200101;
  const validTo = dateNum(file.validTo);
  // идентификаторы — сами названия: избранное не ломается при пересборке файла
  const stopNames = new Set<string>();
  const stopOf = (n: string): string => {
    const k = n.replace(/[\r\n]+/g, ' ').trim();
    stopNames.add(k);
    return q(k);
  };
  const routes: string[] = ['route_id,route_short_name,route_long_name,route_type'];
  const trips: string[] = ['route_id,service_id,trip_id,trip_headsign,direction_id'];
  const times: string[] = ['trip_id,arrival_time,departure_time,stop_id,stop_sequence'];
  const services = new Set<string>();
  let tripN = 0;
  file.lines.forEach((line) => {
    const rid = q(`${line.id}`);
    const dirs = (line.dirs ?? []).slice(0, 2);
    let has = false;
    dirs.forEach((d, di) => {
      const names = d.stops && d.stops.length >= 2 ? d.stops : [d.from, d.to];
      const ids = names.map(stopOf);
      const vf = dateNum(d.validFrom) || generated;
      for (const kind of ['weekday', 'sat', 'sun'] as const) {
        for (const t of d.times?.[kind] ?? []) {
          const tt = normTime(t);
          if (!tt) continue;
          const sid = `${vf}-${kind}`;
          services.add(sid);
          const tid = `T${tripN++}`;
          trips.push(`${rid},${sid},${tid},${q(d.to)},${di}`);
          ids.forEach((id, k) => times.push(k === 0 ? `${tid},${tt},${tt},${id},1` : `${tid},,,${id},${k + 1}`));
          has = true;
        }
      }
    });
    if (has) routes.push(`${rid},${q(line.short || line.id)},${q(line.long ?? '')},${ROUTE_TYPE[line.kind ?? 'bus'] ?? 3}`);
  });
  const stops = ['stop_id,stop_code,stop_name,stop_lat,stop_lon', ...[...stopNames].map((n) => `${q(n)},,${q(n)},0,0`)];
  const cal = ['service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date'];
  for (const sid of services) {
    const [from, kind] = sid.split('-') as [string, 'weekday' | 'sat' | 'sun'];
    cal.push(`${sid},${SERVICE_DAYS[kind]},${from},${validTo}`);
  }
  const enc = new TextEncoder();
  const f = (lines: string[]) => enc.encode(lines.join('\n') + '\n');
  return {
    key,
    name,
    files: {
      'stops.txt': f(stops),
      'routes.txt': f(routes),
      'trips.txt': f(trips),
      'stop_times.txt': f(times),
      'calendar.txt': f(cal),
      'feed_info.txt': f(['feed_publisher_name,feed_version', `${q(file.source ?? 'custom')},${(file.generated ?? '').slice(0, 10)}`]),
    },
  };
}
