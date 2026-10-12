import type { Dataset } from './types.ts';
import { DATA_FORMAT } from './types.ts';

const DB_NAME = 'datalaw-transit';
const DB_VERSION = 2;
const STORE = 'kv';
const KEY = 'dataset';

let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // версия 1 хранила GTFS по частям — этот формат больше не используется
      for (const old of ['routes', 'raw']) if (db.objectStoreNames.contains(old)) db.deleteObjectStore(old);
      if (db.objectStoreNames.contains(STORE)) req.transaction!.objectStore(STORE).clear();
      else db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbp = null;
      reject(req.error ?? new Error('Хранилище на телефоне недоступно'));
    };
  });
  return dbp;
}

export async function saveDataset(ds: Dataset): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(ds, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Ошибка записи в память телефона'));
    tx.onabort = () => reject(tx.error ?? new Error('Запись отменена — возможно, не хватает места на телефоне'));
  });
}

export async function loadDataset(): Promise<Dataset | null> {
  const db = await open();
  const v = await new Promise<unknown>((resolve, reject) => {
    const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  const ds = v as Dataset | undefined;
  if (!ds || ds.format !== DATA_FORMAT || !Array.isArray(ds.lines)) return null;
  return ds;
}

/** Произвольные данные в том же хранилище (напр. скачанные изменения). */
export async function kvGet<T>(key: string): Promise<T | undefined> {
  const db = await open();
  return new Promise<T | undefined>((resolve, reject) => {
    const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    r.onsuccess = () => resolve(r.result as T | undefined);
    r.onerror = () => reject(r.error);
  });
}

export async function kvPut(key: string, value: unknown): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Ошибка записи в память телефона'));
    tx.onabort = () => reject(tx.error ?? new Error('Запись отменена — возможно, не хватает места на телефоне'));
  });
}
