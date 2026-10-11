import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDataset } from '../src/gtfs/build.ts';
import { patternTimes } from '../src/schedule.ts';
import { applyLayer, choiceStats, changesCount, CUSTOM_FEED_KEY, defaultChoices, mergeDatasets, planCustom, resolveChoices } from '../src/overlay.ts';
import type { Choice } from '../src/overlay.ts';
import { sampleFeed } from './helpers.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Свой файл: линия 26 получает ещё один будний рейс (13:00), трамвая 2 нет, появляется линия 77. */
function customFeed() {
  const f = sampleFeed();
  f.key = CUSTOM_FEED_KEY;
  f.name = 'Свой файл: test.zip';
  const t = (n: string) => dec.decode(f.files[n]);
  f.files['routes.txt'] = enc.encode(t('routes.txt').replace('r2,2,Устанички - Калемегдан,0,,', 'r77,77,Тест - Тест,3,,'));
  f.files['trips.txt'] = enc.encode(t('trips.txt').replace('r2,wd,t6', 'r77,wd,t6') + 'r26,wd,t7,Звездара,0,sh1\n');
  f.files['stop_times.txt'] = enc.encode(t('stop_times.txt') + 't7,13:00:00,13:00:00,1,1\nt7,13:05:00,13:05:00,2,2\nt7,13:10:00,13:10:00,4,3\n');
  return f;
}

const shorts = (ds: ReturnType<typeof buildDataset>) => ds.routes.map((r) => r.short).sort();
const trips = (ds: ReturnType<typeof buildDataset>, short: string) => ds.routeData.find((rd) => ds.routes[rd.route].short === short)!.patterns.reduce((a, p) => a + p.trips, 0);

function setup() {
  const base = buildDataset([sampleFeed()]);
  const custom = buildDataset([customFeed()]);
  return { base, custom, plan: planCustom(base, custom) };
}

test('сравнение: изменённая, новая и отсутствующая линии', () => {
  const { plan } = setup();
  const by = Object.fromEntries(plan.lines.map((l) => [l.short, l]));
  assert.equal(by['26'].status, 'changed');
  assert.equal(by['26'].key, 'bus:26');
  assert.match(by['26'].notes.join('\n'), /будни: \+1 рейс/);
  assert.equal(by['77'].status, 'added');
  assert.equal(by['2'].status, 'removed');
  assert.deepEqual(plan.lines.map((l) => l.status), ['changed', 'added', 'removed']); // порядок: конфликты первыми
  assert.equal(plan.same, 0);
});

test('решения по умолчанию: конфликт — текущая, новая — добавить, отсутствующая — оставить', () => {
  const { plan } = setup();
  assert.deepEqual(defaultChoices(plan), { 'bus:26': 'current', 'bus:77': 'custom', 'tram:2': 'current' });
  // неизвестные ключи и мусор отбрасываются
  const r = resolveChoices(plan, { 'bus:26': 'custom', 'bus:999': 'custom', 'tram:2': 'x' as Choice });
  assert.deepEqual(r, { 'bus:26': 'custom', 'bus:77': 'custom', 'tram:2': 'current' });
});

test('слияние по умолчанию: текущие линии нетронуты, новая добавлена', () => {
  const { base, custom, plan } = setup();
  const m = mergeDatasets(base, custom, plan, defaultChoices(plan));
  assert.deepEqual(shorts(m), ['2', '26', '77']);
  assert.equal(trips(m, '26'), trips(base, '26')); // конфликт решён в пользу текущей
  assert.equal(m.meta.routes, 3);
  assert.equal(m.meta.feeds.length, 2);
  assert.equal(m.meta.feeds[1].key, CUSTOM_FEED_KEY);
  assert.equal(m.meta.feeds[1].routes, 1); // из своего файла взята только линия 77
  assert.equal(m.meta.feeds[0].routes, 2);
  assert.equal(m.meta.trips, trips(m, '2') + trips(m, '26') + trips(m, '77'));
});

test('слияние: конфликт в пользу своего файла — рейсы и календарь берутся из него', () => {
  const { base, custom, plan } = setup();
  const m = mergeDatasets(base, custom, plan, { ...defaultChoices(plan), 'bus:26': 'custom' });
  assert.equal(trips(m, '26'), trips(base, '26') + 1);
  const ri = m.routes.findIndex((r) => r.short === '26');
  assert.equal(m.routes[ri].id, 'u:r26');
  assert.equal(m.routes[ri].feed, 1);
  const p0 = m.routeData[ri].patterns.find((p) => p.dir === 0)!;
  // сервисы рейсов сдвинуты на конец общего календаря и указывают на сервисы своего файла
  for (const s of p0.svc) assert.ok(m.services.ids[s].startsWith('u:'), m.services.ids[s]);
  const wed = new Date(2026, 9, 14);
  assert.ok(patternTimes(m.services, p0, 0, wed).includes(13 * 3600));
  // календарные исключения (праздник 12.10) своего файла тоже перенесены
  const wd = m.services.ids.indexOf('u:wd');
  assert.deepEqual(m.services.remove[wd], [20261012]);
});

