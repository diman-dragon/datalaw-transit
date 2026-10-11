/** Напоминания: когда пора скачать новое расписание (смена сезона, окончание срока, старые данные). */
import { fmtDateInt } from './compare.ts';

export interface Transition {
  m: number;
  d: number;
}

export interface RemindInput {
  today: Date;
  /** когда собраны текущие данные (ISO) */
  builtAt: string;
  feeds: { startDate: number; endDate: number }[];
  transitions: Transition[];
  /** за сколько дней до смены начинать напоминать */
  leadDays?: number;
  /** через сколько дней после даты смены перестать напоминать, если данные не обновили */
  graceDays?: number;
  /** возраст данных, после которого напоминаем в любом случае */
  maxAgeDays?: number;
}

export interface Reminder {
  kind: 'expired' | 'expiring' | 'transition' | 'age';
  text: string;
}

/** «15.06, 01.09» -> [{m:6,d:15},{m:9,d:1}]; ошибочные части пропускаются. */
export function parseTransitions(s: string): Transition[] {
  const out: Transition[] = [];
  for (const part of s.split(/[,;\s]+/)) {
    const m = /^(\d{1,2})\.(\d{1,2})\.?$/.exec(part.trim());
    if (!m) continue;
    const d = +m[1];
    const mo = +m[2];
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) out.push({ m: mo, d });
  }
  return out;
}

export function formatTransitions(t: Transition[]): string {
  return t.map((x) => `${String(x.d).padStart(2, '0')}.${String(x.m).padStart(2, '0')}`).join(', ');
}

const DAY_MS = 86400000;
const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const toInt = (d: Date) => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();

function plural(n: number, one: string, few: string, many: string): string {
  const a = n % 10;
  const b = n % 100;
  return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 10 || b >= 20) ? few : many;
}

/** Список напоминаний, самое важное — первым. Пусто, если всё в порядке. */
export function reminders(i: RemindInput): Reminder[] {
  const lead = i.leadDays ?? 7;
  const grace = i.graceDays ?? 90;
  const maxAge = i.maxAgeDays ?? 60;
  const today = startOf(i.today);
  const built = startOf(new Date(i.builtAt));
  const out: Reminder[] = [];
  const ends = i.feeds.map((f) => f.endDate).filter((x) => x > 0);
  const end = ends.length ? Math.max(...ends) : 0;
  const todayInt = toInt(today);
  if (end && end < todayInt) out.push({ kind: 'expired', text: `Срок расписания истёк ${fmtDateInt(end)}. Скачайте новое расписание.` });

  for (const t of i.transitions) {
    for (const y of [today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1]) {
      const T = new Date(y, t.m - 1, t.d);
      if (T.getMonth() !== t.m - 1) continue; // 31.02 и т.п.
      const diff = Math.round((T.getTime() - today.getTime()) / DAY_MS);
      if (built >= T) continue; // данные уже новее смены
      if (diff > lead || diff < -grace) continue;
      const when = fmtDateInt(toInt(T));
      out.push({
        kind: 'transition',
        text:
          diff > 0
            ? `Через ${diff} ${plural(diff, 'день', 'дня', 'дней')} (${when}) смена расписания. После смены скачайте новое расписание.`
            : diff === 0
              ? `Сегодня смена расписания (${when}). Скачайте новое расписание, когда оно появится.`
              : `Прошла смена расписания (${when}), а данные в приложении старше. Скачайте новое расписание.`,
      });
    }
  }

  if (end && end >= todayInt) {
    const endD = new Date(Math.floor(end / 10000), Math.floor((end % 10000) / 100) - 1, end % 100);
    const left = Math.round((endD.getTime() - today.getTime()) / DAY_MS);
    if (left <= 14) out.push({ kind: 'expiring', text: `Расписание действует до ${fmtDateInt(end)} (осталось ${left} ${plural(left, 'день', 'дня', 'дней')}). Скоро нужно новое.` });
  }

  const age = Math.round((today.getTime() - built.getTime()) / DAY_MS);
  if (age >= maxAge) out.push({ kind: 'age', text: `Данные скачаны ${age} ${plural(age, 'день', 'дня', 'дней')} назад. Проверьте, нет ли нового расписания.` });
  const order = { expired: 0, transition: 1, expiring: 2, age: 3 } as const;
  return out.sort((a, b) => order[a.kind] - order[b.kind]);
}
