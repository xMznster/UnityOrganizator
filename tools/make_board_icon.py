#!/usr/bin/env python3
"""Generates the Organizator app icons (web/board/icons): indigo gradient with three board columns."""
import os
import sys
from PIL import Image, ImageDraw

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "web", "board", "icons")
S = 1024
TOP, BOTTOM = (112, 124, 236), (78, 86, 196)  # indigo gradient


def render(size, pad_ratio):
    img = Image.new("RGB", (S, S), BOTTOM)
    d = ImageDraw.Draw(img)
    for y in range(S):
        t = y / (S - 1)
        d.line([(0, y), (S, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(TOP, BOTTOM)))
    # three columns, like lists on a board
    pad = S * pad_ratio
    inner = S - 2 * pad
    gap = inner * 0.085
    col_w = (inner - 2 * gap) / 3
    heights = [0.78, 0.52, 1.0]
    alphas = [255, 225, 200]
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    for i, (hgt, a) in enumerate(zip(heights, alphas)):
        x0 = pad + i * (col_w + gap)
        y0 = pad
        ld.rounded_rectangle([x0, y0, x0 + col_w, y0 + inner * hgt], radius=col_w * 0.34, fill=(255, 255, 255, a))
    img = Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")
    return img.resize((size, size), Image.LANCZOS)


os.makedirs(OUT, exist_ok=True)
render(180, 0.27).save(os.path.join(OUT, "icon-180.png"))
render(192, 0.27).save(os.path.join(OUT, "icon-192.png"))
render(512, 0.27).save(os.path.join(OUT, "icon-512.png"))
render(512, 0.33).save(os.path.join(OUT, "maskable-512.png"))  # content inside the maskable safe zone
print("wrote icons to", os.path.abspath(OUT))
