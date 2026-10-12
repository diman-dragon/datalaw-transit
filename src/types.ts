/** Формат хранимых данных. Меняйте DATA_FORMAT при несовместимых изменениях. */
export const DATA_FORMAT = 4;

export type RouteKind = 'bus' | 'tram' | 'trolley' | 'rail' | 'other';

/** Категория линии — по ней работает фильтр на вкладке «Линии». */
export type LineCat = 'tram' | 'trolley' | 'day' | 'night' | 'express' | 'suburban' | 'rail';

/** Порядок категорий в списках и подписи фильтров. */
export const CAT_ORDER: LineCat[] = ['tram', 'trolley', 'day', 'night', 'express', 'suburban', 'rail'];
export const CAT_LABEL: Record<LineCat, string> = {
  tram: 'Трамваи',
  trolley: 'Троллейбусы',
  day: 'Дневные',
  night: 'Ночные',
  express: 'Экспресс',
  suburban: 'Пригородные',
  rail: 'Сербиявоз',
};

export type DayKind = 'weekday' | 'sat' | 'sun';

/** Одно направление линии: отправления от начальной (конечной) остановки. */
export interface Direction {
  from: string;
  to: string;
  /** названия остановок по порядку (минимум две: from и to) */
  stops: string[];
  /** yyyymmdd, 0 — не указано («Важи од») */
  validFrom: number;
  /** минуты от полуночи, по возрастанию; значения ≥ 1440 — рейсы после полуночи */
  times: Record<DayKind, number[]>;
}

export interface Line {
  /** 'g:<id из файла>' — стабильный идентификатор (избранное не ломается при обновлении файла) */
  id: string;
  short: string;
  long: string;
  kind: RouteKind;
  cat: LineCat;
  dirs: Direction[];
}

export interface Dataset {
  format: number;
  /** когда загружено в приложение (ISO) */
  builtAt: string;
  fileName: string;
  /** поле generated из файла (ISO или пусто) */
  generated: string;
  source: string;
  /** yyyymmdd общего срока окончания, 0 — не указан */
  validTo: number;
  lines: Line[];
}
