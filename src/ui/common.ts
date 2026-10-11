import type { Route, RouteKind } from '../types.ts';
import { dateForKind, dateInt, dayKindOf, fmtTime } from '../schedule.ts';
import type { DayKind, Validity } from '../schedule.ts';
import { fmtDateInt } from '../compare.ts';
import { data, hasData } from '../store.ts';
import { back, go } from './router.ts';
import { prefs } from '../prefs.ts';
import { parseTransitions, reminders } from '../remind.ts';
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

const dayFmt = new Intl.DateTimeFormat('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' });

export function startOfDay(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function isToday(d: Date): boolean {
  return dateInt(d) === dateInt(new Date());
}

const KIND_BTN: { kind: DayKind; label: string }[] = [
  { kind: 'weekday', label: 'Будни' },
  { kind: 'sat', label: 'Суббота' },
  { kind: 'sun', label: 'Воскресенье' },
];

/**
 * Выбор типа дня: Будни / Суббота / Воскресенье. Сегодняшний тип помечен точкой и подписью «сегодня»,
 * он же выбран по умолчанию. Показывает, по какой дате считается расписание.
 */
export function dayKindBar(onChange: (kind: DayKind, date: Date) => void, initial?: DayKind): HTMLElement {
  const cal = data().services;
  const today = startOfDay();
  const todayKind = dayKindOf(cal, today);
  let cur: DayKind = initial ?? todayKind;
  const label = el('div', { class: 'daykind-note' });
  const btns = KIND_BTN.map((k) => {
    const b = el(
      'button',
      { role: 'tab', class: 'daykind' + (k.kind === todayKind ? ' is-today' : '') },
      el('span', null, k.label),
      k.kind === todayKind ? el('small', null, 'сегодня') : null,
    );
    b.addEventListener('click', () => set(k.kind));
    return { ...k, b };
  });
  const dateOf = (k: DayKind) => dateForKind(cal, k, today);
  const sync = () => {
    for (const x of btns) {
      x.b.classList.toggle('active', x.kind === cur);
      x.b.setAttribute('aria-selected', String(x.kind === cur));
    }
    const d = dateOf(cur);
    label.textContent = isToday(d) ? `Сегодня, ${dayFmt.format(d)}` : `По расписанию на ${dayFmt.format(d)}`;
  };
  const set = (k: DayKind) => {
    cur = k;
    sync();
    onChange(k, dateOf(k));
  };
  sync();
  return el('div', { class: 'daykind-bar' }, el('div', { class: 'daykinds', role: 'tablist' }, ...btns.map((x) => x.b)), label);
}

/** Исходная дата для начального отображения (до первого выбора). */
export function initialDate(kind?: DayKind): { kind: DayKind; date: Date } {
  const cal = data().services;
  const today = startOfDay();
  const k = kind ?? dayKindOf(cal, today);
  return { kind: k, date: dateForKind(cal, k, today) };
}

export function fmtValidity(v: Validity): string {
  if (!v.from && !v.to) return '';
  if (v.from && v.to) return `Действует с ${fmtDateInt(v.from)} по ${fmtDateInt(v.to)}`;
  if (v.from) return `Действует с ${fmtDateInt(v.from)}`;
  return `Действует до ${fmtDateInt(v.to)}`;
}

/**
 * Напоминание сверху экрана: смена расписания, окончание срока, старые данные.
 * Приложение само ничего не скачивает — только просит сделать это в настройках.
 */
export function validityBanner(): HTMLElement | null {
  if (!hasData()) return null;
  const now = new Date();
  const today = dateInt(now);
  const m = data().meta;
  const starts = m.feeds.map((f) => f.startDate).filter((x) => x > 0);
  if (starts.length && Math.min(...starts) > today)
    return el('div', { class: 'banner warn' }, `Это расписание начнёт действовать с ${fmtDateInt(Math.min(...starts))}.`);
  const cfg = prefs.remind();
  if (!cfg.on || cfg.hiddenUntil >= today) return null;
  const list = reminders({ today: now, builtAt: m.builtAt, feeds: m.feeds, transitions: parseTransitions(cfg.dates) });
  if (!list.length) return null;
  const box = el(
    'div',
    { class: 'banner warn remind' },
    el('div', null, list[0].text),
    el(
      'div',
      { class: 'btn-row' },
      el('button', { class: 'btn small primary', onclick: () => go(['settings']) }, icon('download'), 'Скачать новое'),
      el('button', {
        class: 'btn small',
        onclick: () => {
          prefs.setRemind({ hiddenUntil: today });
          box.remove();
        },
      }, 'Напомнить завтра'),
    ),
  );
  return box;
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
