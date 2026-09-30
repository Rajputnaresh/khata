#!/usr/bin/env python3
"""
Extract a transparent-background glyph (the white "k" + chart line + gold dot)
from the app's 512px PWA icon, and a matching gradient background layer, for use
as an Android adaptive icon.

The icon's background is a deep navy -> green gradient with a large glossy
highlight near the top. The glyph strokes are *thinner* than that highlight, so
a heavily downscaled median filter estimates the background while erasing the
glyph. The glyph is then recovered as the residual.

Why not simple thresholding: the lower half of the chart line is mid-green on a
green background, so luminance thresholding drops it (or keeps the background).

Outputs (in --out):
  fg-<n>.png  glyph on transparency, sized n (108dp canvas convention)
  bg-<n>.png  gradient background, sized n
"""

from __future__ import annotations

import argparse
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

REPO = Path(__file__).resolve().parent.parent.parent
DEFAULT_SRC = REPO / "public" / "icons" / "icon-512.png"
DEFAULT_OUT = REPO / "android" / "build" / "glyph"


def segment_tile(src: np.ndarray) -> np.ndarray:
    """Crop the saturated icon tile out of the surrounding page background."""
    rgb = src.astype(np.float32) / 255.0
    mx, mn = rgb.max(axis=2), rgb.min(axis=2)
    light = mx + mn
    sat = np.where(light == 0, 0.0, (mx - mn) / np.where(light == 0, 1.0, light))
    # Strong chroma AND not near-white: keeps the tile, drops the page and the
    # pale anti-aliased halo hugging the tile's edge.
    mask = ((sat > 0.22) & (mx < 0.80)).astype(np.uint8)

    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    if n <= 1:
        raise SystemExit("could not segment the icon tile (no saturated core found)")
    biggest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    x = stats[biggest, cv2.CC_STAT_LEFT]
    y = stats[biggest, cv2.CC_STAT_TOP]
    w = stats[biggest, cv2.CC_STAT_WIDTH]
    h = stats[biggest, cv2.CC_STAT_HEIGHT]
    # Make it square, centred on the detected centre.
    side = max(w, h)
    cx, cy = x + w // 2, y + h // 2
    x0, y0 = cx - side // 2, cy - side // 2
    # Clamp by shifting the window inward rather than padding with black.
    x0 = int(np.clip(x0, 0, src.shape[1] - side))
    y0 = int(np.clip(y0, 0, src.shape[0] - side))
    return src[y0 : y0 + side, x0 : x0 + side]


def background_estimate(gray8: np.ndarray) -> np.ndarray:
    """Estimate the background by erasing the glyph.

    The "k" stem is ~53px wide, so a 121px median filter is the smallest that
    fully erases it. A median (rather than a mean) is essential: the gradient
    is locally smooth but steep, and averaging would smear bright glyph edges
    into the background estimate. Morphological opening works too but leaves a
    hard edge, and inpainting was tried and rejected -- with the gloss highlight
    spanning the top of the tile, the rough mask saturated to 100% coverage and
    inpainted the glyph away along with everything else.
    """
    med = cv2.medianBlur(gray8, 121)
    return med.astype(np.float32) / 255.0


def glyph_alpha(gray8: np.ndarray) -> np.ndarray:
    """Soft coverage of the glyph: how far each pixel is from the background."""
    bg = background_estimate(gray8)
    g = gray8.astype(np.float32) / 255.0
    resid = np.abs(g - bg)

    # Border band: the tile's rounded edges and the gloss highlight along its
    # top both sit within ~6% of the border, and the glyph never reaches there.
    # Zeroing the band removes the texture the residual picks up at the corners.
    h, w = resid.shape
    band = int(min(h, w) * 0.06)
    resid[:band, :] = 0
    resid[-band:, :] = 0
    resid[:, :band] = 0
    resid[:, -band:] = 0

    hard = (resid > 0.12).astype(np.uint8)

    # Close then open: the close re-joins the "k" to the chart line crossing it
    # (the crossing is a thin gap), the open drops speckle.
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
    hard = cv2.morphologyEx(hard, cv2.MORPH_CLOSE, k)
    hard = cv2.morphologyEx(hard, cv2.MORPH_OPEN, k)

    # Fill interior holes (the counter of the "k" bowl and the notch where the
    # chart line crosses it), else the gradient shows through as a blemish.
    inv = (1 - hard).astype(np.uint8)
    filled = inv.copy()
    ff = np.zeros((h + 2, w + 2), np.uint8)
    cv2.floodFill(filled, ff, (0, 0), 0)
    hard = (hard | filled).astype(np.uint8)

    # Keep the few substantial components: the "k" and the chart line (which the
    # close may have split where it thins out). Anything smaller is residual
    # gradient texture that survived the threshold.
    n, labels, stats, _ = cv2.connectedComponentsWithStats(hard, connectivity=8)
    if n > 1:
        areas = stats[1:, cv2.CC_STAT_AREA]
        keep = [i + 1 for i in np.argsort(areas)[::-1][:3] if areas[i] > 0.005 * hard.size]
        hard = np.isin(labels, keep).astype(np.uint8)

    return cv2.GaussianBlur(hard.astype(np.float32), (0, 0), 1.2)


