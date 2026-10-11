import { fmtDateInt, kindName, plural } from '../compare.ts';
import type { CustomPending } from '../importer.ts';
import { changesCount, choiceStats } from '../overlay.ts';
import type { Choice, LineConflict, LineStatus } from '../overlay.ts';
import { dateInt } from '../schedule.ts';
import { period } from './diff-panel.ts';
import { append, el } from './dom.ts';

export interface CustomPanelHandlers {
  onApply: (choices: Record<string, Choice>) => void;
  onCancel: () => void;
}

/** Подписи кнопок выбора: [оставить текущую версию, взять свою]. */
const LABELS: Record<LineStatus, [string, string]> = {
  changed: ['Текущее', 'Своё'],
  added: ['Пропустить', 'Добавить'],
  removed: ['Оставить', 'Убрать'],
};
const BULK: Record<LineStatus, [string, string]> = {
  changed: ['Все текущие', 'Все свои'],
  added: ['Пропустить все', 'Добавить все'],
  removed: ['Оставить все', 'Убрать все'],
};
const TITLES: Record<LineStatus, string> = {
  changed: 'Конфликты — линия есть в обоих наборах и отличается',
  added: 'Только в своём файле — новые линии',
  removed: 'Нет в своём файле — есть в текущих данных',
};
const HINTS: Partial<Record<LineStatus, string>> = {
  changed: 'Выберите, чья версия линии останется: текущая или из вашего файла. Версии целиком не смешиваются.',
  removed: 'По умолчанию такие линии остаются: ваш файл может быть неполным. «Убрать» — удалить линию из расписания.',
};

/**
 * Сравнение своего файла с текущими данными: по каждой линии с различиями нужно выбрать версию.
 * Состояние выбора живёт внутри панели; наружу отдаётся при нажатии «Применить».
 */
