import { categoriesPresent } from '../dataset.ts';
import { pretty } from '../format.ts';
import { prefs } from '../prefs.ts';
import { routeCompare } from '../schedule.ts';
import { data, hasData, lineSearch } from '../store.ts';
import type { Line, LineCat } from '../types.ts';
import { CAT_LABEL } from '../types.ts';
import { badge, button, emptyState, fitAll, titleBar } from './common.ts';
import { clear, el, icon } from './dom.ts';
import { openTab, routeLink } from './nav.ts';

/** Короткие подписи для кнопок фильтра: чтобы всё помещалось в одну строку на любом экране. */
const CAT_SHORT: Record<LineCat, string> = { tram: 'Трамваи', trolley: 'Тролл.', day: 'Дневные', night: 'Ночные', express: 'Экспресс', suburban: 'Пригор.', rail: 'Сербиявоз' };

// состояние сохраняется между заходами на вкладку
let lastQuery = '';
let lastCat: LineCat | 'all' = 'all';
let lastScroll = 0;

export function linesView(host: HTMLElement): () => void {
  host.append(titleBar('Линии'));
  if (!hasData()) {
    host.append(emptyState('Расписание не загружено', 'Загрузите файл расписания в настройках.', button('Открыть настройки', () => openTab('settings'))));
    return () => {};
  }
  const ds = data();
  const cats = categoriesPresent(ds);
  if (lastCat !== 'all' && !cats.includes(lastCat)) lastCat = 'all';

  // ---- закреплённая верхняя часть: поиск и фильтр
  const input = el('input', {
    type: 'search',
    class: 'search-input',
    placeholder: 'Номер линии или конечная…',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    enterkeyhint: 'search',
    'aria-label': 'Поиск линии',
  });
  input.value = lastQuery;
  const clearBtn = el('button', { class: 'icon-btn small clear', 'aria-label': 'Очистить' }, icon('close'));
  const bar = el('div', { class: 'searchbar' }, icon('search'), input, clearBtn);

  const filterItems: { id: LineCat | 'all'; label: string }[] = [{ id: 'all', label: 'Все' }, ...cats.map((c) => ({ id: c, label: CAT_SHORT[c] }))];
  const filterBtns = filterItems.map((f) => {
    const b = el('button', { class: 'filter' + (f.id === lastCat ? ' active' : ''), 'aria-pressed': String(f.id === lastCat) }, el('span', null, f.label));
    b.addEventListener('click', () => {
      lastCat = f.id;
      lastScroll = 0;
      filterBtns.forEach((x, i) => {
        const on = filterItems[i].id === lastCat;
        x.classList.toggle('active', on);
        x.setAttribute('aria-pressed', String(on));
      });
      draw();
      scroll.scrollTop = 0;
    });
    return b;
  });
  const filters = el('div', { class: 'filters' }, ...filterBtns);
  host.append(el('div', { class: 'topfix' }, bar, filters));

  requestAnimationFrame(() => fitAll(filters, '.filter span', 10));
  const scroll = el('div', { class: 'scroll lines-scroll' });
  host.append(scroll);

  const inCat = (l: Line) => lastCat === 'all' || l.cat === lastCat;

  const tile = (l: Line) => {
    const t = routeLink(l.id, 0, 'tile', badge(l, 'fill'), prefs.isFav(l.id) ? el('span', { class: 'tile-fav', 'aria-label': 'В избранном' }, icon('star', true)) : null);
    t.title = pretty(l.long);
    t.setAttribute('aria-label', `Линия ${l.short}: ${pretty(l.long)}`);
    return t;
  };

  const row = (l: Line) => {
    const d = l.dirs[0];
    return routeLink(
      l.id,
      0,
      'res-row',
      badge(l, 'md'),
      el('span', { class: 'res-name' }, `${pretty(d.from)} — ${pretty(d.to)}`),
      prefs.isFav(l.id) ? el('span', { class: 'res-fav' }, icon('star', true)) : null,
    );
  };

  const draw = () => {
    clear(scroll);
    const q = lastQuery.trim();
    clearBtn.style.visibility = lastQuery ? 'visible' : 'hidden';
    if (q) {
      const hits = lineSearch()
        .search(q)
        .map((i) => ds.lines[i])
        .filter(inCat);
      if (!hits.length) {
        scroll.append(emptyState('Ничего не найдено', 'Попробуйте номер линии или часть названия конечной. Кириллица и латиница работают одинаково.'));
        return;
      }
      scroll.append(el('div', { class: 'res-list' }, ...hits.map(row)));
      fitAll(scroll, '.res-name', 11);
      return;
    }
    const lines = ds.lines.filter(inCat).sort(routeCompare);
    if (!lines.length) {
      scroll.append(emptyState('Здесь пусто', 'В загруженном расписании нет таких линий.'));
      return;
    }
    const groups = lastCat === 'all' ? cats : [lastCat];
    for (const c of groups) {
      const items = lines.filter((l) => l.cat === c);
      if (!items.length) continue;
      scroll.append(
        el('section', { class: 'group' }, lastCat === 'all' ? el('h3', null, el('span', null, CAT_LABEL[c]), el('small', null, String(items.length))) : null, el('div', { class: 'tiles' }, ...items.map(tile))),
      );
    }
    requestAnimationFrame(() => fitAll(scroll, '.tile .badge', 12));
  };

  let timer = 0;
  input.addEventListener('input', () => {
    lastQuery = input.value;
    clearBtn.style.visibility = lastQuery ? 'visible' : 'hidden';
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      draw();
      scroll.scrollTop = 0;
    }, 120);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
  });
  clearBtn.addEventListener('click', () => {
    input.value = '';
    lastQuery = '';
    draw();
    scroll.scrollTop = 0;
    input.focus();
  });

  draw();
  requestAnimationFrame(() => {
    scroll.scrollTop = lastScroll;
  });
  return () => {
    window.clearTimeout(timer);
    lastScroll = scroll.scrollTop;
  };
}
