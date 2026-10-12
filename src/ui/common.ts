import type { Line } from '../types.ts';
import { prefs } from '../prefs.ts';
import { el, icon } from './dom.ts';

/** Значок с номером линии; цвет — по категории. */
export function badge(l: Line, size: 'md' | 'xl' | 'fill' = 'md'): HTMLElement {
  return el('span', { class: `badge cat-${l.cat} ${size}` }, l.short);
}

export function titleBar(title: string): HTMLElement {
  return el('header', { class: 'titlebar' }, el('h1', null, title));
}

export function emptyState(title: string, text: string, action?: HTMLElement | null): HTMLElement {
  return el('div', { class: 'empty' }, el('h2', null, title), el('p', null, text), action ?? null);
}

export function button(label: string, onClick: () => void, primary = true): HTMLButtonElement {
  return el('button', { class: 'btn ' + (primary ? 'primary' : 'plain'), onclick: onClick }, label);
}

export function starButton(isFav: boolean, onToggle: () => boolean): HTMLButtonElement {
  const btn = el('button', { class: 'icon-btn star', 'aria-label': 'В избранное' });
  const draw = (on: boolean) => {
    btn.classList.toggle('on', on);
    btn.replaceChildren(icon('star', on));
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', on ? 'Убрать из избранного' : 'Добавить в избранное');
  };
  draw(isFav);
  btn.addEventListener('click', () => draw(onToggle()));
  return btn;
}

export function isFavLine(id: string): boolean {
  return prefs.isFav(id);
}

/**
 * Текст в одну строку без переносов: если не помещается — уменьшаем шрифт до min, дальше «…».
 * Вызывать, когда элемент уже в документе (иначе ширина неизвестна).
 */
export function fitText(node: HTMLElement, min = 11): void {
  node.style.fontSize = '';
  if (!node.clientWidth) return;
  let size = parseFloat(getComputedStyle(node).fontSize) || 14;
  while (node.scrollWidth > node.clientWidth + 0.5 && size > min) {
    size -= 0.5;
    node.style.fontSize = `${size}px`;
  }
}

export function fitAll(root: ParentNode, selector: string, min = 11): void {
  root.querySelectorAll<HTMLElement>(selector).forEach((n) => fitText(n, min));
}
