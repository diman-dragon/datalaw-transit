import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDataset } from '../src/gtfs/build.ts';
import {
  activeServices,
  dateForKind,
  dayKindOf,
  validityOn,
  fmtTime,
  patternTimes,
  routeCompare,
  routesAtStop,
  shortCompare,
} from '../src/schedule.ts';
import { sampleFeed } from './helpers.ts';

const ds = buildDataset([sampleFeed()]);
const rdMap = new Map(ds.routeData.map((r) => [r.route, r]));
const slavija = ds.stops.name.indexOf('Славија');
const t = (s: number) => fmtTime(s);

test('календарь: будни, выходные, исключения', () => {
  const wd = ds.services.ids.indexOf('c:wd');
  const we = ds.services.ids.indexOf('c:we');
  // 2026-10-09 — пятница
  const fri = activeServices(ds.services, new Date(2026, 9, 9));
  assert.equal(fri[wd], 1);
  assert.equal(fri[we], 0);
  const sat = activeServices(ds.services, new Date(2026, 9, 10));
  assert.equal(sat[wd], 0);
  assert.equal(sat[we], 1);
  // 2026-10-12 — понедельник, но по исключению ходит «выходное» расписание
  const mon = activeServices(ds.services, new Date(2026, 9, 12));
  assert.equal(mon[wd], 0);
  assert.equal(mon[we], 1);
  // вне диапазона календаря
  const out = activeServices(ds.services, new Date(2027, 0, 5));
  assert.equal(out[wd], 0);
});

test('тип дня: будни, суббота, воскресенье и праздник, работающий по-воскресному', () => {
  assert.equal(dayKindOf(ds.services, new Date(2026, 9, 9)), 'weekday');
  assert.equal(dayKindOf(ds.services, new Date(2026, 9, 10)), 'sat');
  assert.equal(dayKindOf(ds.services, new Date(2026, 9, 11)), 'sun');
  // 12.10.2026 — понедельник, но по исключению ходит «выходное» расписание (суббота и воскресенье совпадают)
  assert.notEqual(dayKindOf(ds.services, new Date(2026, 9, 12)), 'weekday');
});

test('дата для типа дня: сегодняшний тип — сама сегодняшняя дата', () => {
  const fri = new Date(2026, 9, 9);
  assert.equal(dateForKind(ds.services, 'weekday', fri).getTime(), fri.getTime());
  const sat = dateForKind(ds.services, 'sat', fri);
  assert.equal(sat.getDay(), 6);
  const sun = dateForKind(ds.services, 'sun', fri);
  assert.equal(sun.getDay(), 0);
});

test('срок действия расписания линии на дату', () => {
  const r26 = ds.routes.findIndex((r) => r.short === '26');
  const v = validityOn(ds.services, rdMap.get(r26)!.patterns, new Date(2026, 9, 9));
  assert.deepEqual(v, { from: 20260101, to: 20261231 });
});

test('patternTimes и routesAtStop', () => {
  const r26 = ds.routes.findIndex((r) => r.short === '26');
  const pat = rdMap.get(r26)!.patterns.find((p) => p.dir === 0)!;
  assert.deepEqual(patternTimes(ds.services, pat, 0, new Date(2026, 9, 9)).map(t), ['00:10', '08:00', '09:00']);
  assert.deepEqual(patternTimes(ds.services, pat, 0, new Date(2026, 9, 10)).map(t), ['00:10', '11:00']);
  assert.equal(routesAtStop(ds.stopIndex, slavija).length, 2);
});

test('fmtTime и сортировка номеров линий', () => {
  assert.equal(fmtTime(25 * 3600 + 5 * 60), '01:05');
  assert.equal(fmtTime(0), '00:00');
  const nums = ['E2', '101', '26', '7', '26Л', 'A1', 'N15', '2'];
  assert.deepEqual([...nums].sort(shortCompare), ['2', '7', '26', '26Л', '101', 'A1', 'E2', 'N15']);
  const tram = { kind: 'tram', short: '12' } as never;
  const bus = { kind: 'bus', short: '1' } as never;
  assert.ok(routeCompare(tram, bus) < 0);
});

import { dateInt, typicalDate } from '../src/schedule.ts';

test('типичные даты: будни, суббота, воскресенье; праздничные исключения пропускаются', () => {
  const fri = new Date(2026, 9, 9);
  assert.equal(dateInt(typicalDate(ds.services, 'weekday', fri)), 20261014); // ближайшая среда
  assert.equal(dateInt(typicalDate(ds.services, 'sat', new Date(2026, 9, 10))), 20261010);
  assert.equal(dateInt(typicalDate(ds.services, 'sun', fri)), 20261011);
  // если на среду приходится исключение календаря — берём следующую
  const cal = JSON.parse(JSON.stringify(ds.services));
  cal.add[0] = [...(cal.add[0] ?? []), 20261014];
  assert.equal(dateInt(typicalDate(cal, 'weekday', fri)), 20261021);
  // за пределами периода расписания — всё равно возвращает дату нужного дня недели
  assert.equal(typicalDate(ds.services, 'sat', new Date(2027, 5, 1)).getDay(), 6);
});
