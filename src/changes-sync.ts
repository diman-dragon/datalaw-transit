import { kvGet, kvPut } from './db.ts';
import { CHANGES_URL, mergeChanges, parseChangeDetail, parseChangesList } from './changes.ts';
import type { Change, ChangesStore } from './changes.ts';
import { getText, isWifi, WIFI_ONLY_MESSAGE } from './net.ts';
import { prefs } from './prefs.ts';

const KEY = 'changes';
/** автоматически обновляем не чаще, чем раз в столько часов */
const STALE_HOURS = 6;
const MAX_DETAILS = 60;

let store: ChangesStore | null = null;
let inflight: Promise<RefreshResult> | null = null;
const listeners = new Set<() => void>();

export interface RefreshResult {
  total: number;
  fresh: number;
  /** тексты «Опширније», которые не удалось скачать */
  detailsFailed: number;
}

export async function initChanges(): Promise<void> {
  try {
    store = (await kvGet<ChangesStore>(KEY)) ?? null;
  } catch {
    store = null;
  }
}

export function savedChanges(): ChangesStore | null {
  return store;
}

export function onChangesUpdated(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Сколько изменений появилось с последнего просмотра вкладки. */
export function unseenCount(): number {
  const v = prefs.changesViewed;
  if (!store || !v) return 0;
  return store.items.filter((c) => c.firstSeen > v).length;
}

export function isStale(): boolean {
  if (!store) return true;
  return Date.now() - new Date(store.fetchedAt).getTime() > STALE_HOURS * 3600 * 1000;
}

async function requireWifi(): Promise<void> {
  if (!(await isWifi())) throw new Error(WIFI_ONLY_MESSAGE);
}

/**
 * Скачивает список изменений и недостающие тексты и сохраняет их на телефоне.
 * Работает только по Wi-Fi: проверка перед списком и перед каждой пачкой страниц.
 * Если сеть пропала посреди загрузки, то, что уже скачано, остаётся.
 */
export function refreshChanges(progress: (m: string) => void = () => {}): Promise<RefreshResult> {
  if (inflight) return inflight;
  inflight = (async () => {
    await requireWifi();
    progress('Скачиваю список изменений…');
    const html = await getText(CHANGES_URL);
    const list = parseChangesList(html);
    if (!list.length) {
      throw new Error(html.length > 2000 ? 'Не удалось разобрать страницу изменений: возможно, сайт изменил оформление.' : 'Страница изменений пришла пустой.');
    }
    const now = new Date().toISOString();
    const items = mergeChanges(store?.items ?? [], list, now);
    const firstEver = !store;
    const save = async () => {
      store = { fetchedAt: now, items };
      await kvPut(KEY, store);
      listeners.forEach((f) => f());
    };
    if (firstEver && !prefs.changesViewed) prefs.setChangesViewed(now);
    const fresh = items.filter((c) => c.firstSeen === now && !firstEver).length;
    await save();

    let failed = 0;
    const todo = items.filter((c) => !c.detail && c.url).slice(0, MAX_DETAILS);
    for (let i = 0; i < todo.length; i += 4) {
      if (!(await isWifi())) {
        failed += todo.length - i;
        break;
      }
      progress(`Скачиваю подробности: ${Math.min(i + 4, todo.length)} из ${todo.length}…`);
      const batch = todo.slice(i, i + 4);
      await Promise.all(
        batch.map(async (c) => {
          try {
            c.detail = parseChangeDetail(await getText(c.url));
            if (!c.detail) failed++;
          } catch {
            failed++;
          }
        }),
      );
      await save();
    }
    return { total: items.length, fresh, detailsFailed: failed };
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Тихое автообновление: только по Wi-Fi и только если данные устарели. Ошибки не показываем. */
export async function autoRefreshIfStale(): Promise<void> {
  if (!isStale() || inflight) return;
  try {
    if (await isWifi()) await refreshChanges();
  } catch {
    /* без шума: пользователь может обновить вручную */
  }
}

export type { Change };
