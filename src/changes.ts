/**
 * Актуальные изменения в работе транспорта — https://bgprevoz.rs/linije/aktuelne-izmene
 * Разбор страницы без DOM (чтобы работало и в тестах): таблица «линии / название / тип / период / ссылка».
 */
export const CHANGES_URL = 'https://bgprevoz.rs/linije/aktuelne-izmene';
const HOST = 'bgprevoz.rs';

export interface Change {
  /** номер записи на сайте */
  id: string;
  /** подписи линий как на сайте: «15», «15Н», «7Л» */
  lines: string[];
  title: string;
  /** «Радови», «Привремено укинуто стајалиште» … */
  type: string;
  /** yyyymmdd */
  from: number;
  to: number;
  url: string;
  /** полный текст со страницы «Опширније»; пусто, если не скачан */
  detail: string;
  /** когда впервые увидели (ISO) */
  firstSeen: string;
}

/** Запись журнала: это объявление уже скачивали (даже если потом удалили) — при обновлении оно пропускается. */
export interface JournalEntry {
  id: string;
  title: string;
  /** когда скачано (ISO) */
  at: string;
  /** удалено пользователем */
  deleted: boolean;
}

export interface ChangesStore {
  fetchedAt: string;
  items: Change[];
  journal: JournalEntry[];
}

function decode(s: string): string {
  return s
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

/** HTML → текст; блочные теги и <br> дают переводы строк. */
function toText(html: string): string {
  return decode(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>|<\/(p|div|li|tr|h[1-6]|section|article|ul|ol|table)>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  );
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

const PERIOD = /(\d{2})\/(\d{2})\/(\d{4})\s*[-–]\s*(\d{2})\/(\d{2})\/(\d{4})/;

function absUrl(href: string): string {
  try {
    const u = new URL(decode(href), `https://${HOST}`);
    return u.hostname === HOST || u.hostname === `www.${HOST}` ? u.href : '';
  } catch {
    return '';
  }
}

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** Список изменений со страницы. Пустой список — вёрстка не распознана или изменений нет. */
export function parseChangesList(html: string): Change[] {
  const out: Change[] = [];
  const seen = new Set<string>();
  for (const row of html.match(/<tr[\s>][\s\S]*?<\/tr>/gi) ?? []) {
    const cells = row.match(/<td[\s>][\s\S]*?<\/td>/gi);
    if (!cells || cells.length < 4) continue;
    const p = PERIOD.exec(toText(cells[3]));
    if (!p) continue;
    const lines: string[] = [];
    for (const a of cells[0].matchAll(/<a\s[^>]*>([\s\S]*?)<\/a>/gi)) {
      const t = oneLine(toText(a[1]));
      if (t && !lines.includes(t)) lines.push(t);
    }
    const title = oneLine(toText(cells[1]));
    if (!title) continue;
    const link = /href=["']([^"']*aktuelne-izmene\/(\d+))["']/i.exec(row);
    const url = link ? absUrl(link[1]) : '';
    const id = link ? link[2] : `h${hash(title + p[0])}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      lines,
      title,
      type: oneLine(toText(cells[2])),
      from: +p[3] * 10000 + +p[2] * 100 + +p[1],
      to: +p[6] * 10000 + +p[5] * 100 + +p[4],
      url,
      detail: '',
      firstSeen: '',
    });
  }
  return out;
}

/** Текст со страницы «Опширније»: всё между периодом действия и блоком «Зона радова» / выбором линии. */
export function parseChangeDetail(html: string): string {
  const text = toText(html);
  const p = PERIOD.exec(text);
  if (!p) return '';
  let body = text.slice(p.index + p[0].length);
  const stops = ['Зона радова', 'Изабери линију', 'Секретаријат за јавни превоз\nГрадска', 'Линкови'];
  let cut = body.length;
  for (const m of stops) {
    const i = body.indexOf(m);
    if (i >= 0 && i < cut) cut = i;
  }
  body = body.slice(0, cut);
  // маркированные пункты, записанные в строку: «…следећи начин: - возила… ; - возила…»
  body = body.replace(/([:;.])[ \t]+- /g, '$1\n- ');
  const lines = body
    .split('\n')
    .map(oneLine)
    .filter(Boolean);
  return lines.join('\n').slice(0, 6000);
}

/** Сливает свежий список с сохранённым: сохраняет «впервые увидели» и уже скачанные тексты. */
export function mergeChanges(old: Change[], fresh: Change[], nowIso: string): Change[] {
  const prev = new Map(old.map((c) => [c.id, c]));
  return fresh.map((f) => {
    const p = prev.get(f.id);
    const same = !!p && p.title === f.title && p.from === f.from && p.to === f.to;
    return { ...f, firstSeen: p?.firstSeen || nowIso, detail: same ? p.detail : '' };
  });
}

export type ChangeStatus = 'active' | 'soon' | 'ended';

export function changeStatus(c: Change, todayInt: number): ChangeStatus {
  if (c.to && c.to < todayInt) return 'ended';
  if (c.from > todayInt) return 'soon';
  return 'active';
}