test('слияние: «убрать» линию, которой нет в своём файле, и «пропустить» новую', () => {
  const { base, custom, plan } = setup();
  const m = mergeDatasets(base, custom, plan, { 'bus:26': 'current', 'bus:77': 'current', 'tram:2': 'custom' });
  assert.deepEqual(shorts(m), ['26']);
  assert.equal(m.meta.feeds.length, 1); // из своего файла ничего не взято — отдельного источника нет
  // остановка, которую использовала только убранная линия, не осталась в данных
  assert.ok(!m.stops.name.includes('Трг Републике'));
  assert.equal(m.stops.id.length, 3);
});

test('слияние: одна и та же остановка (код + название) не дублируется', () => {
  const { base, custom, plan } = setup();
  const m = mergeDatasets(base, custom, plan, { 'bus:26': 'custom', 'bus:77': 'custom', 'tram:2': 'current' });
  assert.equal(m.stops.id.length, 4);
  assert.equal(new Set(m.stops.name).size, 4); // дублей по названию нет
  // общие остановки остались текущими (c:), «Ђерам» — только в своей версии линии 26, текущая её не использует
  assert.deepEqual(m.stops.id.filter((id) => id.startsWith('u:')), ['u:2']);
  // обе версии линий используют одну остановку Славија
  const slavija = m.stops.name.indexOf('Славија');
  const lines = new Set<number>();
  for (let k = 0; k < m.stopIndex[slavija].length; k += 3) lines.add(m.stopIndex[slavija][k]);
  assert.equal(lines.size, 3);
});

test('слияние: индекс остановок, слепок и входные данные согласованы', () => {
  const { base, custom, plan } = setup();
  const before = { routes: base.routes.length, services: base.services.ids.length, stops: base.stops.id.length, customStops: custom.stops.id.length };
  const m = mergeDatasets(base, custom, plan, { 'bus:26': 'custom', 'bus:77': 'custom', 'tram:2': 'current' });
  for (const [s, list] of Object.entries(m.stopIndex)) {
    for (let k = 0; k < list.length; k += 3) {
      const [ri, pi, pos] = [list[k], list[k + 1], list[k + 2]];
      assert.equal(m.routeData[ri].patterns[pi].stops[pos], +s);
    }
  }
  m.routeData.forEach((rd, i) => assert.equal(rd.route, i));
  const keys = m.snapshot.lines.map((l) => l.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(m.snapshot.lines.length, m.routes.length);
  // исходные наборы не изменены
  assert.equal(base.routes.length, before.routes);
  assert.equal(base.services.ids.length, before.services);
  assert.equal(base.stops.id.length, before.stops);
  assert.equal(custom.stops.id.length, before.customStops);
  assert.ok(base.routeData.every((rd) => rd.patterns.every((p) => p.stops.every((s) => s < before.stops))));
});

test('сводка выбора', () => {
  const { plan } = setup();
  const st = choiceStats(plan, { 'bus:26': 'custom', 'bus:77': 'current', 'tram:2': 'custom' });
  assert.deepEqual(st, { conflicts: 1, conflictsCustom: 1, added: 1, addedTaken: 0, removed: 1, removedDropped: 1 });
  assert.equal(changesCount(st), 2);
  assert.equal(changesCount(choiceStats(plan, {})), 1); // по умолчанию меняется только добавление линии 77
});

test('сохранённый слой: повторное наложение на заново собранные данные', () => {
  const { base, custom } = setup();
  const withChoice = applyLayer(base, custom, { 'bus:26': 'custom', 'bus:77': 'custom', 'tram:2': 'current' });
  assert.equal(withChoice.undecided, 0);
  assert.equal(trips(withChoice.dataset, '26'), trips(base, '26') + 1);
  // решения нет — конфликт остаётся за текущей версией и учитывается как нерешённый
  const without = applyLayer(base, custom, {});
  assert.equal(without.undecided, 1);
  assert.equal(trips(without.dataset, '26'), trips(base, '26'));
});
