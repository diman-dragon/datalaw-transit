import type { Route, RouteKind } from '../types.ts';
import { addDays, dateInt, fmtTime } from '../schedule.ts';
import { back } from './router.ts';
import { el, icon } from './dom.ts';

export const KIND_LABEL: Record<RouteKind, string> = {
  bus: 'Автобус',
  tram: 'Трамвай',
  trolley: 'Троллейбус',
  rail: 'Электричка',
  other: 'Другое',
};

export const KIND_LABEL_PLURAL: Record<RouteKind, string> = {
  bus: 'Автобусы',
  tram: 'Трамваи',
  trolley: 'Троллейбусы',
  rail: 'Электрички',
  other: 'Другое',
};

function textOn(hex: string): string {
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#111111' : '#ffffff';
}

export function badge(r: Route, size: 'sm' | 'lg' = 'sm'): HTMLElement {
  const style = r.color ? `background:#${r.color};color:${r.textColor ? '#' + r.textColor : textOn(r.color)}` : undefined;
  return el('span', { class: `badge kind-${r.kind} ${size}`, style }, r.short);
}

export function lineBadges(routes: Route[], max = 8): HTMLElement {
  const wrap = el('span', { class: 'badges' });
  routes.slice(0, max).forEach((r) => wrap.appendChild(badge(r)));
  if (routes.length > max) wrap.appendChild(el('span', { class: 'more' }, `+${routes.length - max}`));
  return wrap;
}

export function pageHeader(opts: {
  title: string | Node;
  subtitle?: string | Node;
  back?: boolean;
  actions?: Node[];
}): HTMLElement {
  return el(
    'header',
    { class: 'topbar' },
    opts.back
      ? el('button', { class: 'icon-btn', 'aria-label': 'Назад', onclick: () => back([]) }, icon('back'))
      : null,
    el(
      'div',
      { class: 'titles' },
      el('h1', null, opts.title),
      opts.subtitle ? el('div', { class: 'subtitle' }, opts.subtitle) : null,
    ),
    el('div', { class: 'actions' }, ...(opts.actions ?? [])),
  );
}

export function starButton(isFav: boolean, onToggle: () => boolean): HTMLButtonElement {
  const btn = el('button', { class: 'icon-btn star' + (isFav ? ' on' : ''), 'aria-label': 'В избранное' });
  const render = (on: boolean) => {
    btn.classList.toggle('on', on);
    btn.replaceChildren(icon('star', on));
    btn.setAttribute('aria-pressed', String(on));
  };
  render(isFav);
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    render(onToggle());
  });
  return btn;
}

export function empty(title: string, text: string, action?: HTMLElement): HTMLElement {
  return el('div', { class: 'empty' }, el('h2', null, title), el('p', null, text), action ?? null);
}

export function section(title: string, ...children: (Node | null)[]): HTMLElement {
  return el('section', { class: 'section' }, el('h3', null, title), ...children);
}

export function segmented<T extends string>(
  items: { value: T; label: string }[],
  active: T,
  onChange: (v: T) => void,
): HTMLElement {
  const wrap = el('div', { class: 'segmented', role: 'tablist' });
  const btns = items.map((it) => {
    const b = el('button', { role: 'tab', class: it.value === active ? 'active' : '' }, it.label);
    b.addEventListener('click', () => {
      btns.forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      onChange(it.value);
    });
    wrap.appendChild(b);
    return b;
  });
  return wrap;
}

const dayFmt = new Intl.DateTimeFormat('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' });

export function startOfDay(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function isToday(d: Date): boolean {
  return dateInt(d) === dateInt(new Date());
}

function toInputValue(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Выбор дня: «Сегодня / Завтра / дата». */
export function dayControls(initial: Date, onChange: (d: Date) => void): HTMLElement {
  let cur = startOfDay(initial);
  const today = el('button', null, 'Сегодня');
  const tomorrow = el('button', null, 'Завтра');
  const input = el('input', { type: 'date', class: 'date-input', 'aria-label': 'Дата' });
  const label = el('span', { class: 'day-label' });
  const sync = () => {
    const t = dateInt(startOfDay());
    const c = dateInt(cur);
    today.classList.toggle('active', c === t);
    tomorrow.classList.toggle('active', c === dateInt(addDays(startOfDay(), 1)));
    input.value = toInputValue(cur);
    label.textContent = dayFmt.format(cur);
  };
  const set = (d: Date) => {
    cur = startOfDay(d);
    sync();
    onChange(cur);
  };
  today.addEventListener('click', () => set(startOfDay()));
  tomorrow.addEventListener('click', () => set(addDays(startOfDay(), 1)));
  input.addEventListener('change', () => {
    const [y, m, d] = input.value.split('-').map(Number);
    if (y && m && d) set(new Date(y, m - 1, d));
  });
  sync();
  return el('div', { class: 'daybar' }, el('div', { class: 'segmented small' }, today, tomorrow), label, input);
}

export function fmtRelative(diffSec: number): string {
  if (diffSec < 60) return 'сейчас';
  const m = Math.round(diffSec / 60);
  if (m < 60) return `через ${m} мин`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm ? `через ${h} ч ${mm} мин` : `через ${h} ч`;
}

/** Сетка расписания: час — минуты. now (сек) подсвечивает ближайшее отправление и приглушает прошедшие. */
export function hourGrid(times: number[], now: number | null): HTMLElement {
  const grid = el('div', { class: 'hourgrid' });
  if (!times.length) {
    grid.appendChild(el('div', { class: 'muted pad' }, 'В этот день отправлений нет'));
    return grid;
  }
  const nextIdx = now === null ? -1 : times.findIndex((t) => t >= now);
  const byHour = new Map<number, { t: number; i: number }[]>();
  times.forEach((t, i) => {
    const h = Math.floor(t / 3600);
    let a = byHour.get(h);
    if (!a) byHour.set(h, (a = []));
    a.push({ t, i });
  });
  for (const [h, list] of byHour) {
    const mins = el('div', { class: 'mins' });
    for (const { t, i } of list) {
      const cls = ['min'];
      if (now !== null && i < (nextIdx === -1 ? times.length : nextIdx)) cls.push('past');
      if (i === nextIdx) cls.push('next');
      mins.appendChild(el('span', { class: cls.join(' ') }, fmtTime(t).slice(3)));
    }
    grid.appendChild(el('div', { class: 'hrow' }, el('div', { class: 'hh' }, String(h).padStart(2, '0')), mins));
  }
  return grid;
}
