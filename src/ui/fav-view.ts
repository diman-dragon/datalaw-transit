import { arrivalProvider } from '../planned/arrivals.ts';
import { prefs } from '../prefs.ts';
import { fmtTime, secondsNow } from '../schedule.ts';
import { data, hasData, linesAtStop, routeIdx, stopIdx } from '../store.ts';
import { badge, empty, fmtRelative, lineBadges, pageHeader, starButton } from './common.ts';
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
    root.appendChild(empty('Пока пусто', 'Откройте остановку или линию и нажмите ★ — они появятся здесь, с ближайшими отправлениями.'));
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
      const nextBox = el('div', { class: 'next3' }, el('span', { class: 'muted' }, 'загрузка…'));
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
            nextBox,
          ),
          starButton(true, () => prefs.toggleFavStop(s.id)),
        ),
      );
      void arrivalProvider()
        .arrivals(idx, new Date())
        .then((arr) => {
          const now = secondsNow();
          const upcoming = arr.filter((a) => a.expected >= now - 30).slice(0, 3);
          nextBox.replaceChildren();
          if (!upcoming.length) nextBox.appendChild(el('span', { class: 'muted' }, 'Сегодня отправлений больше нет'));
          for (const a of upcoming)
            nextBox.appendChild(
              el('span', { class: 'next-item' }, badge(c.routes[a.route]), el('b', null, fmtTime(a.expected)), el('small', null, fmtRelative(Math.max(0, a.expected - now)))),
            );
        })
        .catch(() => nextBox.replaceChildren(el('span', { class: 'muted' }, 'нет данных')));
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
      list.appendChild(
        el(
          'div',
          { class: 'row' },
          el('a', { class: 'grow link row-inner', href: href(['route', r.id]) }, badge(route, 'lg'), el('div', { class: 'grow' }, el('div', { class: 'title' }, route.long || route.short)), icon('chevron')),
          starButton(true, () => prefs.toggleFavRoute(r.id)),
        ),
      );
    }
  }
  return () => {};
}
