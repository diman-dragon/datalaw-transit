/**
 * ПЛАНИРУЕТСЯ: время прибытия в реальном времени.
 *
 * Экран остановки уже получает «ближайшие отправления» через ArrivalProvider.
 * Сейчас единственный провайдер — scheduleProvider (плановое расписание из GTFS).
 * Чтобы добавить реальное время, достаточно реализовать ArrivalProvider
 * (например, GTFS-RT или другой источник) и вызвать registerArrivalProvider() —
 * интерфейс экрана менять не придётся: он показывает метку источника и задержку.
 */
import { ctx, ensureRoutes, routeData } from '../store.ts';
import { dateInt, departuresAt, patternDest, patternLabel, secondsNow } from '../schedule.ts';
import { linesAtStop } from '../store.ts';

export interface Arrival {
  route: number;
  /** куда едет — конечная остановка */
  head: string;
  /** направление целиком: «Мириево 4 → Дорчол» */
  label: string;
  /** время отправления по расписанию, секунды от полуночи выбранного дня */
  time: number;
  /** прогноз с учётом задержки (если известен), иначе совпадает с time */
  expected: number;
  /** задержка в секундах (только для реального времени) */
  delaySec?: number;
  source: 'schedule' | 'realtime';
}

export interface ArrivalProvider {
  readonly id: string;
  readonly realtime: boolean;
  /** Ближайшие отправления с остановки на выбранный день, по возрастанию времени. */
  arrivals(stop: number, date: Date): Promise<Arrival[]>;
}

export const scheduleProvider: ArrivalProvider = {
  id: 'schedule',
  realtime: false,
  async arrivals(stop, date) {
    await ensureRoutes(linesAtStop(stop));
    const cx = ctx();
    return departuresAt(cx, stop, date).map((d) => {
      const pat = routeData(d.route).patterns[d.pattern];
      return {
      route: d.route,
      head: patternDest(cx.stopName, pat),
      label: patternLabel(cx.stopName, pat),
      time: d.time,
      expected: d.time,
      source: 'schedule' as const,
      };
    });
  },
};

let current: ArrivalProvider = scheduleProvider;

export function registerArrivalProvider(p: ArrivalProvider): void {
  current = p;
}

export function arrivalProvider(): ArrivalProvider {
  return current;
}

/** Секунды до отправления относительно «сейчас» для выбранного дня; null — день не сегодняшний. */
export function etaFromNow(a: Arrival, date: Date, now = new Date()): number | null {
  if (dateInt(date) !== dateInt(now)) return null;
  return a.expected - secondsNow(now);
}
