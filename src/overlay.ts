/**
 * Свой файл расписания поверх официальных данных.
 *
 * Сравнение идёт по линиям (ключ «вид:номер», см. routeKeys). Для каждой линии, у которой есть различия,
 * пользователь выбирает, чья версия остаётся: «текущая» (официальная) или «своя» (из загруженного файла):
 *
 *   changed — линия есть в обоих наборах и отличается: побеждает выбранная версия;
 *   added   — линия есть только в своём файле: «своя» = добавить, «текущая» = пропустить;
 *   removed — линия есть только в текущих данных: «текущая» = оставить, «своя» = убрать (в своём файле её нет).
 *
 * Линии, которые в обоих наборах совпадают, не требуют решения — остаётся текущая.
 * Модуль не зависит от DOM и IndexedDB, поэтому покрыт тестами в tests/overlay.test.ts.
 */
import { diffSnapshots, makeSnapshot, routeKeys } from './compare.ts';
import type { Diff } from './compare.ts';
import { DATA_FORMAT } from './types.ts';
import type { Dataset, FeedMeta, Pattern, Route, RouteData, RouteKind, ServiceCalendar, StopIndex, StopsData } from './types.ts';

/** Ключ фида «свой файл»: префикс идентификаторов остановок, линий и сервисов (`u:…`). */
export const CUSTOM_FEED_KEY = 'u';

export type Choice = 'custom' | 'current';
export type LineStatus = 'added' | 'removed' | 'changed';

export interface LineConflict {
  key: string;
  status: LineStatus;
  short: string;
  long: string;
  kind: RouteKind;
  /** что именно отличается: «было» — текущие данные, «стало» — свой файл */
  notes: string[];
}

export interface CustomPlan {
  /** общий отчёт «текущие данные → свой файл» (срок действия, даты сравнения) */
  diff: Diff;
  /** линии, требующие решения: сначала изменённые, затем новые, затем отсутствующие в своём файле */
  lines: LineConflict[];
  /** линий, совпадающих в обоих наборах */
  same: number;
}

/** Сохранённый «слой» — свой файл и принятые решения. Сам zip лежит в хранилище raw под ключом CUSTOM_FEED_KEY. */
export interface CustomLayer {
  fileName: string;
  size: number;
  savedAt: string;
  choices: Record<string, Choice>;
}

const DEFAULT_CHOICE: Record<LineStatus, Choice> = {
  changed: 'current', // конфликт: без явного решения ничего не меняем
  added: 'custom', // новые линии просто добавляются
  removed: 'current', // отсутствие линии в своём файле не считается решением её убрать (файл может быть неполным)
};

export function planCustom(base: Dataset, custom: Dataset): CustomPlan {
  const diff = diffSnapshots(base.snapshot, custom.snapshot);
  const longOf = new Map(custom.snapshot.lines.map((l) => [l.key, l.long]));
  const lines: LineConflict[] = [
    ...diff.changed.map((c) => ({ key: c.key, status: 'changed' as const, short: c.short, long: longOf.get(c.key) ?? '', kind: c.kind, notes: c.notes })),
    ...diff.added.map((a) => ({ key: a.key, status: 'added' as const, short: a.short, long: a.long, kind: a.kind, notes: [] })),
    ...diff.removed.map((r) => ({ key: r.key, status: 'removed' as const, short: r.short, long: r.long, kind: r.kind, notes: [] })),
  ];
  return { diff, lines, same: diff.same };
}

/** Решения по умолчанию: конфликты — текущая версия, новые линии — добавить, отсутствующие — оставить. */
export function defaultChoices(plan: CustomPlan): Record<string, Choice> {
  const out: Record<string, Choice> = {};
  for (const l of plan.lines) out[l.key] = DEFAULT_CHOICE[l.status];
  return out;
}

/** Явные решения поверх умолчаний; ключи, которых нет в сравнении, отбрасываются. */
export function resolveChoices(plan: CustomPlan, explicit: Record<string, Choice> | undefined): Record<string, Choice> {
  const out = defaultChoices(plan);
  if (explicit) for (const l of plan.lines) if (explicit[l.key] === 'custom' || explicit[l.key] === 'current') out[l.key] = explicit[l.key];
  return out;
}

export interface ChoiceStats {
  conflicts: number;
  conflictsCustom: number;
  added: number;
  addedTaken: number;
  removed: number;
  removedDropped: number;
}

/** Сводка выбора для подписи под списком: сколько линий в итоге изменится. */
export function choiceStats(plan: CustomPlan, choices: Record<string, Choice>): ChoiceStats {
  const s: ChoiceStats = { conflicts: 0, conflictsCustom: 0, added: 0, addedTaken: 0, removed: 0, removedDropped: 0 };
  for (const l of plan.lines) {
    const custom = (choices[l.key] ?? DEFAULT_CHOICE[l.status]) === 'custom';
    if (l.status === 'changed') {
      s.conflicts++;
      if (custom) s.conflictsCustom++;
    } else if (l.status === 'added') {
      s.added++;
      if (custom) s.addedTaken++;
    } else {
      s.removed++;
      if (custom) s.removedDropped++;
    }
  }
  return s;
}

/** Сколько линий меняется относительно текущих данных при данном выборе. */
export function changesCount(st: ChoiceStats): number {
  return st.conflictsCustom + st.addedTaken + st.removedDropped;
}

function stopKey(code: string, name: string): string {
  return `${code.trim()}\u0000${name.trim().toLowerCase()}`;
}

/**
 * Собирает итоговый набор данных из текущего (base) и своего (custom) с учётом решений.
 * Входные наборы не изменяются. Остановки своего файла с тем же кодом и названием, что у текущих,
 * объединяются с ними — иначе одна и та же остановка в поиске встречалась бы дважды.
 */
