import { prefs } from '../prefs.ts';
import { fmtTime, patternDest, patternTimes, routeCompare, secondsNow, validityOn } from '../schedule.ts';
import { data, ensureRoutes, linesAtStop, routeData, stopIdx } from '../store.ts';
import { badge, dayKindBar, empty, fmtValidity, hourGrid, initialDate, isToday, lineBadges, pageHeader, starButton, validityBanner } from './common.ts';
import { clear, el, icon } from './dom.ts';
import { href } from './router.ts';
import type { Route as NavRoute } from './router.ts';

/**
 * Остановка: какие линии здесь проходят (без времён по промежуточным остановкам).
 * Если остановка — начальная для какого-то направления, показываем отправления отсюда.
 */
export async function stopView(root: HTMLElement, nav: NavRoute): Promise<() => void> {
  const id = nav.path[1] ?? '';
  const s = stopIdx(id);
  if (s === undefined) {
    root.append(pageHeader({ title: 'Остановка', back: true }), empty('Остановка не найдена', 'Возможно, после обновления данных она изменилась или была удалена.'));
    return () => {};
  }
  const c = data();
  const lines = linesAtStop(s);
  await ensureRoutes(lines);

  const routeObjs = lines.map((i) => c.routes[i]);
  root.appendChild(
    pageHeader({
      title: c.stops.name[s],
      subtitle: c.stops.code[s] ? `код ${c.stops.code[s]}` : undefined,
      back: true,
      actions: [starButton(prefs.isFavStop(id), () => prefs.toggleFavStop(id))],
    }),
  );
  const banner = validityBanner();
  if (banner) root.appendChild(el('div', { class: 'pad' }, banner));
  root.appendChild(el('div', { class: 'pad' }, routeObjs.length ? lineBadges(routeObjs, 14) : null));

  if (!lines.length) {
    root.appendChild(empty('Нет линий', 'На этой остановке нет рейсов в загруженных данных.'));
    return () => {};
  }

  // линии на остановке: «номер → конечная»
  const list = el('div', { class: 'list' });
  for (const r of lines) {
    const route = c.routes[r];
    const dests = new Set<string>();
    for (const p of routeData(r).patterns) if (p.stops.includes(s)) dests.add(patternDest((x) => c.stops.name[x], p));
    list.appendChild(
      el(
        'a',
        { class: 'row', href: href(['route', route.id]) },
        badge(route, 'lg'),
        el('div', { class: 'grow' }, el('div', { class: 'title' }, [...dests].map((d) => '→ ' + d).join('  ·  ')), el('div', { class: 'sub' }, route.long)),
        icon('chevron'),
      ),
    );
  }
  root.appendChild(el('section', { class: 'section' }, el('h3', null, 'Линии на остановке'), list));

  // отправления отсюда: варианты, у которых это начальная остановка
  const starts: { r: number; p: number }[] = [];
  for (const r of lines) routeData(r).patterns.forEach((p, pi) => { if (p.stops[0] === s) starts.push({ r, p: pi }); });
  if (starts.length) {
    starts.sort((a, b) => routeCompare(c.routes[a.r], c.routes[b.r]));
    const host = el('div');
    let { date } = initialDate();
    const draw = () => {
      clear(host);
      const now = isToday(date) ? secondsNow() : null;
      for (const st of starts) {
        const rd = routeData(st.r);
        const pat = rd.patterns[st.p];
        const times = patternTimes(c.services, pat, 0, date);
        const v = fmtValidity(validityOn(c.services, rd.patterns, date));
        host.appendChild(
          el(
            'section',
            { class: 'card' },
            el(
              'a',
              { class: 'card-head', href: href(['route', c.routes[st.r].id]) },
              badge(c.routes[st.r], 'lg'),
              el('div', { class: 'grow' }, el('div', { class: 'title' }, '→ ' + patternDest((x) => c.stops.name[x], pat)), el('div', { class: 'sub' }, times.length ? `${times.length} отправл. · ${fmtTime(times[0])}–${fmtTime(times[times.length - 1])}` : 'В этот день рейсов нет')),
              icon('chevron'),
            ),
            v ? el('div', { class: 'validity pad-x' }, v) : null,
            hourGrid(times, now),
          ),
        );
      }
    };
    root.appendChild(
      el('section', { class: 'section' }, el('h3', null, 'Отправление отсюда'), dayKindBar((_k, d) => { date = d; draw(); }), host),
    );
    draw();
  }
  return () => {};
}
