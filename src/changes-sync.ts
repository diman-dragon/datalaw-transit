import { kvGet, kvPut } from './db.ts';
import { buildDoc, CHANGES_URL, extractIds, stylesheetUrls } from './changes-page.ts';
import { getText, isWifi, WIFI_ONLY_MESSAGE } from './net.ts';
import { prefs } from './prefs.ts';

const KEY = 'changes-page';

/** Сохранённая страница «Актуелне измене». */
export interface PageSnapshot {
  /** когда скачано (ISO) */
  fetchedAt: string;
  /** готовый к показу HTML (стили вшиты, скриптов нет) */
  doc: string;
  /** номера объявлений на странице */
  ids: string[];
  /** номера, которых не было в предыдущей копии */
  newIds: string[];
}

let snap: PageSnapshot | null = null;
let inflight: Promise<RefreshResult> | null = null;
const listeners = new Set<() => void>();

export interface RefreshResult {
  total: number;
  fresh: number;
}

export async function initChanges(): Promise<void> {
  try {
    snap = (await kvGet<PageSnapshot>(KEY)) ?? null;
  } catch {
    snap = null;
  }
}

export function savedPage(): PageSnapshot | null {
  return snap;
}

export function onChangesUpdated(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Сколько новых объявлений появилось в последней скачанной копии, которую вы ещё не смотрели. */
export function unseenCount(): number {
  if (!snap || !snap.newIds.length) return 0;
  return snap.fetchedAt > prefs.changesViewed ? snap.newIds.length : 0;
}

/**
 * Скачивает страницу с сайта и сохраняет её на телефоне. Только по запросу и только по Wi-Fi.
 * Прежняя копия заменяется, только если новая скачалась целиком.
 */
export function refreshChanges(progress: (m: string) => void = () => {}): Promise<RefreshResult> {
  if (inflight) return inflight;
  inflight = (async () => {
    if (!(await isWifi())) throw new Error(WIFI_ONLY_MESSAGE);
    progress('Скачиваю страницу…');
    const html = await getText(CHANGES_URL);
    if (html.length < 2000) throw new Error('Сайт вернул пустую страницу. Попробуйте позже.');
    const css: string[] = [];
    const urls = stylesheetUrls(html);
    for (let i = 0; i < urls.length; i++) {
      progress(`Скачиваю оформление: ${i + 1} из ${urls.length}…`);
      try {
        const c = await getText(urls[i]);
        if (c.length < 1_500_000) css.push(c);
      } catch {
        /* без части оформления страница всё равно читается */
      }
    }
    const ids = extractIds(html);
    const prev = new Set(snap?.ids ?? []);
    const newIds = snap ? ids.filter((x) => !prev.has(x)) : [];
    const now = new Date().toISOString();
    const next: PageSnapshot = { fetchedAt: now, doc: buildDoc(html, css), ids, newIds };
    await kvPut(KEY, next);
    snap = next;
    if (!prefs.changesViewed) prefs.setChangesViewed(now);
    listeners.forEach((f) => f());
    return { total: ids.length, fresh: newIds.length };
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}
