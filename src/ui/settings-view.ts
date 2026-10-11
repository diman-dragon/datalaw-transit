import { clearDataset, clearRaw, loadCustomLayer, loadLastDiff, loadRawInfos } from '../db.ts';
import type { RawInfo } from '../db.ts';
import { applyCustom, applyPending, loadStoredCustom, prepareCustom, prepareUpdate, readZipFile } from '../importer.ts';
import type { CustomPending, Pending, PrepareOptions } from '../importer.ts';
import type { Choice, CustomLayer } from '../overlay.ts';
import { customPanel } from './custom-panel.ts';
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
  // свой файл расписания
  const customHost = el('div', { class: 'custom-host' });
  const customPendingHost = el('div', { class: 'pending' });
  const customInput = el('input', { type: 'file', accept: '.zip,application/zip', class: 'hidden' });
  let customPending: CustomPending | null = null;
  let layer: CustomLayer | undefined = await loadCustomLayer().catch(() => undefined);

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
        p.dropCustom ? el('div', { class: 'banner' }, 'Свой файл будет убран из приложения, данные вернутся к официальным.') : null,
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

  const drawCustomPending = () => {
    clear(customPendingHost);
    const cp = customPending;
    if (!cp) return;
    customPendingHost.appendChild(
      el(
        'div',
        { class: 'card pad pending-card' },
        el('h4', null, `Свой файл «${cp.fileName}» — сравнение с текущим расписанием`),
        customPanel(cp, {
          onApply: async (choices) => {
            if (busy) return;
            setBusy(true);
            try {
              await applyCustom(cp, choices, (m) => report(m));
              customPending = null;
              report('Готово. Свой файл применён.', 'ok');
            } catch (e) {
              report('Ошибка: ' + (e instanceof Error ? e.message : String(e)), 'err');
            } finally {
              setBusy(false);
              await refresh();
            }
          },
          onCancel: () => {
            customPending = null;
            report('Отменено. Прежние данные не тронуты.', 'info');
            drawCustomPending();
          },
        }),
      ),
    );
  };

  const drawCustom = () => {
    clear(customHost);
    customHost.appendChild(el('h4', { class: 'group-title' }, 'Свой файл расписания'));
    customHost.appendChild(
      el(
        'p',
        { class: 'muted small' },
        'Загрузите свой GTFS (zip): приложение сравнит его с текущим расписанием по линиям, а по каждому отличию вы выберете, какая версия останется. Сначала должны быть загружены официальные данные.',
      ),
    );
    const pick = () => {
      if (!hasData()) {
        report('Сначала загрузите официальное расписание: свой файл сравнивается с ним.', 'err');
        return;
      }
      customInput.value = '';
      customInput.click();
    };
    if (layer) {
      const mine = Object.values(layer.choices).filter((c) => c === 'custom').length;
      customHost.appendChild(
        el(
          'div',
          { class: 'feed' },
          el('b', null, `«${layer.fileName}»`),
          el('div', { class: 'muted small' }, `${fmtSize(layer.size)}, загружен ${dtFmt.format(new Date(layer.savedAt))}`),
          el('div', { class: 'muted small' }, `Выбрана своя версия для линий: ${mine}. При обновлении официальных данных этот выбор применяется заново.`),
          el(
            'div',
            { class: 'btn-row' },
            el('button', { class: 'btn small', onclick: () => void reviewCustom() }, 'Пересмотреть выбор'),
            el('button', { class: 'btn small', onclick: pick }, icon('file'), 'Заменить файл…'),
            el('button', { class: 'btn small danger', onclick: () => void run({ dropCustom: true }) }, 'Убрать свой файл'),
          ),
        ),
      );
    } else {
      const b = el('button', { class: 'btn wide', onclick: pick }, icon('file'), 'Загрузить свой файл…');
      if (!hasData()) b.classList.add('is-off');
      customHost.appendChild(b);
    }
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
    layer = await loadCustomLayer().catch(() => undefined);
    drawStatus();
    drawFeeds();
    drawPending();
    drawCustom();
    drawCustomPending();
    await drawLast();
    setBusy(busy);
  };

  /** Подготовить обновление (скачать / принять файл), собрать данные и показать сравнение. Применяется отдельной кнопкой. */
  const run = async (opt: PrepareOptions) => {
    if (busy) return;
    setBusy(true);
    pending = null;
    customPending = null;
    drawPending();
    drawCustomPending();
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

  /** Собрать свой файл, сравнить с текущими данными и показать выбор версий. Применяется отдельной кнопкой. */
  const runCustom = async (file: { fileName: string; bytes: Uint8Array }, previous?: Record<string, Choice>) => {
    if (busy) return;
    setBusy(true);
    pending = null;
    customPending = null;
    drawPending();
    drawCustomPending();
    report('Начинаю…');
    try {
      customPending = await prepareCustom(prefs.feeds(), file, (m) => report(m), previous);
      report('Свой файл сравнён с текущими данными, но ещё не применён. Выберите версии ниже.', 'ok');
    } catch (e) {
      report('Ошибка: ' + (e instanceof Error ? e.message : String(e)), 'err');
    } finally {
      drawCustomPending();
      setBusy(false);
    }
  };

  const reviewCustom = async () => {
    if (busy) return;
    const st = await loadStoredCustom();
    if (!st) {
      report('Сохранённый свой файл не найден. Загрузите его заново.', 'err');
      return;
    }
    await runCustom({ fileName: st.fileName, bytes: st.bytes }, st.choices);
  };

  customInput.addEventListener('change', async () => {
    const file = customInput.files?.[0];
    if (!file || busy) return;
    if (!hasData()) {
      report('Сначала загрузите официальное расписание: свой файл сравнивается с ним.', 'err');
      return;
    }
    try {
      report(`Читаю файл ${file.name}…`);
      await runCustom({ fileName: file.name, bytes: await readZipFile(file) });
    } catch (e) {
      report('Ошибка: ' + (e instanceof Error ? e.message : String(e)), 'err');
    }
  });

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
        customPending = null;
        layer = undefined;
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
  drawCustom();
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
      customHost,
      customInput,
      customPendingHost,
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
