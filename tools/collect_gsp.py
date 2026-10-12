#!/usr/bin/env python3
"""
Сборщик расписания: gsp.rs -> datalaw-schedule.json (формат datalaw-schedule/1).

Что делает:
  1. Берёт список линий со страниц https://www.gsp.rs/dnevne_linije.aspx и nocne_linije.aspx.
  2. Для каждой линии читает страницу linija.aspx?id=… (остановки по направлениям)
     и PDF с расписанием linije-pdf/<id>.pdf (отправления от конечной: будни / суббота / воскресенье, «Важи од»).
  3. Пишет один JSON, который выбирается в приложении: Настройки -> Свой файл расписания.

Установка:   pip install requests beautifulsoup4 pdfplumber
Запуск:      python tools/collect_gsp.py                 # всё, результат datalaw-schedule.json
             python tools/collect_gsp.py --only 26,72    # только эти линии (проверка)
             python tools/collect_gsp.py --debug-pdf cache/pdf/26.pdf   # показать, как разобран PDF

Скачанные страницы и PDF складываются в папку cache/ — повторный запуск их не качает (--refresh чтобы перекачать).
Можно положить PDF вручную: cache/pdf/<id>.pdf и страницу cache/html/<id>.html, затем запустить с --offline.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
import time
from pathlib import Path
from typing import Any

BASE = "https://www.gsp.rs"
LIST_PAGES = [("dnevne_linije.aspx", False), ("nocne_linije.aspx", True)]
UA = "Mozilla/5.0 (DataLawTransit schedule collector; personal use)"

# --------------------------------------------------------------------------- сеть и кэш


def fetch(url: str, dest: Path, refresh: bool, offline: bool, delay: float) -> bytes | None:
    if dest.exists() and not refresh:
        return dest.read_bytes()
    if offline:
        return None
    import requests  # импорт здесь, чтобы разбор работал и без сети

    for attempt in range(3):
        try:
            r = requests.get(url, headers={"User-Agent": UA}, timeout=40)
            if r.status_code == 404:
                return None
            r.raise_for_status()
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(r.content)
            time.sleep(delay)
            return r.content
        except Exception as e:  # noqa: BLE001
            if attempt == 2:
                print(f"  ! не удалось скачать {url}: {e}", file=sys.stderr)
                return None
            time.sleep(1.5 * (attempt + 1))
    return None


def decode_html(b: bytes) -> str:
    for enc in ("utf-8", "windows-1251", "windows-1250"):
        try:
            return b.decode(enc)
        except UnicodeDecodeError:
            continue
    return b.decode("utf-8", "replace")


# --------------------------------------------------------------------------- список линий

KIND_KEYS = [
    ("трамвај", "tram"),
    ("tramvaj", "tram"),
    ("тролејбус", "trolley"),
    ("trolejbus", "trolley"),
    ("електробус", "bus"),
    ("elektrobus", "bus"),
    ("аутобус", "bus"),
    ("autobus", "bus"),
]


def kind_of(text: str) -> str | None:
    t = text.lower()
    for k, v in KIND_KEYS:
        if k in t:
            return v
    return None


def parse_line_list(html: str, night: bool) -> list[dict[str, Any]]:
    """Линии со страницы списка: id, подпись, вид транспорта, признак «временно не саобраћа»."""
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    kind = "tram" if not night else "bus"
    for node in soup.find_all(True):
        if node.name in ("h1", "h2", "h3", "h4", "h5", "strong", "b", "th", "caption", "legend"):
            k = kind_of(node.get_text(" ", strip=True))
            if k and len(node.get_text(strip=True)) < 60:
                kind = k
        if node.name == "a" and node.get("href"):
            m = re.search(r"linija\.aspx\?id=(\d+)", node["href"], re.I)
            if not m or m.group(1) in seen:
                continue
            seen.add(m.group(1))
            label = node.get_text(" ", strip=True)
            row = node.find_parent("tr") or node.find_parent("li") or node.parent
            row_text = row.get_text(" ", strip=True) if row else label
            out.append(
                {
                    "id": m.group(1),
                    "label": label,
                    "kind": kind,
                    "suspended": bool(re.search(r"привремено\s+не\s+саобра", row_text, re.I)),
                    "night": night,
                }
            )
    return out


# --------------------------------------------------------------------------- страница линии


def clean_name(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip(" ,;. ")


def parse_line_page(html: str) -> dict[str, Any]:
    """Остановки по направлениям (по порядку на странице)."""
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")
    for t in soup(["script", "style", "nav", "footer"]):
        t.decompose()
    text = soup.get_text("\n")
    text = text.replace("\r", "")
    # отсекаем подвал
    cut = re.search(r"©\s*20\d\d", text)
    if cut:
        text = text[: cut.start()]
    title = None
    m = re.search(r"ЛИНИЈА\s+([^\n]+)", text)
    if m:
        title = clean_name(m.group(1))
    stops_lists: list[list[str]] = []
    # всё, что идёт после слова «СТАЈАЛИШТА» до следующей метки
    parts = re.split(r"СТАЈАЛИШТА\s*:?", text)[1:]
    for part in parts:
        end = re.search(r"(УЛИЦЕ\s*:?|СМЕР\s*[AaАаBbБб]|Смер\s*[AaАаBbБб]|ПОЛАЗАК|Ред вожње)", part)
        body = part[: end.start()] if end else part
        names = [clean_name(x) for x in re.split(r",\s*|\n", body)]
        names = [n for n in names if n and len(n) < 80]
        if len(names) >= 2:
            stops_lists.append(names)
    return {"title": title, "stops": stops_lists}


# --------------------------------------------------------------------------- PDF

WD_KEYS = ("радни", "radni")
SAT_KEYS = ("субота", "subota", "суббота")
SUN_KEYS = ("недеља", "nedelja", "недеља")
VALID_RE = re.compile(r"(?:Важи\s+од|Vazi\s+od|Važi\s+od)\s*:?\s*(\d{1,2})[-./](\d{1,2})[-./](\d{4})", re.I)


def _kw(word: str) -> str | None:
    w = word.lower().strip(":")
    if w in WD_KEYS:
        return "weekday"
    if w in SAT_KEYS:
        return "sat"
    if w in SUN_KEYS:
        return "sun"
    return None


def _clusters(items: list[float], tol: float) -> list[list[float]]:
    out: list[list[float]] = []
    for v in sorted(items):
        if out and v - out[-1][-1] <= tol:
            out[-1].append(v)
        else:
            out.append([v])
    return out


def parse_pdf_page(words: list[dict[str, Any]], page_height: float) -> list[dict[str, Any]]:
    """
    Разбор одной страницы: таблицы «час | будни | суббота | воскресенье | час».
    words — слова из pdfplumber (text, x0, x1, top, bottom). Возвращает блоки-направления.
    """
    heads = [(w, _kw(w["text"])) for w in words]
    heads = [(w, k) for w, k in heads if k]
    if not heads:
        return []
    # заголовки: тройки (будни, суббота, воскресенье) по порядку «строка -> x»
    heads.sort(key=lambda t: (round(t[0]["top"] / 6), t[0]["x0"]))
    triples: list[dict[str, dict[str, Any]]] = []
    cur: dict[str, dict[str, Any]] = {}
    for w, k in heads:
        if k in cur:
            triples.append(cur)
            cur = {}
        cur[k] = w
        if len(cur) == 3:
            triples.append(cur)
            cur = {}
    if len(cur) >= 2:
        triples.append(cur)
    blocks: list[dict[str, Any]] = []
    for tr in triples:
        if not {"weekday", "sat", "sun"} <= set(tr):
            continue
        cx = {k: (w["x0"] + w["x1"]) / 2 for k, w in tr.items()}
        gap = min(abs(cx["sat"] - cx["weekday"]), abs(cx["sun"] - cx["sat"]))
        blocks.append(
            {
                "cx": cx,
                "gap": gap,
                "left": cx["weekday"] - gap / 2,
                "right": cx["sun"] + gap / 2,
                "head_top": min(w["top"] for w in tr.values()),
                "head_bottom": max(w["bottom"] for w in tr.values()),
            }
        )
    # вертикальные границы: следующий заголовок в том же x-диапазоне
    for b in blocks:
        below = [
            o["head_top"]
            for o in blocks
            if o is not b and o["head_top"] > b["head_bottom"] + 5 and abs(o["left"] - b["left"]) < b["gap"]
        ]
        footers = [
            w["top"]
            for w in words
            if re.match(r"(Важи|Vazi|Važi)", w["text"], re.I) and w["top"] > b["head_bottom"]
        ]
        b["bottom"] = min(below + footers + [page_height + 1])
    for b in blocks:
        above = [o["bottom"] for o in blocks if o is not b and o["bottom"] <= b["head_top"] and abs(o["left"] - b["left"]) < b["gap"]]
        b["top_limit"] = max(above + [0.0])
    result: list[dict[str, Any]] = []
    for b in sorted(blocks, key=lambda x: (round(x["head_top"] / 10), x["left"])):
        hours: list[tuple[int, float]] = []
        mins: list[dict[str, Any]] = []
        for w in words:
            if not (b["head_bottom"] < w["top"] < b["bottom"]):
                continue
            t = w["text"].strip()
            xc = (w["x0"] + w["x1"]) / 2
            if xc < b["left"] and xc > b["left"] - b["gap"] * 1.2:
                if re.fullmatch(r"\d{1,2}", t):
                    hours.append((int(t), w["top"]))
            elif b["left"] <= xc <= b["right"]:
                mins.append(w)
        hours.sort(key=lambda h: h[1])
        cells: dict[str, list[tuple[int, int]]] = {"weekday": [], "sat": [], "sun": []}
        rows: list[tuple[int, float, float]] = []
        off = 0
        prev = -1
        for i, (h, top) in enumerate(hours):
            if prev >= 0 and h < prev:
                off += 24
            prev = h
            nxt = hours[i + 1][1] if i + 1 < len(hours) else b["bottom"]
            rows.append((h + off, top - 2, nxt - 2))
        for w in mins:
            xc = (w["x0"] + w["x1"]) / 2
            col = min(b["cx"], key=lambda k: abs(b["cx"][k] - xc))
            digits = re.sub(r"\D", "", w["text"])
            if not digits:
                continue
            chunks = [digits[i : i + 2] for i in range(0, len(digits), 2)] if len(digits) > 2 else [digits]
            for row_h, y0, y1 in rows:
                if y0 <= w["top"] < y1:
                    for c in chunks:
                        if int(c) < 60:
                            cells[col].append((row_h, int(c)))
                    break
        times = {k: [f"{h:02d}:{m:02d}" for h, m in sorted(v)] for k, v in cells.items()}
        # заголовок направления: строки над таблицей
        title_words = [
            w
            for w in words
            if b["top_limit"] <= w["top"] < b["head_top"] - 1 and b["left"] - b["gap"] * 1.5 <= (w["x0"] + w["x1"]) / 2 <= b["right"] + b["gap"] * 1.5
        ]
        lines: dict[int, list[dict[str, Any]]] = {}
        for w in title_words:
            lines.setdefault(round(w["top"] / 4), []).append(w)
        title = ""
        for _y, ws in sorted(lines.items()):
            txt = " ".join(x["text"] for x in sorted(ws, key=lambda x: x["x0"]))
            if re.search(r"\s[-–—]\s", txt) and len(txt) > len(title):
                title = txt
        result.append({"title": title, "times": times, "top": b["head_top"], "bottom": b["bottom"]})
    # «Важи од» — ближайшая под блоком, иначе единственная на странице
    page_text = " ".join(w["text"] for w in sorted(words, key=lambda w: (round(w["top"] / 4), w["x0"])))
    all_dates = [(m.start(), _date(m)) for m in VALID_RE.finditer(page_text)]
    for r in result:
        r["validFrom"] = all_dates[0][1] if len(all_dates) == 1 else None
    if len(all_dates) > 1:
        # даты идут в том же порядке, что и таблицы на странице
        for r, (_pos, d) in zip(result, all_dates):
            r["validFrom"] = d
    return result


def _date(m: re.Match[str]) -> str:
    d, mo, y = (int(x) for x in m.groups())
    return f"{y:04d}-{mo:02d}-{d:02d}"


def parse_pdf(path: Path) -> list[dict[str, Any]]:
    import pdfplumber

    blocks: list[dict[str, Any]] = []
    with pdfplumber.open(str(path)) as pdf:
        for page in pdf.pages:
            words = page.extract_words(keep_blank_chars=False, use_text_flow=False)
            blocks.extend(parse_pdf_page(words, float(page.height)))
    return blocks


def split_title(title: str) -> tuple[str, str] | None:
    parts = re.split(r"\s[-–—]\s", title)
    if len(parts) < 2:
        return None
    return clean_name(parts[0]), clean_name(" - ".join(parts[1:]))


# --------------------------------------------------------------------------- сборка


def make_line(item: dict[str, Any], page: dict[str, Any] | None, blocks: list[dict[str, Any]]) -> tuple[dict[str, Any] | None, list[str]]:
    notes: list[str] = []
    short = re.sub(r"\s+", "", item["label"]) or item["id"]
    dirs: list[dict[str, Any]] = []
    stops_lists = page["stops"] if page else []
    for i, b in enumerate(blocks):
        ft = split_title(b["title"]) if b["title"] else None
        stops = stops_lists[i] if i < len(stops_lists) else None
        frm = stops[0] if stops else (ft[0] if ft else "")
        to = stops[-1] if stops else (ft[1] if ft else "")
        if not frm or not to:
            notes.append(f"направление {i + 1}: не определены конечные")
            continue
        n = sum(len(v) for v in b["times"].values())
        if n == 0:
            notes.append(f"направление {i + 1}: нет времён отправления")
        if not stops:
            notes.append(f"направление {i + 1}: нет списка остановок (только конечные)")
        d: dict[str, Any] = {"from": frm, "to": to, "validFrom": b.get("validFrom"), "times": b["times"]}
        if stops:
            d["stops"] = stops
        dirs.append(d)
    if not dirs:
        return None, notes + ["нет ни одного направления"]
    long_name = f"{dirs[0]['from']} - {dirs[0]['to']}"
    line: dict[str, Any] = {"id": item["id"], "short": short, "long": long_name, "kind": item["kind"], "dirs": dirs}
    if item.get("night"):
        line["category"] = "night"  # приложение показывает такие линии в фильтре «Ночные»
    return line, notes


def main() -> int:
    ap = argparse.ArgumentParser(description="gsp.rs -> datalaw-schedule.json")
    ap.add_argument("-o", "--out", default="datalaw-schedule.json")
    ap.add_argument("--cache", default="cache")
    ap.add_argument("--only", default="", help="id линий через запятую (как в linija.aspx?id=…)")
    ap.add_argument("--refresh", action="store_true", help="перекачать, даже если есть в cache")
    ap.add_argument("--offline", action="store_true", help="не ходить в сеть, брать только из cache")
    ap.add_argument("--delay", type=float, default=0.4, help="пауза между запросами, сек")
    ap.add_argument("--valid-to", default=None, help="общий срок окончания YYYY-MM-DD (необязательно)")
    ap.add_argument("--debug-pdf", default=None, help="разобрать один PDF и показать результат")
    args = ap.parse_args()

    if args.debug_pdf:
        import pdfplumber

        p = Path(args.debug_pdf)
        with pdfplumber.open(str(p)) as pdf:
            for n, page in enumerate(pdf.pages, 1):
                words = page.extract_words()
                print(f"--- страница {n}: слов {len(words)}, размер {page.width}x{page.height}")
                for w in words[:60]:
                    print(f"  {w['text']!r:24} x0={w['x0']:.0f} top={w['top']:.0f}")
                for b in parse_pdf_page(words, float(page.height)):
                    print("  БЛОК:", b["title"], b["validFrom"], {k: len(v) for k, v in b["times"].items()})
                    print("   ", json.dumps(b["times"], ensure_ascii=False)[:400])
        return 0

    cache = Path(args.cache)
    only = {x.strip() for x in args.only.split(",") if x.strip()}
    items: list[dict[str, Any]] = []
    for name, night in LIST_PAGES:
        raw = fetch(f"{BASE}/{name}", cache / "html" / name, args.refresh, args.offline, args.delay)
        if raw is None:
            print(f"! нет страницы списка {name}", file=sys.stderr)
            continue
        items.extend(parse_line_list(decode_html(raw), night))
    if not items:
        print("Список линий пуст. Проверьте интернет или структуру сайта (откройте cache/html/*.aspx).", file=sys.stderr)
        return 1
    if only:
        items = [i for i in items if i["id"] in only]
    print(f"Линий в списке: {len(items)}")

    lines: list[dict[str, Any]] = []
    problems: list[str] = []
    for n, item in enumerate(items, 1):
        lid = item["id"]
        print(f"[{n}/{len(items)}] {item['label']} (id {lid})")
        if item["suspended"]:
            problems.append(f"{item['label']} (id {lid}): линия временно не саобраћа — пропущена")
            continue
        html = fetch(f"{BASE}/linija.aspx?id={lid}", cache / "html" / f"{lid}.html", args.refresh, args.offline, args.delay)
        page = parse_line_page(decode_html(html)) if html else None
        pdf = fetch(f"{BASE}/dokumenti/dnevne_linije/linije-pdf/{lid}.pdf", cache / "pdf" / f"{lid}.pdf", args.refresh, args.offline, args.delay)
        blocks: list[dict[str, Any]] = []
        if pdf:
            try:
                blocks = parse_pdf(cache / "pdf" / f"{lid}.pdf")
            except Exception as e:  # noqa: BLE001
                problems.append(f"{item['label']} (id {lid}): PDF не разобран — {e}")
        else:
            problems.append(f"{item['label']} (id {lid}): нет PDF с расписанием")
        line, notes = make_line(item, page, blocks)
        for nt in notes:
            problems.append(f"{item['label']} (id {lid}): {nt}")
        if line:
            lines.append(line)

    out = {
        "format": "datalaw-schedule/1",
        "generated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "gsp.rs",
        "validTo": args.valid_to,
        "lines": lines,
    }
    Path(args.out).write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    total = sum(len(t) for ln in lines for d in ln["dirs"] for t in d["times"].values())
    print(f"\nГотово: {args.out} — линий {len(lines)}, отправлений {total}")
    if problems:
        print(f"\nЗамечания ({len(problems)}):")
        for p in problems:
            print("  -", p)
    return 0


if __name__ == "__main__":
    sys.exit(main())
