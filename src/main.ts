import './styles.css';
import { Capacitor } from '@capacitor/core';
import { prefs } from './prefs.ts';
import { shouldRemind } from './remind.ts';
import { data, hasData, initStore } from './store.ts';
import { datasetStats } from './dataset.ts';
import { fmtDateInt, monthKey, validityFull } from './format.ts';
import { button, emptyState } from './ui/common.ts';
import { clear, el, icon } from './ui/dom.ts';
import type { IconName } from './ui/dom.ts';
import { initChanges, onChangesUpdated, unseenCount } from './changes-sync.ts';
import { changesView } from './ui/changes-view.ts';
import { favView } from './ui/fav-view.ts';
import { linesView } from './ui/lines-view.ts';
import { handleBack, openTab, parseHash, resetToFav } from './ui/nav.ts';
import type { Loc, TabId } from './ui/nav.ts';
import { modal } from './ui/overlay.ts';
import { routeView } from './ui/route-view.ts';
import { settingsView } from './ui/settings-view.ts';
import { applyTheme } from './ui/theme.ts';

type Cleanup = () => void;
type ViewFn = (host: HTMLElement, loc: Loc) => Cleanup | void;

applyTheme(prefs.theme);

const TABS: { id: TabId; label: string; icon: IconName }[] = [
  { id: 'fav', label: 'Избранное', icon: 'star' },
  { id: 'lines', label: 'Линии', icon: 'bus' },
  { id: 'changes', label: 'Изменения', icon: 'warn' },
  { id: 'settings', label: 'Настройки', icon: 'sliders' },
];

const VIEWS: Record<string, { tab: TabId | null; fn: ViewFn }> = {
  fav: { tab: 'fav', fn: favView },
  lines: { tab: 'lines', fn: linesView },
  changes: { tab: 'changes', fn: changesView },
  settings: { tab: 'settings', fn: settingsView },
  route: { tab: null, fn: routeView },
};

const app = document.getElementById('app')!;
const view = el('main', { class: 'view', id: 'view' });
const tabButtons = TABS.map((t) => {
  const b = el('button', { class: 'tab', 'data-tab': t.id, 'aria-label': t.label }, el('span', { class: 'tab-ico' }, icon(t.icon)), el('span', { class: 'tab-label' }, t.label));
  b.addEventListener('click', () => openTab(t.id));
  if (t.id === 'changes') b.querySelector('.tab-ico')!.append(el('span', { class: 'tab-dot hidden', 'aria-label': 'Есть новые изменения' }));
  return b;
});
const nav = el('nav', { class: 'tabbar', 'aria-label': 'Разделы' }, ...tabButtons);
app.append(view, nav);

let cleanup: Cleanup | null = null;
let token = 0;
/** вкладка, с которой открыта линия — её и подсвечиваем на экране линии */
let lastTab: TabId = 'fav';

function render(): void {
  const my = ++token;
  cleanup?.();
  cleanup = null;
  const loc = parseHash();
  const def = VIEWS[loc.path[0] ?? ''];
  if (!def) {
    openTab('fav');
    return;
  }
  if (def.tab) lastTab = def.tab;
  tabButtons.forEach((b) => {
    const on = b.getAttribute('data-tab') === lastTab;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  const host = el('div', { class: 'page' });
  let c: Cleanup | void = undefined;
  try {
    c = def.fn(host, loc);
  } catch (e) {
    clear(host);
    host.append(emptyState('Что-то пошло не так', e instanceof Error ? e.message : String(e), button('В избранное', () => openTab('fav'))));
  }
  if (my !== token) {
    if (typeof c === 'function') c();
    return;
  }
  cleanup = typeof c === 'function' ? c : null;
  view.replaceChildren(host);
}

/** Точка на вкладке «Изменения», если появились новые, которые ещё не смотрели. */
function updateBadge(): void {
  const dot = nav.querySelector('.tab-dot');
  const onTab = (parseHash().path[0] ?? '') === 'changes';
  dot?.classList.toggle('hidden', onTab || unseenCount() === 0);
}

/** Раз в месяц, при первом открытии: напомнить проверить актуальность расписания. */
function monthlyReminder(): void {
  const now = new Date();
  if (!shouldRemind(prefs.remindMonth, now, hasData())) return;
  prefs.setRemindMonth(monthKey(now));
  const ds = data();
  const s = datasetStats(ds);
  const v = validityFull(s.validFrom, ds.validTo);
  modal({
    title: 'Проверьте расписание',
    body: [
      el('p', null, 'Новый месяц — самое время проверить, не обновилось ли расписание. Загрузите свежее расписание в настройках, если оно обновилось.'),
      el('div', { class: 'muted small' }, `Сейчас загружено: ${fmtDateInt(+ds.builtAt.slice(0, 10).replace(/-/g, ''))}`),
      v ? el('div', { class: 'muted small' }, v) : null,
    ],
    actions: [
      { label: 'Понятно', kind: 'plain' },
      { label: 'Открыть настройки', kind: 'primary', onClick: () => openTab('settings') },
    ],
  });
}

window.addEventListener('hashchange', render);

// системная кнопка «назад» на Android: по шагам до «Избранного», в «Избранном» — остаёмся на месте
if (Capacitor.isNativePlatform()) {
  void import('@capacitor/app').then(({ App }) => App.addListener('backButton', () => handleBack())).catch(() => {});
}

(async () => {
  try {
    await initStore();
  } catch (e) {
    console.error(e);
  }
  await initChanges();
  resetToFav(); // приложение всегда открывается на «Избранном»
  render();
  updateBadge();
  onChangesUpdated(updateBadge);
  window.addEventListener('hashchange', updateBadge);
  monthlyReminder();
})();
