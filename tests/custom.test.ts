import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDataset } from '../src/gtfs/build.ts';
import { CUSTOM_FORMAT, customToFeed, parseCustom } from '../src/custom.ts';
import { patternTimes, fmtTime, validityOn } from '../src/schedule.ts';

const file = {
  format: CUSTOM_FORMAT,
  generated: '2026-10-11T12:00:00Z',
  source: 'gsp.rs',
  lines: [
    {
      id: '26',
      short: '26',
      long: 'Дорћол - Браће Јерковић',
      kind: 'bus',
      dirs: [
        {
          from: 'ДОРЋОЛ /ДУНАВСКА/',
          to: 'БРАЋЕ ЈЕРКОВИЋ',
          stops: ['ДОРЋОЛ /ДУНАВСКА/', 'ТРГ РЕПУБЛИКЕ', 'БРАЋЕ ЈЕРКОВИЋ'],
          validFrom: '2025-03-17',
          times: { weekday: ['04:10', '04:30', '24:15'], sat: ['05:00'], sun: [] },
        },
        { from: 'БРАЋЕ ЈЕРКОВИЋ', to: 'ДОРЋОЛ /ДУНАВСКА/', validFrom: '2025-09-01', times: { weekday: ['05:00'], sat: [], sun: ['06:00'] } },
      ],
    },
    { id: 'X', dirs: [{ from: 'A', to: 'B', times: {} }] },
  ],
};
const bytes = new TextEncoder().encode(JSON.stringify(file));

test('parseCustom: проверка формата', () => {
  assert.throws(() => parseCustom(new TextEncoder().encode('не json')), /JSON/);
  assert.throws(() => parseCustom(new TextEncoder().encode('{"lines":[]}')), /datalaw-schedule/);
  assert.equal(parseCustom(bytes).lines.length, 2);
});

test('файл расписания превращается в набор данных: направления, дни, срок действия', () => {
  const ds = buildDataset([customToFeed(parseCustom(bytes), 'g', 'Свой файл')]);
  assert.equal(ds.routes.length, 1); // линия без рейсов не попала
  const rd = ds.routeData[0];
  assert.equal(rd.patterns.length, 2);
  const p0 = rd.patterns.find((p) => p.dir === 0)!;
  assert.equal(ds.stops.name[p0.stops[1]], 'ТРГ РЕПУБЛИКЕ');
  assert.equal(ds.stops.name[p0.stops[0]], 'ДОРЋОЛ /ДУНАВСКА/');
  const wed = new Date(2026, 9, 14);
  const sat = new Date(2026, 9, 17);
  // будни: 00:15 (рейс 24:15 вчерашнего дня), 04:10, 04:30
  assert.deepEqual(patternTimes(ds.services, p0, 0, wed).map(fmtTime), ['00:15', '04:10', '04:30']);
  assert.deepEqual(patternTimes(ds.services, p0, 0, sat).map(fmtTime), ['00:15', '05:00']); // 00:15 — ночной рейс пятницы
  // у направлений разные даты «Важи од»
  assert.deepEqual(validityOn(ds.services, [p0], wed), { from: 20250317, to: 0 });
  const p1 = rd.patterns.find((p) => p.dir === 1)!;
  assert.deepEqual(validityOn(ds.services, [p1], wed), { from: 20250901, to: 0 });
  // остановки без списка заменены на пару «откуда — куда»
  assert.equal(p1.stops.length, 2);
  // идентификаторы остановок — названия
  assert.ok(ds.stops.id.includes('g:ТРГ РЕПУБЛИКЕ'));
});
