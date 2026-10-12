import { datasetStats, makeDataset } from '../dataset.ts';
import { saveDataset } from '../db.ts';
import { fmtDateInt, fmtSize, monthKey, plural, validityFull } from '../format.ts';
import { prefs } from '../prefs.ts';
import type { ThemeName } from '../prefs.ts';
import { data, hasData, setDataset } from '../store.ts';
import { CAT_LABEL } from '../types.ts';
import { checkSchedule, FILE_FORMAT, MAX_FILE_BYTES } from '../validate.ts';
import type { ScheduleCheck } from '../validate.ts';
import { titleBar } from './common.ts';
import { append, clear, el, icon } from './dom.ts';
import { confirmDialog, toast } from './overlay.ts';
import { applyTheme, THEMES } from './theme.ts';

const dtFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const EXAMPLE = `{
  "format": "${FILE_FORMAT}",
  "validTo": "2026-12-31",
  "lines": [{
    "id": "26", "short": "26",
    "long": "Дорћол - Браће Јерковић",
    "kind": "bus", "category": "day",
    "dirs": [{
      "from": "ДОРЋОЛ", "to": "БРАЋЕ ЈЕРКОВИЋ",
      "validFrom": "2025-03-17",
      "times": {
        "weekday": ["04:10", "04:30", "24:15"],
        "sat": ["05:00"], "sun": ["06:00"]
      }
    }]
  }]
}`;

function countText(n: number, one: string, few: string, many: string): string {
  return `${n.toLocaleString('ru-RU')} ${plural(n, one, few, many)}`;
}

function statsText(s: { lines: number; dirs: number; departures: number }): string {
  return `${countText(s.lines, 'линия', 'линии', 'линий')} · ${countText(s.dirs, 'направление', 'направления', 'направлений')} · ${countText(s.departures, 'отправление', 'отправления', 'отправлений')}`;
}

