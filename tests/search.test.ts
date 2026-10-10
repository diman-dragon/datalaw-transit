import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDataset } from '../src/gtfs/build.ts';
import { SearchIndex, normalize } from '../src/search.ts';
import { sampleFeed } from './helpers.ts';

test('normalize: кириллица, латиница с диакритикой, русская раскладка', () => {
  assert.equal(normalize('Ђерам'), 'djeram');
  assert.equal(normalize('Đeram'), 'djeram');
  assert.equal(normalize('Славија'), 'slavija');
  assert.equal(normalize('Žarkovo — Čukarica'), 'zarkovo cukarica');
  assert.equal(normalize('Звездара'), 'zvezdara');
  assert.equal(normalize('  Трг   Републике '), 'trg republike');
});

const ds = buildDataset([sampleFeed()]);
const idx = new SearchIndex(ds.stops, ds.routes);

test('поиск остановок: латиницей, кириллицей, по коду, по части слова', () => {
  const name = (i: number) => ds.stops.name[i];
  assert.equal(name(idx.searchStops('slavija')[0].stop), 'Славија');
  assert.equal(name(idx.searchStops('Славија')[0].stop), 'Славија');
  assert.equal(name(idx.searchStops('djeram')[0].stop), 'Ђерам, пијаца');
  assert.equal(name(idx.searchStops('pijaca')[0].stop), 'Ђерам, пијаца');
  assert.equal(name(idx.searchStops('trg rep')[0].stop), 'Трг Републике');
  assert.equal(name(idx.searchStops('104')[0].stop), 'Звездара');
  assert.equal(idx.searchStops('несуществующая').length, 0);
  assert.equal(idx.searchStops('').length, 0);
});

test('поиск линий: по номеру и по названию', () => {
  const short = (i: number) => ds.routes[i].short;
  assert.equal(short(idx.searchRoutes('26')[0].route), '26');
  assert.equal(short(idx.searchRoutes('kalemegdan')[0].route), '2');
  assert.equal(idx.searchRoutes('999').length, 0);
});
