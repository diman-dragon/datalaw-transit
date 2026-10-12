import test from 'node:test';
import assert from 'node:assert/strict';
import { kindOfDate, nextDeparture, routeCompare, shortCompare } from '../src/schedule.ts';
import { fmtMin, pretty, validityFull, validityText, waitText, parseIsoDate, fmtDateInt, monthKey } from '../src/format.ts';
import { shouldRemind } from '../src/remind.ts';
import { checkSchedule } from '../src/validate.ts';
import { bytesOf, sampleFile } from './helpers.ts';

const c = checkSchedule(bytesOf(sampleFile()), 'f.json', new Date(2026, 9, 11));
const l26 = c.lines.find((l) => l.short === '26')!;
const d0 = l26.dirs[0];

test('тип дня по дате', () => {
  assert.equal(kindOfDate(new Date(2026, 9, 9)), 'weekday'); // пятница
  assert.equal(kindOfDate(new Date(2026, 9, 10)), 'sat');
  assert.equal(kindOfDate(new Date(2026, 9, 11)), 'sun');
  assert.equal(kindOfDate(new Date(2026, 9, 12)), 'weekday');
});

test('ближайшее отправление: сегодня, через полночь, завтра', () => {
  // среда 14.10.2026, будни: 04:10 04:30 12:00 24:15
  const at = (h: number, m: number, day = 14) => new Date(2026, 9, day, h, m);
  let n = nextDeparture(d0, at(11, 50))!;
  assert.deepEqual([fmtMin(n.min), n.wait, n.tomorrow], ['12:00', 10, false]);
  n = nextDeparture(d0, at(12, 0))!; // в ту же минуту — «сейчас»
  assert.deepEqual([fmtMin(n.min), n.wait], ['12:00', 0]);
  n = nextDeparture(d0, at(12, 1))!; // дальше только рейс после полуночи
  assert.deepEqual([fmtMin(n.min), n.tomorrow], ['00:15', false]);
  assert.equal(n.wait, 1455 - 721);
  // 00:05 в четверг: ловим «вчерашний» 24:15 из среды
  n = nextDeparture(d0, at(0, 5, 15))!;
  assert.deepEqual([fmtMin(n.min), n.wait, n.tomorrow], ['00:15', 10, false]);
  // пятница 00:20: вчерашний рейс уже ушёл, ближайшее — 04:10
  n = nextDeparture(d0, at(0, 20, 16))!;
  assert.equal(fmtMin(n.min), '04:10');
  // пятница вечером: на субботу — 05:00 (завтра), но сначала 00:15 ночного рейса пятницы
  n = nextDeparture(d0, at(23, 0, 16))!;
  assert.equal(fmtMin(n.min), '00:15');
  // у обратного направления в будни только 05:00: в 06:00 в среду — рейсов нет, завтра 05:00
  n = nextDeparture(l26.dirs[1], at(6, 0))!;
  assert.deepEqual([fmtMin(n.min), n.tomorrow, n.wait], ['05:00', true, 1440 - 360 + 300]);
  // воскресенье вечером, обратное направление: завтра (будни) 05:00
  n = nextDeparture(l26.dirs[1], new Date(2026, 9, 11, 23, 0))!;
  assert.deepEqual([fmtMin(n.min), n.tomorrow], ['05:00', true]);
  // линия без рейсов в этот и следующий день
  assert.equal(nextDeparture({ ...d0, times: { weekday: [], sat: [], sun: [] } }, at(10, 0)), null);
});

test('форматирование времени и сроков', () => {
  assert.equal(fmtMin(0), '00:00');
  assert.equal(fmtMin(1455), '00:15');
  assert.equal(fmtMin(1559), '01:59');
  assert.equal(fmtMin(605), '10:05');
  assert.equal(waitText(0), 'сейчас');
  assert.equal(waitText(12), 'через 12 мин');
  assert.equal(waitText(65), 'через 1 ч 05 мин');
  assert.equal(waitText(120), 'через 2 ч');
  assert.equal(parseIsoDate('2025-03-17'), 20250317);
  assert.equal(parseIsoDate('2025-02-30'), 0);
  assert.equal(parseIsoDate('17.03.2025'), 0);
  assert.equal(parseIsoDate(5), 0);
  assert.equal(fmtDateInt(20250317), '17.03.2025');
  assert.equal(validityText(20250317, 0), 'действует с 17.03.2025');
  assert.equal(validityText(20250317, 20261231), '17.03.2025 – 31.12.2026');
  assert.equal(validityText(0, 20261231), 'действует до 31.12.2026');
  assert.equal(validityText(0, 0), '');
  assert.equal(validityFull(20250317, 20261231), 'Действует с 17.03.2025 по 31.12.2026');
  assert.equal(monthKey(new Date(2026, 0, 5)), '2026-01');
});

test('названия остановок: ЗАГЛАВНЫЕ → «Заглавная», смешанный регистр не трогаем', () => {
  assert.equal(pretty('МИРИЈЕВО 4'), 'Мирије­во 4'.replace('\u00ad', ''));
  assert.equal(pretty('БЕЖАНИЈСКА КОСА'), 'Бежанијска Коса');
  assert.equal(pretty('ДОРЋОЛ /ДУНАВСКА/'), 'Дорћол /Дунавска/');
  assert.equal(pretty('Трг Републике'), 'Трг Републике');
  assert.equal(pretty('  123  '), '123');
});

test('сортировка линий: категория, потом номер', () => {
  assert.ok(shortCompare('2', '10') < 0);
  assert.ok(shortCompare('26', '26Л') < 0);
  assert.ok(shortCompare('101', 'E2') < 0);
  const by = (s: string) => c.lines.find((l) => l.short === s)!;
  const order = [...c.lines].sort(routeCompare).map((l) => l.short);
  assert.deepEqual(order, ['2', '26', 'N1', 'E2', '401', 'BG1']);
  assert.ok(routeCompare(by('2'), by('26')) < 0);
});

test('ежемесячное напоминание: раз в месяц и только при наличии данных', () => {
  const now = new Date(2026, 9, 11);
  assert.equal(shouldRemind('', now, true), true);
  assert.equal(shouldRemind('2026-09', now, true), true);
  assert.equal(shouldRemind('2026-10', now, true), false);
  assert.equal(shouldRemind('2025-10', now, true), true); // тот же месяц, но прошлого года
  assert.equal(shouldRemind('2026-09', now, false), false);
});
