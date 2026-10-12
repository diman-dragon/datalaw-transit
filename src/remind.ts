import { monthKey } from './format.ts';

/**
 * Ежемесячное напоминание: при первом открытии приложения в новом месяце
 * просим проверить, не обновилось ли расписание. Приложение ничего не скачивает само.
 */
export function shouldRemind(lastMonth: string, now: Date, hasData: boolean): boolean {
  return hasData && lastMonth !== monthKey(now);
}