def gradient_background(rgb: np.ndarray, size: int) -> np.ndarray:
    """Full-bleed gradient taken from the tile's own interior, top to bottom."""
    h, w = rgb.shape[:2]
    inset = int(min(w, h) * 0.14)
    core = rgb[inset : h - inset, inset : w - inset].astype(np.float32)
    band = max(1, core.shape[0] // 6)
    top = core[:band].reshape(-1, 3).mean(axis=0)
    bottom = core[-band:].reshape(-1, 3).mean(axis=0)

    ramp = np.linspace(0.0, 1.0, size, dtype=np.float32)[:, None]
    grad = top[None, :] + (bottom - top)[None, :] * ramp  # (size, 3)
    img = np.repeat(grad[:, None, :], size, axis=1)
    return cv2.GaussianBlur(img, (0, 0), max(1.0, size * 0.015))


def legacy_icon(tile: np.ndarray, size: int, shape: str) -> np.ndarray:
    """Pre-O launcher icon: the full tile, squircle- or circle-cropped.

    Launchers before API 26 (and any OEM that ignores adaptive icons) use these,
    so the finished artwork has to stand on its own with no separate background.
    """
    h, w = tile.shape[:2]
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    cx = cy = (size - 1) / 2.0
    if shape == "circle":
        inside = ((xx - cx) ** 2 + (yy - cy) ** 2) <= (size / 2.0 - 0.5) ** 2
    else:
        # A rounded square (squircle-ish) with a 22% corner radius, matching the
        # shape the source artwork itself uses.
        r = size * 0.22
        inside = _rounded_rect_mask(xx, yy, cx, cy, size / 2.0, r)
    scale = size / float(max(h, w))
    img = cv2.resize(tile, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_LANCZOS4)
    out = np.zeros((size, size, 4), np.uint8)
    src = img[:size, :size]
    out[..., :3] = src
    out[..., 3] = (inside * 255).astype(np.uint8)
    return out


def _rounded_rect_mask(xx, yy, cx, cy, half, r) -> np.ndarray:
    """Signed-distance test for a rounded rectangle centred on (cx, cy).

    Uses the standard SDF: distance to the shape is `length(max(q,0)) +
    min(max(qx,qy),0) - r`, and the point is inside when that is negative. A
    naive `|p| > half` test would be a plain square; a naive
    `max(|dx|,|dy|) > half` test erases the entire band outside the inner
    rectangle and leaves only a hard-cornered box.
    """
    qx = np.abs(xx - cx) - (half - r)
    qy = np.abs(yy - cy) - (half - r)
    outside = np.sqrt(np.maximum(qx, 0) ** 2 + np.maximum(qy, 0) ** 2) + np.minimum(
        np.maximum(qx, qy), 0
    ) - r
    return outside <= 0


def _write(path: Path, arr: np.ndarray) -> None:
    """Write a PNG, converting float working images to 8-bit on the way out."""
    if arr.dtype != np.uint8:
        arr = np.clip(arr, 0, 255).astype(np.uint8)
    Image.fromarray(arr).save(path)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", type=Path, default=DEFAULT_SRC)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--res", type=Path, default=REPO / "android" / "src" / "app" / "khata" / "res")
    ap.add_argument("--preview", action="store_true", help="write a side-by-side preview")
    args = ap.parse_args()

    src = np.asarray(Image.open(args.src).convert("RGB"))
    tile = segment_tile(src)
    print(f"source {src.shape[1]}x{src.shape[0]}  ->  tile {tile.shape[1]}x{tile.shape[0]}")

    alpha = glyph_alpha(cv2.cvtColor(tile, cv2.COLOR_RGB2GRAY))
    fg_rgb = tile.astype(np.float32)
    bg = gradient_background(tile, 432)

    # ---- adaptive icon layers -------------------------------------------
    # Android renders an adaptive icon on a 108dp canvas but only guarantees the
    # central 72dp survives every OEM mask (66dp for aggressive circles). The
    # glyph is scaled to 60dp and centred, which keeps it clear of the worst-case
    # mask while still filling the icon generously.
    CANVAS = 432  # 108dp at 4x

    def place_fg(size: int) -> np.ndarray:
        """Rescale the glyph into the safe zone of a `size` canvas."""
        canvas = np.zeros((size, size, 4), np.uint8)
        s = int(size * 0.555)
        a = cv2.resize(alpha, (s, s), interpolation=cv2.INTER_LANCZOS4)
        f = cv2.resize(fg_rgb, (s, s), interpolation=cv2.INTER_LANCZOS4)
        o = (size - s) // 2
        canvas[o : o + s, o : o + s, :3] = f.astype(np.uint8)
        canvas[o : o + s, o : o + s, 3] = np.clip(a * 255, 0, 255).astype(np.uint8)
        return canvas

    adir = args.res / "mipmap-anydpi-v26"
    adir.mkdir(parents=True, exist_ok=True)
    _write(adir / "ic_launcher_foreground.png", place_fg(CANVAS))
    # Themed-icon (Android 13+) layer: the launcher tints this itself, so it must
    # be a flat white silhouette of the glyph, not the artwork. Flat white with
    # the glyph's own alpha -- the launcher supplies the colour.
    mono = np.zeros((CANVAS, CANVAS, 4), np.uint8)
    mono[..., :3] = 255
    mono[..., 3] = place_fg(CANVAS)[..., 3]
    _write(adir / "ic_launcher_monochrome.png", mono)
    # Backgrounds at every density so non-adaptive and pre-26 renderers still
    # get a full-bleed gradient rather than a transparent square.
    for density, px in (("mdpi", 108), ("hdpi", 162), ("xhdpi", 216), ("xxhdpi", 324), ("xxxhdpi", 432)):
        d = args.res / f"mipmap-{density}"
        d.mkdir(parents=True, exist_ok=True)
        _write(d / "ic_launcher_background.png", cv2.resize(bg, (px, px), interpolation=cv2.INTER_AREA))
    print(f"  adaptive foreground {CANVAS}px, background 108..432px")

    # ---- legacy launcher icons ------------------------------------------
    for density, base in (("mdpi", 48), ("hdpi", 72), ("xhdpi", 96), ("xxhdpi", 144), ("xxxhdpi", 192)):
        d = args.res / f"mipmap-{density}"
        _write(d / "ic_launcher.png", legacy_icon(tile, base, "squircle"))
        _write(d / "ic_launcher_round.png", legacy_icon(tile, base, "circle"))
    print("  legacy ic_launcher + ic_launcher_round 48..192px")

    if args.preview:
        s = 256
        a = cv2.resize(alpha, (s, s), interpolation=cv2.INTER_LANCZOS4)
        f = cv2.resize(fg_rgb, (s, s), interpolation=cv2.INTER_LANCZOS4)
        b = cv2.resize(bg, (s, s), interpolation=cv2.INTER_AREA)
        composed = np.clip(f * a[..., None] + b * (1 - a[..., None]), 0, 255)

        def mask_panel(mask2d: np.ndarray) -> np.ndarray:
            m = mask2d[..., None].astype(np.float32)
            return np.clip(composed * m + 255.0 * (1 - m), 0, 255)

        yy, xx = np.mgrid[0:s, 0:s].astype(np.float32)
        c = (s - 1) / 2.0
        circle = ((xx - c) ** 2 + (yy - c) ** 2) <= (s / 2 - 1) ** 2
        squircle = _rounded_rect_mask(xx, yy, c, c, s / 2 - 1, s * 0.28)
        legacy = legacy_icon(tile, s, "squircle")
        alpha_frac = legacy[..., 3:4].astype(np.float32) / 255.0
        legacy_rgb = legacy[..., :3].astype(np.float32) * alpha_frac + 255.0 * (1 - alpha_frac)

        pad = np.full((s, 10, 3), 210.0)
        row = np.hstack(
            [composed, pad, mask_panel(circle), pad, mask_panel(squircle), pad, legacy_rgb]
        )
        Image.fromarray(np.clip(row, 0, 255).astype(np.uint8)).save(args.out / "preview.png")
        print("  preview.png (composite | circle mask | squircle mask | legacy)")


if __name__ == "__main__":
    main()
