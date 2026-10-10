import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDataset } from '../src/gtfs/build.ts';
import {
  activeServices,
  departuresAt,
  fmtTime,
  groupDepartures,
  patternTimes,
  routeCompare,
  routesAtStop,
  shortCompare,
} from '../src/schedule.ts';
import { sampleFeed } from './helpers.ts';

const ds = buildDataset([sampleFeed()]);
const rdMap = new Map(ds.routeData.map((r) => [r.route, r]));
const ctx = { services: ds.services, stopIndex: ds.stopIndex, routeData: (r: number) => rdMap.get(r)! };
const slavija = ds.stops.name.indexOf('Славија');
const zvezdara = ds.stops.name.indexOf('Звездара');
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

test('отправления со Славии в пятницу: будни + ночной рейс четверга после полуночи', () => {
  const deps = departuresAt(ctx, slavija, new Date(2026, 9, 9));
  const names = deps.map((d) => `${ds.routes[d.route].short}@${t(d.time)}`);
  // 00:10 — рейс t3 буднего сервиса четверга (24:10), трамвай 2 в 07:15, автобус 26 в 08:00 и 09:00
  assert.deepEqual(names, ['26@00:10', '2@07:15', '26@08:00', '26@09:00']);
});

test('отправления в субботу: рейс t3 из пятницы в 00:10 + выходной рейс t5', () => {
  const deps = departuresAt(ctx, slavija, new Date(2026, 9, 10));
  const names = deps.map((d) => `${ds.routes[d.route].short}@${t(d.time)}`);
  assert.deepEqual(names, ['26@00:10', '26@11:00']);
});

test('фильтр по линии и группировка по направлению', () => {
  const r26 = ds.routes.findIndex((r) => r.short === '26');
  const deps = departuresAt(ctx, zvezdara, new Date(2026, 9, 9), r26);
  assert.equal(deps.length, 1);
  assert.equal(deps[0].time, 10 * 3600);
  const groups = groupDepartures(ctx, departuresAt(ctx, slavija, new Date(2026, 9, 9)));
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((g) => g.head).sort(), ['Калемегдан', 'Звездара'].sort());
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
