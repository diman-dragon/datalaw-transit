import { fmtMin, pretty, waitText } from '../format.ts';
import { prefs } from '../prefs.ts';
import { nextDeparture } from '../schedule.ts';
import { hasData, lineById } from '../store.ts';
import type { Direction, Line } from '../types.ts';
import { badge, button, emptyState, fitAll, fitText, titleBar } from './common.ts';
import { el, icon } from './dom.ts';
import { toast } from './overlay.ts';
import { openTab, routeLink } from './nav.ts';

interface NextInfo {
  text: string;
  soon: boolean;
}

function nextInfo(dir: Direction | undefined, now: Date): NextInfo {
  if (!dir) return { text: 'нет отправлений', soon: false };
  const n = nextDeparture(dir, now);
  if (!n) return { text: 'нет отправлений', soon: false };
  if (n.tomorrow) return { text: `завтра ${fmtMin(n.min)}`, soon: false };
  return { text: `${fmtMin(n.min)} · ${waitText(n.wait)}`, soon: n.wait <= 10 };
}

interface Card {
  node: HTMLElement;
  update: (now: Date) => void;
}

/** Карточка линии: номер слева; справа две «строки» — конечные, между ними стрелки, под названием — ближайшее отправление. */
function makeCard(line: Line, onRemove: (line: Line) => void): Card {
  const d0 = line.dirs[0];
  const d1 = line.dirs[1];
  const names = [pretty(d0.from), pretty(d1 ? d1.from : d0.to)];
  const dirsOf: (Direction | undefined)[] = [d0, d1];

  const nextEls: HTMLElement[] = [];
  const term = (i: number) => {
    const next = el('span', { class: 'term-next' });
    nextEls.push(next);
    const a = routeLink(line.id, i, 'term', el('span', { class: 'term-name' }, names[i]), next);
    a.setAttribute('aria-label', `${line.short}: от ${names[i]}`);
    return a;
  };
  const rows = el('div', { class: 'fav-rows' }, term(0), el('span', { class: 'term-swap', 'aria-hidden': 'true' }, icon('swapV')), term(1));
  const num = routeLink(line.id, 0, 'fav-num', badge(line, 'fill'));
  num.setAttribute('aria-label', `Линия ${line.short}`);
  const rm = el('button', { class: 'fav-remove', 'aria-label': `Убрать линию ${line.short} из избранного`, title: 'Убрать из избранного' }, icon('star', true));
  rm.addEventListener('click', () => onRemove(line));
  const node = el('article', { class: 'fav-card' }, num, rows, rm);

  const update = (now: Date) => {
    dirsOf.forEach((d, i) => {
      const info = nextInfo(d, now);
      nextEls[i].textContent = info.text;
      nextEls[i].classList.toggle('soon', info.soon);
    });
  };
  return { node, update };
}

export function favView(host: HTMLElement): () => void {
  host.append(titleBar('Избранное'));
  const scroll = el('div', { class: 'scroll' });
  host.append(scroll);
  let timer = 0;
  let cards: Card[] = [];

  const tick = () => {
    const now = new Date();
    for (const c of cards) c.update(now);
  };

  const remove = (line: Line) => {
    const at = prefs.favs().indexOf(line.id);
    prefs.toggleFav(line.id);
    toast(`Линия ${line.short} убрана из избранного`, 'info', 4000, {
      label: 'Отменить',
      onClick: () => {
        prefs.restoreFav(line.id, at);
        render();
      },
    });
    render();
  };

  const render = () => {
    scroll.replaceChildren();
    cards = [];
    if (!hasData()) {
      scroll.append(
        emptyState('Расписание не загружено', 'Загрузите файл расписания в настройках — дальше всё работает без интернета.', button('Открыть настройки', () => openTab('settings'))),
      );
      return;
    }
    const lines = prefs
      .favs()
      .map((id) => lineById(id))
      .filter((l): l is Line => !!l);
    if (!lines.length) {
      scroll.append(emptyState('Пока пусто', 'Откройте линию на вкладке «Линии» и нажмите ★ — она появится здесь.', button('К линиям', () => openTab('lines'))));
      return;
    }
    cards = lines.map((l) => makeCard(l, remove));
    const list = el('div', { class: 'fav-list' }, ...cards.map((c) => c.node));
    scroll.append(list);
    tick();
    // ширина известна только после вставки в документ
    requestAnimationFrame(() => {
      fitAll(list, '.term-name', 11);
      list.querySelectorAll<HTMLElement>('.term-next').forEach((n) => fitText(n, 10));
      list.querySelectorAll<HTMLElement>('.fav-num .badge').forEach((n) => fitText(n, 14));
    });
  };

  render();
  timer = window.setInterval(tick, 20000);
  return () => window.clearInterval(timer);
}
