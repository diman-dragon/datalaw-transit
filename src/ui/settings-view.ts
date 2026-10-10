import { clearDataset, clearRaw, loadRawInfos } from '../db.ts';
import type { RawInfo } from '../db.ts';
import { importFile, rebuild, updateFromNetwork } from '../importer.ts';
import { routePlanner } from '../planned/routing.ts';
import { arrivalProvider } from '../planned/arrivals.ts';
import { prefs } from '../prefs.ts';
import type { FeedCfg, ThemeName } from '../prefs.ts';
import { data, hasData, setCore } from '../store.ts';
import { pageHeader } from './common.ts';
import { clear, el, icon } from './dom.ts';
import { applyTheme, THEMES } from './theme.ts';

const dtFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function fmtDateInt(n: number): string {
  if (!n) return '—';
  const s = String(n);
  return `${s.slice(6, 8)}.${s.slice(4, 6)}.${s.slice(0, 4)}`;
}

function fmtSize(b: number): string {
  return b > 1048576 ? `${(b / 1048576).toFixed(1)} МБ` : `${Math.round(b / 1024)} КБ`;
}

export async function settingsView(root: HTMLElement): Promise<() => void> {
  root.appendChild(pageHeader({ title: 'Настройки' }));
  const infos = await loadRawInfos().catch(() => ({}) as Record<string, RawInfo>);

  // ---------- Тема
  const themeList = el('div', { class: 'themes' });
  const drawThemes = () => {
    clear(themeList);
    (Object.keys(THEMES) as ThemeName[]).forEach((k) => {
      const t = THEMES[k];
      themeList.appendChild(
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
  root.appendChild(el('section', { class: 'section' }, el('h3', null, 'Тема'), themeList));

  // ---------- Карта
  const tilesCheck = el('input', { type: 'checkbox', checked: prefs.mapTiles || undefined });
  tilesCheck.addEventListener('change', () => prefs.setMapTiles(tilesCheck.checked));
  root.appendChild(
    el(
      'section',
      { class: 'section' },
      el('h3', null, 'Карта'),
      el('div', { class: 'card pad' }, el('label', { class: 'check' }, tilesCheck, el('span', null, 'Подложка OpenStreetMap')), el('p', { class: 'muted small' }, 'Подгружает плитки карты из интернета и показывается только на вкладке «Карта». Без неё маршрут рисуется по остановкам на чистом фоне, интернет не нужен. Данные карты © участники OpenStreetMap.')),
    ),
  );

  // ---------- Данные
  const status = el('div', { class: 'data-status' });
  const progress = el('div', { class: 'progress', 'aria-live': 'polite' });
  const feedsHost = el('div', { class: 'feeds' });
  const updateBtn = el('button', { class: 'btn primary wide' }, icon('download'), 'Скачать / обновить данные');
  const fileInput = el('input', { type: 'file', accept: '.zip,application/zip', class: 'hidden' });
  let busy = false;
  let fileFeed: FeedCfg | null = null;

  const setBusy = (b: boolean) => {
    busy = b;
    updateBtn.toggleAttribute('disabled', b);
    root.querySelectorAll<HTMLButtonElement | HTMLInputElement>('.feeds button, .feeds input, .danger').forEach((x) => (x.disabled = b));
  };

  const drawStatus = () => {
    clear(status);
    if (!hasData()) {
      status.append(el('b', null, 'Данных нет'), el('div', { class: 'muted' }, 'Нажмите кнопку ниже — приложение скачает расписание с портала открытых данных Сербии (data.gov.rs).'));
      return;
    }
    const m = data().meta;
    status.append(
      el('b', null, 'Данные загружены'),
      el('div', { class: 'muted' }, `Собрано: ${dtFmt.format(new Date(m.builtAt))}`),
      el('div', { class: 'muted' }, `${m.routes} линий · ${m.stops} остановок · ${m.trips.toLocaleString('ru-RU')} рейсов`),
      ...m.feeds.map((f) =>
        el('div', { class: 'muted' }, `${f.name}: ${f.routes} линий, расписание ${fmtDateInt(f.startDate)} – ${fmtDateInt(f.endDate)}${f.version ? ', версия ' + f.version : ''}`),
      ),
    );
  };

  const drawFeeds = () => {
    clear(feedsHost);
    for (const f of prefs.feeds()) {
      const info = infos[f.key];
      const url = el('input', { type: 'url', class: 'text-input', value: f.url, spellcheck: 'false', autocapitalize: 'off', 'aria-label': 'Ссылка на GTFS zip' });
      url.addEventListener('change', () => prefs.setFeed(f.key, { url: url.value }));
      const check = el('input', { type: 'checkbox', checked: f.enabled || undefined });
      check.addEventListener('change', () => prefs.setFeed(f.key, { enabled: check.checked }));
      feedsHost.appendChild(
        el(
          'div',
          { class: 'feed' },
          el('label', { class: 'check' }, check, el('span', null, f.name)),
          el('div', { class: 'muted small' }, info ? `Файл: ${fmtSize(info.size)}, ${info.source === 'file' ? 'из файла' : 'скачан'} ${dtFmt.format(new Date(info.savedAt))}` : 'Файл ещё не загружен'),
          el('details', null, el('summary', null, 'Ссылка и загрузка из файла'), url, el('button', {
            class: 'btn small',
            onclick: () => {
              fileFeed = prefs.feeds().find((x) => x.key === f.key) ?? null;
              fileInput.value = '';
              fileInput.click();
            },
          }, icon('file'), 'Выбрать zip с телефона…')),
        ),
      );
    }
  };

  const report = (msg: string, kind: 'info' | 'ok' | 'err' = 'info') => {
    progress.className = 'progress ' + kind;
    progress.textContent = msg;
  };

  const refresh = async () => {
    Object.assign(infos, await loadRawInfos().catch(() => ({})));
    drawStatus();
    drawFeeds();
    setBusy(busy);
  };

  updateBtn.addEventListener('click', async () => {
    if (busy) return;
    setBusy(true);
    report('Начинаю…');
    try {
      const res = await updateFromNetwork(prefs.feeds(), (m) => report(m));
      report(res.warnings.length ? 'Готово, но есть замечания:\n' + res.warnings.join('\n') : 'Готово. Данные обновлены.', res.warnings.length ? 'info' : 'ok');
    } catch (e) {
      report('Ошибка: ' + (e instanceof Error ? e.message : String(e)), 'err');
    } finally {
      setBusy(false);
      await refresh();
    }
  });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    const feed = fileFeed;
    if (!file || !feed || busy) return;
    setBusy(true);
    report(`Читаю файл ${file.name}…`);
    try {
      await importFile(feed, file);
      await rebuild(prefs.feeds(), (m) => report(m));
      report('Готово. Данные собраны из файла.', 'ok');
    } catch (e) {
      report('Ошибка: ' + (e instanceof Error ? e.message : String(e)), 'err');
    } finally {
      setBusy(false);
      await refresh();
    }
  });

  const wipe = el('button', {
    class: 'btn danger wide',
    onclick: async () => {
      if (busy || !confirm('Удалить скачанные данные расписания с телефона? Избранное сохранится.')) return;
      setBusy(true);
      try {
        await clearDataset();
        await clearRaw();
        setCore(null);
        for (const k of Object.keys(infos)) delete infos[k];
        report('Данные удалены.', 'ok');
      } catch (e) {
        report('Ошибка: ' + (e instanceof Error ? e.message : String(e)), 'err');
      } finally {
        setBusy(false);
        await refresh();
      }
    },
  }, 'Удалить данные расписания');

  drawStatus();
  drawFeeds();
  root.appendChild(
    el('section', { class: 'section' }, el('h3', null, 'Данные расписания'), el('div', { class: 'card pad' }, status, updateBtn, progress, fileInput), el('h4', { class: 'group-title' }, 'Источники'), feedsHost, wipe),
  );

  // ---------- Планируется
  const planned = (title: string, text: string, ready: boolean) =>
    el('div', { class: 'planned' }, el('div', { class: 'grow' }, el('b', null, title), el('small', null, text)), el('span', { class: 'pill' + (ready ? ' ok' : '') }, ready ? 'готово' : 'в планах'));
  root.appendChild(
    el(
      'section',
      { class: 'section' },
      el('h3', null, 'Планируется'),
      el('div', { class: 'card' },
        planned('Маршруты с пересадками', 'Из точки A в точку B с пересадками и пешими участками (линии без пересадок уже есть на вкладке «Из А в Б»)', routePlanner !== null),
        planned('Время прибытия', 'Когда реально приедет автобус (сейчас — только плановое расписание)', arrivalProvider().realtime),
      ),
    ),
  );

  // ---------- О приложении
  root.appendChild(
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
      el('p', { class: 'muted small pad' }, 'Расписание — по открытым данным GTFS (портал data.gov.rs). Время плановое: фактическое движение может отличаться.'),
    ),
  );
  return () => {};
}
