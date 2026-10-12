import { Capacitor } from '@capacitor/core';
import { onChangesUpdated, refreshChanges, savedPage } from '../changes-sync.ts';
import { siteLink } from '../changes-page.ts';
import { isWifi, WIFI_ONLY_MESSAGE } from '../net.ts';
import { prefs } from '../prefs.ts';
import { clear, el, icon } from './dom.ts';
import { titleBar } from './common.ts';
import { toast } from './overlay.ts';

const dtFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

/** Открывает страницу сайта поверх приложения (нужен интернет). */
async function openOnline(url: string): Promise<void> {
  if (!navigator.onLine) {
    toast('Нет интернета: «Опширније» открывается с сайта', 'err');
    return;
  }
  try {
    if (Capacitor.isNativePlatform()) {
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url });
      return;
    }
  } catch {
    /* ниже — запасной вариант */
  }
  window.open(url, '_blank', 'noopener');
}

export function changesView(host: HTMLElement): () => void {
  host.append(titleBar('Изменения'));
  const btn = el('button', { class: 'btn primary wide' }, icon('download'), 'Скачать страницу');
  const status = el('div', { class: 'chg-status' });
  host.append(el('div', { class: 'topfix' }, btn, el('div', { class: 'chg-bar' }, status)));
  const wrap = el('div', { class: 'frame-wrap' });
  host.append(wrap);

  let busy = false;

  const draw = () => {
    clear(wrap);
    const s = savedPage();
    btn.lastChild!.textContent = s ? 'Обновить страницу' : 'Скачать страницу';
    if (!s) {
      status.textContent = 'Только по Wi-Fi, только по запросу';
      wrap.append(
        el('div', { class: 'empty' }, el('h2', null, 'Страница не скачана'), el('p', null, 'Подключитесь к Wi-Fi и нажмите «Скачать страницу»: все объявления сохранятся на телефоне и будут открываться без сети. «Опширније» открывается с сайта.')),
      );
      return;
    }
    status.textContent = `Сохранено ${dtFmt.format(new Date(s.fetchedAt))} · объявлений: ${s.ids.length}`;
    // скрипты в сохранённой копии выключены (sandbox без allow-scripts); allow-same-origin нужен только чтобы перехватить нажатия на ссылки
    const frame = el('iframe', { class: 'changes-frame', title: 'Актуелне измене', sandbox: 'allow-same-origin' });
    frame.addEventListener('load', () => {
      const doc = frame.contentDocument;
      if (!doc) return;
      doc.addEventListener('click', (e) => {
        const a = (e.target as Element | null)?.closest?.('a');
        if (!a) return;
        e.preventDefault();
        const url = siteLink(a.getAttribute('href') ?? '');
        if (url) void openOnline(url);
      });
    });
    frame.srcdoc = s.doc;
    wrap.append(frame);
  };

  const run = async () => {
    if (busy) return;
    if (!(await isWifi())) {
      toast(WIFI_ONLY_MESSAGE + (savedPage() ? ' Показана сохранённая страница.' : ''), 'err');
      return;
    }
    busy = true;
    btn.disabled = true;
    try {
      const r = await refreshChanges((m) => (status.textContent = m));
      toast(`Страница сохранена: объявлений ${r.total}${r.fresh ? `, новых ${r.fresh}` : ''}`, 'ok');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'err');
    } finally {
      busy = false;
      btn.disabled = false;
      draw();
    }
  };
  btn.addEventListener('click', () => void run());

  const off = onChangesUpdated(() => {
    if (!busy) draw();
  });
  draw();
  return () => {
    off();
    prefs.setChangesViewed(new Date().toISOString());
  };
}

