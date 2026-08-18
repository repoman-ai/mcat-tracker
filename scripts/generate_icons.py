#!/usr/bin/env python3
"""Generate the MCAT Momentum icon set (favicon, PWA, Apple touch) from one glyph.

Usage:  python3 scripts/generate_icons.py [option]
        option = check (default) | bars | monogram | hex

Writes favicon.svg + icons/* + favicon.ico at the repo root.
Requires: cairosvg, pillow  ->  pip install cairosvg pillow
"""
import sys, os, io
import cairosvg
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Each option: tile background + the glyph drawn on a 64x64 canvas.
OPTIONS = {
    "bars": {
        "bg": "#0e2a47",
        "glyph": """
    <rect x="12" y="35" width="10" height="15" rx="5" fill="#9fc6d6"/>
    <rect x="27" y="27" width="10" height="23" rx="5" fill="#dceef2"/>
    <rect x="42" y="15" width="10" height="35" rx="5" fill="#f3c86d"/>""",
    },
    "check": {
        "bg": "#0e2a47",
        "glyph": """
    <g fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="9">
      <path d="M13 33 L25 45" stroke="#dceef2"/>
      <path d="M25 45 L51 15" stroke="#f3c86d"/>
    </g>""",
    },
    "monogram": {
        "bg": "#f5f1e8",
        "glyph": """
    <path d="M12 42 L12 18 L32 36 L52 18 L52 42" fill="none" stroke="#0e2a47" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M14 53 L50 53" stroke="#c88444" stroke-width="8" stroke-linecap="round"/>""",
    },
    "hex": {
        "bg": "#0e2a47",
        "glyph": """
    <path d="M32 8 L53 20 L53 44 L32 56 L11 44 L11 20 Z" fill="#f3c86d"/>
    <path d="M21 39 L29 30 L36 36 L45 24" fill="none" stroke="#0e2a47" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>""",
    },
}


def svg(option, radius=14, scale=1.0):
    """Compose an SVG tile. radius=0 for full-bleed (Apple/maskable), scale<1 for maskable safe zone."""
    o = OPTIONS[option]
    inner = o["glyph"]
    if scale != 1.0:
        shift = 32 * (1 - scale)
        inner = f'<g transform="translate({shift:.3f} {shift:.3f}) scale({scale})">{inner}</g>'
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">\n'
        f'  <rect width="64" height="64" rx="{radius}" fill="{o["bg"]}"/>{inner}\n</svg>\n'
    )


def png(markup, size, path):
    cairosvg.svg2png(bytestring=markup.encode(), write_to=path, output_width=size, output_height=size)


def main():
    option = sys.argv[1] if len(sys.argv) > 1 else "check"
    if option not in OPTIONS:
        sys.exit(f"unknown option {option!r}; pick one of {', '.join(OPTIONS)}")
    icons = os.path.join(ROOT, "icons")
    os.makedirs(icons, exist_ok=True)

    # Scalable favicon: rounded tile, used by every modern browser for tabs + bookmarks.
    with open(os.path.join(ROOT, "favicon.svg"), "w") as fh:
        fh.write(svg(option, radius=14))

    rounded = svg(option, radius=14)
    # iOS applies its own squircle mask, so the touch icon must be full-bleed and opaque.
    png(svg(option, radius=0), 180, os.path.join(icons, "apple-touch-icon.png"))
    png(rounded, 192, os.path.join(icons, "icon-192.png"))
    png(rounded, 512, os.path.join(icons, "icon-512.png"))
    # Android maskable icons get cropped to the launcher shape: keep the glyph inside the safe zone.
    png(svg(option, radius=0, scale=0.78), 192, os.path.join(icons, "icon-192-maskable.png"))
    png(svg(option, radius=0, scale=0.78), 512, os.path.join(icons, "icon-512-maskable.png"))

    # Legacy multi-resolution .ico for older browsers and pinned/bookmark bars.
    frames = []
    for s in (16, 32, 48, 64):
        buf = io.BytesIO()
        cairosvg.svg2png(bytestring=rounded.encode(), write_to=buf, output_width=s, output_height=s)
        frames.append(Image.open(io.BytesIO(buf.getvalue())).convert("RGBA"))
    frames[-1].save(os.path.join(ROOT, "favicon.ico"), format="ICO",
                    sizes=[(f.width, f.height) for f in frames])
    print(f"icon set written from option '{option}'")


if __name__ == "__main__":
    main()