export function settingsView(host: HTMLElement): () => void {
  host.append(titleBar('Настройки'));
  const scroll = el('div', { class: 'scroll settings' });
  host.append(scroll);

  // ================= Расписание: загрузка файла
  const status = el('div', { class: 'data-status' });
  const result = el('div', { class: 'result', 'aria-live': 'polite' });
  const input = el('input', { type: 'file', class: 'hidden', accept: '.json,application/json,text/plain' });
  const uploadBtn = el('button', { class: 'btn primary wide' }, icon('upload'), 'Загрузить расписание');
  let busy = false;

  const showResult = (kind: 'info' | 'ok' | 'err', title: string, lines: string[] = []) => {
    clear(result);
    result.className = `result ${kind}`;
    result.append(el('b', null, title), ...lines.map((l) => el('div', null, l)));
  };

  const drawStatus = () => {
    clear(status);
    if (!hasData()) {
      status.append(el('b', null, 'Расписание не загружено'), el('div', { class: 'muted' }, 'Выберите файл расписания (формат описан ниже).'));
      return;
    }
    const ds = data();
    const s = datasetStats(ds);
    const v = validityFull(s.validFrom, ds.validTo);
    append(status, [
      el('b', null, 'Расписание загружено'),
      el('div', { class: 'muted' }, `Файл: ${ds.fileName || '—'}`),
      el('div', { class: 'muted' }, `Загружено: ${dtFmt.format(new Date(ds.builtAt))}`),
      el('div', { class: 'muted' }, statsText(s)),
      v ? el('div', { class: 'muted' }, v) : null,
    ]);
  };

  const setBusy = (b: boolean) => {
    busy = b;
    uploadBtn.disabled = b;
  };

  const summaryNodes = (c: ScheduleCheck): (Node | string)[] => {
    const cats = new Map<string, number>();
    for (const l of c.lines) cats.set(CAT_LABEL[l.cat], (cats.get(CAT_LABEL[l.cat]) ?? 0) + 1);
    const v = validityFull(c.validFrom, c.validTo);
    const nodes: (Node | string)[] = [
      el('div', { class: 'sum-line' }, statsText(c.stats)),
      el('div', { class: 'muted small' }, [...cats].map(([k, n]) => `${k}: ${n}`).join(' · ')),
    ];
    if (v) nodes.push(el('div', { class: 'muted small' }, v));
    if (c.generated) nodes.push(el('div', { class: 'muted small' }, `Файл создан: ${fmtDateInt(+c.generated.slice(0, 10).replace(/-/g, ''))}`));
    return nodes;
  };

  const warningNodes = (warnings: string[], max: number): Node[] => {
    if (!warnings.length) return [];
    const shown = warnings.slice(0, max);
    return [
      el(
        'div',
        { class: 'warn-box' },
        el('b', null, `Замечания: ${warnings.length}`),
        el('ul', null, ...shown.map((w) => el('li', null, w)), warnings.length > max ? el('li', { class: 'muted' }, `…и ещё ${warnings.length - max}`) : null),
      ),
    ];
  };

  const handleFile = async (file: File) => {
    setBusy(true);
    showResult('info', 'Проверяю файл…', [file.name]);
    try {
      if (file.size > MAX_FILE_BYTES) {
        const msg = `Файл слишком большой (${fmtSize(file.size)}). Максимум — ${fmtSize(MAX_FILE_BYTES)}.`;
        showResult('err', 'Файл не принят', [msg]);
        toast(msg, 'err');
        return;
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const check = checkSchedule(bytes, file.name);
      if (!check.ok) {
        showResult('err', 'Файл не принят', check.errors);
        toast(check.errors[0], 'err');
        return;
      }
      const extra: string[] = [];
      if (hasData()) {
        const cur = data();
        if (cur.generated && check.generated && check.generated < cur.generated) extra.push(`Этот файл старее загруженного: создан ${fmtDateInt(+check.generated.slice(0, 10).replace(/-/g, ''))}, а сейчас в приложении файл от ${fmtDateInt(+cur.generated.slice(0, 10).replace(/-/g, ''))}.`);
        const have = new Set(check.lines.map((l) => l.id));
        const lost = prefs.favs().filter((f) => !have.has(f));
        if (lost.length) extra.push(`Из избранного в новом файле нет: ${lost.map((x) => x.replace(/^g:/, '')).join(', ')}.`);
      }
      const warnings = [...extra, ...check.warnings];
      showResult('info', 'Файл проверен', [`${statsText(check.stats)}${warnings.length ? ` · замечаний: ${warnings.length}` : ''}`]);
      const yes = await confirmDialog({
        title: hasData() ? 'Заменить расписание?' : 'Загрузить расписание?',
        body: [...summaryNodes(check), ...warningNodes(warnings, 6), hasData() ? el('p', { class: 'muted small' }, 'Прежнее расписание будет заменено. Избранное сохранится.') : ''],
        ok: hasData() ? 'Заменить' : 'Загрузить',
      });
      if (!yes) {
        showResult('info', 'Загрузка отменена', ['Прежнее расписание не тронуто.']);
        toast('Загрузка отменена', 'info');
        return;
      }
      showResult('info', 'Сохраняю в память телефона…');
      const ds = makeDataset(check, file.name);
      await saveDataset(ds);
      setDataset(ds);
      prefs.setRemindMonth(monthKey(new Date()));
      showResult('ok', 'Расписание загружено', [statsText(check.stats), ...(warnings.length ? [`Замечаний: ${warnings.length} (часть данных пропущена)`] : [])]);
      toast(`Расписание загружено: ${countText(check.stats.lines, 'линия', 'линии', 'линий')}`, 'ok');
      drawStatus();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showResult('err', 'Не удалось загрузить', [msg]);
      toast(`Ошибка: ${msg}`, 'err');
    } finally {
      setBusy(false);
      input.value = '';
    }
  };

  uploadBtn.addEventListener('click', () => {
    if (busy) return;
    input.value = '';
    input.click();
  });
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    if (!f) return;
    void handleFile(f);
  });

  const formatCard = el(
    'div',
    { class: 'card pad format' },
    el('h4', null, 'Формат файла'),
    el(
      'ul',
      { class: 'fmt-list' },
      el('li', null, el('b', null, 'Тип: '), 'JSON, расширение ', el('code', null, '.json'), ', кодировка UTF-8'),
      el('li', null, el('b', null, 'Метка: '), el('code', null, `"format": "${FILE_FORMAT}"`)),
      el('li', null, el('b', null, 'Содержимое: '), 'линии → направления → время отправления «ЧЧ:ММ» для будней, субботы и воскресенья'),
      el('li', null, el('b', null, 'Размер: '), `до ${fmtSize(MAX_FILE_BYTES)}`),
      el('li', null, el('b', null, 'Как получить: '), 'скрипт ', el('code', null, 'tools/collect_gsp.py'), ' (см. README)'),
    ),
    el('details', null, el('summary', null, 'Пример структуры'), el('pre', null, EXAMPLE)),
  );

  scroll.append(
    el('section', { class: 'section' }, el('h3', null, 'Расписание'), el('div', { class: 'card pad' }, status, uploadBtn, result, input), formatCard),
  );
  drawStatus();

  // ================= Тема
  const themeList = el('div', { class: 'themes' });
  const drawThemes = () => {
    clear(themeList);
    (Object.keys(THEMES) as ThemeName[]).forEach((k) => {
      const t = THEMES[k];
      themeList.append(
        el(
          'button',
          {
            class: 'theme-card' + (prefs.theme === k ? ' active' : ''),
            'aria-pressed': String(prefs.theme === k),
            onclick: () => {
              prefs.setTheme(k);
              applyTheme(k);
              drawThemes();
            },
          },
          el('span', { class: `swatch swatch-${k}` }, el('i'), el('i'), el('i')),
          el('span', { class: 'grow' }, el('b', null, t.title), el('small', null, t.desc)),
          el('span', { class: 'radio' }),
        ),
      );
    });
  };
  drawThemes();
  scroll.append(el('section', { class: 'section' }, el('h3', null, 'Тема'), themeList));

  // ================= О приложении
  scroll.append(
    el(
      'section',
      { class: 'section about' },
      el('h3', null, 'О приложении'),
      el(
        'div',
        { class: 'card pad about-card' },
        el('span', { class: 'brand-logo', role: 'img', 'aria-label': 'DataLaw' }),
        el('div', { class: 'grow' }, el('b', null, 'DataLaw Transit'), el('div', { class: 'muted' }, 'Общественный транспорт Белграда'), el('div', { class: 'muted' }, `Версия ${__APP_VERSION__} (сборка ${__BUILD_DATE__})`)),
      ),
      el('p', { class: 'muted small' }, 'Приложение работает полностью офлайн и ничего не скачивает само. Время плановое: фактическое движение может отличаться.'),
    ),
  );
  return () => {};
}
