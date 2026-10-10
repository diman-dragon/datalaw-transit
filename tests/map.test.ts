import test from 'node:test';
import assert from 'node:assert/strict';
import { boundsOf, fitView, haversine, project, unproject } from '../src/map/geo.ts';
import { buildDataset } from '../src/gtfs/build.ts';
import { buildNameGroups, enrich, findDirect, sortResults } from '../src/finder.ts';
import { fmtTime } from '../src/schedule.ts';
import { sampleFeed } from './helpers.ts';

test('проекция: туда и обратно', () => {
  for (const [lat, lon, z] of [[44.8125, 20.4612, 12], [45.2671, 19.8335, 17.5], [-33.9, 151.2, 5]]) {
    const p = project(lat, lon, z);
    const q = unproject(p.x, p.y, z);
    assert.ok(Math.abs(q.lat - lat) < 1e-9 && Math.abs(q.lon - lon) < 1e-9);
  }
  // Белград лежит около x≈0.557 мира, y≈0.3 мира
  const w = project(44.8125, 20.4612, 0);
  assert.ok(Math.abs(w.x / 256 - 0.5568) < 0.001);
});

test('fitView: границы помещаются в окно', () => {
  const b = boundsOf([
    { lat: 44.78, lon: 20.40 },
    { lat: 44.84, lon: 20.52 },
  ])!;
  const { center, zoom } = fitView(b, 400, 600, 30);
  const a = project(b.maxLat, b.minLon, zoom);
  const c = project(b.minLat, b.maxLon, zoom);
  assert.ok(c.x - a.x <= 400 - 60 + 1e-6 && c.y - a.y <= 600 - 60 + 1e-6);
  assert.ok(center.lat > 44.78 && center.lat < 44.84);
  // одна точка — максимальный масштаб, но не больше 17
  assert.equal(fitView(boundsOf([{ lat: 44.8, lon: 20.4 }])!, 400, 600).zoom, 17);
});

test('haversine ~ 1° широты ≈ 111 км', () => {
  const d = haversine({ lat: 44, lon: 20 }, { lat: 45, lon: 20 });
  assert.ok(Math.abs(d - 111195) < 300);
});

const ds = buildDataset([sampleFeed()]);
const rdMap = new Map(ds.routeData.map((r) => [r.route, r]));
const rd = (r: number) => rdMap.get(r)!;
const groups = buildNameGroups(ds.stops);

test('линии без пересадок: Славија → Звездара и обратно', () => {
  const sl = groups.get('Славија')!;
  const zv = groups.get('Звездара')!;
  const fwd = findDirect(sl, zv, ds.stopIndex, rd);
  assert.equal(fwd.length, 2); // автобус 26 и трамвай 2 (Славија → Звездара на 3-й остановке)
  const r26 = ds.routes.findIndex((r) => r.short === '26');
  const f26 = fwd.find((x) => x.route === r26)!;
  assert.equal(f26.stopsBetween, 2);
  // обратное направление: 26 ходит Звездара → Славија
  const back = findDirect(zv, sl, ds.stopIndex, rd);
  assert.equal(back.length, 1);
  assert.equal(back[0].route, r26);
  assert.equal(findDirect(sl, groups.get('Трг Републике')!, ds.stopIndex, rd).length, 0);
});

test('время в пути и сортировка по прибытию', () => {
  const sl = groups.get('Славија')!;
  const zv = groups.get('Звездара')!;
  const res = enrich(findDirect(sl, zv, ds.stopIndex, rd), rd, ds.services, new Date(2026, 9, 9), 7 * 3600 + 20 * 60);
  const sorted = sortResults(res, ds.routes);
  // 07:20 — трамвай 2 в 07:15 уже ушёл, ближайший: автобус 26 в 08:00, в пути 10 мин
  const first = sorted[0];
  assert.equal(ds.routes[first.route].short, '26');
  assert.equal(fmtTime(first.next[0]), '08:00');
  assert.equal(first.rideSec, 600);
  assert.equal(fmtTime(first.arrive!), '08:10');
});
