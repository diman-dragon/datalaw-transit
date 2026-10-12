import { Capacitor, CapacitorHttp } from '@capacitor/core';

/**
 * Подключены ли мы по Wi-Fi. На телефоне — только если система сообщает именно «wifi»
 * (мобильный интернет, VPN, «неизвестно» и отсутствие сети — не подходят).
 * В обычном браузере (разработка) тип сети обычно недоступен — тогда считаем, что можно.
 */
export async function isWifi(): Promise<boolean> {
  try {
    if (Capacitor.isNativePlatform()) {
      const { Network } = await import('@capacitor/network');
      const s = await Network.getStatus();
      return s.connected && s.connectionType === 'wifi';
    }
    const type = (navigator as unknown as { connection?: { type?: string } }).connection?.type;
    return type === undefined ? navigator.onLine : type === 'wifi';
  } catch {
    return false;
  }
}

export const WIFI_ONLY_MESSAGE = 'Нет Wi-Fi: изменения скачиваются только по Wi-Fi.';

/** GET текстовой страницы. На телефоне — нативный HTTP (без ограничений CORS). */
export async function getText(url: string): Promise<string> {
  try {
    if (Capacitor.isNativePlatform()) {
      const res = await CapacitorHttp.get({ url, responseType: 'text', connectTimeout: 20000, readTimeout: 30000 });
      if (res.status < 200 || res.status >= 300) throw new Error(`сервер ответил кодом ${res.status}`);
      return typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`сервер ответил кодом ${res.status}`);
    return await res.text();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(/сервер ответил/.test(msg) ? msg : 'нет соединения с сайтом или он недоступен');
  }
}
