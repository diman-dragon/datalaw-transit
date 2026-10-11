import { clearDataset, clearRaw, loadLastDiff, loadRawInfos } from '../db.ts';
import type { RawInfo } from '../db.ts';
import { applyPending, prepareUpdate, readZipFile } from '../importer.ts';
import type { Pending, PrepareOptions } from '../importer.ts';
import { fmtDateInt } from '../compare.ts';
import type { Diff } from '../compare.ts';
import { diffPanel } from './diff-panel.ts';
import { prefs } from '../prefs.ts';
import type { FeedCfg, ThemeName } from '../prefs.ts';
import { data, hasData, setCore } from '../store.ts';
import { pageHeader } from './common.ts';
import { clear, el, icon } from './dom.ts';
import { applyTheme, THEMES } from './theme.ts';

const dtFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

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

  // ---------- Данные
  const status = el('div', { class: 'data-status' });
  const progress = el('div', { class: 'progress', 'aria-live': 'polite' });
  const pendingHost = el('div', { class: 'pending' });
  const lastHost = el('div');
  const feedsHost = el('div', { class: 'feeds' });
  const updateBtn = el('button', { class: 'btn primary wide' }, icon('download'), 'Скачать / обновить все источники');
  const rebuildBtn = el('button', { class: 'btn wide' }, 'Пересобрать из сохранённых файлов');
  const fileInput = el('input', { type: 'file', accept: '.zip,application/zip', class: 'hidden' });
  let busy = false;
  let fileFeed: FeedCfg | null = null;
  let pending: Pending | null = null;

  const setBusy = (b: boolean) => {
    busy = b;
    root.querySelectorAll<HTMLButtonElement | HTMLInputElement>('.data-section button, .data-section input').forEach((x) => (x.disabled = b));
  };

  const drawStatus = () => {
    clear(status);
    if (!hasData()) {
      status.append(el('b', null, 'Данных нет'), el('div', { class: 'muted' }, 'Нажмите кнопку ниже — приложение скачает расписание с портала открытых данных Сербии (data.gov.rs). Можно и вручную: скачайте zip в браузере и выберите его в разделе «Источники».'));
      return;
    }
    const m = data().meta;
    status.append(
      el('b', null, 'Данные загружены'),
      el('div', { class: 'muted' }, `Собрано: ${dtFmt.format(new Date(m.builtAt))}`),
      el('div', { class: 'muted' }, `${m.routes} линий · ${m.stops} остановок · ${m.trips.toLocaleString('ru-RU')} рейсов`),
      ...m.feeds.map((f) =>
        el('div', { class: 'feed-valid' }, el('b', null, f.name), el('div', { class: 'muted' }, `Расписание действует с ${fmtDateInt(f.startDate)} по ${fmtDateInt(f.endDate)}${f.version ? ' · версия ' + f.version : ''}`)),
      ),
    );
  };

  const drawPending = () => {
    clear(pendingHost);
    if (!pending) return;
    const p = pending;
    pendingHost.appendChild(
      el(
        'div',
        { class: 'card pad pending-card' },
        el('h4', null, 'Новые данные готовы — проверьте и примените'),
        diffPanel(p.diff),
        p.warnings.length ? el('div', { class: 'banner warn' }, p.warnings.join('\n')) : null,
        el(
          'div',
          { class: 'btn-row' },
          el(
            'button',
            {
              class: 'btn primary',
              onclick: async () => {
                if (busy) return;
                setBusy(true);
                try {
                  await applyPending(p, (m) => report(m));
                  pending = null;
                  report('Готово. Новые данные применены.', 'ok');
                } catch (e) {
                  report('Ошибка: ' + (e instanceof Error ? e.message : String(e)), 'err');
                } finally {
                  setBusy(false);
                  await refresh();
                }
              },
            },
            'Применить',
          ),
          el(
            'button',
            {
              class: 'btn',
              onclick: () => {
                pending = null;
                report('Отменено. Прежние данные не тронуты.', 'info');
                drawPending();
              },
            },
            'Отмена',
          ),
        ),
      ),
    );
  };

  const drawLast = async () => {
    clear(lastHost);
    const last = await loadLastDiff<Diff>().catch(() => undefined);
    if (!last || !hasData()) return;
    lastHost.appendChild(
      el('details', { class: 'card pad' }, el('summary', null, `Что изменилось при обновлении ${dtFmt.format(new Date(last.at))}`), diffPanel(last.diff)),
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
          el('div', { class: 'muted small' }, info ? `Файл: ${fmtSize(info.size)}, ${info.source === 'file' ? 'выбран вручную' : 'скачан'} ${dtFmt.format(new Date(info.savedAt))}` : 'Файл ещё не загружен'),
          el(
            'details',
            null,
            el('summary', null, 'Ссылка и ручная загрузка'),
            url,
            el('div', { class: 'btn-row' },
              el('button', { class: 'btn small', onclick: () => void run({ download: [f.key] }) }, icon('download'), 'Скачать этот источник'),
              el('button', {
                class: 'btn small',
                onclick: () => {
                  fileFeed = prefs.feeds().find((x) => x.key === f.key) ?? null;
                  fileInput.value = '';
                  fileInput.click();
                },
              }, icon('file'), 'Выбрать zip вручную…'),
            ),
          ),
        ),
      );
    }
    rebuildBtn.style.display = Object.keys(infos).length ? '' : 'none';
  };

  const report = (msg: string, kind: 'info' | 'ok' | 'err' = 'info') => {
    progress.className = 'progress ' + kind;
    progress.textContent = msg;
  };

  const refresh = async () => {
    Object.assign(infos, await loadRawInfos().catch(() => ({})));
    drawStatus();
    drawFeeds();
    drawPending();
    await drawLast();
    setBusy(busy);
  };

  /** Подготовить обновление (скачать / принять файл), собрать данные и показать сравнение. Применяется отдельной кнопкой. */
  const run = async (opt: PrepareOptions) => {
    if (busy) return;
    setBusy(true);
    pending = null;
    drawPending();
    report('Начинаю…');
    try {
      pending = await prepareUpdate(prefs.feeds(), opt, (m) => report(m));
      report('Данные собраны, но ещё не применены. Посмотрите сравнение ниже.', 'ok');
    } catch (e) {
      report('Ошибка: ' + (e instanceof Error ? e.message : String(e)), 'err');
    } finally {
      setBusy(false);
      drawPending();
      setBusy(busy);
    }
  };

  updateBtn.addEventListener('click', () => void run({ download: prefs.feeds().filter((f) => f.enabled).map((f) => f.key) }));
  rebuildBtn.addEventListener('click', () => void run({}));

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    const feed = fileFeed;
    if (!file || !feed || busy) return;
    try {
      report(`Читаю файл ${file.name}…`);
      const bytes = await readZipFile(file);
      await run({ files: { [feed.key]: bytes } });
    } catch (e) {
      report('Ошибка: ' + (e instanceof Error ? e.message : String(e)), 'err');
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
        pending = null;
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
  void drawLast();
  root.appendChild(
    el(
      'section',
      { class: 'section data-section' },
      el('h3', null, 'Данные расписания'),
      el('div', { class: 'card pad' }, status, updateBtn, rebuildBtn, progress, fileInput),
      pendingHost,
      lastHost,
      el('h4', { class: 'group-title' }, 'Источники'),
      feedsHost,
      wipe,
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
      el('p', { class: 'muted small pad' }, 'Приложение работает полностью офлайн: интернет нужен только для кнопки загрузки данных. Расписание — по открытым данным GTFS (портал data.gov.rs), показаны отправления от конечных остановок. Время плановое: фактическое движение может отличаться.'),
    ),
  );
  return () => {};
}
