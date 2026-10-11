"""Тесты разбора на синтетических PDF/HTML (настоящий макет gsp.rs может отличаться — см. --debug-pdf)."""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import collect_gsp as c  # noqa: E402

FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


def make_pdf(path: Path, tables):
    from reportlab.pdfgen import canvas
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont

    pdfmetrics.registerFont(TTFont("DV", FONT))
    cv = canvas.Canvas(str(path), pagesize=(595, 842))
    y = 800
    for title, valid, rows in tables:
        cv.setFont("DV", 11)
        cv.drawString(60, y, "Ред вожње")
        y -= 16
        cv.drawString(60, y, title)
        y -= 24
        cv.setFont("DV", 9)
        cv.drawString(40, y, "Сат")
        cv.drawString(130, y, "Радни дан")
        cv.drawString(260, y, "Субота")
        cv.drawString(380, y, "Недеља")
        cv.drawString(500, y, "Сат")
        y -= 14
        for h, wd, sa, su in rows:
            cv.drawString(42, y, f"{h:02d}")
            cv.drawString(130, y, wd)
            cv.drawString(260, y, sa)
            cv.drawString(380, y, su)
            cv.drawString(502, y, f"{h:02d}")
            y -= 12
        y -= 6
        cv.drawString(60, y, f"Важи од: {valid}")
        y -= 40
    cv.save()


class PdfTest(unittest.TestCase):
    @unittest.skipUnless(Path(FONT).exists(), "нет шрифта DejaVu")
    def test_two_tables_and_night_wrap(self):
        try:
            import pdfplumber  # noqa: F401
            import reportlab  # noqa: F401
        except ImportError:
            self.skipTest("нужны pdfplumber и reportlab")
        t1 = [(4, "10 30 50", "20 50", ""), (5, "10 20 30", "20", "40"), (23, "15", "15", "15")]
        t2 = [(22, "10", "10", "10"), (23, "30", "30", ""), (0, "15 45", "15", "15"), (1, "05", "", "")]
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "26.pdf"
            make_pdf(p, [("ДОРЋОЛ /ДУНАВСКА/ - НАСЕЉЕ БРАЋЕ ЈЕРКОВИЋ", "17-03-2025", t1), ("НАСЕЉЕ БРАЋЕ ЈЕРКОВИЋ - ДОРЋОЛ /ДУНАВСКА/", "01-09-2025", t2)])
            blocks = c.parse_pdf(p)
        self.assertEqual(len(blocks), 2)
        b1, b2 = blocks
        self.assertEqual(b1["title"], "ДОРЋОЛ /ДУНАВСКА/ - НАСЕЉЕ БРАЋЕ ЈЕРКОВИЋ")
        self.assertEqual(b1["validFrom"], "2025-03-17")
        self.assertEqual(b1["times"]["weekday"], ["04:10", "04:30", "04:50", "05:10", "05:20", "05:30", "23:15"])
        self.assertEqual(b1["times"]["sat"], ["04:20", "04:50", "05:20", "23:15"])
        self.assertEqual(b1["times"]["sun"], ["05:40", "23:15"])
        self.assertEqual(b2["validFrom"], "2025-09-01")
        # после 23 идут 00 и 01 — это следующие сутки: 24:xx, 25:xx
        self.assertEqual(b2["times"]["weekday"], ["22:10", "23:30", "24:15", "24:45", "25:05"])
        self.assertEqual(c.split_title(b2["title"]), ("НАСЕЉЕ БРАЋЕ ЈЕРКОВИЋ", "ДОРЋОЛ /ДУНАВСКА/"))


LIST_HTML = """
<html><body><h3>Трамвајске линије</h3>
<table><tr><td><a href="linija.aspx?id=2">2</a></td><td>УСТАНИЧКА - КАЛЕМЕГДАН</td></tr>
<tr><td><a href="linija.aspx?id=3">3</a></td><td>Линија привремено не саобраћа</td></tr></table>
<h3>Аутобуске линије</h3>
<table><tr><td><a href="linija.aspx?id=15002">2 А</a></td><td>X</td></tr>
<tr><td><a href="linija.aspx?id=26">26</a></td><td>ДОРЋОЛ</td></tr></table></body></html>"""

LINE_HTML = """
<html><body><div>ЛИНИЈА 26</div>
<ul><li>СМЕР А: ДОРЋОЛ - БРАЋЕ ЈЕРКОВИЋ</li>
<li>УЛИЦЕ: Дунавска - Цара Душана - Трг Републике</li>
<li>СТАЈАЛИШТА: ДОРЋОЛ /ДУНАВСКА/, ДЕСПОТА ЂУРЂА, ТРГ РЕПУБЛИКЕ, НАСЕЉЕ БРАЋЕ ЈЕРКОВИЋ</li></ul>
<ul><li>СМЕР Б: БРАЋЕ ЈЕРКОВИЋ - ДОРЋОЛ</li>
<li>УЛИЦЕ: Каленићева</li>
<li>СТАЈАЛИШТА: НАСЕЉЕ БРАЋЕ ЈЕРКОВИЋ, ТЕРАЗИЈЕ, ГЛАВНА ПОШТА, ДОРЋОЛ /ДУНАВСКА/</li></ul>
<footer>© 2016.</footer></body></html>"""


class HtmlTest(unittest.TestCase):
    def test_list(self):
        items = c.parse_line_list(LIST_HTML, False)
        self.assertEqual([i["id"] for i in items], ["2", "3", "15002", "26"])
        self.assertEqual([i["kind"] for i in items], ["tram", "tram", "bus", "bus"])
        self.assertTrue(items[1]["suspended"])
        self.assertFalse(items[0]["suspended"])

    def test_line_page(self):
        p = c.parse_line_page(LINE_HTML)
        self.assertEqual(len(p["stops"]), 2)
        self.assertEqual(p["stops"][0][0], "ДОРЋОЛ /ДУНАВСКА/")
        self.assertEqual(p["stops"][1][-1], "ДОРЋОЛ /ДУНАВСКА/")
        self.assertEqual(len(p["stops"][0]), 4)

    def test_make_line(self):
        item = {"id": "15002", "label": "2 А", "kind": "bus", "suspended": False, "night": False}
        page = c.parse_line_page(LINE_HTML)
        blocks = [
            {"title": "ДОРЋОЛ - БРАЋЕ", "times": {"weekday": ["05:00"], "sat": [], "sun": []}, "validFrom": "2025-03-17"},
            {"title": "", "times": {"weekday": [], "sat": ["06:00"], "sun": []}, "validFrom": None},
        ]
        line, notes = c.make_line(item, page, blocks)
        self.assertEqual(line["short"], "2А")
        self.assertEqual(line["dirs"][0]["from"], "ДОРЋОЛ /ДУНАВСКА/")
        self.assertEqual(len(line["dirs"]), 2)
        self.assertEqual(notes, [])


if __name__ == "__main__":
    unittest.main()
