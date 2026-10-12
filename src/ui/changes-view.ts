import { deleteChange, onChangesUpdated, refreshChanges, restoreChange, savedChanges } from '../changes-sync.ts';
import { changeStatus } from '../changes.ts';
import type { Change } from '../changes.ts';
import { dateToInt, fmtDateInt, plural } from '../format.ts';
import { isWifi, WIFI_ONLY_MESSAGE } from '../net.ts';
import { prefs } from '../prefs.ts';
import { button, emptyState, titleBar } from './common.ts';
import { clear, el, icon } from './dom.ts';
import { confirmDialog, modal, toast } from './overlay.ts';

const dtFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function period(c: Change): string {
  const f = fmtDateInt(c.from);
  const t = fmtDateInt(c.to);
  return c.to && c.to !== c.from ? `${f.slice(0, 5)} – ${t}` : f;
}

/** Номера линий из объявления — просто подписи, без связи с избранным. */
function chips(c: Change, max = 14): HTMLElement {
  return el('div', { class: 'chg-lines' }, ...c.lines.slice(0, max).map((x) => el('span', { class: 'badge sm cat-none' }, x)), c.lines.length > max ? el('span', { class: 'more' }, `+${c.lines.length - max}`) : null);
}

function removeWithUndo(c: Change): void {
  void deleteChange(c.id).then(() =>
    toast('Объявление удалено', 'info', 4500, {
      label: 'Отменить',
      onClick: () => void restoreChange(c),
    }),
  );
}

/** Показывает сохранённый (уже очищенный при скачивании) HTML объявления. */
function htmlBlock(html: string): HTMLElement {
  const d = el('div', { class: 'detail-html' });
  d.innerHTML = html;
  return d;
}

function showDetail(c: Change): void {
  const h = modal({
    title: c.type || 'Объявление',
    body: [
      el('div', { class: 'muted small' }, `${fmtDateInt(c.from)} – ${fmtDateInt(c.to)}`),
      el('div', { class: 'detail-title' }, c.title),
      el('div', { class: 'chg-lines' }, ...c.lines.map((x) => el('span', { class: 'badge sm cat-none' }, x))),
      c.html ? htmlBlock(c.html) : c.detail ? el('div', { class: 'detail-text' }, c.detail) : el('p', { class: 'muted small' }, 'Текст не скачан — он докачается при следующем обновлении по Wi-Fi.'),
      c.url ? el('a', { class: 'btn plain wide', href: c.url, target: '_blank', rel: 'noopener' }, 'Открыть на сайте') : null,
    ],
    actions: [
      {
        label: 'Удалить',
        kind: 'plain',
        onClick: () => {
          removeWithUndo(c);
        },
      },
      { label: 'Закрыть', kind: 'primary' },
    ],
  });
  void h;
}

function showJournal(): void {
  const st = savedChanges();
  const j = [...(st?.journal ?? [])].sort((a, b) => (a.at < b.at ? 1 : -1));
  modal({
    title: 'Журнал',
    body: [
      el('p', { class: 'muted small' }, 'Объявления, которые уже скачивались. При «Скачать обновления» они пропускаются — в том числе удалённые.'),
      j.length
        ? el(
            'ul',
            { class: 'journal' },
            ...j.map((e) => el('li', null, el('b', null, e.title || `№ ${e.id}`), el('small', null, `${dtFmt.format(new Date(e.at))}${e.deleted ? ' · удалено' : ''}`))),
          )
        : el('p', { class: 'muted' }, 'Журнал пуст.'),
    ],
    actions: [{ label: 'Закрыть', kind: 'primary' }],
  });
}

