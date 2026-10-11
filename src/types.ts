/** Формат хранимых данных. Меняйте DATA_FORMAT при несовместимых изменениях. */
export const DATA_FORMAT = 3;

export type RouteKind = 'bus' | 'tram' | 'trolley' | 'rail' | 'other';

export interface StopsData {
  id: string[];
  code: string[];
  name: string[];
}

export interface Route {
  id: string;
  short: string;
  long: string;
  kind: RouteKind;
  /** hex без '#', может быть пустым */
  color: string;
  textColor: string;
  /** индекс фида в meta.feeds */
  feed: number;
}

/** Один вариант прохождения линии: последовательность остановок + рейсы. */
export interface Pattern {
  dir: number;
  head: string;
  /** индексы остановок */
  stops: number[];
  /** число рейсов */
  trips: number;
  /** индекс сервиса для каждого рейса */
  svc: Int32Array;
  /** время отправления в секундах от полуночи, trips*stops.length, рейсы отсортированы по первому времени */
  times: Int32Array;
}

export interface RouteData {
  route: number;
  patterns: Pattern[];
}

export interface ServiceCalendar {
  ids: string[];
  /** yyyymmdd; 0 — нет календаря */
  start: number[];
  end: number[];
  /** бит 0 = понедельник … бит 6 = воскресенье */
  mask: number[];
  add: Record<number, number[]>;
  remove: Record<number, number[]>;
}

/** stopIdx -> плоский список троек [routeIdx, patternIdx, pos] */
export type StopIndex = Record<number, number[]>;

export interface FeedMeta {
  key: string;
  name: string;
  version: string;
  startDate: number;
  endDate: number;
  routes: number;
  trips: number;
}

export interface Meta {
  format: number;
  builtAt: string;
  feeds: FeedMeta[];
  stops: number;
  routes: number;
  trips: number;
}

export interface Dataset {
  meta: Meta;
  stops: StopsData;
  routes: Route[];
  routeData: RouteData[];
  stopIndex: StopIndex;
  services: ServiceCalendar;
  /** краткий слепок расписания для сравнения при обновлении */
  snapshot: Snapshot;
}

export interface FeedInput {
  key: string;
  name: string;
  /** файлы GTFS по базовому имени, например 'stops.txt' */
  files: Record<string, Uint8Array>;
}

export type DayKindKey = 'weekday' | 'sat' | 'sun';

/** Направление линии в слепке: основной вариант, отправления от начальной остановки (минуты от полуночи). */
export interface SnapDir {
  from: string;
  to: string;
  stops: number;
  times: Record<DayKindKey, number[]>;
}

export interface SnapLine {
  key: string;
  short: string;
  long: string;
  kind: RouteKind;
  dirs: SnapDir[];
}

export interface Snapshot {
  builtAt: string;
  feeds: { key: string; name: string; version: string; startDate: number; endDate: number }[];
  /** даты (yyyymmdd), по которым считались будни / суббота / воскресенье */
  refDates: Record<DayKindKey, number>;
  lines: SnapLine[];
}
