#!/usr/bin/env python3
"""
Генерация иконок DataLaw Transit из resources/logo-source.png.

  python3 scripts/make_icons.py               # вариант по умолчанию (см. DEFAULT_VARIANT)
  python3 scripts/make_icons.py --variant navy
  python3 scripts/make_icons.py --sheet       # только лист сравнения вариантов resources/icon-variants.png

Результат: resources/android/res/** (копируется в android/ скриптом prepare-android.mjs),
public/logo-mask.png (логотип внутри приложения), resources/icon-preview.png.
Нужны Pillow и numpy.
"""
import argparse
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "resources", "logo-source.png")

# bg — фон иконки, fg — цвет логотипа (None = оставить исходный глянцевый чёрный)
VARIANTS = {
    "cream": {"bg": "#EDE4D3", "fg": None, "title": "Слоновая кость + чёрный логотип"},
    "navy": {"bg": "#0D2038", "fg": "#F1E7D2", "title": "Тёмно-синий + светлый логотип"},
    "white": {"bg": "#FFFFFF", "fg": None, "title": "Белый + чёрный логотип"},
    "black": {"bg": "#000000", "fg": "#E9D9B8", "title": "Чёрный (AMOLED) + золотистый логотип"},
    "brown": {"bg": "#8A5A2B", "fg": "#F6ECD9", "title": "Коричневый + светлый логотип"},
}
DEFAULT_VARIANT = "navy"
# Высота логотипа / сторона адаптивного холста 108dp. Видимая маска — 72dp (круг), поэтому буквы D с засечками
# по диагонали (≈1.36 высоты) должны уместиться в 72dp: 0.44*108*1.36 ≈ 65dp (в пределах безопасной зоны 66dp).
LOGO_FILL = 0.44


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))


def extract_logo():
    """Вырезает логотип с белого фона: возвращает RGBA, обрезанный по границам."""
    im = Image.open(SRC).convert("RGB")
    a = np.asarray(im).astype(np.float32)
    lum = a @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    alpha = np.clip((175.0 - lum) / (175.0 - 125.0), 0.0, 1.0)  # тень и белый фон -> прозрачно
    # «закрытие» альфа-канала: убирает тонкие светлые блики внутри букв, которые иначе дают прозрачные штрихи
    a_img = Image.fromarray((alpha * 255.0).astype(np.uint8), "L").filter(ImageFilter.MaxFilter(7)).filter(ImageFilter.MinFilter(7))
    alpha = np.asarray(a_img).astype(np.float32) / 255.0
    rgba = np.dstack([a, alpha * 255.0]).astype(np.uint8)
    img = Image.fromarray(rgba, "RGBA")
    bbox = img.getchannel("A").point(lambda v: 255 if v > 40 else 0).getbbox()
    return img.crop(bbox)


def tint(logo, fg):
    """Перекрашивает логотип в один цвет, сохраняя альфу; лёгкий блик по яркости оригинала."""
    if fg is None:
        return logo
    r, g, b = hex_rgb(fg)
    out = Image.new("RGBA", logo.size, (r, g, b, 0))
    out.putalpha(logo.getchannel("A"))
    return out


def silhouette(logo, color=(255, 255, 255)):
    out = Image.new("RGBA", logo.size, color + (0,))
    out.putalpha(logo.getchannel("A"))
    return out


