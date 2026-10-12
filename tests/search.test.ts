import test from 'node:test';
import assert from 'node:assert/strict';
import { LineSearch, normalize } from '../src/search.ts';
import { checkSchedule } from '../src/validate.ts';
import { bytesOf, sampleFile } from './helpers.ts';

test('normalize: кириллица, латиница с диакритикой, русская раскладка', () => {
  assert.equal(normalize('Ђерам'), 'djeram');
  assert.equal(normalize('Đeram'), 'djeram');
  assert.equal(normalize('Славија'), 'slavija');
  assert.equal(normalize('Žarkovo — Čukarica'), 'zarkovo cukarica');
  assert.equal(normalize('  Трг   Републике '), 'trg republike');
});

const c = checkSchedule(bytesOf(sampleFile()), 'f.json', new Date(2026, 9, 11));
const idx = new LineSearch(c.lines);
const shorts = (q: string) => idx.search(q).map((i) => c.lines[i].short);

test('поиск линий: по номеру и по конечным, кириллица = латиница', () => {
  assert.deepEqual(shorts('26'), ['26']);
  assert.deepEqual(shorts('n1'), ['N1']);
  assert.deepEqual(shorts('мириево'), []); // «Мириево» ≠ «Мириjево» в данных — зато ниже находится по «МИРИЈЕВО»
  assert.deepEqual(shorts('мирије'), ['26']);
  assert.deepEqual(shorts('mirije'), ['26']);
  assert.deepEqual(shorts('bezanijska'), ['26']);
  assert.deepEqual(shorts('slavija'), ['N1']);
  assert.deepEqual(shorts('zemun slav'), ['N1']);
  assert.deepEqual(shorts('несуществующая'), []);
  assert.deepEqual(shorts(''), []);
});
