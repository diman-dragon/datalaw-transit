import { arrivalProvider, etaFromNow } from '../planned/arrivals.ts';
import type { Arrival } from '../planned/arrivals.ts';
import { prefs } from '../prefs.ts';
import { departuresAt, fmtTime, groupDepartures, routeCompare, secondsNow } from '../schedule.ts';
import { ctx, data, ensureRoutes, linesAtStop, routeIdx, stopIdx } from '../store.ts';
import {
  badge,
  dayControls,
  empty,
  fmtRelative,
  hourGrid,
  isToday,
  lineBadges,
  pageHeader,
  segmented,
  startOfDay,
  starButton,
} from './common.ts';
import { clear, el, icon } from './dom.ts';
import { href, replaceQuery } from './router.ts';
import type { Route as NavRoute } from './router.ts';
import { addDays } from '../schedule.ts';

type Tab = 'next' | 'lines';

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

  let date = startOfDay();
  let tab: Tab = nav.query.get('t') === 'lines' ? 'lines' : 'next';
  let filter: number | undefined = nav.query.get('r') ? routeIdx(nav.query.get('r')!) : undefined;
  let timer = 0;
  const body = el('div', { class: 'body' });

  const routeObjs = lines.map((i) => c.routes[i]);
  root.appendChild(
    pageHeader({
      title: c.stops.name[s],
      subtitle: c.stops.code[s] ? `код ${c.stops.code[s]}` : undefined,
      back: true,
      actions: [starButton(prefs.isFavStop(id), () => prefs.toggleFavStop(id))],
    }),
  );
  root.appendChild(el('div', { class: 'pad' }, routeObjs.length ? lineBadges(routeObjs, 14) : null));
  root.appendChild(body);

  const mount = () => {
    clear(body);
    if (filter !== undefined) {
      const r = c.routes[filter];
      body.appendChild(
        el(
          'div',
          { class: 'filterbar' },
          el('span', null, 'Только линия'),
          badge(r),
          el(
            'button',
            {
              class: 'icon-btn small',
              'aria-label': 'Показать все линии',
              onclick: () => {
                filter = undefined;
                replaceQuery(['stop', id], { t: tab === 'lines' ? 'lines' : undefined });
                mount();
              },
            },
            icon('close'),
          ),
        ),
      );
    }
    body.appendChild(
      el(
        'div',
        { class: 'controls' },
        dayControls(date, (d) => {
          date = d;
          renderContent();
        }),
        segmented<Tab>(
          [
            { value: 'next', label: 'Ближайшие' },
            { value: 'lines', label: 'По линиям' },
          ],
          tab,
          (t) => {
            tab = t;
            renderContent();
          },
        ),
      ),
    );
    body.appendChild(content);
    renderContent();
  };

  const content = el('div', { class: 'content' });
  let renderToken = 0;
  const renderContent = () => {
    const token = ++renderToken;
    if (tab === 'next') void renderNext(token);
    else renderLines();
  };

  const renderNext = async (token: number) => {
    const provider = arrivalProvider();
    let list: Arrival[];
    try {
      list = await provider.arrivals(s, date);
    } catch (e) {
      clear(content);
      content.appendChild(empty('Не удалось загрузить расписание', e instanceof Error ? e.message : String(e)));
      return;
    }
    if (token !== renderToken) return;
    if (filter !== undefined) list = list.filter((a) => a.route === filter);
    const today = isToday(date);
    const now = secondsNow();
    let shown = list;
    if (today) shown = list.filter((a) => a.expected >= now - 30);
    const total = shown.length;
    shown = shown.slice(0, 40);
    clear(content);
    if (!shown.length) {
      content.appendChild(
        empty(
          today ? 'На сегодня отправлений больше нет' : 'В этот день отправлений нет',
          today ? 'Посмотрите расписание на завтра.' : 'Проверьте другую дату — в праздники и выходные расписание отличается.',
          today
            ? el(
                'button',
                {
                  class: 'btn',
                  onclick: () => {
                    date = addDays(startOfDay(), 1);
                    mount();
                  },
                },
                'Показать завтра',
              )
            : undefined,
        ),
      );
      return;
    }
    content.appendChild(
      el(
        'div',
        { class: 'source-note' },
        icon('clock'),
        provider.realtime ? 'В реальном времени' : 'По расписанию (без учёта пробок и задержек)',
      ),
    );
    const listEl = el('div', { class: 'list' });
    for (const a of shown) {
      const r = c.routes[a.route];
      const eta = etaFromNow(a, date);
      listEl.appendChild(
        el(
          'a',
          { class: 'row dep', href: href(['route', r.id]) },
          el('div', { class: 'time' }, fmtTime(a.expected)),
          badge(r, 'lg'),
          el('div', { class: 'grow' }, el('div', { class: 'title' }, '→ ' + a.head), el('div', { class: 'sub' }, a.label)),
          eta !== null ? el('div', { class: 'eta' + (eta < 300 ? ' soon' : '') }, fmtRelative(Math.max(0, eta))) : null,
        ),
      );
    }
    content.appendChild(listEl);
    if (total > shown.length)
      content.appendChild(el('div', { class: 'muted pad center' }, `Показаны ближайшие ${shown.length} из ${total}. Полный список — на вкладке «По линиям».`));
  };

  const renderLines = () => {
    clear(content);
    const deps = departuresAt(ctx(), s, date, filter);
    const groups = groupDepartures(ctx(), deps).sort(
      (a, b) => routeCompare(c.routes[a.route], c.routes[b.route]) || a.head.localeCompare(b.head, 'sr'),
    );
    if (!groups.length) {
      content.appendChild(empty('В этот день отправлений нет', 'Проверьте другую дату — в праздники и выходные расписание отличается.'));
      return;
    }
    const now = isToday(date) ? secondsNow() : null;
    for (const g of groups) {
      const r = c.routes[g.route];
      content.appendChild(
        el(
          'section',
          { class: 'card' },
          el(
            'a',
            { class: 'card-head', href: href(['route', r.id]) },
            badge(r, 'lg'),
            el('div', { class: 'grow' }, el('div', { class: 'title' }, '→ ' + g.head), el('div', { class: 'sub' }, `${g.label} · ${g.times.length} отправл.`)),
            icon('chevron'),
          ),
          hourGrid(g.times, now),
        ),
      );
    }
  };

  mount();
  timer = window.setInterval(() => {
    if (isToday(date)) renderContent();
  }, 30000);
  return () => window.clearInterval(timer);
}
