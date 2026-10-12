import test from 'node:test';
import assert from 'node:assert/strict';
import { changeStatus, extractDetailHtml, mergeChanges, parseChangeDetail, parseChangesList } from '../src/changes.ts';

const row = (lines: string[], title: string, type: string, period: string, id: string, extra = '') =>
  `<tr><td>${lines.map((l) => `<a href="https://bgprevoz.rs/linije/red-voznje/smer-a/${l}">${l}</a>`).join('&nbsp; ')}${extra}</td><td>${title}</td><td>${type}</td><td>${period}</td><td><a href="https://bgprevoz.rs/linije/aktuelne-izmene/${id}">Опширније</a></td></tr>`;

const html = `<html><body><table><thead><tr><th>Линије</th><th>Наслов измене</th><th>Тип</th><th>Период</th><th></th></tr></thead><tbody>
${row(['15', '18', '78', '15Н'], 'Радови у улици Теодора Херцла &amp; Новоградска', 'Радови', '30/09/2026 - 13/12/2026', '1119')}
${row(['72', '601'], 'Информација о радовима у улици Сурчинска', 'Привремено измештено стајалиште', '10/10/2026 - 15/10/2026', '1131', ' &nbsp; #1758')}
${row(['7'], 'Нова измена', 'Радови', '20/10/2026 - 01/11/2026', '1200')}
<tr><td>без периода</td><td>x</td><td>y</td><td>нема</td><td></td></tr>
</tbody></table></body></html>`;

test('список изменений: линии, название, тип, период, ссылка', () => {
  const items = parseChangesList(html);
  assert.equal(items.length, 3);
  assert.deepEqual(items[0].lines, ['15', '18', '78', '15Н']);
  assert.equal(items[0].title, 'Радови у улици Теодора Херцла & Новоградска');
  assert.equal(items[0].type, 'Радови');
  assert.deepEqual([items[0].from, items[0].to], [20260930, 20261213]);
  assert.equal(items[0].id, '1119');
  assert.equal(items[0].url, 'https://bgprevoz.rs/linije/aktuelne-izmene/1119');
  assert.deepEqual(items[1].lines, ['72', '601']); // «#1758» — не линия
  assert.deepEqual(parseChangesList('<html>нет таблицы</html>'), []);
});

test('текст подробностей: после периода, до «Зона радова»', () => {
  const page = `<nav>меню</nav><h1>Наслов</h1><div><span>15 18</span> 30/09/2026 - 13/12/2026</div><div>Током радова доћи ће до промена. Линије саобраћају на следећи начин: - возила 15 иду преко А; - возила 18 иду преко Б;</div><p>Зона радова</p><p>Изабери линију 15 [Земун]</p><footer>Секретаријат</footer>`;
  const d = parseChangeDetail(page);
  assert.match(d, /^Током радова/);
  assert.ok(d.includes('следећи начин:\n- возила 15 иду преко А;\n- возила 18'));
  assert.ok(!d.includes('Зона радова') && !d.includes('Изабери'));
  assert.equal(parseChangeDetail('<p>без периода</p>'), '');
});

test('слияние: «впервые увидели» и тексты сохраняются, изменившееся — перекачивается', () => {
  const a = parseChangesList(html).map((c) => ({ ...c, firstSeen: '2026-10-01T10:00:00Z', detail: 'текст ' + c.id }));
  const fresh = parseChangesList(html.replace('15/10/2026', '20/10/2026')).concat();
  const m = mergeChanges(a, fresh, '2026-10-12T10:00:00Z');
  assert.equal(m[0].firstSeen, '2026-10-01T10:00:00Z');
  assert.equal(m[0].detail, 'текст 1119');
  assert.equal(m[1].detail, ''); // период изменился
  const m2 = mergeChanges(a.slice(0, 1), fresh, '2026-10-12T10:00:00Z');
  assert.equal(m2[2].firstSeen, '2026-10-12T10:00:00Z'); // новая запись
});

test('статус по датам', () => {
  const [c] = parseChangesList(html);
  assert.equal(changeStatus(c, 20261012), 'active');
  assert.equal(changeStatus(c, 20260901), 'soon');
  assert.equal(changeStatus(c, 20261214), 'ended');
});

test('HTML объявления: от периода до «Зона радова», с разметкой', () => {
  const page = '<nav>меню</nav><h1>Наслов</h1><div>30/09/2026 - 13/12/2026</div><p>Током <b>радова</b>: - возила А ; - возила Б</p><ul><li>15</li></ul><h2>Зона радова</h2><div>карта</div>';
  const h = extractDetailHtml(page);
  assert.ok(h.includes('<b>радова</b>') && h.includes('<ul>'));
  assert.ok(!h.includes('Зона радова') && !h.includes('меню'));
  assert.equal(extractDetailHtml('<p>без периода</p>'), '');
});
