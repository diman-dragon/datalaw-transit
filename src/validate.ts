/**
 * Файл расписания (datalaw-schedule.json) — единственный источник данных приложения.
 * Делается скриптом tools/collect_gsp.py или вручную.
 *
 * {
 *   "format": "datalaw-schedule/1",
 *   "generated": "2026-10-11T12:00:00Z",   // необязательно
 *   "source": "gsp.rs",                     // необязательно
 *   "validTo": "2026-12-31",                // необязательно: общий срок окончания
 *   "lines": [{
 *     "id": "26", "short": "26", "long": "Дорћол - Браће Јерковић",
 *     "kind": "bus" | "tram" | "trolley" | "rail" | "other",           // необязательно, по умолчанию bus
 *     "category": "day" | "night" | "express" | "suburban" | "rail" | "tram" | "trolley",  // необязательно
 *     "night": true,                                                    // необязательно: то же, что category = night
 *     "dirs": [{
 *       "from": "ДОРЋОЛ", "to": "БРАЋЕ ЈЕРКОВИЋ",
 *       "stops": ["ДОРЋОЛ", "…", "БРАЋЕ ЈЕРКОВИЋ"],                     // необязательно
 *       "validFrom": "2025-03-17",                                      // необязательно («Важи од»)
 *       "times": { "weekday": ["04:10", …], "sat": [...], "sun": [...] } // отправления от начальной остановки;
 *     }]                                                                 // часы 24–47 — рейсы после полуночи
 *   }]
 * }
 */
import { fmtDateInt, fmtSize, parseIsoDate, dateToInt } from './format.ts';
import type { DayKind, Direction, Line, LineCat, RouteKind } from './types.ts';
import { CAT_ORDER } from './types.ts';

export const FILE_FORMAT = 'datalaw-schedule/1';
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export interface ScheduleStats {
  lines: number;
  dirs: number;
  departures: number;
}

export interface ScheduleCheck {
  /** файл можно загружать (ошибок нет) */
  ok: boolean;
  /** причины, по которым файл не принят */
  errors: string[];
  /** замечания: файл принят, но часть данных пропущена или вызывает вопросы */
  warnings: string[];
  lines: Line[];
  stats: ScheduleStats;
  generated: string;
  source: string;
  validTo: number;
  /** самая ранняя дата «Важи од» среди направлений, 0 — нигде не указана */
  validFrom: number;
}

const KIND_SET = new Set<string>(['bus', 'tram', 'trolley', 'rail', 'other']);
const CAT_SET = new Set<string>(CAT_ORDER);
const DAY_KEYS: DayKind[] = ['weekday', 'sat', 'sun'];
const TIME_RE = /^(\d{1,2}):([0-5]\d)$/;

