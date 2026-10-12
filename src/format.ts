/** Мелкие функции форматирования. Без DOM — чтобы их можно было тестировать. */

export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 10;
  const b = Math.abs(n) % 100;
  return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 10 || b >= 20) ? few : many;
}

/** Минуты от полуночи -> «ЧЧ:ММ». Значения ≥ 1440 (после полуночи) показываются как 00:15 и т.д. */
export function fmtMin(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h < 10 ? '0' : ''}${h}:${mm < 10 ? '0' : ''}${mm}`;
}

/** «сейчас», «через 12 мин», «через 1 ч 05 мин». */
export function waitText(min: number): string {
  if (min <= 0) return 'сейчас';
  if (min < 60) return `через ${min} мин`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `через ${h} ч ${m < 10 ? '0' : ''}${m} мин` : `через ${h} ч`;
}

export function dateToInt(d: Date): number {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

/** yyyymmdd -> «дд.мм.гггг» (0 -> «—») */
export function fmtDateInt(n: number): string {
  if (!n) return '—';
  const s = String(n);
  return `${s.slice(6, 8)}.${s.slice(4, 6)}.${s.slice(0, 4)}`;
}

/** «2025-03-17» (допускается хвост со временем) -> 20250317; неверная или несуществующая дата -> 0 */
export function parseIsoDate(s: unknown): number {
  if (typeof s !== 'string') return 0;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s.trim());
  if (!m) return 0;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  const t = new Date(y, mo - 1, d);
  if (t.getFullYear() !== y || t.getMonth() !== mo - 1 || t.getDate() !== d) return 0;
  return y * 10000 + mo * 100 + d;
}

/** Срок действия для подписи: «действует с …», «действует до …», «… – …». Пусто, если ничего не известно. */
export function validityText(from: number, to: number): string {
  if (from && to) return `${fmtDateInt(from)} – ${fmtDateInt(to)}`;
  if (from) return `действует с ${fmtDateInt(from)}`;
  if (to) return `действует до ${fmtDateInt(to)}`;
  return '';
}

/** Полная подпись срока: «Действует с … по …». Пусто, если ничего не известно. */
export function validityFull(from: number, to: number): string {
  if (from && to) return `Действует с ${fmtDateInt(from)} по ${fmtDateInt(to)}`;
  if (from) return `Действует с ${fmtDateInt(from)}`;
  if (to) return `Действует до ${fmtDateInt(to)}`;
  return '';
}

/**
 * Названия остановок на gsp.rs пишутся ЗАГЛАВНЫМИ — для чтения приводим к «Заглавная первая буква».
 * Если в названии уже есть строчные буквы, оставляем как есть.
 */
export function pretty(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (!t) return t;
  if (t !== t.toUpperCase() || t === t.toLowerCase()) return t;
  return t.toLowerCase().replace(/(^|[\s/(\-.])(\p{L})/gu, (_m, p: string, c: string) => p + c.toUpperCase());
}

/** Ключ месяца «2026-10» — для ежемесячного напоминания. */
export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function fmtSize(bytes: number): string {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1).replace('.', ',')} МБ`;
  return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
}
