import { isStale, onChangesUpdated, refreshChanges, savedChanges } from '../changes-sync.ts';
import { changeStatus } from '../changes.ts';
import type { Change } from '../changes.ts';
import { fmtDateInt, plural } from '../format.ts';
import { isWifi, WIFI_ONLY_MESSAGE } from '../net.ts';
import { prefs } from '../prefs.ts';
import { normalize } from '../search.ts';
import { data, hasData } from '../store.ts';
import type { Line } from '../types.ts';
import { dateToInt } from '../format.ts';
import { button, emptyState, titleBar } from './common.ts';
import { clear, el, icon } from './dom.ts';
import { open } from './nav.ts';
import { modal, toast } from './overlay.ts';

const dtFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

let onlyMine = false;

const key = (label: string) => normalize(label).replace(/ /g, '');

function lineIndex(): Map<string, Line> {
  const m = new Map<string, Line>();
  if (hasData()) for (const l of data().lines) if (!m.has(key(l.short))) m.set(key(l.short), l);
  return m;
}

function period(c: Change): string {
  const f = fmtDateInt(c.from);
  const t = fmtDateInt(c.to);
  return c.to && c.to !== c.from ? `${f.slice(0, 5)} – ${t}` : f;
}

/** Значок линии из списка изменений: цвет — как в приложении, если такая линия есть в расписании; ★ — избранные. */
function chip(label: string, idx: Map<string, Line>, clickable: boolean, onOpen?: () => void): HTMLElement {
  const l = idx.get(key(label));
  const fav = !!l && prefs.isFav(l.id);
  const cls = `badge sm ${l ? 'cat-' + l.cat : 'cat-none'}${fav ? ' fav' : ''}`;
  if (clickable && l) {
    const b = el('button', { class: cls, 'aria-label': `Линия ${label}` }, label);
    b.addEventListener('click', () => {
      onOpen?.();
      open(['route', l.id]);
    });
    return b;
  }
  return el('span', { class: cls }, label);
}

function chips(c: Change, idx: Map<string, Line>, max = 14): HTMLElement {
  const shown = c.lines.slice(0, max);
  // избранные — вперёд, чтобы они были видны даже в длинном списке
  shown.sort((a, b) => Number(prefs.isFav(idx.get(key(b))?.id ?? '')) - Number(prefs.isFav(idx.get(key(a))?.id ?? '')));
  return el('div', { class: 'chg-lines' }, ...shown.map((x) => chip(x, idx, false)), c.lines.length > max ? el('span', { class: 'more' }, `+${c.lines.length - max}`) : null);
}

function showDetail(c: Change, idx: Map<string, Line>): void {
  const h = modal({
    title: c.type || 'Изменение',
    body: [
      el('div', { class: 'muted small' }, `${fmtDateInt(c.from)} – ${fmtDateInt(c.to)}`),
      el('div', { class: 'detail-title' }, c.title),
      el('div', { class: 'chg-lines' }, ...c.lines.map((x) => chip(x, idx, true, () => h.close()))),
      c.detail ? el('div', { class: 'detail-text' }, c.detail) : el('p', { class: 'muted small' }, 'Подробный текст не скачан — он загрузится при следующем обновлении по Wi-Fi.'),
      c.url ? el('a', { class: 'btn plain wide', href: c.url, target: '_blank', rel: 'noopener' }, 'Открыть на сайте') : null,
    ],
    actions: [{ label: 'Закрыть', kind: 'primary' }],
  });
}

