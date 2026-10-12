import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSchedule, deriveCat } from '../src/validate.ts';
import { makeDataset, datasetStats, categoriesPresent } from '../src/dataset.ts';
import { bytesOf, sampleFile } from './helpers.ts';

const today = new Date(2026, 9, 11);

test('корректный файл принимается: линии, направления, отправления', () => {
  const c = checkSchedule(bytesOf(sampleFile()), 'datalaw-schedule.json', today);
  assert.equal(c.ok, true);
  assert.deepEqual(c.errors, []);
  assert.equal(c.lines.length, 6); // X без рейсов отброшена
  assert.equal(c.stats.dirs, 7);
  assert.equal(c.stats.departures, 15); // 26: 7 + 2, N1: 2, трамвай 2, E2, 401, BG1 — по одному
  assert.equal(c.validTo, 20270831);
  assert.equal(c.validFrom, 20250317);
  const l26 = c.lines.find((l) => l.short === '26')!;
  assert.equal(l26.id, 'g:26');
  assert.deepEqual(l26.dirs[0].times.weekday, [250, 270, 720, 1455]); // 24:15 → 1455 минут
  assert.deepEqual(l26.dirs[1].stops, ['БЕЖАНИЈСКА КОСА', 'МИРИЈЕВО 4']); // без списка остановок — только конечные
  assert.ok(c.warnings.some((w) => w.includes('Линия X')));
});

test('категории: ночные, трамваи, экспресс, пригородные, сербиявоз, дневные', () => {
  const c = checkSchedule(bytesOf(sampleFile()), 'f.json', today);
  const cat = (s: string) => c.lines.find((l) => l.short === s)!.cat;
  assert.equal(cat('26'), 'day');
  assert.equal(cat('N1'), 'night');
  assert.equal(cat('2'), 'tram');
  assert.equal(cat('E2'), 'express');
  assert.equal(cat('401'), 'suburban');
  assert.equal(cat('BG1'), 'rail');
  assert.equal(deriveCat('7', 'bus', 'night', false), 'night');
  assert.equal(deriveCat('7', 'bus', 'мусор', false), 'day');
  assert.equal(deriveCat('15', 'bus', undefined, true), 'night');
  assert.equal(deriveCat('A1', 'bus', undefined, undefined), 'express');
  assert.equal(deriveCat('26Л', 'bus', undefined, undefined), 'day');
  const ds = makeDataset(c, 'f.json');
  assert.deepEqual(categoriesPresent(ds), ['tram', 'day', 'night', 'express', 'suburban', 'rail']);
  assert.equal(datasetStats(ds).lines, 6);
});

test('ошибки: пустой файл, не JSON, ZIP, PDF, не UTF-8', () => {
  assert.match(checkSchedule(new Uint8Array(0)).errors[0], /пуст/);
  const bad = checkSchedule(bytesOf('это не json'), 'a.txt');
  assert.equal(bad.ok, false);
  assert.match(bad.errors[0], /не читается как JSON/);
  assert.match(bad.errors[0], /\.txt/);
  assert.match(checkSchedule(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0])).errors[0], /ZIP/);
  assert.match(checkSchedule(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])).errors[0], /PDF/);
  assert.match(checkSchedule(new Uint8Array([0x7b, 0xff, 0xfe, 0x7d])).errors[0], /UTF-8/);
});

test('ошибки: метка формата, версия, нет линий', () => {
  assert.match(checkSchedule(bytesOf({ lines: [] })).errors[0], /format/);
  assert.match(checkSchedule(bytesOf({ format: 'gtfs', lines: [] })).errors[0], /не файл расписания/);
  assert.match(checkSchedule(bytesOf({ format: 'datalaw-schedule/2', lines: [{}] })).errors[0], /не поддерживается/);
  assert.match(checkSchedule(bytesOf({ format: 'datalaw-schedule/1' })).errors[0], /списка линий/);
  assert.match(checkSchedule(bytesOf({ format: 'datalaw-schedule/1', lines: [] })).errors[0], /пуст/);
  assert.match(checkSchedule(bytesOf([1, 2])).errors[0], /объект/);
  const none = checkSchedule(bytesOf({ format: 'datalaw-schedule/1', lines: [{ id: '1', dirs: [{ from: 'A', to: 'B', times: { weekday: ['xx'] } }] }] }));
  assert.equal(none.ok, false);
  assert.match(none.errors[0], /нет ни одной линии/);
});

test('замечания: плохие времена, даты, дубликаты, срок истёк, старт в будущем', () => {
  const f = {
    format: 'datalaw-schedule/1',
    validTo: '2026-01-01',
    lines: [
      { id: '1', dirs: [{ from: 'A', to: 'B', validFrom: '2027-02-30', times: { weekday: ['5:00', '25:99', '48:00', 'abc', 7, '05:00'] } }] },
      { id: '1', dirs: [{ from: 'A', to: 'B', times: { weekday: ['06:00'] } }] },
      { short: '', dirs: [] },
      'мусор',
      { id: '3', dirs: [{ from: 'A', times: { weekday: ['06:00'] } }] },
    ],
  };
  const c = checkSchedule(bytesOf(f), 'x.json', today);
  assert.equal(c.ok, true);
  assert.equal(c.lines.length, 1);
  assert.deepEqual(c.lines[0].dirs[0].times.weekday, [300]); // «5:00» и «05:00» — одно время
  const w = c.warnings.join('\n');
  assert.match(w, /некорректных значений времени: 4/);
  assert.match(w, /validFrom/);
  assert.match(w, /уже встречался/);
  assert.match(w, /Срок действия файла истёк 01\.01\.2026/);
  assert.match(w, /нет id/);
  assert.match(w, /не объект/);
  assert.match(w, /не указаны конечные/);
});

test('расписание, которое начнётся в будущем, — замечание', () => {
  const f = { format: 'datalaw-schedule/1', lines: [{ id: '1', dirs: [{ from: 'A', to: 'B', validFrom: '2026-12-01', times: { weekday: ['06:00'] } }] }] };
  const c = checkSchedule(bytesOf(f), 'x.json', today);
  assert.match(c.warnings.join(), /начнёт действовать только с 01\.12\.2026/);
});

test('BOM в начале файла допускается; лишние направления игнорируются', () => {
  const body = JSON.stringify({ format: 'datalaw-schedule/1', lines: [{ id: '1', dirs: [1, 2, 3].map((i) => ({ from: 'A' + i, to: 'B', times: { sun: ['01:00'] } })) }] });
  const c = checkSchedule(new TextEncoder().encode('\ufeff' + body), 'x.json', today);
  assert.equal(c.ok, true);
  assert.equal(c.lines[0].dirs.length, 2);
  assert.match(c.warnings.join(), /первые два/);
});
