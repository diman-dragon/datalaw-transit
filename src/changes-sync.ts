import { kvGet, kvPut } from './db.ts';
import { CHANGES_URL, extractDetailHtml, parseChangeDetail, parseChangesList } from './changes.ts';
import { sanitizeHtml } from './sanitize.ts';
import type { Change, ChangesStore, JournalEntry } from './changes.ts';
import { getText, isWifi, WIFI_ONLY_MESSAGE } from './net.ts';
import { prefs } from './prefs.ts';

const KEY = 'changes';
/** за один раз скачиваем не больше стольких объявлений */
const MAX_DOWNLOAD = 300;

let store: ChangesStore | null = null;
let inflight: Promise<RefreshResult> | null = null;
const listeners = new Set<() => void>();

export interface RefreshResult {
  /** сколько объявлений на сайте сейчас */
  onSite: number;
  /** скачано в этот раз */
  added: number;
  /** пропущено: уже есть в журнале */
  skipped: number;
  /** тексты, которые не удалось скачать (повторятся при следующем обновлении) */
  failed: number;
}

export async function initChanges(): Promise<void> {
  try {
    const s = (await kvGet<ChangesStore>(KEY)) ?? null;
    if (s) {
      // данные версии 2.0: журнала не было — считаем скачанным всё, что уже лежит на телефоне
      if (!Array.isArray(s.journal)) s.journal = s.items.map((c) => ({ id: c.id, title: c.title, at: c.firstSeen || s.fetchedAt, deleted: false }));
      store = s;
    } else store = null;
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

/** Сколько объявлений скачано после последнего просмотра вкладки. */
export function unseenCount(): number {
  const v = prefs.changesViewed;
  if (!store || !v) return 0;
  return store.items.filter((c) => c.firstSeen > v).length;
}

async function persist(): Promise<void> {
  if (!store) return;
  await kvPut(KEY, store);
  listeners.forEach((f) => f());
}

async function requireWifi(): Promise<void> {
  if (!(await isWifi())) throw new Error(WIFI_ONLY_MESSAGE);
}

/**
 * Скачивает объявления по запросу. Те, что уже есть в журнале (скачаны раньше, в том числе удалённые), пропускаются.
 * `all` — «скачать всё заново»: журнал и сохранённые объявления стираются, скачивается всё, что есть на сайте.
 * Только по Wi-Fi. Если сеть пропала посреди загрузки, то, что уже скачано, остаётся.
 */
export function refreshChanges(all: boolean, progress: (m: string) => void = () => {}): Promise<RefreshResult> {
  if (inflight) return inflight;
  inflight = (async () => {
    await requireWifi();
    progress('Скачиваю список объявлений…');
    const html = await getText(CHANGES_URL);
    const list = parseChangesList(html);
    if (!list.length) {
      throw new Error(html.length > 2000 ? 'Не удалось разобрать страницу объявлений: возможно, сайт изменил оформление.' : 'Страница объявлений пришла пустой.');
    }
    const now = new Date().toISOString();
    if (all || !store) store = { fetchedAt: now, items: [], journal: [] };
    const st = store;
    const logged = new Set(st.journal.map((j) => j.id));
    const fresh = list.filter((c) => !logged.has(c.id));
    const skipped = list.length - fresh.length;
    // без текста (прошлый раз не скачался) — докачиваем, это не повтор
    const retry = st.items.filter((c) => !c.html && c.url);
    const todo = [...fresh, ...retry].slice(0, MAX_DOWNLOAD);
    if (!st.items.length && !prefs.changesViewed) prefs.setChangesViewed(now);

    let added = 0;
    let failed = 0;
    for (let i = 0; i < todo.length; i += 4) {
      if (!(await isWifi())) {
        failed += todo.length - i;
        break;
      }
      progress(`Скачиваю объявления: ${Math.min(i + 4, todo.length)} из ${todo.length}…`);
      const batch = todo.slice(i, i + 4);
      await Promise.all(
        batch.map(async (c) => {
          let detail = '';
          let pageHtml = '';
          try {
            if (c.url) {
              const raw = await getText(c.url);
              detail = parseChangeDetail(raw);
              pageHtml = sanitizeHtml(extractDetailHtml(raw));
            }
          } catch {
            /* повторим при следующем обновлении */
          }
          if (!detail && !pageHtml && c.url) failed++;
          if (st.items.includes(c)) {
            c.detail = detail;
            c.html = pageHtml;
            return;
          }
          const item: Change = { ...c, detail, html: pageHtml, firstSeen: now };
          st.items.push(item);
          const e: JournalEntry = { id: c.id, title: c.title, at: now, deleted: false };
          st.journal.push(e);
          added++;
        }),
      );
      st.fetchedAt = now;
      await persist();
    }
    st.fetchedAt = now;
    await persist();
    return { onSite: list.length, added, skipped, failed };
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Удаляет объявление с телефона. В журнале остаётся отметка «удалено», поэтому при обновлении оно не вернётся. */
export async function deleteChange(id: string): Promise<void> {
  if (!store) return;
  store.items = store.items.filter((c) => c.id !== id);
  const j = store.journal.find((e) => e.id === id);
  if (j) j.deleted = true;
  else store.journal.push({ id, title: '', at: new Date().toISOString(), deleted: true });
  await persist();
}

/** Возвращает только что удалённое объявление (кнопка «Отменить»). */
export async function restoreChange(c: Change): Promise<void> {
  if (!store || store.items.some((x) => x.id === c.id)) return;
  store.items.push(c);
  const j = store.journal.find((e) => e.id === c.id);
  if (j) j.deleted = false;
  await persist();
}

export type { Change, JournalEntry };
