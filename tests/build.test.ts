import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDataset, routeKind } from '../src/gtfs/build.ts';
import { sampleFeed } from './helpers.ts';

test('routeKind', () => {
  assert.equal(routeKind(0), 'tram');
  assert.equal(routeKind(3), 'bus');
  assert.equal(routeKind(11), 'trolley');
  assert.equal(routeKind(700), 'bus');
  assert.equal(routeKind(2), 'rail');
});

test('buildDataset: линии, варианты, остановки, индекс', () => {
  const ds = buildDataset([sampleFeed()]);
  assert.equal(ds.routes.length, 2);
  const r26 = ds.routes.findIndex((r) => r.short === '26');
  assert.ok(r26 >= 0);
  assert.equal(ds.routes[r26].kind, 'bus');
  assert.equal(ds.routes[r26].color, 'ff0000');
  assert.equal(ds.routes[ds.routes.findIndex((r) => r.short === '2')].kind, 'tram');

  // неиспользуемая остановка не попала
  assert.ok(!ds.stops.name.includes('Неиспользуемая'));
  assert.equal(ds.meta.stops, 4);
  assert.equal(ds.meta.feeds[0].version, '2026-10-01');
  assert.equal(ds.meta.feeds[0].startDate, 20260101);

  const rd = ds.routeData.find((x) => x.route === r26)!;
  // направление 0: 4 рейса (t1,t2,t3,t5) по одному и тому же набору остановок, направление 1: 1 рейс
  assert.equal(rd.patterns.length, 2);
  const p0 = rd.patterns.find((p) => p.dir === 0)!;
  const p1 = rd.patterns.find((p) => p.dir === 1)!;
  assert.equal(p0.trips, 4);
  assert.equal(p0.head, 'Звездара');
  assert.equal(p0.stops.length, 3);
  assert.equal(ds.stops.name[p0.stops[0]], 'Славија');
  assert.equal(ds.stops.name[p0.stops[2]], 'Звездара');
  // рейсы отсортированы по первому времени: 08:00, 09:00, 11:00, 24:10
  const firsts = [...Array(4).keys()].map((i) => p0.times[i * 3]);
  assert.deepEqual(firsts, [8 * 3600, 9 * 3600, 11 * 3600, 24 * 3600 + 600]);
  // перемешанные строки t3 собрались по stop_sequence
  assert.deepEqual([...p0.times.subarray(9, 12)], [24 * 3600 + 600, 24 * 3600 + 1200, 24 * 3600 + 1800]);
  // пропущенное время (t4, остановка 2) заполнено предыдущим
  assert.deepEqual([...p1.times], [10 * 3600, 10 * 3600, 10 * 3600 + 1200]);
  assert.equal(p1.head, 'Славија');

  // индекс содержит все остановки вариантов, включая конечные: Звездара — конец направления 0 и начало направления 1
  const zvezdara = ds.stops.name.indexOf('Звездара');
  const atZvezdara = ds.stopIndex[zvezdara] ?? [];
  assert.equal(atZvezdara.length % 3, 0);
  const poss = [];
  for (let k = 0; k < atZvezdara.length; k += 3) if (atZvezdara[k] === r26) poss.push(atZvezdara[k + 2]);
  assert.deepEqual(poss.sort(), [0, 2]);
});

test('buildDataset: несколько фидов не смешивают идентификаторы', () => {
  const a = sampleFeed();
  const b = sampleFeed();
  b.key = 'p';
  b.name = 'Пригород';
  const ds = buildDataset([a, b]);
  assert.equal(ds.routes.length, 4);
  assert.equal(ds.meta.stops, 8);
  assert.equal(ds.meta.feeds.length, 2);
  assert.equal(new Set(ds.services.ids).size, ds.services.ids.length);
});

test('buildDataset: понятная ошибка при отсутствии файла', () => {
  const f = sampleFeed();
  delete f.files['stop_times.txt'];
  assert.throws(() => buildDataset([f]), /stop_times\.txt/);
});
