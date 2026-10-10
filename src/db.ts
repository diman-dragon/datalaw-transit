import type { Dataset, Meta, Route, RouteData, ServiceCalendar, StopIndex, StopsData } from './types.ts';
import { DATA_FORMAT } from './types.ts';

const DB_NAME = 'datalaw-transit';
const DB_VERSION = 1;

export interface Core {
  meta: Meta;
  stops: StopsData;
  routes: Route[];
  stopIndex: StopIndex;
  services: ServiceCalendar;
}

export interface RawInfo {
  savedAt: string;
  size: number;
  source: 'network' | 'file';
}

let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of ['kv', 'routes', 'raw']) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB недоступна'));
  });
  return dbp;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Ошибка записи в базу'));
    tx.onabort = () => reject(tx.error ?? new Error('Запись в базу отменена (возможно, не хватает места)'));
  });
}

function get<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
  return open().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const r = db.transaction(store, 'readonly').objectStore(store).get(key);
        r.onsuccess = () => resolve(r.result as T | undefined);
        r.onerror = () => reject(r.error);
      }),
  );
}

export async function saveDataset(ds: Dataset): Promise<void> {
  const db = await open();
  const tx = db.transaction(['kv', 'routes'], 'readwrite');
  const kv = tx.objectStore('kv');
  const rs = tx.objectStore('routes');
  rs.clear();
  kv.put(ds.stops, 'stops');
  kv.put(ds.routes, 'routes');
  kv.put(ds.stopIndex, 'stopIndex');
  kv.put(ds.services, 'services');
  for (const rd of ds.routeData) rs.put(rd, rd.route);
  kv.put(ds.meta, 'meta'); // последним: по нему определяется, что набор целый
  await done(tx);
}

export async function loadCore(): Promise<Core | null> {
  const meta = await get<Meta>('kv', 'meta');
  if (!meta || meta.format !== DATA_FORMAT) return null;
  const [stops, routes, stopIndex, services] = await Promise.all([
    get<StopsData>('kv', 'stops'),
    get<Route[]>('kv', 'routes'),
    get<StopIndex>('kv', 'stopIndex'),
    get<ServiceCalendar>('kv', 'services'),
  ]);
  if (!stops || !routes || !stopIndex || !services) return null;
  return { meta, stops, routes, stopIndex, services };
}

export function loadRouteData(route: number): Promise<RouteData | undefined> {
  return get<RouteData>('routes', route);
}

export async function clearDataset(): Promise<void> {
  const db = await open();
  const tx = db.transaction(['kv', 'routes'], 'readwrite');
  tx.objectStore('kv').clear();
  tx.objectStore('routes').clear();
  await done(tx);
}

// ---- исходные zip-архивы фидов (чтобы пересобирать данные без повторной загрузки)

export async function saveRaw(key: string, bytes: Uint8Array, source: RawInfo['source']): Promise<void> {
  const db = await open();
  const tx = db.transaction('raw', 'readwrite');
  const info: RawInfo = { savedAt: new Date().toISOString(), size: bytes.length, source };
  tx.objectStore('raw').put({ info, bytes }, key);
  await done(tx);
}

export async function loadRaw(key: string): Promise<{ info: RawInfo; bytes: Uint8Array } | undefined> {
  return get('raw', key);
}

export async function loadRawInfos(): Promise<Record<string, RawInfo>> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const out: Record<string, RawInfo> = {};
    const req = db.transaction('raw', 'readonly').objectStore('raw').openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (c) {
        out[String(c.key)] = (c.value as { info: RawInfo }).info;
        c.continue();
      } else resolve(out);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function clearRaw(): Promise<void> {
  const db = await open();
  const tx = db.transaction('raw', 'readwrite');
  tx.objectStore('raw').clear();
  await done(tx);
}
