#!/usr/bin/env python3
"""Generates the app icon (1024x1024, no alpha) for Unity Developer Vault."""
import math, sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont

S = 1024
out = sys.argv[1] if len(sys.argv) > 1 else "AppIcon.png"
img = Image.new("RGB", (S, S), (9, 11, 15))
d = ImageDraw.Draw(img)

# Background: diagonal gradient deep navy -> near black
for y in range(S):
    t = y / S
    r = int(14 * (1 - t) + 6 * t); g = int(20 * (1 - t) + 8 * t); b = int(34 * (1 - t) + 12 * t)
    d.line([(0, y), (S, y)], fill=(r, g, b))

# Glow
glow = Image.new("RGB", (S, S), (0, 0, 0))
gd = ImageDraw.Draw(glow)
gd.ellipse([180, 160, 860, 840], fill=(30, 140, 135))
glow = glow.filter(ImageFilter.GaussianBlur(170))
img = Image.blend(img, Image.composite(glow, img, Image.new("L", (S, S), 255)), 0.55)
d = ImageDraw.Draw(img)

# Vault ring (hex-like rounded square)
def rounded_rect(box, radius, outline, width):
    d.rounded_rectangle(box, radius=radius, outline=outline, width=width)

rounded_rect([196, 196, 828, 828], 150, (79, 209, 197), 26)
rounded_rect([244, 244, 780, 780], 118, (40, 70, 80), 6)

# Dial ticks
cx, cy = 512, 512
for i in range(24):
    a = i / 24 * 2 * math.pi
    r1, r2 = 300, 318 if i % 2 else 334
    d.line([(cx + r1 * math.cos(a), cy + r1 * math.sin(a)), (cx + r2 * math.cos(a), cy + r2 * math.sin(a))], fill=(79, 209, 197), width=6)

# Curly braces
font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf", 330) if True else None
try:
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf", 330)
except Exception:
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", 330)
text = "{ }"
bbox = d.textbbox((0, 0), text, font=font)
tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
d.text((cx - tw / 2 - bbox[0], cy - th / 2 - bbox[1] - 10), text, font=font, fill=(232, 234, 240))

# Accent cube dot (Unity-ish nod without any trademark)
d.polygon([(512, 452), (552, 475), (512, 498), (472, 475)], fill=(199, 146, 234))
d.polygon([(472, 475), (512, 498), (512, 545), (472, 522)], fill=(139, 213, 160))
d.polygon([(552, 475), (512, 498), (512, 545), (552, 522)], fill=(79, 209, 197))

img.save(out, "PNG")
print("wrote", out)
