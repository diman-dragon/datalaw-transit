import { buildNameGroups, enrich, findDirect, sortResults } from '../finder.ts';
import type { StopGroup } from '../finder.ts';
import { fmtTime, patternDest, patternLabel, routeCompare, routesAtStop, secondsNow } from '../schedule.ts';
import { data, ensureRoutes, hasData, routeData, searchIndex } from '../store.ts';
import { badge, dayControls, empty, isToday, lineBadges, pageHeader, startOfDay } from './common.ts';
import { clear, el, icon } from './dom.ts';
import { href } from './router.ts';
import { noDataState } from './search-view.ts';

let groupsCache: { key: object; map: Map<string, number[]> } | null = null;
let A: StopGroup | null = null;
let B: StopGroup | null = null;
let date = startOfDay();

function nameGroups(): Map<string, number[]> {
  const c = data();
  if (!groupsCache || groupsCache.key !== c.stops) groupsCache = { key: c.stops, map: buildNameGroups(c.stops) };
  return groupsCache.map;
}

function linesOfGroup(g: StopGroup): number[] {
  const c = data();
  const set = new Set<number>();
  for (const s of g.stops) for (const r of routesAtStop(c.stopIndex, s)) set.add(r);
  return [...set].sort((a, b) => routeCompare(c.routes[a], c.routes[b]));
}

function suggestions(query: string): StopGroup[] {
  const groups = nameGroups();
  const c = data();
  const out: StopGroup[] = [];
  const seen = new Set<string>();
  for (const h of searchIndex().searchStops(query, 120)) {
    const name = c.stops.name[h.stop];
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ name, stops: groups.get(name) ?? [h.stop] });
    if (out.length >= 8) break;
  }
  return out;
}

function picker(label: string, get: () => StopGroup | null, set: (g: StopGroup | null) => void, onChange: () => void): { el: HTMLElement; refresh: () => void } {
  const c = data();
  const input = el('input', {
    type: 'search',
    class: 'search-input',
    placeholder: label,
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    'aria-label': label,
  });
  const list = el('div', { class: 'suggest hidden' });
  const refresh = () => {
    input.value = get()?.name ?? '';
  };
  const hide = () => list.classList.add('hidden');
  const show = () => {
    clear(list);
    const q = input.value.trim();
    if (!q || q === get()?.name) return hide();
    const items = suggestions(q);
    if (!items.length) {
      list.appendChild(el('div', { class: 'muted pad' }, 'Остановка не найдена'));
    }
    for (const g of items) {
      const lines = linesOfGroup(g).map((i) => c.routes[i]);
      list.appendChild(
        el(
          'button',
          {
            class: 'suggest-item',
            onmousedown: (e: Event) => e.preventDefault(),
            onclick: () => {
              set(g);
              refresh();
              hide();
              input.blur();
              onChange();
            },
          },
          el('div', { class: 'grow' }, el('div', { class: 'title' }, g.name), el('div', { class: 'sub' }, g.stops.length > 1 ? `${g.stops.length} платформ` : '', lines.length ? lineBadges(lines, 7) : null)),
        ),
      );
    }
    list.classList.remove('hidden');
  };
  input.addEventListener('input', () => {
    if (get() && input.value !== get()!.name) {
      set(null);
      onChange();
    }
    show();
  });
  input.addEventListener('focus', () => {
    input.select();
    show();
  });
  input.addEventListener('blur', () => window.setTimeout(hide, 120));
  refresh();
  return { el: el('div', { class: 'picker' }, el('div', { class: 'searchbar flat' }, icon('search'), input), list), refresh };
}

export async function betweenView(root: HTMLElement): Promise<() => void> {
  root.appendChild(pageHeader({ title: 'Из А в Б', subtitle: 'Линии без пересадок между остановками' }));
  if (!hasData()) {
    root.appendChild(noDataState());
    return () => {};
  }
  const results = el('div', { class: 'results' });
  let token = 0;

  const run = async () => {
    const my = ++token;
    clear(results);
    if (!A || !B) {
      results.appendChild(
        empty('Выберите две остановки', 'Например, «Матице српске» и «Блок 23». Покажу линии, которые едут напрямую, время в пути и маршрут на карте.'),
      );
      return;
    }
    if (A.name === B.name) {
      results.appendChild(empty('Это одна и та же остановка', 'Выберите разные остановки.'));
      return;
    }
    const c = data();
    try {
      await ensureRoutes(linesOfGroup(A));
    } catch (e) {
      results.appendChild(empty('Не удалось загрузить расписание', e instanceof Error ? e.message : String(e)));
      return;
    }
    if (my !== token) return;
    const direct = findDirect(A.stops, B.stops, c.stopIndex, routeData);
    const today = isToday(date);
    const list = sortResults(enrich(direct, routeData, c.services, date, today ? secondsNow() : null), c.routes);
    if (!list.length) {
      results.appendChild(
        empty(
          'Прямых линий нет',
          'Между этими остановками нет линии без пересадок в этом направлении. Проверьте обратное направление (кнопка ⇄). Маршруты с пересадками — в планах.',
        ),
      );
      return;
    }
    results.appendChild(el('div', { class: 'meta-line' }, `Найдено линий: ${list.length}. Сверху — те, что прибудут раньше.`));
    const box = el('div', { class: 'list' });
    for (const x of list) {
      const r = c.routes[x.route];
      const p = routeData(x.route).patterns[x.pattern];
      const mins = Math.max(1, Math.round(x.rideSec / 60));
      box.appendChild(
        el(
          'a',
          { class: 'row result', href: href(['route', r.id], { t: 'map', p: String(x.pattern), i: String(x.from), j: String(x.to) }) },
          badge(r, 'lg'),
          el(
            'div',
            { class: 'grow' },
            el('div', { class: 'title' }, '→ ' + patternDest((s) => c.stops.name[s], p)),
            el('div', { class: 'sub' }, patternLabel((s) => c.stops.name[s], p)),
            el('div', { class: 'sub' }, `${x.stopsBetween} ост. · ~${mins} мин в пути`),
            el(
              'div',
              { class: 'next3' },
              x.next.length
                ? el('span', { class: 'next-item' }, 'отпр.', ...x.next.map((t) => el('b', null, fmtTime(t))), x.arrive !== null ? el('small', null, `→ приб. ${fmtTime(x.arrive)}`) : null)
                : el('span', { class: 'muted' }, today ? 'сегодня рейсов больше нет' : 'в этот день рейсов нет'),
            ),
          ),
          el('span', { class: 'map-hint' }, icon('route')),
        ),
      );
    }
    results.appendChild(box);
  };

  const pa = picker('Откуда (остановка)', () => A, (g) => (A = g), () => void run());
  const pb = picker('Куда (остановка)', () => B, (g) => (B = g), () => void run());
  const swap = el(
    'button',
    {
      class: 'icon-btn swap',
      'aria-label': 'Поменять местами',
      onclick: () => {
        [A, B] = [B, A];
        pa.refresh();
        pb.refresh();
        void run();
      },
    },
    icon('swap'),
  );
  root.append(
    el('div', { class: 'between' }, el('div', { class: 'grow' }, pa.el, pb.el), swap),
    el('div', { class: 'controls' }, dayControls(date, (d) => {
      date = d;
      void run();
    })),
    results,
  );
  await run();
  return () => {
    token++;
  };
}
