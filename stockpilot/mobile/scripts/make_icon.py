"""StockPilot app icon: three rising bars with an upward trend arrow.

    python3 scripts/make_icon.py   # writes the icon, Android adaptive icon layers, splash and favicon (needs Pillow)
"""
import math
from PIL import Image, ImageDraw

OUT = str(__import__("pathlib").Path(__file__).resolve().parent.parent / "assets" / "images") + "/"
BLUE_TOP, BLUE_BOTTOM = (58, 141, 238), (24, 92, 196)
SS = 4  # supersampling for smooth edges


def gradient(size):
    im = Image.new("RGBA", (size, size))
    px = im.load()
    for y in range(size):
        t = y / (size - 1)
        c = tuple(round(BLUE_TOP[i] + (BLUE_BOTTOM[i] - BLUE_TOP[i]) * t) for i in range(3))
        for x in range(size):
            px[x, y] = c + (255,)
    return im


def glyph(size, box, color=(255, 255, 255, 255), soft=(255, 255, 255, 150)):
    """Bars + arrow inside box=(x0, y0, x1, y1) of a size×size transparent canvas."""
    S = size * SS
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    x0, y0, x1, y1 = [v * SS for v in box]
    w, h = x1 - x0, y1 - y0
    bw, gap = w * 0.2, w * 0.1
    base = y0 + h
    for i, frac in enumerate([0.38, 0.58, 0.8]):
        bx = x0 + w * 0.08 + i * (bw + gap)
        d.rounded_rectangle([bx, base - h * frac * 0.78, bx + bw, base], radius=bw * 0.22, fill=soft)
    # Trend line from lower left to upper right, with an arrowhead.
    pts = [(x0 + w * 0.02, y0 + h * 0.62), (x0 + w * 0.36, y0 + h * 0.36), (x0 + w * 0.56, y0 + h * 0.48), (x0 + w * 0.92, y0 + h * 0.06)]
    lw = int(w * 0.075)
    tip = pts[-1]
    ang = math.atan2(tip[1] - pts[-2][1], tip[0] - pts[-2][0])
    L = w * 0.22  # arrowhead length
    base = (tip[0] - L * 0.8 * math.cos(ang), tip[1] - L * 0.8 * math.sin(ang))  # the line stops inside the head
    line = pts[:-1] + [base]
    d.line(line, fill=color, width=lw, joint="curve")
    for q in line[:-1]:
        d.ellipse([q[0] - lw / 2, q[1] - lw / 2, q[0] + lw / 2, q[1] + lw / 2], fill=color)
    back = (tip[0] - L * math.cos(ang), tip[1] - L * math.sin(ang))
    half = L * 0.55
    left = (back[0] + half * math.sin(ang), back[1] - half * math.cos(ang))
    right = (back[0] - half * math.sin(ang), back[1] + half * math.cos(ang))
    d.polygon([tip, left, right], fill=color)
    return im.resize((size, size), Image.LANCZOS)


def rounded(im, radius):
    mask = Image.new("L", (im.width * SS, im.height * SS), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, mask.width - 1, mask.height - 1], radius=radius * SS, fill=255)
    out = im.copy()
    out.putalpha(mask.resize(im.size, Image.LANCZOS))
    return out


# 1024 store/legacy icon: full-bleed square (stores and launchers apply their own mask).
icon = gradient(1024)
icon.alpha_composite(glyph(1024, (230, 250, 794, 770)))
icon.convert("RGB").save(OUT + "icon.png")
# Android adaptive icon: background layer + foreground glyph inside the central safe zone.
gradient(512).save(OUT + "android-icon-background.png")
glyph(512, (150, 160, 362, 352)).save(OUT + "android-icon-foreground.png")
mono = glyph(432, (126, 134, 306, 298), color=(255, 255, 255, 255), soft=(255, 255, 255, 255))
mono.save(OUT + "android-icon-monochrome.png")
# Splash: white glyph shown on the blue splash background.
glyph(288, (24, 30, 264, 258)).save(OUT + "splash-icon.png")
fav = rounded(gradient(48), 10)
fav.alpha_composite(glyph(48, (9, 10, 39, 38)))
fav.save(OUT + "favicon.png")
print("ok")
