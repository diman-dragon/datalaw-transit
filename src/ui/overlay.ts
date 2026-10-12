import { el, icon } from './dom.ts';

// ---------- уведомления

export type ToastKind = 'ok' | 'err' | 'info';

let toastEl: HTMLElement | null = null;
let toastTimer = 0;

/** Короткое уведомление над нижней панелью. Ошибки висят дольше. */
export function toast(message: string, kind: ToastKind = 'info', ms?: number, action?: { label: string; onClick: () => void }): void {
  toastEl?.remove();
  window.clearTimeout(toastTimer);
  const t = el(
    'div',
    { class: `toast ${kind}`, role: kind === 'err' ? 'alert' : 'status', 'aria-live': kind === 'err' ? 'assertive' : 'polite' },
    icon(kind === 'ok' ? 'check' : kind === 'err' ? 'alert' : 'clock'),
    el('span', null, message),
    action
      ? el('button', { class: 'toast-action', onclick: (e: Event) => {
          e.stopPropagation();
          t.remove();
          action.onClick();
        } }, action.label)
      : null,
  );
  t.addEventListener('click', () => t.remove());
  document.body.appendChild(t);
  toastEl = t;
  toastTimer = window.setTimeout(() => t.remove(), ms ?? (kind === 'err' ? 7000 : 3500));
}

// ---------- диалоги

export interface ModalAction {
  label: string;
  kind?: 'primary' | 'plain';
  /** вернуть false, чтобы не закрывать окно */
  onClick?: () => void | boolean | Promise<void | boolean>;
}

export interface ModalOptions {
  title: string;
  body: (Node | string | null)[];
  actions: ModalAction[];
  /** вызывается при любом закрытии (в т.ч. по «назад» и по фону) */
  onClose?: () => void;
}

const stack: { close: () => void }[] = [];

export function modal(opts: ModalOptions): { close: () => void } {
  const backdrop = el('div', { class: 'backdrop' });
  let closed = false;
  const handle = {
    close: () => {
      if (closed) return;
      closed = true;
      const i = stack.indexOf(handle);
      if (i >= 0) stack.splice(i, 1);
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
      opts.onClose?.();
    },
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && stack[stack.length - 1] === handle) handle.close();
  };
  const buttons = opts.actions.map((a) => {
    const b = el('button', { class: 'btn ' + (a.kind === 'primary' ? 'primary' : 'plain') }, a.label);
    b.addEventListener('click', async () => {
      b.disabled = true;
      let keep = false;
      try {
        keep = (await a.onClick?.()) === false;
      } finally {
        b.disabled = false;
      }
      if (!keep) handle.close();
    });
    return b;
  });
  const dialog = el(
    'div',
    { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title },
    el('h2', null, opts.title),
    el('div', { class: 'dialog-body' }, ...opts.body),
    el('div', { class: 'dialog-actions' }, ...buttons),
  );
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) handle.close();
  });
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);
  document.addEventListener('keydown', onKey);
  stack.push(handle);
  (buttons.find((b) => b.classList.contains('primary')) ?? buttons[0])?.focus();
  return handle;
}

/** Закрывает верхнее окно; true — окно было открыто (системная «назад» на этом и заканчивается). */
export function closeTopModal(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top.close();
  return true;
}

/** Окно с подтверждением: true — нажали основную кнопку. */
export function confirmDialog(opts: { title: string; body: (Node | string | null)[]; ok: string; cancel?: string }): Promise<boolean> {
  return new Promise((resolve) => {
    let answer = false;
    modal({
      title: opts.title,
      body: opts.body,
      actions: [
        { label: opts.cancel ?? 'Отмена', kind: 'plain' },
        {
          label: opts.ok,
          kind: 'primary',
          onClick: () => {
            answer = true;
          },
        },
      ],
      onClose: () => resolve(answer),
    });
  });
}
