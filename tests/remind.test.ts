import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTransitions, reminders } from '../src/remind.ts';

const base = { feeds: [{ startDate: 20250101, endDate: 0 }], transitions: parseTransitions('15.06, 01.09') };

test('parseTransitions: разбор дат, мусор пропускается', () => {
  assert.deepEqual(parseTransitions('15.06, 01.09; 99.99 abc 1.1'), [{ m: 6, d: 15 }, { m: 9, d: 1 }, { m: 1, d: 1 }]);
});

test('напоминание за неделю до смены, если данные старые', () => {
  const r = reminders({ ...base, today: new Date(2026, 7, 27), builtAt: '2026-07-01T10:00:00Z' });
  assert.equal(r[0].kind, 'transition');
  assert.match(r[0].text, /Через 5 дней \(01\.09\.2026\)/);
});

test('после смены напоминает, пока данные не обновлены; обновлённые — нет', () => {
  const stale = reminders({ ...base, today: new Date(2026, 8, 10), builtAt: '2026-08-20T10:00:00Z' });
  assert.match(stale[0].text, /Прошла смена расписания \(01\.09\.2026\)/);
  const fresh = reminders({ ...base, today: new Date(2026, 8, 10), builtAt: '2026-09-02T10:00:00Z' });
  assert.deepEqual(fresh, []);
});

test('далеко от смены и данные свежие — тишина', () => {
  assert.deepEqual(reminders({ ...base, today: new Date(2026, 9, 11), builtAt: '2026-09-20T10:00:00Z' }), []);
});

test('срок истёк, срок кончается, данные старые', () => {
  const exp = reminders({ ...base, feeds: [{ startDate: 20250101, endDate: 20261231 }], today: new Date(2027, 0, 5), builtAt: '2026-12-30T00:00:00Z' });
  assert.equal(exp[0].kind, 'expired');
  const soon = reminders({ ...base, feeds: [{ startDate: 20250101, endDate: 20261231 }], today: new Date(2026, 11, 25), builtAt: '2026-12-20T00:00:00Z' });
  assert.equal(soon[0].kind, 'expiring');
  const old = reminders({ ...base, today: new Date(2026, 9, 11), builtAt: '2026-06-20T00:00:00Z' });
  assert.equal(old.at(-1)!.kind, 'age');
});
