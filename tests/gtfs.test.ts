import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDataset } from '../src/gtfs/build.ts';
import { nextDeparture } from '../src/schedule.ts';
import { fmtMin } from '../src/format.ts';

const enc = new TextEncoder();
const b = (s: string) => enc.encode(s.trim() + '\n');
const feed = (key: string) => ({
  key,
  name: 'Тест',
  files: {
    'stops.txt': b(`stop_id,stop_code,stop_name\n1,101,Мириjево 4\n2,102,"Трг, Републике"\n3,103,Бежанијска коса\n4,104,Славија\n5,105,Земун`),
    'routes.txt': b(`route_id,route_short_name,route_long_name,route_type\nr26,26,Мириjево - Бежанијска коса,3\nr2,2,Устанички - Калемегдан,0\nn1,N1,Славија - Земун,3`),
    'calendar.txt': b(`service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nwd,1,1,1,1,1,0,0,20260901,20270831\nwe,0,0,0,0,0,1,1,20260901,20270831`),
    'calendar_dates.txt': b(`service_id,date,exception_type\nwd,20261014,2\nwe,20261014,1`),
    'trips.txt': b(`route_id,service_id,trip_id,trip_headsign,direction_id
r26,wd,t1,x,0
r26,wd,t2,x,0
r26,wd,t3,x,0
r26,wd,t4,x,1
r26,we,t5,x,0
r2,wd,t6,x,0
n1,wd,t7,x,0
n1,wd,t8,x,0`),
    // t3 — после полуночи (24:10); строки перемешаны; t2 идёт короче (до остановки 2)
    'stop_times.txt': b(`trip_id,arrival_time,departure_time,stop_id,stop_sequence
t1,08:00:00,08:00:00,1,1
t1,08:05:00,08:05:00,2,2
t1,08:10:00,08:10:00,3,3
t2,09:00:00,09:00:00,1,1
t2,09:06:00,09:06:00,2,2
t3,24:10:00,24:10:00,1,1
t3,24:20:00,24:20:00,3,2
t4,10:00:00,10:00:00,3,1
t4,10:20:00,10:20:00,1,2
t5,11:00:00,11:00:00,1,1
t5,11:20:00,11:20:00,3,2
t6,07:00:00,07:00:00,4,1
t6,07:10:00,07:10:00,5,2
t7,23:30:00,23:30:00,4,1
t7,23:50:00,23:50:00,5,2
t8,25:10:00,25:10:00,4,1
t8,25:30:00,25:30:00,5,2`),
  },
});

test('GTFS → линии, направления, дни, срок действия', () => {
  const ds = buildDataset([feed('c')], new Date(2026, 9, 12));
  assert.equal(ds.lines.length, 3);
  assert.equal(ds.validTo, 20270831);
  const l = ds.lines.find((x) => x.short === '26')!;
  assert.equal(l.id, 'c:r26');
  assert.equal(l.cat, 'day');
  assert.equal(l.dirs.length, 2);
  assert.deepEqual([l.dirs[0].from, l.dirs[0].to], ['Мириjево 4', 'Бежанијска коса']);
  assert.deepEqual([l.dirs[1].from, l.dirs[1].to], ['Бежанијска коса', 'Мириjево 4']);
  // t2 короче, но отправляется от той же начальной — тоже попадает; 24:10 → после полуночи
  assert.deepEqual(l.dirs[0].times.weekday.map(fmtMin), ['08:00', '09:00', '00:10']);
  assert.deepEqual(l.dirs[0].times.weekday, [480, 540, 1450]);
  assert.deepEqual(l.dirs[0].times.sat, [660]);
  assert.deepEqual(l.dirs[1].times.sun, []);
  assert.equal(l.dirs[0].validFrom, 20260901);
});

test('категории: трамвай, ночная по времени, пригородная по источнику', () => {
  const ds = buildDataset([feed('c')], new Date(2026, 9, 12));
  assert.equal(ds.lines.find((x) => x.short === '2')!.cat, 'tram');
  assert.equal(ds.lines.find((x) => x.short === 'N1')!.cat, 'night');
  const p = buildDataset([feed('p')], new Date(2026, 9, 12));
  assert.equal(p.lines.find((x) => x.short === '26')!.cat, 'suburban');
  assert.equal(p.lines.find((x) => x.short === '2')!.cat, 'tram');
});

test('ближайшее отправление работает на данных из GTFS', () => {
  const ds = buildDataset([feed('c')], new Date(2026, 9, 12));
  const d = ds.lines.find((x) => x.short === '26')!.dirs[0];
  const n = nextDeparture(d, new Date(2026, 9, 13, 8, 30))!; // вторник
  assert.equal(fmtMin(n.min), '09:00');
});

test('ошибки: нет обязательных файлов, нет линий', () => {
  const f = feed('c');
  delete (f.files as Record<string, unknown>)['trips.txt'];
  assert.throws(() => buildDataset([f]), /нет файла trips\.txt/);
  const empty = feed('c');
  empty.files['trips.txt'] = b('route_id,service_id,trip_id,trip_headsign,direction_id');
  assert.throws(() => buildDataset([empty]), /нет ни одной линии/);
});
