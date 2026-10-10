/**
 * ПЛАНИРУЕТСЯ: построение маршрутов «из A в B» с пересадками.
 *
 * Данные для этого уже подготовлены импортом GTFS:
 *  - Pattern.stops / Pattern.times — готовые «связи» между остановками по каждому рейсу
 *    (подходит для алгоритмов CSA и RAPTOR);
 *  - StopsData.lat / lon — для пеших пересадок между остановками рядом;
 *  - activeServices() — какие рейсы ходят в выбранный день.
 *
 * План реализации: Connection Scan Algorithm в Web Worker, пешие переходы ≤ 400 м
 * по прямой с коэффициентом 1.3, 2–3 варианта (быстрее / меньше пересадок).
 * Пока сюда подключается только интерфейс, экран появится вместе с реализацией.
 */
export interface Place {
  /** индекс остановки или координаты точки на карте */
  stop?: number;
  lat?: number;
  lon?: number;
}

export interface JourneyQuery {
  from: Place;
  to: Place;
  departAt: Date;
  maxTransfers?: number;
  maxWalkMeters?: number;
}

export type Leg =
  | { kind: 'walk'; meters: number; seconds: number }
  | { kind: 'ride'; route: number; pattern: number; trip: number; fromPos: number; toPos: number };

export interface Journey {
  departSec: number;
  arriveSec: number;
  transfers: number;
  legs: Leg[];
}

export interface RoutePlanner {
  plan(q: JourneyQuery): Promise<Journey[]>;
}

/** null — планировщик ещё не реализован; интерфейс показывает пометку «в планах». */
export let routePlanner: RoutePlanner | null = null;

export function registerRoutePlanner(p: RoutePlanner): void {
  routePlanner = p;
}
