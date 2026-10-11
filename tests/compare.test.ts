import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDataset } from '../src/gtfs/build.ts';
import { diffSnapshots, diffSummary, makeSnapshot } from '../src/compare.ts';
import { sampleFeed } from './helpers.ts';

const enc = new TextEncoder();

function feedWith(extraTrips: string): ReturnType<typeof sampleFeed> {
  const f = sampleFeed();
  const dec = new TextDecoder();
  f.files['trips.txt'] = enc.encode(dec.decode(f.files['trips.txt']) + extraTrips);
  return f;
}

test('слепок: направления, будни/суббота/воскресенье, даты', () => {
  const ds = buildDataset([sampleFeed()]);
  const s = ds.snapshot;
  assert.equal(s.lines.length, 2);
  const l26 = s.lines.find((l) => l.short === '26')!;
  assert.equal(l26.dirs.length, 2);
  assert.equal(l26.dirs[0].from, 'Славија');
  assert.equal(l26.dirs[0].to, 'Звездара');
  // будни: 00:10 (ночной рейс предыдущего дня), 08:00, 09:00
  assert.deepEqual(l26.dirs[0].times.weekday, [10, 480, 540]);
  assert.deepEqual(l26.dirs[0].times.sat, [10, 660]);
  assert.equal(s.feeds[0].startDate, 20260101);
  assert.ok(s.refDates.weekday > 0);
});

test('сравнение: без старых данных — первая загрузка', () => {
  const d = diffSnapshots(null, buildDataset([sampleFeed()]).snapshot);
  assert.equal(d.first, true);
  assert.match(diffSummary(d), /Первая загрузка/);
});

test('сравнение: одинаковые наборы — без изменений', () => {
  const a = makeSnapshot(buildDataset([sampleFeed()]), new Date(2026, 9, 9));
  const b = makeSnapshot(buildDataset([sampleFeed()]), new Date(2026, 9, 9));
  const d = diffSnapshots(a, b);
  assert.equal(d.changed.length, 0);
  assert.equal(d.added.length + d.removed.length, 0);
  assert.equal(d.same, 2);
});

test('сравнение: новые рейсы, убранная и новая линия', () => {
  const oldDs = buildDataset([sampleFeed()]);
  // новый набор: линия 26 получает ещё один будний рейс, трамвай 2 пропал, появляется линия 77
  const f = sampleFeed();
  const dec = (n: string) => new TextDecoder().decode(f.files[n]);
  f.files['routes.txt'] = enc.encode(dec('routes.txt').replace('r2,2,Устанички - Калемегдан,0,,', 'r77,77,Тест - Тест,3,,'));
  f.files['trips.txt'] = enc.encode(dec('trips.txt').replace('r2,wd,t6', 'r77,wd,t6') + 'r26,wd,t7,Звездара,0,sh1\n');
  f.files['stop_times.txt'] = enc.encode(dec('stop_times.txt') + 't7,13:00:00,13:00:00,1,1\nt7,13:05:00,13:05:00,2,2\nt7,13:10:00,13:10:00,4,3\n');
  const newDs = buildDataset([f]);
  const d = diffSnapshots(makeSnapshot(oldDs, new Date(2026, 9, 9)), makeSnapshot(newDs, new Date(2026, 9, 9)));
  assert.deepEqual(d.added.map((x) => x.short), ['77']);
  assert.deepEqual(d.removed.map((x) => x.short), ['2']);
  assert.equal(d.changed.length, 1);
  assert.equal(d.changed[0].short, '26');
  assert.match(d.changed[0].notes.join('\n'), /будни: \+1 рейс/);
});

test('сравнение: смена конечной и срока действия', () => {
  const a = makeSnapshot(buildDataset([sampleFeed()]), new Date(2026, 9, 9));
  const f = sampleFeed();
  f.files['calendar.txt'] = enc.encode(new TextDecoder().decode(f.files['calendar.txt']).replaceAll('20260101', '20270301').replaceAll('20261231', '20271001'));
  const b = makeSnapshot(buildDataset([f]), new Date(2026, 9, 9));
  const d = diffSnapshots(a, b);
  assert.deepEqual(d.oldValidity, { start: 20260101, end: 20261231 });
  assert.deepEqual(d.newValidity, { start: 20270301, end: 20271001 });
  // эталонные даты нового расписания — внутри его срока действия
  assert.ok(d.refDates.new.weekday >= 20270301);
});
