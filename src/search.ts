import type { Line } from './types.ts';
import { routeCompare } from './schedule.ts';

const MAP: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', ђ: 'dj', е: 'e', ж: 'z', з: 'z', и: 'i', ј: 'j', к: 'k',
  л: 'l', љ: 'lj', м: 'm', н: 'n', њ: 'nj', о: 'o', п: 'p', р: 'r', с: 's', т: 't', ћ: 'c', у: 'u',
  ф: 'f', х: 'h', ц: 'c', ч: 'c', џ: 'dz', ш: 's',
  // русская раскладка
  ё: 'e', й: 'j', щ: 's', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'ju', я: 'ja',
  // латиница
  đ: 'dj',
};

/** Приводит кириллицу/латиницу с диакритикой к простой латинице для поиска. */
export function normalize(s: string): string {
  let out = '';
  for (const ch of s.toLowerCase()) out += MAP[ch] ?? ch;
  return out
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** 0 — слово начинается с токена, 1 — начало другого слова, 2 — подстрока (токен ≥ 3 символов), 99 — нет */
function scoreToken(hay: string, t: string): number {
  if (hay.startsWith(t)) return 0;
  if (hay.includes(' ' + t)) return 1;
  if (t.length >= 3 && hay.includes(t)) return 2;
  return 99;
}

/** Поиск линий по номеру и по названиям конечных. */
export class LineSearch {
  private lines: Line[];
  private shortN: string[];
  private hay: string[];

  constructor(lines: Line[]) {
    this.lines = lines;
    this.shortN = lines.map((l) => normalize(l.short).replace(/ /g, ''));
    this.hay = lines.map((l) => normalize([l.long, ...l.dirs.map((d) => `${d.from} ${d.to}`)].join(' ')));
  }

  /** Индексы линий, подходящих запросу, лучшие первыми. Пустой запрос — пустой результат. */
  search(query: string): number[] {
    const q = normalize(query);
    if (!q) return [];
    const compact = q.replace(/ /g, '');
    const tokens = q.split(' ');
    const hits: { i: number; score: number }[] = [];
    for (let i = 0; i < this.lines.length; i++) {
      const sh = this.shortN[i];
      let score: number;
      if (sh === compact) score = 0;
      else if (sh.startsWith(compact)) score = 1;
      else {
        let total = 0;
        let ok = true;
        for (const t of tokens) {
          const s = scoreToken(this.hay[i], t);
          if (s >= 99) {
            ok = false;
            break;
          }
          total += s;
        }
        if (!ok) continue;
        score = 3 + total;
      }
      hits.push({ i, score });
    }
    const L = this.lines;
    hits.sort((a, b) => a.score - b.score || routeCompare(L[a.i], L[b.i]));
    return hits.map((h) => h.i);
  }
}