function str(v: unknown): string {
  if (typeof v === 'string') return v.replace(/\s+/g, ' ').trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Категория линии: явная из файла → ночная → по виду транспорта → по номеру. */
export function deriveCat(short: string, kind: RouteKind, rawCat: unknown, night: unknown): LineCat {
  if (typeof rawCat === 'string' && CAT_SET.has(rawCat)) return rawCat as LineCat;
  if (night === true) return 'night';
  if (kind === 'rail') return 'rail';
  if (kind === 'tram') return 'tram';
  if (kind === 'trolley') return 'trolley';
  const s = short.trim();
  if (/^(N|Н)\s?\d/i.test(s) || /^\d+\s?(N|Н)$/i.test(s)) return 'night';
  if (/^(E|Е|A|А)\s?\d/i.test(s)) return 'express';
  const num = /^\d+/.exec(s);
  if (num && +num[0] >= 300) return 'suburban';
  return 'day';
}

function emptyCheck(): ScheduleCheck {
  return { ok: false, errors: [], warnings: [], lines: [], stats: { lines: 0, dirs: 0, departures: 0 }, generated: '', source: '', validTo: 0, validFrom: 0 };
}

/**
 * Проверяет файл расписания и превращает его в набор линий.
 * Не бросает исключений: все проблемы попадают в errors (файл не принят) или warnings (часть данных пропущена).
 */
export function checkSchedule(bytes: Uint8Array, fileName = '', today: Date = new Date()): ScheduleCheck {
  const r = emptyCheck();
  const fail = (msg: string): ScheduleCheck => {
    r.errors.push(msg);
    return r;
  };
  const ext = /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase() ?? '';

  if (!bytes.length) return fail('Файл пуст.');
  if (bytes.length > MAX_FILE_BYTES) return fail(`Файл слишком большой (${fmtSize(bytes.length)}). Максимум — ${fmtSize(MAX_FILE_BYTES)}.`);
  if (bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b) return fail('Это ZIP-архив. Приложение принимает только JSON-файл расписания (.json), GTFS-архивы больше не поддерживаются.');
  if (bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return fail('Это PDF-документ. Нужен JSON-файл расписания (.json).');

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return fail('Файл не в кодировке UTF-8. Сохраните его как JSON в UTF-8.');
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch (e) {
    const detail = e instanceof Error ? ` (${e.message.slice(0, 90)})` : '';
    const hint = ext && ext !== 'json' ? ` Расширение файла — .${ext}, ожидается .json.` : '';
    return fail(`Файл не читается как JSON — он повреждён, обрезан или это другой тип файла.${hint}${detail}`);
  }
  if (!isObj(root)) return fail('В файле должен быть JSON-объект с полями format и lines.');

  const format = str(root.format);
  if (!format) return fail('В файле нет поля "format". Ожидается "format": "' + FILE_FORMAT + '".');
  if (!format.startsWith('datalaw-schedule/')) return fail(`Это не файл расписания DataLaw (format = "${format.slice(0, 40)}"). Ожидается "${FILE_FORMAT}".`);
  if (format !== FILE_FORMAT) return fail(`Версия формата "${format}" не поддерживается этой версией приложения (нужна "${FILE_FORMAT}").`);
  if (!Array.isArray(root.lines)) return fail('В файле нет списка линий ("lines").');
  if (!root.lines.length) return fail('Список линий пуст.');

  r.source = str(root.source).slice(0, 60);
  const gen = str(root.generated);
  r.generated = parseIsoDate(gen) ? gen : '';
  if (root.validTo !== undefined && root.validTo !== null && root.validTo !== '') {
    r.validTo = parseIsoDate(root.validTo);
    if (!r.validTo) r.warnings.push(`Поле validTo ("${str(root.validTo).slice(0, 20)}") — не дата ГГГГ-ММ-ДД, срок окончания не учтён.`);
  }

  const ids = new Set<string>();
  const w = r.warnings;
  (root.lines as unknown[]).forEach((rawLine, li) => {
    if (!isObj(rawLine)) {
      w.push(`Линия №${li + 1}: это не объект — пропущена.`);
      return;
    }
    const rawId = str(rawLine.id);
    const short0 = str(rawLine.short);
    const id = rawId || short0;
    if (!id) {
      w.push(`Линия №${li + 1}: нет id и номера — пропущена.`);
      return;
    }
    const label = `Линия ${short0 || id}`;
    if (ids.has(id)) {
      w.push(`${label}: id «${id}» уже встречался — повтор пропущен.`);
      return;
    }
    if (!Array.isArray(rawLine.dirs)) {
      w.push(`${label}: нет списка направлений — пропущена.`);
      return;
    }
    const kindRaw = str(rawLine.kind);
    const kind: RouteKind = KIND_SET.has(kindRaw) ? (kindRaw as RouteKind) : 'bus';
    if (kindRaw && !KIND_SET.has(kindRaw)) w.push(`${label}: неизвестный вид транспорта «${kindRaw.slice(0, 20)}», принят автобус.`);
    const short = short0 || id;
    const cat = deriveCat(short, kind, rawLine.category, rawLine.night);
    if (rawLine.category !== undefined && !CAT_SET.has(String(rawLine.category))) w.push(`${label}: неизвестная категория «${str(rawLine.category).slice(0, 20)}», определена автоматически.`);

    const dirsRaw = rawLine.dirs as unknown[];
    if (dirsRaw.length > 2) w.push(`${label}: направлений ${dirsRaw.length}, используются первые два.`);
    const dirs: Direction[] = [];
    dirsRaw.slice(0, 2).forEach((rd, di) => {
      const dl = `${label}, направление ${di + 1}`;
      if (!isObj(rd)) {
        w.push(`${dl}: это не объект — пропущено.`);
        return;
      }
      const from = str(rd.from);
      const to = str(rd.to);
      if (!from || !to) {
        w.push(`${dl}: не указаны конечные («from» и «to») — пропущено.`);
        return;
      }
      let stops: string[] = [from, to];
      if (rd.stops !== undefined) {
        if (Array.isArray(rd.stops)) {
          const s = (rd.stops as unknown[]).map(str).filter(Boolean);
          if (s.length >= 2) stops = s;
        } else w.push(`${dl}: «stops» должен быть списком — используются только конечные.`);
      }
      let validFrom = 0;
      if (rd.validFrom !== undefined && rd.validFrom !== null && rd.validFrom !== '') {
        validFrom = parseIsoDate(rd.validFrom);
        if (!validFrom) w.push(`${dl}: «validFrom» («${str(rd.validFrom).slice(0, 20)}») — не дата ГГГГ-ММ-ДД, дата начала не указана.`);
      }
      const times = { weekday: [] as number[], sat: [] as number[], sun: [] as number[] };
      const tRaw = rd.times;
      if (!isObj(tRaw)) w.push(`${dl}: нет блока «times».`);
      else {
        let bad = 0;
        let sample = '';
        for (const k of DAY_KEYS) {
          const arr = tRaw[k];
          if (arr === undefined || arr === null) continue;
          if (!Array.isArray(arr)) {
            w.push(`${dl}: «times.${k}» должен быть списком.`);
            continue;
          }
          const set = new Set<number>();
          for (const x of arr) {
            const m = typeof x === 'string' ? TIME_RE.exec(x.trim()) : null;
            const h = m ? +m[1] : 99;
            if (!m || h > 47) {
              bad++;
              if (!sample) sample = str(x).slice(0, 12) || '—';
              continue;
            }
            set.add(h * 60 + +m[2]);
          }
          times[k] = [...set].sort((a, b) => a - b);
        }
        if (bad) w.push(`${dl}: некорректных значений времени: ${bad} (например «${sample}») — пропущены. Ожидается «ЧЧ:ММ».`);
      }
      const total = times.weekday.length + times.sat.length + times.sun.length;
      if (!total) {
        w.push(`${dl}: нет ни одного отправления — пропущено.`);
        return;
      }
      dirs.push({ from, to, stops, validFrom, times });
    });
    if (!dirs.length) {
      w.push(`${label}: нет ни одного направления с отправлениями — пропущена.`);
      return;
    }
    ids.add(id);
    r.lines.push({ id: `g:${id}`, short, long: str(rawLine.long) || `${dirs[0].from} - ${dirs[0].to}`, kind, cat, dirs });
  });

  if (!r.lines.length) {
    r.errors.push('В файле нет ни одной линии с отправлениями. Проверьте содержимое файла.');
    return r;
  }
  for (const l of r.lines)
    for (const d of l.dirs) {
      r.stats.dirs++;
      r.stats.departures += d.times.weekday.length + d.times.sat.length + d.times.sun.length;
      if (d.validFrom && (!r.validFrom || d.validFrom < r.validFrom)) r.validFrom = d.validFrom;
    }
  r.stats.lines = r.lines.length;

  const todayInt = dateToInt(today);
  if (r.validTo && r.validTo < todayInt) w.push(`Срок действия файла истёк ${fmtDateInt(r.validTo)}.`);
  const allFuture = r.lines.every((l) => l.dirs.every((d) => d.validFrom > todayInt));
  if (r.validFrom && allFuture) w.push(`Расписание из файла начнёт действовать только с ${fmtDateInt(r.validFrom)}.`);
  r.ok = true;
  return r;
}
