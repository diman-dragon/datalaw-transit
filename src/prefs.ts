export type ThemeName = 'amoled' | 'sand';

export interface FeedCfg {
  key: string;
  name: string;
  url: string;
  enabled: boolean;
}

export const DEFAULT_FEEDS: FeedCfg[] = [
  {
    key: 'c',
    name: 'Городской транспорт (автобусы, трамваи, троллейбусы)',
    url: 'https://data.gov.rs/sr/datasets/r/729be9a1-7ed9-453d-9a3d-68fa30f07529',
    enabled: true,
  },
  {
    key: 'p',
    name: 'Пригородные автобусы',
    url: 'https://data.gov.rs/sr/datasets/r/60f82229-16c7-4939-961b-2c24873d3e06',
    enabled: true,
  },
];

interface Stored {
  theme: ThemeName;
  favStops: string[];
  favRoutes: string[];
  feeds: Pick<FeedCfg, 'key' | 'url' | 'enabled'>[];
  recents: string[];
  mapTiles: boolean;
}

const KEY = 'datalaw-transit/prefs/v1';

function defaults(): Stored {
  return {
    theme: 'amoled',
    favStops: [],
    favRoutes: [],
    feeds: DEFAULT_FEEDS.map((f) => ({ key: f.key, url: f.url, enabled: f.enabled })),
    recents: [],
    mapTiles: true,
  };
}

let cache: Stored | null = null;

function load(): Stored {
  if (cache) return cache;
  const d = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Stored>;
      if (p.theme === 'amoled' || p.theme === 'sand') d.theme = p.theme;
      if (Array.isArray(p.favStops)) d.favStops = p.favStops.filter((x) => typeof x === 'string');
      if (Array.isArray(p.favRoutes)) d.favRoutes = p.favRoutes.filter((x) => typeof x === 'string');
      if (typeof p.mapTiles === 'boolean') d.mapTiles = p.mapTiles;
      if (Array.isArray(p.recents)) d.recents = p.recents.filter((x) => typeof x === 'string').slice(0, 12);
      if (Array.isArray(p.feeds)) {
        for (const f of p.feeds) {
          const t = d.feeds.find((x) => x.key === f.key);
          if (t) {
            if (typeof f.url === 'string' && f.url.trim()) t.url = f.url.trim();
            if (typeof f.enabled === 'boolean') t.enabled = f.enabled;
          }
        }
      }
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
  get mapTiles(): boolean {
    return load().mapTiles;
  },
  setMapTiles(v: boolean): void {
    load().mapTiles = v;
    save();
  },
  feeds(): FeedCfg[] {
    const s = load().feeds;
    return DEFAULT_FEEDS.map((f) => {
      const o = s.find((x) => x.key === f.key);
      return { ...f, url: o?.url ?? f.url, enabled: o?.enabled ?? f.enabled };
    });
  },
  setFeed(key: string, patch: Partial<Pick<FeedCfg, 'url' | 'enabled'>>): void {
    const f = load().feeds.find((x) => x.key === key);
    if (!f) return;
    if (patch.url !== undefined) f.url = patch.url.trim() || DEFAULT_FEEDS.find((x) => x.key === key)!.url;
    if (patch.enabled !== undefined) f.enabled = patch.enabled;
    save();
  },
  isFavStop: (id: string): boolean => load().favStops.includes(id),
  isFavRoute: (id: string): boolean => load().favRoutes.includes(id),
  favStops: (): string[] => [...load().favStops],
  favRoutes: (): string[] => [...load().favRoutes],
  toggleFavStop(id: string): boolean {
    return toggle(load().favStops, id);
  },
  toggleFavRoute(id: string): boolean {
    return toggle(load().favRoutes, id);
  },
  recents: (): string[] => [...load().recents],
  pushRecent(q: string): void {
    const s = load();
    const t = q.trim();
    if (!t) return;
    s.recents = [t, ...s.recents.filter((x) => x !== t)].slice(0, 12);
    save();
  },
  clearRecents(): void {
    load().recents = [];
    save();
  },
};

function toggle(arr: string[], id: string): boolean {
  const i = arr.indexOf(id);
  if (i >= 0) arr.splice(i, 1);
  else arr.unshift(id);
  save();
  return i < 0;
}
