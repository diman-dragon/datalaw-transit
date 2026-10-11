import type { FeedInput } from '../src/types.ts';

const enc = new TextEncoder();
const b = (s: string) => enc.encode(s.trim() + '\n');

/** Небольшой синтетический GTFS: линия 26 (2 направления, ночной рейс за полночь), трамвай 2, кириллица. */
export function sampleFeed(): FeedInput {
  return {
    key: 'c',
    name: 'Тест',
    files: {
      'stops.txt': b(`
stop_id,stop_code,stop_name,stop_lat,stop_lon
1,101,Славија,44.80,20.46
2,102,"Ђерам, пијаца",44.81,20.47
3,103,Трг Републике,44.82,20.48
4,104,Звездара,44.83,20.50
9,999,Неиспользуемая,0,0
`),
      'routes.txt': b(`
route_id,route_short_name,route_long_name,route_type,route_color,route_text_color
r26,26,Славија - Звездара,3,FF0000,FFFFFF
r2,2,Устанички - Калемегдан,0,,
`),
      'calendar.txt': b(`
service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date
wd,1,1,1,1,1,0,0,20260101,20261231
we,0,0,0,0,0,1,1,20260101,20261231
`),
      'calendar_dates.txt': b(`
service_id,date,exception_type
wd,20261012,2
we,20261012,1
`),
      'trips.txt': b(`
route_id,service_id,trip_id,trip_headsign,direction_id,shape_id
r26,wd,t1,Звездара,0,sh1
r26,wd,t2,Звездара,0,sh1
r26,wd,t3,Звездара,0,sh1
r26,wd,t4,Славија,1,sh2
r26,we,t5,Звездара,0,sh1
r2,wd,t6,Калемегдан,0,
`),
      // t3 — ночной рейс: 24:10, 24:20, 24:30 (после полуночи), строки намеренно перемешаны
      'stop_times.txt': b(`
trip_id,arrival_time,departure_time,stop_id,stop_sequence
t1,08:00:00,08:00:00,1,1
t1,08:05:00,08:05:00,2,2
t1,08:10:00,08:10:00,4,3
t2,09:00:00,09:00:00,1,1
t2,09:05:00,09:05:00,2,2
t2,09:10:00,09:10:00,4,3
t3,24:30:00,24:30:00,4,3
t3,24:10:00,24:10:00,1,1
t3,24:20:00,24:20:00,2,2
t4,10:00:00,10:00:00,4,1
t4,,,2,2
t4,10:20:00,10:20:00,1,3
t5,11:00:00,11:00:00,1,1
t5,11:05:00,11:05:00,2,2
t5,11:10:00,11:10:00,4,3
t6,07:00:00,07:00:00,3,1
t6,07:15:00,07:15:00,1,2
t6,07:30:00,07:30:00,4,3
`),
      'feed_info.txt': b(`
feed_publisher_name,feed_version
Test,2026-10-01
`),
    },
  };
}
