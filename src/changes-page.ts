/**
 * Вкладка «Изменения» — просмотр страницы https://bgprevoz.rs/linije/aktuelne-izmene.
 * Страница скачивается один раз по запросу и хранится целиком; здесь — подготовка её HTML для показа без сети.
 */
export const CHANGES_URL = 'https://bgprevoz.rs/linije/aktuelne-izmene';
export const SITE = 'https://bgprevoz.rs';
const HOSTS = new Set(['bgprevoz.rs', 'www.bgprevoz.rs']);

/** Номера объявлений, на которые есть ссылки «Опширније». */
export function extractIds(html: string): string[] {
  const ids = new Set<string>();
  for (const m of html.matchAll(/aktuelne-izmene\/(\d+)/g)) ids.add(m[1]);
  return [...ids];
}

function absUrl(href: string): string {
  try {
    const u = new URL(href.replace(/&amp;/g, '&'), CHANGES_URL);
    return u.protocol === 'https:' && HOSTS.has(u.hostname) ? u.href : '';
  } catch {
    return '';
  }
}

/** Таблицы стилей страницы (только с сайта bgprevoz.rs) — их вшиваем в сохранённую копию, чтобы она выглядела как сайт и без сети. */
export function stylesheetUrls(html: string, max = 6): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/rel=["']?stylesheet/i.test(tag)) continue;
    const h = /href=["']([^"']+)["']/i.exec(tag);
    const u = h ? absUrl(h[1]) : '';
    if (u && !out.includes(u)) out.push(u);
    if (out.length >= max) break;
  }
  return out;
}

/** Страница для показа: без скриптов и внешних вставок, с базовым адресом сайта и вшитыми стилями. */
export function buildDoc(html: string, css: string[]): string {
  let h = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|noscript|iframe|object|embed|base)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|iframe|object|embed|base)\b[^>]*\/?>/gi, '')
    .replace(/<link\b[^>]*>/gi, '')
    .replace(/<meta\b[^>]*http-equiv=["']?refresh[^>]*>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  const inject =
    `<base href="${SITE}/">` +
    css.map((c) => `<style>${c.replace(/<\/style/gi, '')}</style>`).join('') +
    '<style>html,body{margin:0}header,nav,footer{display:none!important}</style>';
  if (/<head[\s>]/i.test(h)) h = h.replace(/<head[^>]*>/i, (m) => m + inject);
  else h = `<head>${inject}</head>${h}`;
  return h;
}

/** Ссылка ведёт на сайт Секретариата (её можно открыть из интернета). */
export function siteLink(href: string): string {
  try {
    const u = new URL(href, `${SITE}/`);
    return u.protocol === 'https:' && HOSTS.has(u.hostname) ? u.href : '';
  } catch {
    return '';
  }
}
