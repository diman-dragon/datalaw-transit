import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDoc, extractIds, siteLink, stylesheetUrls } from '../src/changes-page.ts';

const page = `<html><head><title>x</title><link rel="stylesheet" href="/build/app.css"><link rel="stylesheet" href="https://evil.com/a.css"><script src="/a.js"></script><base href="https://evil.com/"></head>
<body onload="x()"><nav>меню</nav><table><tr><td><a href="https://bgprevoz.rs/linije/aktuelne-izmene/1119" onclick="bad()">Опширније</a></td></tr><tr><td><a href="/linije/aktuelne-izmene/1131">Опширније</a></td></tr></table><script>alert(1)</script></body></html>`;

test('номера объявлений и таблицы стилей', () => {
  assert.deepEqual(extractIds(page), ['1119', '1131']);
  assert.deepEqual(stylesheetUrls(page), ['https://bgprevoz.rs/build/app.css']);
});

test('страница для показа: без скриптов, с базой сайта и вшитыми стилями', () => {
  const d = buildDoc(page, ['.x{color:red}']);
  assert.ok(!/<script|onclick|onload|evil\.com|<link/i.test(d));
  assert.ok(d.includes('<base href="https://bgprevoz.rs/">') && d.includes('.x{color:red}'));
  assert.ok(d.includes('Опширније'));
  assert.ok(buildDoc('<p>без head</p>', []).startsWith('<head>'));
});

test('ссылки только на сайт Секретариата', () => {
  assert.equal(siteLink('/linije/aktuelne-izmene/5'), 'https://bgprevoz.rs/linije/aktuelne-izmene/5');
  assert.equal(siteLink('https://evil.com/x'), '');
  assert.equal(siteLink('javascript:void(0)'), '');
});
