"""Раскадровка: кадры move-<name>-N.png, вырезанные по рамке, в одну полосу. python sheet.py name x0 y0 x1 y1 [cols]"""
import sys, glob, re
from PIL import Image, ImageDraw
name, box = sys.argv[1], tuple(map(int, sys.argv[2:6]))
cols = int(sys.argv[6]) if len(sys.argv) > 6 else 5
files = sorted(glob.glob(f"out/move-{name}-*.png"), key=lambda f: int(re.findall(r"-(\d+)\.png$", f)[0]))
crops = [Image.open(f).crop(box) for f in files]
w, h = crops[0].size
rows = (len(crops) + cols - 1) // cols
sheet = Image.new("RGB", (w * cols, h * rows), "#222")
for i, c in enumerate(crops):
    sheet.paste(c, ((i % cols) * w, (i // cols) * h))
    ImageDraw.Draw(sheet).text(((i % cols) * w + 6, (i // cols) * h + 4), str(i), fill="white")
sheet.save(f"out/sheet-{name}.png")
print(f"out/sheet-{name}.png", sheet.size)
