import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, parseTime } from '../src/gtfs/csv.ts';

const enc = new TextEncoder();

test('parseCsv: BOM, CRLF, кавычки, порядок колонок, пропущенные колонки', () => {
  const src = '﻿stop_id,stop_name,extra\r\n1,"Ђерам, пијаца",x\r\n2,"Say ""hi""",y\r\n\r\n3,Простая,z\r\n';
  const rows: string[][] = [];
  parseCsv(enc.encode(src), ['stop_name', 'stop_id', 'missing'], (v) => rows.push(v));
  assert.deepEqual(rows, [
    ['Ђерам, пијаца', '1', ''],
    ['Say "hi"', '2', ''],
    ['Простая', '3', ''],
  ]);
});

test('parseCsv: большой файл режется на чанки без потери строк', () => {
  const lines = ['a,b'];
  for (let i = 0; i < 400000; i++) lines.push(`${i},Остановка ${i}`);
  const bytes = enc.encode(lines.join('\n'));
  assert.ok(bytes.length > 4 * 1024 * 1024, 'файл должен быть больше одного чанка');
  let n = 0;
  let last = '';
  parseCsv(bytes, ['a', 'b'], (v) => {
    n++;
    last = v[1];
  });
  assert.equal(n, 400000);
  assert.equal(last, 'Остановка 399999');
});

test('parseTime', () => {
  assert.equal(parseTime('08:05:30'), 8 * 3600 + 5 * 60 + 30);
  assert.equal(parseTime('8:05:00'), 8 * 3600 + 300);
  assert.equal(parseTime('25:10:00'), 25 * 3600 + 600);
  assert.equal(parseTime(''), -1);
  assert.equal(parseTime('bad'), -1);
});