export function changesView(host: HTMLElement): () => void {
  host.append(titleBar('Изменения'));
  const updBtn = el('button', { class: 'btn primary' }, icon('download'), 'Скачать обновления');
  const allBtn = el('button', { class: 'btn plain' }, icon('refresh'), 'Скачать заново');
  const jrnBtn = el('button', { class: 'btn plain' }, 'Журнал');
  const status = el('div', { class: 'chg-status' });
  host.append(el('div', { class: 'topfix' }, el('div', { class: 'chg-actions' }, updBtn, allBtn, jrnBtn), el('div', { class: 'chg-bar' }, status)));
  const scroll = el('div', { class: 'scroll' });
  host.append(scroll);

  const viewedAtOpen = prefs.changesViewed;
  let busy = false;

  const draw = () => {
    clear(scroll);
    const st = savedChanges();
    status.textContent = st ? `Скачано ${dtFmt.format(new Date(st.fetchedAt))} · в журнале ${st.journal.length}` : 'Только по Wi-Fi, только по запросу';
    if (!st) {
      scroll.append(emptyState('Объявления не скачаны', 'Подключитесь к Wi-Fi и нажмите «Скачать обновления». Дальше они хранятся на телефоне и доступны без сети.'));
      return;
    }
    if (!st.items.length) {
      scroll.append(emptyState('Объявлений нет', 'Всё скачанное удалено. «Скачать обновления» принесёт только новые, «Скачать заново» — всё с сайта.'));
      return;
    }
    const today = dateToInt(new Date());
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
              const open = el(
                'button',
                { class: 'chg-open' },
                el('div', { class: 'chg-head' }, el('span', { class: 'pill' }, c.type || 'Объявление'), isNew ? el('span', { class: 'pill new' }, 'новое') : null, el('span', { class: 'chg-period' }, period(c))),
                el('div', { class: 'chg-title' }, c.title),
                chips(c),
              );
              open.addEventListener('click', () => showDetail(c));
              const del = el('button', { class: 'chg-del', 'aria-label': 'Удалить объявление', title: 'Удалить' }, icon('close'));
              del.addEventListener('click', () => removeWithUndo(c));
              return el('div', { class: 'chg' + (isNew ? ' new' : '') }, open, del);
            }),
          ),
        ),
      );
    };
    const items = st.items;
    group('Действуют сейчас', items.filter((c) => changeStatus(c, today) === 'active').sort((a, b) => a.to - b.to));
    group('Скоро начнутся', items.filter((c) => changeStatus(c, today) === 'soon').sort((a, b) => a.from - b.from));
    group('Закончились', items.filter((c) => changeStatus(c, today) === 'ended').sort((a, b) => b.to - a.to));
  };

  const run = async (all: boolean) => {
    if (busy) return;
    if (!(await isWifi())) {
      toast(WIFI_ONLY_MESSAGE + (savedChanges() ? ' Показаны сохранённые.' : ''), 'err');
      return;
    }
    busy = true;
    updBtn.disabled = allBtn.disabled = true;
    try {
      const r = await refreshChanges(all, (m) => (status.textContent = m));
      const parts = [`скачано ${r.added}`];
      if (r.skipped) parts.push(`пропущено ${r.skipped} ${plural(r.skipped, 'уже скачанное', 'уже скачанных', 'уже скачанных')}`);
      if (r.failed) parts.push(`тексты не скачались: ${r.failed}`);
      toast(`Объявления: ${parts.join(', ')}`, r.failed ? 'info' : 'ok');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'err');
    } finally {
      busy = false;
      updBtn.disabled = allBtn.disabled = false;
      draw();
    }
  };

  updBtn.addEventListener('click', () => void run(false));
  allBtn.addEventListener('click', async () => {
    const yes = await confirmDialog({
      title: 'Скачать всё заново?',
      body: [el('p', null, 'Журнал и все скачанные объявления (в том числе удалённые вами) будут стёрты, затем заново скачается всё, что сейчас на сайте.')],
      ok: 'Скачать заново',
    });
    if (yes) void run(true);
  });
  jrnBtn.addEventListener('click', showJournal);

  const off = onChangesUpdated(() => {
    if (!busy) draw();
  });
  draw();
  return () => {
    off();
    prefs.setChangesViewed(new Date().toISOString());
  };
}
