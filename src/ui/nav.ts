import { closeTopModal } from './overlay.ts';

export interface Loc {
  path: string[];
  query: URLSearchParams;
}

export type TabId = 'fav' | 'lines' | 'changes' | 'settings';

export function parseHash(hash = location.hash): Loc {
  const raw = hash.replace(/^#\/?/, '');
  const [p, q = ''] = raw.split('?');
  return { path: p.split('/').filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(q) };
}

export function href(path: string[], query?: Record<string, string | undefined>): string {
  let s = '#/' + path.map(encodeURIComponent).join('/');
  if (query) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') q.set(k, v);
    const qs = q.toString();
    if (qs) s += '?' + qs;
  }
  return s;
}

/** Сколько записей истории мы сами добавили поверх корневой (открытые линии). */
let depth = 0;

/** Открыть экран «вглубь» (линия): добавляет запись в историю, системная «назад» вернёт обратно. */
export function open(path: string[], query?: Record<string, string | undefined>): void {
  depth++;
  location.hash = href(path, query);
}

/** Переключить вкладку: без новой записи в историю. */
export function openTab(id: TabId): void {
  const h = href([id]);
  if (location.hash === h) return;
  location.replace(h);
}

/** Начальный экран — всегда «Избранное». */
export function resetToFav(): void {
  depth = 0;
  history.replaceState(null, '', href(['fav']));
}

/**
 * Системная кнопка «назад»: закрывает окно → возвращает на шаг назад → с вкладок «Линии» / «Настройки» ведёт в «Избранное».
 * В «Избранном» ничего не делает — приложение остаётся на месте.
 */
export function handleBack(): void {
  if (closeTopModal()) return;
  const name = parseHash().path[0] ?? 'fav';
  if (name === 'fav') return;
  if (depth > 0) {
    depth--;
    history.back();
    return;
  }
  openTab('fav');
}

/** Ссылка, открывающая линию через open() (а не обычный переход). */
export function routeLink(id: string, dir: number, cls: string, ...children: (Node | string | null)[]): HTMLAnchorElement {
  const a = document.createElement('a');
  a.className = cls;
  a.href = href(['route', id], dir ? { d: String(dir) } : undefined);
  a.addEventListener('click', (e) => {
    e.preventDefault();
    open(['route', id], dir ? { d: String(dir) } : undefined);
  });
  for (const c of children) if (c) a.append(c);
  return a;
}
