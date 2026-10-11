import { prefs } from '../prefs.ts';
import { fmtTime, patternLabel, patternTimes, secondsNow, validityOn } from '../schedule.ts';
import { data, ensureRoutes, routeData, routeIdx } from '../store.ts';
import type { Pattern } from '../types.ts';
import {
  badge,
  dayKindBar,
  empty,
  fmtValidity,
  hourGrid,
  initialDate,
  isToday,
  KIND_LABEL,
  pageHeader,
  segmented,
  starButton,
  validityBanner,
} from './common.ts';
import { clear, el } from './dom.ts';
import { href } from './router.ts';
import type { Route as NavRoute } from './router.ts';

type Tab = 'times' | 'stops';

export async function routeView(root: HTMLElement, nav: NavRoute): Promise<() => void> {
  const id = nav.path[1] ?? '';
  const ri = routeIdx(id);
  if (ri === undefined) {
    root.append(pageHeader({ title: 'Линия', back: true }), empty('Линия не найдена', 'Возможно, после обновления данных она изменилась или была удалена.'));
    return () => {};
  }
  const c = data();
  const route = c.routes[ri];
  await ensureRoutes([ri]);
  const rd = routeData(ri);
  const pats = rd.patterns;
  if (!pats.length) {
    root.append(pageHeader({ title: route.short, back: true }), empty('Нет рейсов', 'У этой линии нет рейсов в загруженных данных.'));
    return () => {};
  }

  // основной вариант каждого направления — с наибольшим числом рейсов
  const dirs = [...new Set(pats.map((p) => p.dir))].sort();
  const mainOf = (dir: number): number => {
    let best = -1;
    pats.forEach((p, i) => {
      if (p.dir === dir && (best < 0 || p.trips > pats[best].trips)) best = i;
    });
    return best;
  };

  let pi = mainOf(dirs[0]);
  let tab: Tab = nav.query.get('t') === 'stops' ? 'stops' : 'times';
  let { kind, date } = initialDate();
  const stopName = (p: Pattern, i: number) => c.stops.name[p.stops[i]];

  const feedName = c.meta.feeds[route.feed]?.name ?? '';
  root.appendChild(
    pageHeader({
      title: el('span', { class: 'route-title' }, badge(route, 'lg'), el('span', null, route.long || route.short)),
      subtitle: `${KIND_LABEL[route.kind]}${feedName ? ' · ' + feedName : ''}`,
      back: true,
      actions: [starButton(prefs.isFavRoute(id), () => prefs.toggleFavRoute(id))],
    }),
  );
  const banner = validityBanner();
  if (banner) root.appendChild(el('div', { class: 'pad' }, banner));

  const dirHost = el('div', { class: 'pad dirhost' });
  const tabsHost = el('div', { class: 'pad' });
  const content = el('div', { class: 'content' });
  root.append(dirHost, tabsHost, content);

  const renderDirs = () => {
    clear(dirHost);
    const nameOf = (st: number) => c.stops.name[st];
    if (dirs.length > 1) {
      const list = el('div', { class: 'dirlist' });
      for (const d of dirs) {
        const main = mainOf(d);
        list.appendChild(
          el(
            'button',
            {
              class: 'dirbtn' + (pats[pi].dir === d ? ' active' : ''),
              onclick: () => {
                pi = main;
                renderDirs();
                renderContent();
              },
            },
            el('span', { class: 'dirarrow' }, '→'),
            el('span', { class: 'grow' }, patternLabel(nameOf, pats[main])),
          ),
        );
      }
      dirHost.appendChild(list);
    } else {
      dirHost.appendChild(el('div', { class: 'dirtitle' }, patternLabel(nameOf, pats[pi])));
    }
    const variants = pats.map((p, i) => ({ p, i })).filter((x) => x.p.dir === pats[pi].dir);
    if (variants.length > 1) {
      const sel = el('select', { class: 'select', 'aria-label': 'Вариант маршрута' });
      for (const { p, i } of variants) {
        const o = el('option', { value: String(i) }, `${stopName(p, 0)} → ${stopName(p, p.stops.length - 1)} · ${p.trips} рейс.`);
        if (i === pi) o.selected = true;
        sel.appendChild(o);
      }
      sel.addEventListener('change', () => {
        pi = Number(sel.value);
        renderContent();
      });
      dirHost.appendChild(el('label', { class: 'field' }, el('span', null, 'Вариант'), sel));
    }
  };

  tabsHost.appendChild(
    segmented<Tab>(
      [
        { value: 'times', label: 'Расписание' },
        { value: 'stops', label: 'Остановки' },
      ],
      tab,
      (t) => {
        tab = t;
        renderContent();
      },
    ),
  );

  const renderContent = () => {
    clear(content);
    if (tab === 'stops') renderStops();
    else renderTimes();
  };

  const renderStops = () => {
    const pat = pats[pi];
    const list = el('div', { class: 'timeline' });
    pat.stops.forEach((s, i) => {
      const last = i === pat.stops.length - 1;
      list.appendChild(
        el(
          'a',
          { class: 'tl-row' + (i === 0 ? ' first' : '') + (last ? ' last' : ''), href: href(['stop', c.stops.id[s]]) },
          el('span', { class: 'tl-dot' }),
          el('div', { class: 'grow' }, el('div', { class: 'title' }, c.stops.name[s]), c.stops.code[s] ? el('div', { class: 'sub' }, `код ${c.stops.code[s]}`) : null),
        ),
      );
    });
    content.append(el('div', { class: 'meta-line' }, `${pat.stops.length} остановок`), list);
  };

  const renderTimes = () => {
    const pat = pats[pi];
    const grid = el('div');
    const draw = () => {
      clear(grid);
      const times = patternTimes(c.services, pat, 0, date);
      const v = fmtValidity(validityOn(c.services, pats, date));
      const summary = times.length ? `${times.length} отправл. · первое ${fmtTime(times[0])} · последнее ${fmtTime(times[times.length - 1])}` : 'В этот день рейсов нет';
      grid.append(el('div', { class: 'start-stop' }, el('small', null, 'Отправление от конечной'), el('b', null, stopName(pat, 0))));
      if (v) grid.append(el('div', { class: 'validity' }, v));
      grid.append(el('div', { class: 'meta-line' }, summary), hourGrid(times, isToday(date) ? secondsNow() : null));
    };
    content.append(
      dayKindBar((k, d) => {
        kind = k;
        date = d;
        draw();
      }, kind),
      grid,
    );
    draw();
  };

  renderDirs();
  renderContent();
  return () => {};
}