export function customPanel(p: CustomPending, h: CustomPanelHandlers): HTMLElement {
  const plan = p.plan;
  const d = plan.diff;
  const root = el('div', { class: 'custom-panel' });

  root.appendChild(
    el(
      'div',
      { class: 'diff-validity' },
      el('div', null, el('small', null, 'Текущие данные'), el('b', null, period(d.oldValidity))),
      el('div', null, el('small', null, 'Свой файл'), el('b', null, period(d.newValidity))),
    ),
  );
  if (p.replaces) root.appendChild(el('div', { class: 'banner' }, `Подключённый ранее свой файл «${p.replaces}» будет заменён этим.`));
  if (d.newValidity.end && d.newValidity.end < dateInt(new Date()))
    root.appendChild(el('div', { class: 'banner warn' }, `Срок действия своего файла истёк ${fmtDateInt(d.newValidity.end)}: его рейсы в расписании не появятся.`));

  const counts = {
    changed: plan.lines.filter((l) => l.status === 'changed').length,
    added: plan.lines.filter((l) => l.status === 'added').length,
    removed: plan.lines.filter((l) => l.status === 'removed').length,
  };
  root.appendChild(
    el(
      'div',
      { class: 'diff-summary' },
      `Совпадает: ${plan.same} · конфликтов: ${counts.changed} · только в своём файле: ${counts.added} · нет в своём файле: ${counts.removed}`,
    ),
  );

  if (!plan.lines.length) {
    root.append(
      el('div', { class: 'banner' }, 'Свой файл совпадает с текущим расписанием: различий нет, выбирать нечего.'),
      el('div', { class: 'btn-row' }, el('button', { class: 'btn', onclick: h.onCancel }, 'Закрыть')),
    );
    return root;
  }

  // ---- состояние выбора
  const choices: Record<string, Choice> = { ...p.initial };
  const sync = new Map<string, () => void>(); // обновление вида уже созданной строки
  const rows: { row: HTMLElement; hay: string }[] = [];
  let query = '';

  const stat = el('div', { class: 'cstat', 'aria-live': 'polite' });
  const applyBtn = el('button', { class: 'btn primary' }, 'Применить');

  const refreshStat = () => {
    const st = choiceStats(plan, choices);
    const n = changesCount(st);
    stat.textContent = n
      ? `Изменится ${n} ${plural(n, 'линия', 'линии', 'линий')}: своя версия в конфликтах — ${st.conflictsCustom} из ${st.conflicts}; добавить — ${st.addedTaken} из ${st.added}; убрать — ${st.removedDropped} из ${st.removed}.`
      : 'Везде выбрана текущая версия — применять нечего.';
    applyBtn.classList.toggle('is-off', n === 0);
  };

  const setMany = (lines: LineConflict[], c: Choice) => {
    for (const l of lines) {
      choices[l.key] = c;
      sync.get(l.key)?.();
    }
    refreshStat();
  };

  const buildRow = (l: LineConflict): HTMLElement => {
    const [labCurrent, labCustom] = LABELS[l.status];
    const set = (c: Choice) => {
      choices[l.key] = c;
      paint();
      refreshStat();
    };
    const bCur = el('button', { type: 'button', onclick: () => set('current') }, labCurrent);
    const bCus = el('button', { type: 'button', onclick: () => set('custom') }, labCustom);
    const paint = () => {
      const c = choices[l.key];
      bCur.classList.toggle('active', c === 'current');
      bCus.classList.toggle('active', c === 'custom');
      bCur.setAttribute('aria-pressed', String(c === 'current'));
      bCus.setAttribute('aria-pressed', String(c === 'custom'));
    };
    sync.set(l.key, paint);
    paint();
    const hay = `${l.short} ${l.long}`.toLowerCase();
    const row = el(
      'div',
      { class: 'cline' },
      el(
        'div',
        { class: 'cline-main' },
        el('div', { class: 'cline-title' }, el('b', null, l.short), ` ${kindName(l.kind)}`),
        l.long ? el('div', { class: 'muted small' }, l.long) : null,
        l.notes.length
          ? el('details', { class: 'cline-notes' }, el('summary', null, 'Что отличается'), el('ul', null, ...l.notes.map((n) => el('li', null, n))))
          : null,
      ),
      el('div', { class: 'segmented small' }, bCur, bCus),
    );
    row.hidden = !!query && !hay.includes(query);
    rows.push({ row, hay });
    return row;
  };

  const group = (status: LineStatus, open: boolean): HTMLElement | null => {
    const lines = plan.lines.filter((l) => l.status === status);
    if (!lines.length) return null;
    const body = el('div', { class: 'cgroup-body' });
    let rendered = false;
    const render = () => {
      if (rendered) return;
      rendered = true;
      for (const l of lines) body.appendChild(buildRow(l));
    };
    const [bCur, bCus] = BULK[status];
    const details = el(
      'details',
      { class: 'cgroup', open: open || undefined },
      el('summary', null, `${TITLES[status]}: ${lines.length}`),
      HINTS[status] ? el('p', { class: 'muted small' }, HINTS[status]) : null,
      el(
        'div',
        { class: 'btn-row' },
        el('button', { type: 'button', class: 'btn small', onclick: () => setMany(lines, 'current') }, bCur),
        el('button', { type: 'button', class: 'btn small', onclick: () => setMany(lines, 'custom') }, bCus),
      ),
      body,
    );
    // длинные списки строим только при первом раскрытии
    details.addEventListener('toggle', () => {
      if (details.open) render();
    });
    if (open) render();
    return details;
  };

  const filter = el('input', { type: 'search', class: 'text-input', placeholder: 'Найти линию по номеру или названию', 'aria-label': 'Фильтр линий', autocapitalize: 'off', spellcheck: 'false' });
  filter.addEventListener('input', () => {
    query = filter.value.trim().toLowerCase();
    for (const r of rows) r.row.hidden = !!query && !r.hay.includes(query);
  });

  const conflicts = plan.lines.filter((l) => l.status === 'changed');
  append(root, [
    el(
      'div',
      { class: 'btn-row' },
      counts.changed
        ? el('button', { type: 'button', class: 'btn small', onclick: () => setMany(conflicts, 'custom') }, 'Все конфликты — в пользу своего файла')
        : null,
      el(
        'button',
        {
          type: 'button',
          class: 'btn small',
          onclick: () => {
            for (const l of plan.lines) choices[l.key] = p.initial[l.key];
            for (const l of plan.lines) sync.get(l.key)?.();
            refreshStat();
          },
        },
        'Сбросить выбор',
      ),
    ),
    plan.lines.length > 8 ? filter : null,
    group('changed', true),
    group('added', true),
    group('removed', false),
    stat,
    el(
      'div',
      { class: 'btn-row' },
      applyBtn,
      el('button', { type: 'button', class: 'btn', onclick: h.onCancel }, 'Отмена'),
    ),
  ]);
  applyBtn.addEventListener('click', () => {
    if (changesCount(choiceStats(plan, choices)) === 0) return;
    h.onApply({ ...choices });
  });
  refreshStat();
  return root;
}
