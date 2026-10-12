/**
 * Очистка HTML объявления: оставляем только оформление текста (абзацы, списки, таблицы, жирный, ссылки на bgprevoz.rs).
 * Скрипты, стили, формы, картинки, атрибуты — удаляются. Работает в браузере/WebView (нужен DOMParser).
 */
const KEEP = new Set(['P', 'BR', 'UL', 'OL', 'LI', 'STRONG', 'B', 'EM', 'I', 'U', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'A', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'HR']);
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'SVG', 'FORM', 'SELECT', 'OPTION', 'BUTTON', 'INPUT', 'IMG', 'OBJECT', 'EMBED', 'NAV', 'NOSCRIPT', 'TEXTAREA', 'LINK', 'META', 'CANVAS', 'VIDEO', 'AUDIO']);
const HOSTS = new Set(['bgprevoz.rs', 'www.bgprevoz.rs']);

function safeHref(h: string): string {
  try {
    const u = new URL(h, 'https://bgprevoz.rs');
    return u.protocol === 'https:' && HOSTS.has(u.hostname) ? u.href : '';
  } catch {
    return '';
  }
}

function clean(src: Node, out: Node, doc: Document): void {
  for (const n of Array.from(src.childNodes)) {
    if (n.nodeType === 3) {
      out.appendChild(doc.createTextNode(n.textContent ?? ''));
      continue;
    }
    if (n.nodeType !== 1) continue;
    const e = n as Element;
    const tag = e.tagName.toUpperCase();
    if (DROP.has(tag)) continue;
    if (KEEP.has(tag)) {
      const t = doc.createElement(tag.toLowerCase().startsWith('h') ? 'h4' : tag.toLowerCase());
      if (tag === 'A') {
        const href = safeHref(e.getAttribute('href') ?? '');
        if (href) {
          t.setAttribute('href', href);
          t.setAttribute('target', '_blank');
          t.setAttribute('rel', 'noopener');
        }
      }
      clean(e, t, doc);
      out.appendChild(t);
    } else {
      // неизвестные и «контейнерные» теги: убираем обёртку, содержимое оставляем; блоки отделяем разрывом
      const block = tag === 'DIV' || tag === 'SECTION' || tag === 'ARTICLE';
      clean(e, out, doc);
      if (block) out.appendChild(doc.createElement('br'));
    }
  }
}

/** Возвращает безопасный HTML; пусто — если после очистки текста не осталось. */
export function sanitizeHtml(html: string): string {
  if (typeof DOMParser === 'undefined') return '';
  const src = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const out = src.createElement('div');
  clean(src.body, out, src);
  // пустые абзацы и лишние <br> подряд
  out.querySelectorAll('p,li').forEach((p) => {
    if (!p.textContent?.trim() && !p.querySelector('table')) p.remove();
  });
  let h = out.innerHTML.replace(/(<br\s*\/?>\s*){3,}/g, '<br><br>').replace(/^(\s*<br\s*\/?>)+|(<br\s*\/?>\s*)+$/g, '');
  if (!out.textContent?.trim()) h = '';
  return h.slice(0, 40000);
}
