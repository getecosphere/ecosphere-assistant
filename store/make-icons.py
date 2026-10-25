#!/usr/bin/env python3
"""Draw the Ecosphere P4 LED mark (rules/brand.md: 4x5 dot grid, 13 lit dots, D1 geometry) into icons/icon*.png.
The 128 px icon keeps 16 px of transparent padding, as the Chrome Web Store asks."""
from PIL import Image, ImageDraw
import os

PAT = ["VBBB", "V...", "VGG.", "V...", "VCCC"]
COL = {"V": (0x70, 0x48, 0xF5), "B": (0x2B, 0x8C, 0xF5), "G": (0x18, 0xB4, 0x7B), "C": (0xF2, 0x59, 0x3A)}
GHOST = (0x17, 0x14, 0x1D, 18)  # unlit dots, ~7% ink
SS = 8  # supersample


def mark(box, ghost=True):
    n = box * SS
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad = n * 0.08
    pitch = (n - 2 * pad) / 5
    dot = pitch * 0.84
    off = (pitch - dot) / 2
    for r in range(5):
        for c in range(4):
            g = PAT[r][c]
            if g == "." and not ghost:
                continue
            x = pad + c * pitch + off + pitch * 0.5  # centre the 4-wide glyph in the square
            y = pad + r * pitch + off
            fill = GHOST if g == "." else COL[g] + (255,)
            d.ellipse([x, y, x + dot, y + dot], fill=fill)
    return img.resize((box, box), Image.LANCZOS)


here = os.path.dirname(os.path.abspath(__file__))
out = os.path.join(here, "..", "icons")
for size in (16, 32, 48):
    mark(size, ghost=size >= 32).save(os.path.join(out, f"icon{size}.png"))
big = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
big.paste(mark(96), (16, 16))
big.save(os.path.join(out, "icon128.png"))
mark(512).save(os.path.join(here, "mark-512.png"))
print("icons written")