export function changesView(host: HTMLElement): () => void {
  host.append(titleBar('Изменения'));
  const mine = el('button', { class: 'seg-btn' }, 'Мои линии');
  const all = el('button', { class: 'seg-btn' }, 'Все');
  const syncSeg = () => {
    all.classList.toggle('active', !onlyMine);
    mine.classList.toggle('active', onlyMine);
  };
  const refreshBtn = el('button', { class: 'icon-btn', 'aria-label': 'Обновить по Wi-Fi' }, icon('refresh'));
  const status = el('div', { class: 'chg-status' });
  host.append(el('div', { class: 'topfix' }, el('div', { class: 'seg' }, all, mine), el('div', { class: 'chg-bar' }, status, refreshBtn)));
  const scroll = el('div', { class: 'scroll' });
  host.append(scroll);

  const viewedAtOpen = prefs.changesViewed;
  let busy = false;

  const draw = () => {
    syncSeg();
    clear(scroll);
    const st = savedChanges();
    status.textContent = st ? `Обновлено ${dtFmt.format(new Date(st.fetchedAt))} · по Wi-Fi` : 'Только по Wi-Fi';
    if (!st) {
      scroll.append(
        emptyState('Изменения ещё не загружены', 'Они скачиваются только по Wi-Fi и дальше хранятся на телефоне. Подключитесь к Wi-Fi и нажмите «Скачать».', button('Скачать по Wi-Fi', () => void refresh(true))),
      );
      return;
    }
    const idx = lineIndex();
    const today = dateToInt(new Date());
    let items = st.items.filter((c) => changeStatus(c, today) !== 'ended');
    if (onlyMine) {
      const favs = new Set(prefs.favs());
      items = items.filter((c) => c.lines.some((x) => {
        const l = idx.get(key(x));
        return !!l && favs.has(l.id);
      }));
    }
    if (!items.length) {
      scroll.append(emptyState(onlyMine ? 'Для ваших линий изменений нет' : 'Изменений нет', onlyMine ? 'Среди избранных линий нет затронутых работами. Переключите на «Все», чтобы посмотреть остальные.' : 'Сейчас на сайте нет действующих изменений.'));
      return;
    }
    const group = (title: string, list: Change[]) => {
      if (!list.length) return;
      scroll.append(
        el(
          'section',
          { class: 'group' },
          el('h3', null, el('span', null, title), el('small', null, String(list.length))),
          el(
            'div',
            { class: 'chg-list' },
            ...list.map((c) => {
              const isNew = !!viewedAtOpen && c.firstSeen > viewedAtOpen;
              const card = el(
                'button',
                { class: 'chg' + (isNew ? ' new' : '') },
                el('div', { class: 'chg-head' }, el('span', { class: 'pill' }, c.type || 'Изменение'), isNew ? el('span', { class: 'pill new' }, 'новое') : null, el('span', { class: 'chg-period' }, period(c))),
                el('div', { class: 'chg-title' }, c.title),
                chips(c, idx),
              );
              card.addEventListener('click', () => showDetail(c, idx));
              return card;
            }),
          ),
        ),
      );
    };
    const byEnd = (a: Change, b: Change) => a.to - b.to;
    group('Действуют сейчас', items.filter((c) => changeStatus(c, today) === 'active').sort(byEnd));
    group('Скоро начнутся', items.filter((c) => changeStatus(c, today) === 'soon').sort((a, b) => a.from - b.from));
  };

  const refresh = async (manual: boolean) => {
    if (busy) return;
    if (!(await isWifi())) {
      if (manual) toast(WIFI_ONLY_MESSAGE + (savedChanges() ? ' Показаны сохранённые.' : ''), 'err');
      return;
    }
    busy = true;
    refreshBtn.classList.add('spin');
    try {
      const r = await refreshChanges((m) => (status.textContent = m));
      toast(
        `Изменения обновлены: ${r.total}${r.fresh ? `, новых ${r.fresh}` : ''}${r.detailsFailed ? `. Тексты не скачались: ${r.detailsFailed} ${plural(r.detailsFailed, 'запись', 'записи', 'записей')}` : ''}`,
        r.detailsFailed ? 'info' : 'ok',
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'err');
    } finally {
      busy = false;
      refreshBtn.classList.remove('spin');
      draw();
    }
  };

  all.addEventListener('click', () => {
    onlyMine = false;
    draw();
  });
  mine.addEventListener('click', () => {
    onlyMine = true;
    draw();
  });
  refreshBtn.addEventListener('click', () => void refresh(true));

  const off = onChangesUpdated(() => {
    if (!busy) draw();
  });
  draw();
  void (async () => {
    // устаревшее обновляем сами, но только по Wi-Fi
    if (isStale()) await refresh(false);
  })();
  return () => {
    off();
    prefs.setChangesViewed(new Date().toISOString());
  };
}
