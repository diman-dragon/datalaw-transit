import { prefs } from '../prefs.ts';
import { fmtTime, patternLabel, patternTimes, secondsNow } from '../schedule.ts';
import { data, ensureRoutes, routeData, routeIdx } from '../store.ts';
import type { Pattern } from '../types.ts';
import {
  badge,
  dayControls,
  empty,
  hourGrid,
  isToday,
  KIND_LABEL,
  pageHeader,
  segmented,
  startOfDay,
  starButton,
} from './common.ts';
import { clear, el } from './dom.ts';
import { href } from './router.ts';
import { mapPanel } from './map-panel.ts';
import type { MapPanel } from './map-panel.ts';
import type { Route as NavRoute } from './router.ts';

type Tab = 'stops' | 'times' | 'map';

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
  // участок «от … до …» (приходит из поиска «Из А в Б»)
  let seg: { from: number; to: number } | null = null;
  const qp = Number(nav.query.get('p'));
  const qi = Number(nav.query.get('i'));
  const qj = Number(nav.query.get('j'));
  if (nav.query.get('p') !== null && qp >= 0 && qp < pats.length) {
    pi = qp;
    if (qj > qi && qj < pats[qp].stops.length) seg = { from: qi, to: qj };
  }
  const qt = nav.query.get('t');
  let tab: Tab = qt === 'times' ? 'times' : qt === 'map' ? 'map' : 'stops';
  let mapInst: MapPanel | null = null;
  let pos = 0;
  let date = startOfDay();
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
                seg = null;
                pos = 0;
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
        seg = null;
        pos = 0;
        renderContent();
      });
      dirHost.appendChild(el('label', { class: 'field' }, el('span', null, 'Вариант'), sel));
    }
  };

  tabsHost.appendChild(
    segmented<Tab>(
      [
        { value: 'stops', label: 'Остановки' },
        { value: 'times', label: 'Расписание' },
        { value: 'map', label: 'Карта' },
      ],
      tab,
      (t) => {
        tab = t;
        renderContent();
      },
    ),
  );

  const renderContent = () => {
    mapInst?.destroy();
    mapInst = null;
    clear(content);
    if (tab === 'stops') renderStops();
    else if (tab === 'times') renderTimes();
    else renderMap();
  };

  const renderMap = () => {
    const pat = pats[pi];
    mapInst = mapPanel({ route, pattern: pat, from: seg?.from, to: seg?.to });
    const note = seg
      ? el('div', { class: 'meta-line' }, `Участок: ${stopName(pat, seg.from)} → ${stopName(pat, seg.to)} · ${seg.to - seg.from} ост.`)
      : el('div', { class: 'meta-line' }, `${pat.stops.length} остановок · линия по остановкам (без изгибов улиц)`);
    content.append(note, mapInst.el);
  };

  const renderStops = () => {
    const pat = pats[pi];
    const list = el('div', { class: 'timeline' });
    const today = isToday(date);
    const now = secondsNow();
    pat.stops.forEach((s, i) => {
      let next = '';
      if (i < pat.stops.length - 1) {
        const times = patternTimes(c.services, pat, i, date);
        const t = today ? times.find((x) => x >= now) : times[0];
        next = t === undefined ? '' : fmtTime(t);
      }
      const last = i === pat.stops.length - 1;
      list.appendChild(
        el(
          'a',
          { class: 'tl-row' + (i === 0 ? ' first' : '') + (last ? ' last' : ''), href: href(['stop', c.stops.id[s]], { r: id }) },
          el('span', { class: 'tl-dot' }),
          el('div', { class: 'grow' }, el('div', { class: 'title' }, c.stops.name[s]), c.stops.code[s] ? el('div', { class: 'sub' }, `код ${c.stops.code[s]}`) : null),
          next ? el('div', { class: 'tl-next' }, el('small', null, today ? 'ближайший' : 'первый'), next) : null,
        ),
      );
    });
    content.append(
      el('div', { class: 'meta-line' }, `${pat.stops.length} остановок · ${pat.trips} рейсов в графике`),
      list,
      el('div', { class: 'muted pad' }, 'Нажмите на остановку, чтобы увидеть все отправления с неё.'),
    );
  };

  const renderTimes = () => {
    const pat = pats[pi];
    if (pos >= pat.stops.length - 1) pos = 0;
    const sel = el('select', { class: 'select', 'aria-label': 'Остановка' });
    pat.stops.forEach((s, i) => {
      if (i === pat.stops.length - 1) return; // на конечной отправлений нет
      const o = el('option', { value: String(i) }, `${i + 1}. ${c.stops.name[s]}${c.stops.code[s] ? ' (' + c.stops.code[s] + ')' : ''}`);
      if (i === pos) o.selected = true;
      sel.appendChild(o);
    });
    const grid = el('div');
    const draw = () => {
      clear(grid);
      const times = patternTimes(c.services, pat, pos, date);
      const summary = times.length ? `${times.length} отправл. · первое ${fmtTime(times[0])} · последнее ${fmtTime(times[times.length - 1])}` : 'В этот день рейсов нет';
      grid.append(el('div', { class: 'meta-line' }, summary), hourGrid(times, isToday(date) ? secondsNow() : null));
    };
    sel.addEventListener('change', () => {
      pos = Number(sel.value);
      draw();
    });
    content.append(
      el('div', { class: 'controls' }, el('label', { class: 'field' }, el('span', null, 'Остановка'), sel), dayControls(date, (d) => {
        date = d;
        draw();
      })),
      grid,
    );
    draw();
  };

  renderDirs();
  renderContent();
  return () => mapInst?.destroy();
}
