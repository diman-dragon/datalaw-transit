import { loadCore, loadRouteData } from './db.ts';
import type { Core } from './db.ts';
import { SearchIndex } from './search.ts';
import { routeCompare, routesAtStop } from './schedule.ts';
import type { ScheduleCtx } from './schedule.ts';
import type { RouteData } from './types.ts';

let core: Core | null = null;
let search: SearchIndex | null = null;
let stopById: Map<string, number> | null = null;
let routeById: Map<string, number> | null = null;
const rdCache = new Map<number, RouteData>();

export function hasData(): boolean {
  return core !== null;
}

export function data(): Core {
  if (!core) throw new Error('Данные не загружены');
  return core;
}

export async function initStore(): Promise<void> {
  setCore(await loadCore());
}

export function setCore(c: Core | null): void {
  core = c;
  rdCache.clear();
  stopById = routeById = null;
  search = c ? new SearchIndex(c.stops, c.routes) : null;
}

export function searchIndex(): SearchIndex {
  if (!search) throw new Error('Данные не загружены');
  return search;
}

export function stopIdx(id: string): number | undefined {
  if (!core) return undefined;
  if (!stopById) stopById = new Map(core.stops.id.map((x, i) => [x, i]));
  return stopById.get(id);
}

export function routeIdx(id: string): number | undefined {
  if (!core) return undefined;
  if (!routeById) routeById = new Map(core.routes.map((r, i) => [r.id, i]));
  return routeById.get(id);
}

export async function ensureRoutes(list: number[]): Promise<void> {
  await Promise.all(
    list.map(async (r) => {
      if (rdCache.has(r)) return;
      const rd = await loadRouteData(r);
      if (!rd) throw new Error(`Нет данных линии #${r}. Обновите данные в настройках.`);
      rdCache.set(r, rd);
    }),
  );
}

export function routeData(r: number): RouteData {
  const rd = rdCache.get(r);
  if (!rd) throw new Error(`Линия #${r} не загружена`);
  return rd;
}

export function ctx(): ScheduleCtx {
  const c = data();
  return { services: c.services, stopIndex: c.stopIndex, routeData };
}

/** Линии, отправляющиеся с остановки, отсортированные по номеру. */
export function linesAtStop(stop: number): number[] {
  const c = data();
  return routesAtStop(c.stopIndex, stop).sort((a, b) => routeCompare(c.routes[a], c.routes[b]));
}
