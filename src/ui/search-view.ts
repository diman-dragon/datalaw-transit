import { prefs } from '../prefs.ts';
import { routeCompare } from '../schedule.ts';
import { data, hasData, linesAtStop, searchIndex } from '../store.ts';
import type { RouteKind } from '../types.ts';
import { badge, empty, KIND_LABEL_PLURAL, lineBadges, pageHeader } from './common.ts';
import { clear, el, icon } from './dom.ts';
import { go, href } from './router.ts';

let lastQuery = '';
let lastKind: RouteKind | 'all' = 'all';

export function dataSubtitle(): string {
  if (!hasData()) return 'Данных пока нет';
  const m = data().meta;
  return `${m.routes} линий · ${m.stops} остановок`;
}

export function noDataState(): HTMLElement {
  return empty(
    'Расписания пока нет',
    'Скачайте данные один раз — дальше приложение работает без интернета. Скачивание только по вашей кнопке.',
    el('button', { class: 'btn primary', onclick: () => go(['settings']) }, icon('download'), 'Открыть настройки'),
  );
}

export function searchView(root: HTMLElement): () => void {
  root.appendChild(pageHeader({ title: 'DataLaw Transit', subtitle: dataSubtitle() }));
  if (!hasData()) {
    root.appendChild(noDataState());
    return () => {};
  }

  const input = el('input', {
    type: 'search',
    class: 'search-input',
    placeholder: 'Линия или остановка…',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    enterkeyhint: 'search',
    'aria-label': 'Поиск',
  });
  input.value = lastQuery;
  const clearBtn = el('button', { class: 'icon-btn clear', 'aria-label': 'Очистить' }, icon('close'));
  const bar = el('div', { class: 'searchbar' }, icon('search'), input, clearBtn);
  const results = el('div', { class: 'results' });
  root.append(bar, results);

  let timer = 0;
  const run = () => {
    lastQuery = input.value;
    clearBtn.style.visibility = input.value ? 'visible' : 'hidden';
    clear(results);
    if (input.value.trim()) renderResults(results, input.value);
    else renderIdle(results, (q) => {
      input.value = q;
      run();
    });
  };
  input.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(run, 120);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      input.blur();
      prefs.pushRecent(input.value);
    }
  });
  clearBtn.addEventListener('click', () => {
    input.value = '';
    run();
    input.focus();
  });
  run();
  return () => window.clearTimeout(timer);
}

function renderIdle(host: HTMLElement, setQuery: (q: string) => void): void {
  const c = data();
  const recents = prefs.recents();
  if (recents.length) {
    host.appendChild(
      el(
        'section',
        { class: 'section' },
        el(
          'div',
          { class: 'section-head' },
          el('h3', null, 'Недавние запросы'),
          el(
            'button',
            {
              class: 'link-btn',
              onclick: () => {
                prefs.clearRecents();
                renderAgain();
              },
            },
            'Очистить',
          ),
        ),
        el('div', { class: 'chips' }, ...recents.map((q) => el('button', { class: 'chip', onclick: () => setQuery(q) }, q))),
      ),
    );
  }

  const kinds = (['all', 'tram', 'trolley', 'bus', 'rail'] as const).filter(
    (k) => k === 'all' || c.routes.some((r) => r.kind === k),
  );
  const list = el('div', { class: 'routegrid' });
  const filters = el(
    'div',
    { class: 'chips scroll' },
    ...kinds.map((k) => {
      const b = el('button', { class: 'chip' + (lastKind === k ? ' active' : '') }, k === 'all' ? 'Все линии' : KIND_LABEL_PLURAL[k]);
      b.addEventListener('click', () => {
        lastKind = k;
        filters.querySelectorAll('.chip').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        fill();
      });
      return b;
    }),
  );
  const fill = () => {
    clear(list);
    const idxs = c.routes.map((_, i) => i).filter((i) => lastKind === 'all' || c.routes[i].kind === lastKind);
    idxs.sort((a, b) => routeCompare(c.routes[a], c.routes[b]));
    let lastGroup = '';
    for (const i of idxs) {
      const r = c.routes[i];
      if (lastKind === 'all' && r.kind !== lastGroup) {
        lastGroup = r.kind;
        list.appendChild(el('h4', { class: 'group-title' }, KIND_LABEL_PLURAL[r.kind]));
      }
      list.appendChild(el('a', { href: href(['route', r.id]), class: 'gridbadge', title: r.long }, badge(r, 'lg')));
    }
  };
  const renderAgain = () => {
    const root = host.parentElement;
    if (!root) return;
    clear(host);
    renderIdle(host, setQuery);
  };
  host.append(el('section', { class: 'section' }, el('h3', null, 'Все линии'), filters, list));
  fill();
}

function renderResults(host: HTMLElement, q: string): void {
  const c = data();
  const idx = searchIndex();
  const routes = idx.searchRoutes(q);
  const stops = idx.searchStops(q);
  if (!routes.length && !stops.length) {
    host.appendChild(empty('Ничего не найдено', 'Попробуйте номер линии, часть названия или код остановки. Кириллица и латиница работают одинаково.'));
    return;
  }
  if (routes.length) {
    host.appendChild(
      el(
        'section',
        { class: 'section' },
        el('h3', null, 'Линии'),
        el(
          'div',
          { class: 'list' },
          ...routes.map((h) => {
            const r = c.routes[h.route];
            return el(
              'a',
              { class: 'row', href: href(['route', r.id]), onclick: () => prefs.pushRecent(q) },
              badge(r, 'lg'),
              el('div', { class: 'grow' }, el('div', { class: 'title' }, r.long || r.short)),
              icon('chevron'),
            );
          }),
        ),
      ),
    );
  }
  if (stops.length) {
    host.appendChild(
      el(
        'section',
        { class: 'section' },
        el('h3', null, 'Остановки'),
        el(
          'div',
          { class: 'list' },
          ...stops.map((h) => {
            const id = c.stops.id[h.stop];
            const lines = linesAtStop(h.stop).map((i) => c.routes[i]);
            return el(
              'a',
              { class: 'row', href: href(['stop', id]), onclick: () => prefs.pushRecent(q) },
              el(
                'div',
                { class: 'grow' },
                el('div', { class: 'title' }, c.stops.name[h.stop]),
                el('div', { class: 'sub' }, c.stops.code[h.stop] ? `код ${c.stops.code[h.stop]}` : '', lines.length ? lineBadges(lines) : null),
              ),
              icon('chevron'),
            );
          }),
        ),
      ),
    );
  }
}
