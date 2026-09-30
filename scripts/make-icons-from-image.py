#!/usr/bin/env python3
"""
Turn a supplied artwork image into a clean, full PWA icon set.

The tricky part is *segmentation*. AI-generated icon art usually sits on a
light page background with a soft drop shadow, and naive bounding-box
detection keeps both — producing an icon with a grey halo, and a maskable
variant that is just a white box inside a coloured field.

This script instead:
  1. finds the icon tile as the largest region of *saturated* pixels (the tile
     is deep navy→green; the page background and shadow are near-neutral grey),
  2. crops to that tile, discarding the page background and the shadow,
  3. writes the standard `any` icons,
  4. writes `maskable` icons by *stretching the tile's own gradient* to fill the
     whole canvas and insetting a centred copy of the artwork, so Android's
     mask never reveals a foreign colour, and
  5. writes a matching favicon.

Usage:
  python3 scripts/make-icons-from-image.py path/to/art.png
"""

from __future__ import annotations

import argparse
import base64
import sys
from io import BytesIO
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

REPO = Path(__file__).resolve().parent.parent
ICONS = REPO / "public" / "icons"


def saturation_mask(img: Image.Image, sat_threshold: float = 0.22, value_max: float = 0.80) -> np.ndarray:
    """
    Boolean mask of strongly-coloured pixels (high chroma). The page background
    and the soft drop shadow are near-neutral, so they are excluded; the icon
    tile is deeply saturated and is kept. Very bright highlights are dropped so
    they don't inflate the bounding box.
    """
    rgb = np.asarray(img.convert("RGB"), dtype=np.float32) / 255.0
    mx = rgb.max(axis=2)
    mn = rgb.min(axis=2)
    light = mx + mn
    sat = np.where(light == 0, 0.0, (mx - mn) / np.where(light == 0, 1.0, light))
    # Require BOTH strong saturation and non-pale value. The pale threshold is
    # what removes the white anti-aliased halo hugging the icon's edge, which a
    # saturation-only mask keeps — and that halo is what leaves a white ring
    # around the maskable inset.
    return (sat > sat_threshold) & (mx < value_max)


def largest_component_bbox(mask: np.ndarray) -> tuple[int, int, int, int] | None:
    """
    Bounding box of the largest connected component of the mask. A plain flood
    fill is ample at icon resolution and avoids a scipy dependency.
    """
    h, w = mask.shape
    seen = np.zeros((h, w), dtype=bool)
    best_area = 0
    best_box: tuple[int, int, int, int] | None = None
    ys, xs = np.nonzero(mask)
    for y0, x0 in zip(ys, xs):
        if seen[y0, x0]:
            continue
        stack = [(int(y0), int(x0))]
        seen[y0, x0] = True
        min_y = max_y = int(y0)
        min_x = max_x = int(x0)
        area = 0
        while stack:
            y, x = stack.pop()
            area += 1
            min_y = min(min_y, y)
            max_y = max(max_y, y)
            min_x = min(min_x, x)
            max_x = max(max_x, x)
            for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    stack.append((ny, nx))
        if area > best_area:
            best_area = area
            best_box = (min_x, min_y, max_x + 1, max_y + 1)
    return best_box