def place(logo, size, fill, offset=(0, 0)):
    """Помещает логотип в прозрачный квадрат size×size, высота логотипа = fill*size."""
    h = int(round(size * fill))
    w = int(round(logo.width * h / logo.height))
    lg = logo.resize((w, h), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(lg, ((size - w) // 2 + offset[0], (size - h) // 2 + offset[1]))
    return canvas


def legacy_icon(logo, bg, size, round_shape):
    """Иконка для Android < 8: фон + логотип, скруглённый квадрат или круг."""
    ss = 4  # суперсэмплинг для гладких краёв
    big = size * ss
    base = Image.new("RGBA", (big, big), hex_rgb(bg) + (255,))
    base.alpha_composite(place(logo, big, 0.58))
    mask = Image.new("L", (big, big), 0)
    d = ImageDraw.Draw(mask)
    if round_shape:
        d.ellipse((0, 0, big - 1, big - 1), fill=255)
    else:
        d.rounded_rectangle((0, 0, big - 1, big - 1), radius=int(big * 0.22), fill=255)
    base.putalpha(mask)
    return base.resize((size, size), Image.LANCZOS)


def logo_mask_png(logo, path):
    """Силуэт логотипа для использования внутри приложения как CSS-маски."""
    h = 256
    w = int(round(logo.width * h / logo.height))
    sil = silhouette(logo, (0, 0, 0)).resize((w, h), Image.LANCZOS)
    side = max(w, h)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.alpha_composite(sil, ((side - w) // 2, (side - h) // 2))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    canvas.save(path)


def write_android(variant_key, logo):
    v = VARIANTS[variant_key]
    res = os.path.join(ROOT, "resources", "android", "res")
    fg = tint(logo, v["fg"])
    densities = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
    for name, k in densities.items():
        d = os.path.join(res, f"mipmap-{name}")
        os.makedirs(d, exist_ok=True)
        place(fg, int(108 * k), LOGO_FILL).save(os.path.join(d, "ic_launcher_foreground.png"))
        place(silhouette(logo), int(108 * k), LOGO_FILL).save(os.path.join(d, "ic_launcher_monochrome.png"))
        legacy_icon(fg, v["bg"], int(48 * k), False).save(os.path.join(d, "ic_launcher.png"))
        legacy_icon(fg, v["bg"], int(48 * k), True).save(os.path.join(d, "ic_launcher_round.png"))
    any_dir = os.path.join(res, "mipmap-anydpi-v26")
    os.makedirs(any_dir, exist_ok=True)
    xml = (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
        '    <background android:drawable="@color/ic_launcher_background"/>\n'
        '    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n'
        '    <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>\n'
        "</adaptive-icon>\n"
    )
    for fn in ("ic_launcher.xml", "ic_launcher_round.xml"):
        with open(os.path.join(any_dir, fn), "w", encoding="utf-8") as f:
            f.write(xml)
    vd = os.path.join(res, "values")
    os.makedirs(vd, exist_ok=True)
    with open(os.path.join(vd, "ic_launcher_background.xml"), "w", encoding="utf-8") as f:
        f.write(
            '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
            f'    <color name="ic_launcher_background">{v["bg"]}</color>\n</resources>\n'
        )
    # 512×512 для магазина/превью
    store = legacy_icon(fg, v["bg"], 512, False)
    store.save(os.path.join(ROOT, "resources", "icon-512.png"))
    return fg, v


def preview(fg, v, path):
    """Показывает иконку в разных масках лаунчера на светлом и тёмном фоне."""
    size = 160
    pad = 24
    shapes = ["circle", "squircle", "square"]
    W = pad + len(shapes) * (size + pad)
    sheet = Image.new("RGB", (W, size * 2 + pad * 3), (0, 0, 0))
    d = ImageDraw.Draw(sheet)
    d.rectangle((0, 0, W, size + pad * 2), fill=(236, 232, 225))
    for row in range(2):
        for i, shp in enumerate(shapes):
            ss = 4
            big = size * ss
            # настоящий адаптивный холст 108dp, видимая часть — центральные 72dp
            full = int(round(big * 108 / 72))
            canvas = Image.new("RGBA", (full, full), hex_rgb(v["bg"]) + (255,))
            canvas.alpha_composite(place(fg, full, LOGO_FILL))
            off = (full - big) // 2
            tile = canvas.crop((off, off, off + big, off + big))
            m = Image.new("L", (big, big), 0)
            md = ImageDraw.Draw(m)
            if shp == "circle":
                md.ellipse((0, 0, big - 1, big - 1), fill=255)
            elif shp == "squircle":
                md.rounded_rectangle((0, 0, big - 1, big - 1), radius=int(big * 0.32), fill=255)
            else:
                md.rounded_rectangle((0, 0, big - 1, big - 1), radius=int(big * 0.12), fill=255)
            tile.putalpha(m)
            tile = tile.resize((size, size), Image.LANCZOS)
            x = pad + i * (size + pad)
            y = pad + row * (size + pad)
            sheet.paste(tile, (x, y), tile)
    sheet.save(path)


def sheet(logo):
    keys = list(VARIANTS)
    size = 150
    pad = 20
    W = pad + len(keys) * (size + pad)
    img = Image.new("RGB", (W, size + pad * 2 + 8), (128, 128, 128))
    img.paste(Image.new("RGB", (W // 2, img.height), (236, 232, 225)), (0, 0))
    img.paste(Image.new("RGB", (W - W // 2, img.height), (18, 18, 20)), (W // 2, 0))
    for i, k in enumerate(keys):
        v = VARIANTS[k]
        ic = legacy_icon(tint(logo, v["fg"]), v["bg"], size, False)
        x = pad + i * (size + pad)
        img.paste(ic, (x, pad), ic)
    img.save(os.path.join(ROOT, "resources", "icon-variants.png"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--variant", default=DEFAULT_VARIANT, choices=list(VARIANTS))
    ap.add_argument("--sheet", action="store_true")
    args = ap.parse_args()
    if not os.path.exists(SRC):
        sys.exit(f"Нет файла {SRC}")
    logo = extract_logo()
    if args.sheet:
        sheet(logo)
        print("resources/icon-variants.png")
        return
    fg, v = write_android(args.variant, logo)
    logo_mask_png(logo, os.path.join(ROOT, "public", "logo-mask.png"))
    preview(fg, v, os.path.join(ROOT, "resources", "icon-preview.png"))
    print(f"Иконки готовы: вариант «{args.variant}» — {v['title']}")


if __name__ == "__main__":
    main()
