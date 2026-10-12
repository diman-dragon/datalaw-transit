import type { DayKind, Direction, Line } from './types.ts';
import { CAT_ORDER } from './types.ts';

export const KINDS: DayKind[] = ['weekday', 'sat', 'sun'];
export const KIND_LABEL: Record<DayKind, string> = { weekday: 'Будни', sat: 'Суббота', sun: 'Воскресенье' };

/** Тип дня по дате: пн–пт — будни, суббота, воскресенье. */
export function kindOfDate(d: Date): DayKind {
  const w = d.getDay();
  return w === 0 ? 'sun' : w === 6 ? 'sat' : 'weekday';
}

export function minuteOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** Отправления направления в выбранный тип дня (минуты от полуночи, по возрастанию, могут быть ≥ 1440). */
export function dayTimes(dir: Direction, kind: DayKind): number[] {
  return dir.times[kind] ?? [];
}

export interface Next {
  /** минуты от полуночи (может быть ≥ 1440) */
  min: number;
  /** ближайшее отправление уже завтра (сегодня рейсов больше нет) */
  tomorrow: boolean;
  /** через сколько минут; для «завтра» — тоже, но считается через полночь */
  wait: number;
}

/**
 * Ближайшее отправление от начальной остановки направления.
 * Учитывает рейсы после полуночи из вчерашнего расписания (24:15 → сегодня 00:15).
 */
export function nextDeparture(dir: Direction, now: Date): Next | null {
  const nowMin = minuteOfDay(now);
  const today = dayTimes(dir, kindOfDate(now));
  const yesterdayTail = dayTimes(dir, kindOfDate(addDays(now, -1)))
    .filter((t) => t >= 1440)
    .map((t) => t - 1440);
  const all = [...yesterdayTail, ...today].sort((a, b) => a - b);
  const hit = all.find((t) => t >= nowMin);
  if (hit !== undefined) return { min: hit, tomorrow: false, wait: hit - nowMin };
  const tomorrow = dayTimes(dir, kindOfDate(addDays(now, 1)));
  if (tomorrow.length) return { min: tomorrow[0], tomorrow: true, wait: 1440 - nowMin + tomorrow[0] };
  return null;
}

// ---------- сортировка линий

export function shortCompare(a: string, b: string): number {
  const ma = /^(\d+)(.*)$/.exec(a);
  const mb = /^(\d+)(.*)$/.exec(b);
  if (ma && mb) return +ma[1] - +mb[1] || ma[2].localeCompare(mb[2], 'sr');
  if (ma) return -1;
  if (mb) return 1;
  return a.localeCompare(b, 'sr', { numeric: true });
}

/** Сначала по категории (трамваи, троллейбусы, дневные, ночные…), потом по номеру: 2, 3, 7, 26, 26Л, 101, E2… */
export function routeCompare(a: Line, b: Line): number {
  return CAT_ORDER.indexOf(a.cat) - CAT_ORDER.indexOf(b.cat) || shortCompare(a.short, b.short);
}