def crop_to_tile(src: Image.Image, margin_ratio: float = 0.01) -> Image.Image:
    box = largest_component_bbox(saturation_mask(src))
    if box is None:
        sys.exit("could not segment the icon (no saturated, non-white core found)")
    x0, y0, x1, y1 = box
    w, h = src.size

    # The detected region is the *saturated body* of the tile, which can be
    # slightly wider than tall (and is never perfectly square). Take the larger
    # span as the side length and centre the crop on the detected centre. This
    # avoids pasting into a synthetic canvas, which would show through as a
    # coloured or white seam.
    cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    side = max(x1 - x0, y1 - y0)
    side = int(side * (1 + margin_ratio * 2))
    left, top = cx - side // 2, cy - side // 2

    # Clamp into the image; if the icon runs to an edge, pad with the tile's
    # own dominant colour rather than black.
    pad_l, pad_t = max(0, -left), max(0, -top)
    right, bottom = min(w, left + side), min(h, top + side)
    if right - left > 0 and bottom - top > 0:
        tile = src.crop((max(0, left), max(0, top), right, bottom)).convert("RGB")
    else:
        sys.exit("icon bbox lies outside the image")

    if tile.size != (side, side):
        # Centre-pad using a border sample so any seam is the icon's own colour.
        edge = tile.crop((tile.width // 2, 0, tile.width // 2 + 1, 1)).getpixel((0, 0))
        canvas = Image.new("RGB", (side, side), edge)
        canvas.paste(tile, ((side - tile.width) // 2, (side - tile.height) // 2))
        tile = canvas
        del pad_l, pad_t

    return tile


def tile_gradient_background(tile: Image.Image, size: int) -> Image.Image:
    """
    Full-bleed background for the maskable icon, built from the tile's own
    *saturated centre* — not its corners, which are the artwork's near-white
    rounded edges and would bleed a white halo into the maskable.

    We sample the interior, build a top→bottom gradient from it, then blur it
    so any residual edge influence is smoothed away.
    """
    # Interior crop: ignore the outer 18% on every side (the rounded corners).
    w, h = tile.size
    inset = int(min(w, h) * 0.18)
    core = tile.crop((inset, inset, w - inset, h - inset))

    # Take the mean colour of the top and bottom strips of that core.
    arr = np.asarray(core, dtype=np.float32)
    band = max(1, arr.shape[0] // 8)
    top = arr[:band].reshape(-1, 3).mean(axis=0)
    bottom = arr[-band:].reshape(-1, 3).mean(axis=0)

    strip = Image.new("RGB", (1, size))
    px = strip.load()
    for y in range(size):
        t = y / max(1, size - 1)
        px[0, y] = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
    grad = strip.resize((size, size), Image.BILINEAR)
    # A light blur removes any banding and the last of the edge influence.
    return grad.filter(ImageFilter.GaussianBlur(radius=max(1, size * 0.02)))


def make_maskable(tile: Image.Image, size: int, inset: float = 0.78) -> Image.Image:
    """
    Maskable icons fill the whole canvas: Android applies its own mask
    (circle / squircle / rounded square), so anything we leave as "padding" is
    simply wasted area, and anything we inset shows as a visible frame.

    The artwork carries a glossy specular highlight along its top edge, so
    insetting it onto a synthesised gradient produced a permanent white glow
    that no amount of edge-trimming could remove. Filling the canvas is both
    simpler and more correct.
    """
    del inset  # full-bleed by design
    return tile.resize((size, size), Image.LANCZOS)


def trim_pale_edge(tile: Image.Image, keep_sat: float = 0.10) -> Image.Image:
    """
    Shrink a tile by the width of its pale outer ring. We re-run the
    saturation mask on the *tile* and inset to that core, so the rounded edge
    (which is near-white and low-chroma) is trimmed off cleanly.
    """
    box = largest_component_bbox(saturation_mask(tile, sat_threshold=keep_sat, value_max=0.92))
    if box is None:
        return tile
    x0, y0, x1, y1 = box
    # Only trim if there is a meaningful pale border; otherwise keep the tile.
    if (x1 - x0) < tile.width * 0.85:
        return tile.crop(box).convert("RGB")
    return tile


def make_any(tile: Image.Image, size: int) -> Image.Image:
    return tile.resize((size, size), Image.LANCZOS)


def write_svg_favicon(tile: Image.Image, path: Path) -> None:
    buf = BytesIO()
    tile.resize((256, 256), Image.LANCZOS).save(buf, format="PNG", optimize=True)
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    path.write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">'
        f'<image href="data:image/png;base64,{b64}" width="256" height="256"/>'
        "</svg>\n",
        encoding="utf8",
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("source", type=Path)
    ap.add_argument("--out", type=Path, default=ICONS)
    ap.add_argument("--maskable-inset", type=float, default=0.78)
    ap.add_argument("--favicon", type=Path, default=REPO / "public" / "favicon.svg")
    args = ap.parse_args()

    if not args.source.exists():
        sys.exit(f"source not found: {args.source}")

    src = Image.open(args.source)
    print(f"source : {src.size[0]}x{src.size[1]} {src.mode}")

    tile = crop_to_tile(src)
    print(f"tile   : {tile.size[0]}x{tile.size[1]} (segmented)")

    args.out.mkdir(parents=True, exist_ok=True)
    for size in (192, 512):
        p = args.out / f"icon-{size}.png"
        make_any(tile, size).save(p, "PNG", optimize=True)
        print(f"  {p.relative_to(REPO)}  any {size}")
    for size in (192, 512):
        p = args.out / f"maskable-{size}.png"
        make_maskable(tile, size, args.maskable_inset).save(p, "PNG", optimize=True)
        print(f"  {p.relative_to(REPO)}  maskable {size}")
    write_svg_favicon(tile, args.favicon)
    print(f"  {args.favicon.relative_to(REPO)}")


if __name__ == "__main__":
    main()
