export type ThemeName = 'amoled' | 'sand';

interface Stored {
  theme: ThemeName;
  /** id избранных линий */
  favs: string[];
  /** месяц, в котором уже показали напоминание («2026-10») */
  remindMonth: string;
}

const KEY = 'datalaw-transit/prefs/v1';

let cache: Stored | null = null;

function load(): Stored {
  if (cache) return cache;
  const d: Stored = { theme: 'amoled', favs: [], remindMonth: '' };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      // поля старых версий (favRoutes и др.) читаем, лишнее игнорируем
      const p = JSON.parse(raw) as { theme?: unknown; favs?: unknown; favRoutes?: unknown; remindMonth?: unknown };
      if (p.theme === 'amoled' || p.theme === 'sand') d.theme = p.theme;
      const f = Array.isArray(p.favs) ? p.favs : Array.isArray(p.favRoutes) ? p.favRoutes : [];
      d.favs = f.filter((x): x is string => typeof x === 'string');
      if (typeof p.remindMonth === 'string') d.remindMonth = p.remindMonth;
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
    else a.unshift(id);
    save();
    return i < 0;
  },
  get remindMonth(): string {
    return load().remindMonth;
  },
  setRemindMonth(m: string): void {
    load().remindMonth = m;
    save();
  },
};
