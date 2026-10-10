export interface Route {
  path: string[];
  query: URLSearchParams;
}

export type View = (root: HTMLElement, r: Route) => void | Promise<void> | (() => void) | Promise<() => void>;

export function parseHash(hash = location.hash): Route {
  const raw = hash.replace(/^#\/?/, '');
  const [p, q = ''] = raw.split('?');
  return {
    path: p.split('/').filter(Boolean).map(decodeURIComponent),
    query: new URLSearchParams(q),
  };
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

export function go(path: string[], query?: Record<string, string | undefined>): void {
  location.hash = href(path, query);
}

/** Заменить текущий адрес без добавления записи в историю (для смены вкладок внутри экрана). */
export function replaceQuery(path: string[], query: Record<string, string | undefined>): void {
  history.replaceState(null, '', href(path, query));
}

export function back(fallback: string[] = []): void {
  if (history.length > 1) history.back();
  else go(fallback);
}
