import { fmtMin, pretty, validityText } from '../format.ts';
import { prefs } from '../prefs.ts';
import { dayTimes, KIND_LABEL, KINDS, kindOfDate, minuteOfDay } from '../schedule.ts';
import { data, lineById } from '../store.ts';
import type { DayKind } from '../types.ts';
import { badge, button, emptyState, fitText, starButton } from './common.ts';
import { append, clear, el, icon } from './dom.ts';
import { openTab } from './nav.ts';
import type { Loc } from './nav.ts';
import { toast } from './overlay.ts';

/**
 * Экран линии. Верхний блок закреплён: номер, направление, тип дня, «Расписание / Остановки».
 * Прокручивается только само расписание.
 */
export function routeView(host: HTMLElement, loc: Loc): () => void {
  const id = loc.path[1] ?? '';
  const line = lineById(id);
  if (!line) {
    host.append(emptyState('Линия не найдена', 'После загрузки нового расписания линия могла пропасть из файла.', button('К линиям', () => openTab('lines'))));
    return () => {};
  }
  const ds = data();
  let di = Math.max(0, Math.min(line.dirs.length - 1, parseInt(loc.query.get('d') ?? '0', 10) || 0));
  let kind: DayKind = kindOfDate(new Date());

  // ---- номер (и ★)
  const star = starButton(prefs.isFav(id), () => {
    const on = prefs.toggleFav(id);
    toast(on ? `Линия ${line.short} добавлена в избранное` : `Линия ${line.short} убрана из избранного`, 'info', 2200);
    return on;
  });
  const head = el('header', { class: 'route-head' }, el('span', { class: 'rh-side' }), badge(line, 'xl'), el('span', { class: 'rh-side right' }, star));

  // ---- направление (одна карточка, нажатие меняет)
  const dirBtn = el('button', { class: 'dircard' });
  dirBtn.addEventListener('click', () => {
    if (line.dirs.length < 2) return;
    di = (di + 1) % line.dirs.length;
    drawDir();
    drawValidity();
    drawSched(true);
  });
  const drawDir = () => {
    const d = line.dirs[di];
    clear(dirBtn);
    dirBtn.disabled = line.dirs.length < 2;
    dirBtn.setAttribute('aria-label', `Направление: ${pretty(d.from)} — ${pretty(d.to)}.${line.dirs.length > 1 ? ' Нажмите, чтобы сменить' : ''}`);
    append(dirBtn, [
      el('span', { class: 'dc-name' }, pretty(d.from)),
      el('span', { class: 'dc-arrow' }, icon('arrowRight')),
      el('span', { class: 'dc-name' }, pretty(d.to)),
      line.dirs.length > 1 ? el('span', { class: 'dc-swap' }, icon('swapH')) : null,
    ]);
    requestAnimationFrame(() => dirBtn.querySelectorAll<HTMLElement>('.dc-name').forEach((n) => fitText(n, 11)));
  };

  // ---- будни / суббота / воскресенье
  const todayKind = kindOfDate(new Date());
  const kindBtns = KINDS.map((k) => {
    const b = el(
      'button',
      { class: 'daykind' + (k === todayKind ? ' is-today' : ''), role: 'tab' },
      el('span', null, KIND_LABEL[k]),
      k === todayKind ? el('small', null, 'сегодня') : null,
    );
    b.addEventListener('click', () => {
      kind = k;
      syncKinds();
      drawSched(true);
    });
    return b;
  });
  const syncKinds = () =>
    kindBtns.forEach((b, i) => {
      const on = KINDS[i] === kind;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    });
  const kinds = el('div', { class: 'daykinds', role: 'tablist' }, ...kindBtns);

  // ---- «Расписание» и «Остановки»
  const validity = el('small', { class: 'mode-sub' });
  const schedCard = el('button', { class: 'mode active', 'aria-pressed': 'true' }, el('b', null, 'Расписание'), validity);
  const stopsCard = el('button', { class: 'mode disabled', disabled: true, 'aria-disabled': 'true' }, el('b', null, 'Остановки'), el('small', { class: 'mode-sub' }, 'скоро'));
  const modes = el('div', { class: 'modes' }, schedCard, stopsCard);
  const drawValidity = () => {
    const d = line.dirs[di];
    validity.textContent = validityText(d.validFrom, ds.validTo) || 'срок не указан';
    requestAnimationFrame(() => fitText(validity, 9.5));
  };

  host.append(el('div', { class: 'fixed' }, head, dirBtn, kinds, modes));

  // ---- расписание: час — минуты
  const sched = el('div', { class: 'scroll sched' });
  host.append(sched);

  /** Прокручивает расписание так, чтобы строка часа оказалась точно по центру видимой области. */
  const centerRow = (row: HTMLElement) => {
    const view = sched.clientHeight;
    const pad = Math.max(0, Math.round((view - row.offsetHeight) / 2));
    // запас сверху и снизу, чтобы центрировать можно было и первый, и последний час
    const grid = row.parentElement as HTMLElement;
    grid.style.paddingTop = `${pad}px`;
    grid.style.paddingBottom = `${pad}px`;
    const top = row.getBoundingClientRect().top - sched.getBoundingClientRect().top + sched.scrollTop;
    sched.scrollTop = Math.max(0, Math.round(top + row.offsetHeight / 2 - view / 2));
  };

  const drawSched = (focus: boolean) => {
    const keep = sched.scrollTop;
    clear(sched);
    const d = line.dirs[di];
    const times = dayTimes(d, kind);
    const now = new Date();
    const isToday = kind === kindOfDate(now);
    const nowMin = minuteOfDay(now);
    if (!times.length) {
      sched.append(el('div', { class: 'sched-empty' }, `В ${kind === 'weekday' ? 'будни' : kind === 'sat' ? 'субботу' : 'воскресенье'} отправлений нет`));
      return;
    }
    const nextIdx = isToday ? times.findIndex((t) => t >= nowMin) : -1;
    const pastCount = isToday ? (nextIdx === -1 ? times.length : nextIdx) : 0;
    sched.append(el('div', { class: 'sched-meta' }, `От «${pretty(d.from)}» · ${times.length} · ${fmtMin(times[0])}–${fmtMin(times[times.length - 1])}`));
    const grid = el('div', { class: 'hourgrid' });
    const byHour = new Map<number, number[]>();
    times.forEach((t, i) => {
      const h = Math.floor(t / 60);
      const a = byHour.get(h);
      if (a) a.push(i);
      else byHour.set(h, [i]);
    });
    let focusRow: HTMLElement | null = null;
    let lastRow: HTMLElement | null = null;
    for (const [h, idxs] of byHour) {
      const mins = el('div', { class: 'mins' });
      for (const i of idxs) {
        const cls = ['min'];
        if (i < pastCount) cls.push('past');
        if (i === nextIdx) cls.push('next');
        mins.append(el('span', { class: cls.join(' ') }, fmtMin(times[i]).slice(3)));
      }
      const curHour = isToday && Math.floor(nowMin / 60) === h;
      const r = el('div', { class: 'hrow' + (curHour ? ' cur' : '') }, el('div', { class: 'hh' }, fmtMin(h * 60).slice(0, 2)), mins);
      grid.append(r);
      lastRow = r;
      if (!focusRow && (nextIdx === -1 ? false : idxs.includes(nextIdx))) focusRow = r;
    }
    sched.append(grid);
    if (focus) {
      // фокус по центру: час ближайшего рейса — ровно посередине окна, сверху и снизу — соседние часы
      requestAnimationFrame(() => {
        const target = isToday ? (focusRow ?? (nextIdx === -1 ? lastRow : null)) : null;
        if (!target) {
          sched.scrollTop = 0;
          return;
        }
        target.classList.add('focus');
        centerRow(target);
      });
    } else {
      const target = isToday ? (focusRow ?? (nextIdx === -1 ? lastRow : null)) : null;
      if (target) {
        target.classList.add('focus');
        const view = sched.clientHeight;
        const pad = Math.max(0, Math.round((view - target.offsetHeight) / 2));
        const g = target.parentElement as HTMLElement;
        g.style.paddingTop = `${pad}px`;
        g.style.paddingBottom = `${pad}px`;
      }
      sched.scrollTop = keep;
    }
  };

  drawDir();
  syncKinds();
  drawValidity();
  drawSched(true);
  requestAnimationFrame(() => fitText(validity, 9.5));

  // раз в полминуты сдвигаем «ближайшее отправление» (без прыжков прокрутки)
  const timer = window.setInterval(() => {
    if (kind === kindOfDate(new Date())) drawSched(false);
  }, 30000);
  return () => window.clearInterval(timer);
}
