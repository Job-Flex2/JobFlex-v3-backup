# THE APP'S FONTS, LATIN ONLY (2026-10-23) — src/app/fonts/*-latin.woff2 from the .ttf originals beside them.
#
#   python scripts/font-subset.py        (needs fonttools and brotli: pip install fonttools brotli)
#
# Kept: Google Fonts' latin + latin-ext ranges, every axis, every OpenType feature (the app sets tnum, ss/cv
# alternates), and every symbol the source under src/ uses that the font draws — arrows, ≤ ≥ ≈, ✓ ★, ▲ ▼ ▶,
# fractions — so they do not fall to the system font. Cyrillic and Greek are left out (the interface is English).
# Re-run after replacing a .ttf, or when the interface starts using a new symbol.
import sys, os
sys.stdout.reconfigure(encoding="utf-8")
from fontTools import subset
from fontTools.ttLib import TTFont
root = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..")
fonts = os.path.join(root, "src", "app", "fonts")
R = lambda a, b=None: range(a, (b if b is not None else a) + 1)
LATIN = [R(0x0,0xFF),R(0x131),R(0x152,0x153),R(0x2BB,0x2BC),R(0x2C6),R(0x2DA),R(0x2DC),R(0x304),R(0x308),R(0x329),R(0x2000,0x206F),R(0x20AC),R(0x2122),R(0x2191),R(0x2193),R(0x2212),R(0x2215),R(0xFEFF),R(0xFFFD)]
EXT = [R(0x100,0x2BA),R(0x2BD,0x2C5),R(0x2C7,0x2CC),R(0x2CE,0x2D7),R(0x2DD,0x2FF),R(0x1D00,0x1DBF),R(0x1E00,0x1E9F),R(0x1EF2,0x1EFF),R(0x2020),R(0x20A0,0x20AB),R(0x20AD,0x20C0),R(0x2113),R(0x2C60,0x2C7F),R(0xA720,0xA7FF)]
base = set(c for r in LATIN + EXT for c in r)
used = set()
for d, _, fs in os.walk(os.path.join(root, "src")):
    for f in fs:
        if f.endswith((".tsx", ".ts", ".css")):
            for ch in open(os.path.join(d, f), encoding="utf-8", errors="ignore").read():
                c = ord(ch)
                if c > 0x7F and c not in base and not (0x370 <= c <= 0x52F):
                    used.add(c)
for src, out in [("Inter-variable.ttf", "Inter-variable-latin.woff2"), ("JetBrainsMono-variable.ttf", "JetBrainsMono-variable-latin.woff2")]:
    font = TTFont(os.path.join(fonts, src))
    cmap = set(font.getBestCmap())
    extra = sorted(c for c in used if c in cmap)
    opts = subset.Options()
    opts.layout_features = ["*"]
    opts.name_IDs = ["*"]
    opts.name_languages = ["*"]
    opts.notdef_outline = True
    opts.glyph_names = False
    opts.flavor = "woff2"
    s = subset.Subsetter(opts)
    s.populate(unicodes=(base | set(extra)) & cmap)
    s.subset(font)
    font.flavor = "woff2"
    p = os.path.join(fonts, out)
    font.save(p)
    print(f"{out}: {os.path.getsize(p)} bytes, {len(font.getBestCmap())} chars; extra {len(extra)}: {''.join(chr(c) for c in extra)}")
