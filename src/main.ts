import './styles.css';
import { prefs } from './prefs.ts';
import { initStore } from './store.ts';
import { clear, el, icon } from './ui/dom.ts';
import { betweenView } from './ui/between-view.ts';
import { favView } from './ui/fav-view.ts';
import { parseHash } from './ui/router.ts';
import type { Route } from './ui/router.ts';
import { routeView } from './ui/route-view.ts';
import { searchView } from './ui/search-view.ts';
import { settingsView } from './ui/settings-view.ts';
import { stopView } from './ui/stop-view.ts';
import { applyTheme } from './ui/theme.ts';

type Cleanup = () => void;
type ViewFn = (host: HTMLElement, r: Route) => Cleanup | void | Promise<Cleanup | void>;

applyTheme(prefs.theme);

const app = document.getElementById('app')!;
const view = el('main', { class: 'view', id: 'view' });
const tabs: { id: string; label: string; href: string; icon: 'search' | 'route' | 'star' | 'gear' }[] = [
  { id: 'search', label: 'Поиск', href: '#/', icon: 'search' },
  { id: 'between', label: 'Из А в Б', href: '#/between', icon: 'route' },
  { id: 'fav', label: 'Избранное', href: '#/fav', icon: 'star' },
  { id: 'settings', label: 'Настройки', href: '#/settings', icon: 'gear' },
];
const nav = el(
  'nav',
  { class: 'tabbar', 'aria-label': 'Разделы' },
  ...tabs.map((t) => el('a', { class: 'tab', href: t.href, 'data-tab': t.id }, icon(t.icon), el('span', null, t.label))),
);
app.append(view, nav);

const views: Record<string, { tab: string; fn: ViewFn }> = {
  '': { tab: 'search', fn: searchView },
  between: { tab: 'between', fn: betweenView },
  fav: { tab: 'fav', fn: favView },
  settings: { tab: 'settings', fn: settingsView },
  stop: { tab: 'search', fn: stopView },
  route: { tab: 'search', fn: routeView },
};

let cleanup: Cleanup | null = null;
let token = 0;

async function render(): Promise<void> {
  const my = ++token;
  cleanup?.();
  cleanup = null;
  const r = parseHash();
  const def = views[r.path[0] ?? ''] ?? views[''];
  nav.querySelectorAll('.tab').forEach((a) => a.classList.toggle('active', a.getAttribute('data-tab') === def.tab));
  const host = el('div', { class: 'page' });
  let c: Cleanup | void = undefined;
  try {
    c = await def.fn(host, r);
  } catch (e) {
    clear(host);
    host.append(el('div', { class: 'empty' }, el('h2', null, 'Что-то пошло не так'), el('p', null, e instanceof Error ? e.message : String(e))));
  }
  if (my !== token) {
    if (typeof c === 'function') c();
    return;
  }
  cleanup = typeof c === 'function' ? c : null;
  view.replaceChildren(host);
  view.scrollTop = 0;
}

window.addEventListener('hashchange', () => void render());

(async () => {
  try {
    await initStore();
  } catch (e) {
    console.error(e);
  }
  await render();
})();
