import type { Route, StopsData } from './types.ts';
import { shortCompare } from './schedule.ts';

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

export interface StopHit {
  stop: number;
  score: number;
}
export interface RouteHit {
  route: number;
  score: number;
}

export class SearchIndex {
  private stops: StopsData;
  private routes: Route[];
  private stopNorm: string[];
  private stopCode: string[];
  private routeShort: string[];
  private routeLong: string[];

  constructor(stops: StopsData, routes: Route[]) {
    this.stops = stops;
    this.routes = routes;
    this.stopNorm = stops.name.map(normalize);
    this.stopCode = stops.code.map((c) => normalize(c));
    this.routeShort = routes.map((r) => normalize(r.short));
    this.routeLong = routes.map((r) => normalize(r.long));
  }

  searchStops(query: string, limit = 60): StopHit[] {
    const q = normalize(query);
    if (!q) return [];
    const tokens = q.split(' ');
    const hits: StopHit[] = [];
    for (let i = 0; i < this.stopNorm.length; i++) {
      const name = this.stopNorm[i];
      const code = this.stopCode[i];
      let total = 0;
      let ok = true;
      for (const t of tokens) {
        const s = scoreToken(name, t);
        const c = code && code.startsWith(t) ? 0 : 99;
        const best = Math.min(s, c);
        if (best >= 99) {
          ok = false;
          break;
        }
        total += best;
      }
      if (!ok) continue;
      if (name.startsWith(q)) total -= 2;
      if (name === q) total -= 2;
      hits.push({ stop: i, score: total });
    }
    const names = this.stops.name;
    const codes = this.stops.code;
    hits.sort(
      (a, b) =>
        a.score - b.score ||
        names[a.stop].length - names[b.stop].length ||
        names[a.stop].localeCompare(names[b.stop], 'sr') ||
        codes[a.stop].localeCompare(codes[b.stop], undefined, { numeric: true }),
    );
    return hits.slice(0, limit);
  }

  searchRoutes(query: string, limit = 40): RouteHit[] {
    const q = normalize(query);
    if (!q) return [];
    const tokens = q.split(' ');
    const hits: RouteHit[] = [];
    for (let i = 0; i < this.routes.length; i++) {
      const sh = this.routeShort[i];
      const lg = this.routeLong[i];
      let score = 0;
      if (sh === q) score = 0;
      else if (sh.startsWith(q.replace(/ /g, ''))) score = 1;
      else {
        let ok = true;
        let total = 0;
        for (const t of tokens) {
          const s = scoreToken(lg, t);
          if (s >= 99) {
            ok = false;
            break;
          }
          total += s;
        }
        if (!ok) continue;
        score = 3 + total;
      }
      hits.push({ route: i, score });
    }
    const routes = this.routes;
    hits.sort((a, b) => a.score - b.score || shortCompare(routes[a.route].short, routes[b.route].short));
    return hits.slice(0, limit);
  }
}

/** 0 — слово начинается с токена, 1 — начало первого слова, 2 — подстрока (токен ≥ 3 символов), 99 — нет */
function scoreToken(hay: string, t: string): number {
  if (hay.startsWith(t)) return 0;
  if (hay.includes(' ' + t)) return 1;
  if (t.length >= 3 && hay.includes(t)) return 2;
  return 99;
}
