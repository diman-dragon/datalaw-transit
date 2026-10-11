import { prefs } from '../prefs.ts';
import { fmtTime, patternTimes, secondsNow } from '../schedule.ts';
import { data, ensureRoutes, hasData, linesAtStop, routeData, routeIdx, stopIdx } from '../store.ts';
import { badge, empty, lineBadges, pageHeader, starButton } from './common.ts';
import { el, icon } from './dom.ts';
import { href } from './router.ts';
import { noDataState } from './search-view.ts';

export async function favView(root: HTMLElement): Promise<() => void> {
  root.appendChild(pageHeader({ title: 'Избранное' }));
  if (!hasData()) {
    root.appendChild(noDataState());
    return () => {};
  }
  const c = data();
  const stops = prefs.favStops().map((id) => ({ id, idx: stopIdx(id) }));
  const routes = prefs.favRoutes().map((id) => ({ id, idx: routeIdx(id) }));

  if (!stops.length && !routes.length) {
    root.appendChild(empty('Пока пусто', 'Откройте остановку или линию и нажмите ★ — они появятся здесь.'));
    return () => {};
  }

  if (stops.length) {
    const list = el('div', { class: 'list' });
    root.appendChild(el('section', { class: 'section' }, el('h3', null, 'Остановки'), list));
    for (const s of stops) {
      if (s.idx === undefined) {
        list.appendChild(el('div', { class: 'row muted' }, `Остановка ${s.id} пропала из данных`, starButton(true, () => prefs.toggleFavStop(s.id))));
        continue;
      }
      const idx = s.idx;
      const lines = linesAtStop(idx).map((i) => c.routes[i]);
      list.appendChild(
        el(
          'div',
          { class: 'row fav-row' },
          el(
            'a',
            { class: 'grow link', href: href(['stop', s.id]) },
            el('div', { class: 'title' }, c.stops.name[idx]),
            el('div', { class: 'sub' }, c.stops.code[idx] ? `код ${c.stops.code[idx]}` : '', lines.length ? lineBadges(lines, 6) : null),
          ),
          starButton(true, () => prefs.toggleFavStop(s.id)),
        ),
      );
    }
  }

  if (routes.length) {
    const list = el('div', { class: 'list' });
    root.appendChild(el('section', { class: 'section' }, el('h3', null, 'Линии'), list));
    for (const r of routes) {
      if (r.idx === undefined) {
        list.appendChild(el('div', { class: 'row muted' }, `Линия ${r.id} пропала из данных`, starButton(true, () => prefs.toggleFavRoute(r.id))));
        continue;
      }
      const route = c.routes[r.idx];
      const nextBox = el('div', { class: 'next3' });
      void ensureRoutes([r.idx])
        .then(() => {
          const rd = routeData(r.idx!);
          const now = secondsNow();
          const dirs = [...new Set(rd.patterns.map((p) => p.dir))].sort();
          for (const d of dirs) {
            let best = -1;
            rd.patterns.forEach((p, i) => {
              if (p.dir === d && (best < 0 || p.trips > rd.patterns[best].trips)) best = i;
            });
            const p = rd.patterns[best];
            const times = patternTimes(c.services, p, 0, new Date());
            const nx = times.find((t) => t >= now);
            nextBox.appendChild(
              el('div', { class: 'next-item' }, el('small', null, `от ${c.stops.name[p.stops[0]]}`), el('b', null, nx === undefined ? 'сегодня больше нет' : fmtTime(nx))),
            );
          }
        })
        .catch(() => {});
      list.appendChild(
        el(
          'div',
          { class: 'row' },
          el('a', { class: 'grow link row-inner', href: href(['route', r.id]) }, badge(route, 'lg'), el('div', { class: 'grow' }, el('div', { class: 'title' }, route.long || route.short), nextBox), icon('chevron')),
          starButton(true, () => prefs.toggleFavRoute(r.id)),
        ),
      );
    }
  }
  return () => {};
}
