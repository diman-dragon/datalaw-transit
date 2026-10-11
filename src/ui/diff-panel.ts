import { DAY_KIND_NAME, diffSummary, fmtDateInt, kindName } from '../compare.ts';
import type { Diff } from '../compare.ts';
import { el } from './dom.ts';

function period(v: { start: number; end: number } | null): string {
  if (!v) return '—';
  return `${fmtDateInt(v.start)} – ${fmtDateInt(v.end)}`;
}

function lineList(title: string, items: { short: string; kind: Parameters<typeof kindName>[0]; long: string }[]): HTMLElement | null {
  if (!items.length) return null;
  return el(
    'details',
    { class: 'diff-block' },
    el('summary', null, `${title}: ${items.length}`),
    el('ul', null, ...items.map((i) => el('li', null, el('b', null, i.short), ` ${kindName(i.kind)}${i.long ? ' — ' + i.long : ''}`))),
  );
}

/** Отчёт сравнения: срок действия, новые / убранные / изменённые линии. */
export function diffPanel(d: Diff): HTMLElement {
  const root = el('div', { class: 'diff' });
  const validity = el(
    'div',
    { class: 'diff-validity' },
    d.oldValidity ? el('div', null, el('small', null, 'Сейчас действует'), el('b', null, period(d.oldValidity))) : null,
    el('div', null, el('small', null, d.oldValidity ? 'Новое расписание' : 'Расписание действует'), el('b', null, period(d.newValidity))),
  );
  root.appendChild(validity);
  if (d.oldValidity && d.newValidity.start && d.oldValidity.start && d.newValidity.start < d.oldValidity.start)
    root.appendChild(el('div', { class: 'banner warn' }, 'Внимание: новый файл начинается раньше текущего — возможно, он старее.'));
  root.appendChild(el('div', { class: 'diff-summary' }, diffSummary(d)));
  if (!d.first) {
    const blocks = [lineList('Новые линии', d.added), lineList('Убраны линии', d.removed)];
    if (d.changed.length)
      blocks.push(
        el(
          'details',
          { class: 'diff-block', open: d.changed.length <= 6 || undefined },
          el('summary', null, `Изменены: ${d.changed.length}`),
          el(
            'ul',
            null,
            ...d.changed.map((c) => el('li', null, el('b', null, c.short), ` ${kindName(c.kind)}`, el('ul', null, ...c.notes.map((n) => el('li', null, n))))),
          ),
        ),
      );
    for (const b of blocks) if (b) root.appendChild(b);
    const o = d.refDates.old;
    const n = d.refDates.new;
    if (o)
      root.appendChild(
        el(
          'p',
          { class: 'muted small' },
          `Сравнение по типичным дням: ${(['weekday', 'sat', 'sun'] as const).map((k) => `${DAY_KIND_NAME[k]} ${fmtDateInt(o[k])} → ${fmtDateInt(n[k])}`).join('; ')}.`,
        ),
      );
  }
  return root;
}
