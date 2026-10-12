import { datasetStats } from '../dataset.ts';
import { saveDataset } from '../db.ts';
import { FEEDS } from '../feeds.ts';
import { fmtDateInt, monthKey, plural, validityFull } from '../format.ts';
import { buildFromZips, fetchSchedule, readZipFile } from '../importer.ts';
import { prefs } from '../prefs.ts';
import type { ThemeName } from '../prefs.ts';
import { data, hasData, setDataset } from '../store.ts';
import { CAT_LABEL } from '../types.ts';
import type { Dataset } from '../types.ts';
import { dateToInt } from '../format.ts';
import { titleBar } from './common.ts';
import { append, clear, el, icon } from './dom.ts';
import { confirmDialog, toast } from './overlay.ts';
import { applyTheme, THEMES } from './theme.ts';

const dtFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function countText(n: number, one: string, few: string, many: string): string {
  return `${n.toLocaleString('ru-RU')} ${plural(n, one, few, many)}`;
}

function statsText(s: { lines: number; dirs: number; departures: number }): string {
  return `${countText(s.lines, 'линия', 'линии', 'линий')} · ${countText(s.dirs, 'направление', 'направления', 'направлений')} · ${countText(s.departures, 'отправление', 'отправления', 'отправлений')}`;
}

function host(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function settingsView(host_: HTMLElement): () => void {
  host_.append(titleBar('Настройки'));
  const scroll = el('div', { class: 'scroll settings' });
  host_.append(scroll);

  // ================= Расписание: загрузка с data.gov.rs
  const status = el('div', { class: 'data-status' });
  const result = el('div', { class: 'result', 'aria-live': 'polite' });
  const loadBtn = el('button', { class: 'btn primary wide' }, icon('download'), 'Загрузить расписание');
  let busy = false;

  const showResult = (kind: 'info' | 'ok' | 'err', title: string, lines: string[] = []) => {
    clear(result);
    result.className = `result ${kind}`;
    result.append(el('b', null, title), ...lines.map((l) => el('div', null, l)));
  };

  const drawStatus = () => {
    clear(status);
    if (!hasData()) {
      append(status, [el('b', null, 'Расписание не загружено'), el('div', { class: 'muted' }, 'Нажмите кнопку ниже — приложение скачает расписание с портала открытых данных Сербии.')]);
      return;
    }
    const ds = data();
    const s = datasetStats(ds);
    const v = validityFull(s.validFrom, ds.validTo);
    append(status, [
      el('b', null, 'Расписание загружено'),
      el('div', { class: 'muted' }, `Источник: ${ds.source || ds.fileName || '—'}`),
      el('div', { class: 'muted' }, `Загружено: ${dtFmt.format(new Date(ds.builtAt))}`),
      el('div', { class: 'muted' }, statsText(s)),
      v ? el('div', { class: 'muted' }, v) : null,
    ]);
  };

  const summaryNodes = (ds: Dataset): (Node | string)[] => {
    const s = datasetStats(ds);
    const cats = new Map<string, number>();
    for (const l of ds.lines) cats.set(CAT_LABEL[l.cat], (cats.get(CAT_LABEL[l.cat]) ?? 0) + 1);
    const v = validityFull(s.validFrom, ds.validTo);
    const nodes: (Node | string)[] = [
      el('div', { class: 'sum-line' }, statsText(s)),
      el('div', { class: 'muted small' }, [...cats].map(([k, n]) => `${k}: ${n}`).join(' · ')),
    ];
    if (v) nodes.push(el('div', { class: 'muted small' }, v));
    return nodes;
  };

  const warningsFor = (ds: Dataset): string[] => {
    const w: string[] = [];
    const today = dateToInt(new Date());
    if (ds.validTo && ds.validTo < today) w.push(`Срок действия этого расписания истёк ${fmtDateInt(ds.validTo)}: на портале пока нет более свежего.`);
    const s = datasetStats(ds);
    if (s.validFrom && s.validFrom > today) w.push(`Расписание начнёт действовать только с ${fmtDateInt(s.validFrom)}.`);
    if (hasData()) {
      const cur = data();
      if (ds.validTo && cur.validTo && ds.validTo < cur.validTo) w.push(`Новое расписание заканчивается раньше текущего (${fmtDateInt(ds.validTo)} против ${fmtDateInt(cur.validTo)}).`);
      if (ds.lines.length < cur.lines.length * 0.7) w.push(`В новом расписании заметно меньше линий: ${ds.lines.length} против ${cur.lines.length}.`);
      const have = new Set(ds.lines.map((l) => l.id));
      const lost = prefs.favs().filter((f) => !have.has(f));
      if (lost.length) w.push(`Из избранного в новом расписании нет: ${lost.map((x) => x.replace(/^[a-z]:/, '')).join(', ')}.`);
    }
    return w;
  };

  const fileInput = el('input', { type: 'file', accept: '.zip,application/zip,application/x-zip-compressed', multiple: true, class: 'hidden-input' });
  const fileBtn = el('button', { class: 'btn plain wide' }, icon('upload'), 'Загрузить из архива (zip)');

  /** Общая часть: получить набор данных → показать сводку → после подтверждения сохранить. */
  const load = async (produce: () => Promise<Dataset>) => {
    if (busy) return;
    busy = true;
    loadBtn.disabled = true;
    fileBtn.disabled = true;
    showResult('info', 'Загрузка…', ['Это может занять до минуты.']);
    try {
      const ds = await produce();
      const warnings = warningsFor(ds);
      showResult('info', 'Расписание получено', [statsText(datasetStats(ds)), 'Подтвердите замену в окне.']);
      const yes = await confirmDialog({
        title: hasData() ? 'Заменить расписание?' : 'Сохранить расписание?',
        body: [
          ...summaryNodes(ds),
          warnings.length ? el('div', { class: 'warn-box' }, el('b', null, `Замечания: ${warnings.length}`), el('ul', null, ...warnings.map((w) => el('li', null, w)))) : null,
          hasData() ? el('p', { class: 'muted small' }, 'Прежнее расписание будет заменено. Избранное сохранится.') : null,
        ],
        ok: hasData() ? 'Заменить' : 'Сохранить',
      });
      if (!yes) {
        showResult('info', 'Загрузка отменена', ['Прежнее расписание не тронуто.']);
        toast('Загрузка отменена', 'info');
        return;
      }
      showResult('info', 'Сохраняю в память телефона…');
      await saveDataset(ds);
      setDataset(ds);
      prefs.setRemindMonth(monthKey(new Date()));
      showResult('ok', 'Расписание загружено', [statsText(datasetStats(ds)), ...(warnings.length ? [`Замечаний: ${warnings.length}`] : [])]);
      toast(`Расписание загружено: ${countText(ds.lines.length, 'линия', 'линии', 'линий')}`, 'ok');
      drawStatus();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showResult('err', 'Не удалось загрузить', [msg, 'Прежнее расписание не тронуто.']);
      toast(msg, 'err');
    } finally {
      busy = false;
      loadBtn.disabled = false;
      fileBtn.disabled = false;
    }
  };
  loadBtn.addEventListener('click', () => void load(() => fetchSchedule((m) => showResult('info', 'Загрузка…', [m]))));

  // ---- архив с телефона: тот же GTFS-формат, что отдаёт data.gov.rs (можно выбрать сразу два: город и пригород)
  const guessKey = (name: string) => (/prigrad|suburb|podgrad|пригор/i.test(name) ? 'p' : 'c');
  fileBtn.addEventListener('click', () => {
    fileInput.value = '';
    fileInput.click();
  });
  fileInput.addEventListener('change', () => {
    const files = Array.from(fileInput.files ?? []);
    if (!files.length || busy) return;
    const picks = files.map((f) => ({ f, sel: el('select', { class: 'feed-select' }, ...FEEDS.map((x) => el('option', { value: x.key }, x.name))) }));
    picks.forEach((p, i) => {
      let k = guessKey(p.f.name);
      // два файла без подсказки в имени: первый — город, второй — пригород
      if (picks.length > 1 && i > 0 && k === 'c' && !/prigrad|suburb|podgrad|пригор/i.test(p.f.name) && !/prigrad|suburb|podgrad|пригор/i.test(picks[0].f.name)) k = 'p';
      p.sel.value = k;
    });
    void (async () => {
      const yes = await confirmDialog({
        title: 'Что за архивы?',
        body: [
          el('p', { class: 'muted small' }, 'Нужен GTFS-архив в том же формате, что на data.gov.rs. Выберите тип для каждого файла: от него зависят категории и номера избранных линий.'),
          ...picks.map((p) => el('div', { class: 'feed-pick' }, el('div', { class: 'feed-file' }, p.f.name), p.sel)),
        ],
        ok: 'Продолжить',
      });
      if (!yes) return;
      const used = new Set<string>();
      for (const p of picks) {
        if (used.has(p.sel.value)) {
          toast('Для двух файлов выбран один и тот же тип', 'err');
          return;
        }
        used.add(p.sel.value);
      }
      void load(async () => {
        const feeds = [];
        for (const p of picks) {
          const cfg = FEEDS.find((x) => x.key === p.sel.value)!;
          showResult('info', 'Загрузка…', [`Читаю ${p.f.name}…`]);
          feeds.push({ key: cfg.key, name: cfg.name, zip: await readZipFile(p.f) });
        }
        return buildFromZips(feeds, (m) => showResult('info', 'Загрузка…', [m]));
      });
    })();
  });

  const sourcesCard = el(
    'div',
    { class: 'card pad format' },
    el('h4', null, 'Откуда берутся данные'),
    el(
      'ul',
      { class: 'fmt-list' },
      ...FEEDS.map((f) => el('li', null, el('b', null, `${f.name}: `), host(f.url))),
      el('li', null, el('b', null, 'Формат: '), 'открытый GTFS (zip): скачивается или выбирается из архива на телефоне'),
    ),
  );

  scroll.append(el('section', { class: 'section' }, el('h3', null, 'Расписание'), el('div', { class: 'card pad' }, status, loadBtn, fileBtn, fileInput, result), sourcesCard));
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
