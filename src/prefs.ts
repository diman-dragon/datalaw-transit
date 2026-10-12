export type ThemeName = 'amoled' | 'sand';

interface Stored {
  theme: ThemeName;
  /** id избранных линий */
  favs: string[];
  /** 2 — избранное хранится в порядке добавления (первая добавленная — сверху) */
  favsOrder: number;
  /** месяц, в котором уже показали напоминание («2026-10») */
  remindMonth: string;
  /** когда пользователь последний раз смотрел вкладку «Изменения» (ISO) */
  changesViewed: string;
}

const KEY = 'datalaw-transit/prefs/v1';

let cache: Stored | null = null;

function load(): Stored {
  if (cache) return cache;
  const d: Stored = { theme: 'amoled', favs: [], favsOrder: 2, remindMonth: '', changesViewed: '' };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      // поля старых версий (favRoutes и др.) читаем, лишнее игнорируем
      const p = JSON.parse(raw) as { theme?: unknown; favs?: unknown; favRoutes?: unknown; favsOrder?: unknown; remindMonth?: unknown; changesViewed?: unknown };
      if (p.theme === 'amoled' || p.theme === 'sand') d.theme = p.theme;
      const f = Array.isArray(p.favs) ? p.favs : Array.isArray(p.favRoutes) ? p.favRoutes : [];
      d.favs = f.filter((x): x is string => typeof x === 'string');
      // до 2.1 новые линии добавлялись в начало: один раз разворачиваем, чтобы порядок добавления сохранился
      if (p.favsOrder !== 2) d.favs.reverse();
      if (typeof p.remindMonth === 'string') d.remindMonth = p.remindMonth;
      if (typeof p.changesViewed === 'string') d.changesViewed = p.changesViewed;
    }
  } catch {
    /* хранилище недоступно — работаем с настройками по умолчанию */
  }
  cache = d;
  return d;
}

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(load()));
  } catch {
    /* ignore */
  }
}

export const prefs = {
  get theme(): ThemeName {
    return load().theme;
  },
  setTheme(t: ThemeName): void {
    load().theme = t;
    save();
  },
  favs: (): string[] => [...load().favs],
  isFav: (id: string): boolean => load().favs.includes(id),
  /** true — линия теперь в избранном */
  toggleFav(id: string): boolean {
    const a = load().favs;
    const i = a.indexOf(id);
    if (i >= 0) a.splice(i, 1);
    else a.push(id);
    save();
    return i < 0;
  },
  /** Возвращает линию на прежнее место в избранном (отмена удаления). */
  restoreFav(id: string, index: number): void {
    const a = load().favs;
    if (a.includes(id)) return;
    a.splice(Math.max(0, Math.min(index, a.length)), 0, id);
    save();
  },
  get remindMonth(): string {
    return load().remindMonth;
  },
  get changesViewed(): string {
    return load().changesViewed;
  },
  setChangesViewed(iso: string): void {
    load().changesViewed = iso;
    save();
  },
  setRemindMonth(m: string): void {
    load().remindMonth = m;
    save();
  },
};
