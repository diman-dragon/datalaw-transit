/**
 * Потоковый разбор CSV из байтов. Возвращает только запрошенные колонки.
 * Предполагается, что переводов строки внутри кавычек нет (в GTFS Белграда их нет).
 */

function splitLine(line: string): string[] {
  if (line.indexOf('"') === -1) return line.split(',');
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const CHUNK = 1 << 22; // 4 МБ

export function parseCsv(bytes: Uint8Array, wanted: string[], cb: (v: string[]) => void): void {
  const dec = new TextDecoder('utf-8');
  let idx: number[] | null = null;
  let pos = 0;
  const w = wanted.length;
  while (pos < bytes.length) {
    let end = Math.min(pos + CHUNK, bytes.length);
    if (end < bytes.length) {
      const nl = bytes.indexOf(10, end);
      end = nl === -1 ? bytes.length : nl + 1;
    }
    const text = dec.decode(bytes.subarray(pos, end));
    pos = end;
    let s = 0;
    const len = text.length;
    while (s < len) {
      let e = text.indexOf('\n', s);
      if (e === -1) e = len;
      let line = text.slice(s, e);
      s = e + 1;
      if (line.length && line.charCodeAt(line.length - 1) === 13) line = line.slice(0, -1);
      if (!line.length) continue;
      const f = splitLine(line);
      if (idx === null) {
        const header = f.map((h) => h.trim().toLowerCase());
        idx = wanted.map((name) => header.indexOf(name));
        continue;
      }
      const row = new Array<string>(w);
      for (let k = 0; k < w; k++) {
        const j = idx[k];
        row[k] = j >= 0 && j < f.length ? f[j] : '';
      }
      cb(row);
    }
  }
}

/** "H:MM:SS" / "HH:MM:SS" -> секунды, -1 если пусто/некорректно */
export function parseTime(s: string): number {
  if (!s) return -1;
  const t = s.trim();
  const a = t.indexOf(':');
  const b = t.indexOf(':', a + 1);
  if (a < 1 || b < 0) return -1;
  const h = +t.slice(0, a);
  const m = +t.slice(a + 1, b);
  const sec = +t.slice(b + 1);
  if (!Number.isFinite(h) || !Number.isFinite(m) || !Number.isFinite(sec)) return -1;
  return h * 3600 + m * 60 + sec;
}

export class IntBuf {
  a: Int32Array;
  n = 0;
  constructor(cap = 1 << 16) {
    this.a = new Int32Array(cap);
  }
  push(v: number): void {
    if (this.n === this.a.length) {
      const b = new Int32Array(this.a.length * 2);
      b.set(this.a);
      this.a = b;
    }
    this.a[this.n++] = v;
  }
}