export function mergeDatasets(base: Dataset, custom: Dataset, plan: CustomPlan, choices: Record<string, Choice>): Dataset {
  const status = new Map(plan.lines.map((l) => [l.key, l.status]));
  const pick = (key: string, st: LineStatus): Choice => choices[key] ?? DEFAULT_CHOICE[st];
  const bKeys = routeKeys(base);
  const cKeys = routeKeys(custom);

  const keepBase = (key: string): boolean => {
    const st = status.get(key);
    return st === 'changed' || st === 'removed' ? pick(key, st) === 'current' : true;
  };
  const keepCustom = (key: string): boolean => {
    const st = status.get(key);
    return st === 'changed' || st === 'added' ? pick(key, st) === 'custom' : false;
  };

  // ---- календарь: сервисы своего файла дописываются в конец, их номера сдвигаются на off
  const off = base.services.ids.length;
  const services: ServiceCalendar = {
    ids: [...base.services.ids, ...custom.services.ids],
    start: [...base.services.start, ...custom.services.start],
    end: [...base.services.end, ...custom.services.end],
    mask: [...base.services.mask, ...custom.services.mask],
    add: { ...base.services.add },
    remove: { ...base.services.remove },
  };
  for (const k in custom.services.add) services.add[+k + off] = custom.services.add[k].slice();
  for (const k in custom.services.remove) services.remove[+k + off] = custom.services.remove[k].slice();

  // ---- остановки: берём только используемые
  const stops: StopsData = { id: [], code: [], name: [] };
  const mapB = new Int32Array(base.stops.id.length).fill(-1);
  const mapC = new Int32Array(custom.stops.id.length).fill(-1);
  const byCode = new Map<string, number>();
  const pushStop = (src: StopsData, i: number): number => {
    const g = stops.id.length;
    stops.id.push(src.id[i]);
    stops.code.push(src.code[i]);
    stops.name.push(src.name[i]);
    return g;
  };
  const stopOfBase = (i: number): number => {
    let g = mapB[i];
    if (g < 0) {
      g = mapB[i] = pushStop(base.stops, i);
      if (base.stops.code[i]) byCode.set(stopKey(base.stops.code[i], base.stops.name[i]), g);
    }
    return g;
  };
  const stopOfCustom = (i: number): number => {
    let g = mapC[i];
    if (g < 0) {
      const code = custom.stops.code[i];
      const same = code ? byCode.get(stopKey(code, custom.stops.name[i])) : undefined;
      g = mapC[i] = same ?? pushStop(custom.stops, i);
    }
    return g;
  };

  const routes: Route[] = [];
  const routeData: RouteData[] = [];
  const stopIndex: StopIndex = {};
  const feeds: FeedMeta[] = base.meta.feeds.map((f) => ({ ...f, routes: 0, trips: 0 }));
  const customFeedIdx = base.meta.feeds.length;
  const customMeta: FeedMeta = { ...custom.meta.feeds[0], key: CUSTOM_FEED_KEY, routes: 0, trips: 0 };

  const addRoute = (route: Route, rd: RouteData, feed: number, mapStop: (i: number) => number, svcOff: number, meta: FeedMeta): void => {
    const ri = routes.length;
    routes.push({ ...route, feed });
    const patterns: Pattern[] = rd.patterns.map((p) => ({
      ...p,
      stops: p.stops.map(mapStop),
      svc: svcOff ? p.svc.map((x) => x + svcOff) : p.svc,
    }));
    patterns.forEach((p, pi) => {
      for (let pos = 0; pos < p.stops.length; pos++) (stopIndex[p.stops[pos]] ??= []).push(ri, pi, pos);
      meta.trips += p.trips;
    });
    meta.routes++;
    routeData.push({ route: ri, patterns });
  };

  base.routeData.forEach((rd, i) => {
    if (!keepBase(bKeys[i])) return;
    const r = base.routes[rd.route];
    addRoute(r, rd, r.feed, stopOfBase, 0, feeds[r.feed]);
  });
  custom.routeData.forEach((rd, i) => {
    if (!keepCustom(cKeys[i])) return;
    addRoute(custom.routes[rd.route], rd, customFeedIdx, stopOfCustom, off, customMeta);
  });
  if (customMeta.routes > 0) feeds.push(customMeta);

  const meta = {
    format: DATA_FORMAT,
    builtAt: new Date().toISOString(),
    feeds,
    stops: stops.id.length,
    routes: routes.length,
    trips: feeds.reduce((a, f) => a + f.trips, 0),
  };
  const ds: Dataset = { meta, stops, routes, routeData, stopIndex, services, snapshot: { builtAt: meta.builtAt, feeds: [], refDates: { weekday: 0, sat: 0, sun: 0 }, lines: [] } };
  ds.snapshot = makeSnapshot(ds);
  return ds;
}

export interface LayerResult {
  dataset: Dataset;
  plan: CustomPlan;
  choices: Record<string, Choice>;
  /** конфликтов, по которым у пользователя нет сохранённого решения (оставлена текущая версия) */
  undecided: number;
}

/** Применить сохранённый слой к заново собранным официальным данным (например, после скачивания обновления). */
export function applyLayer(base: Dataset, custom: Dataset, stored: Record<string, Choice> | undefined): LayerResult {
  const plan = planCustom(base, custom);
  const choices = resolveChoices(plan, stored);
  const undecided = plan.lines.filter((l) => l.status === 'changed' && !stored?.[l.key]).length;
  return { dataset: mergeDatasets(base, custom, plan, choices), plan, choices, undecided };
}
