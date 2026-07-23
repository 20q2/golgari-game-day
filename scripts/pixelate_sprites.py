"""
Turn the 1024px faux-pixel player art into true flat-colour pixel art so the
Undercity hue-band region classifiers (src/app/undercity/engine/sprite-engine.ts)
segment cleanly.

The raw art is a high-res painterly render with a pixel-art *look* but tens of
thousands of noisy, anti-aliased, gradient colours — so hue classification
speckles. This flattens each sprite to a small median-cut palette on a real
pixel grid.

Pipeline per sprite (player_sprites/source/<name>.png -> player_sprites/<name>.png):
  1. Downsample to GRID x GRID with BILINEAR (averages out per-pixel noise).
  2. Threshold alpha to binary (kills anti-aliased halo pixels that carry
     washed-out RGB and land in the wrong hue band / stay untinted).
  3. Flatten transparent pixels' RGB so quantise doesn't spend palette slots
     on halo colour.
  4. Median-cut quantise the RGB to COLORS flat colours, no dither.
  5. Trim transparent margins and re-centre on a square canvas, so a figure
     that only filled a corner of its frame (e.g. the zombie, ~86% empty) is
     drawn large when the board scales it to a fixed height.
  6. Darken the sprite's own outermost 1px ring to black (flush with the edge,
     no size growth). Outline pixels are dark, so the region classifiers leave
     them be.
  7. Upscale back to 1024 with NEAREST -> crisp, contiguous blocks.

Output stays 1024x1024 square so plaza sizing (width-based) is unaffected.

Re-runnable and deterministic: always reads from source/, never from the
processed output, and median-cut has no RNG. If you replace a source image or
change GRID/COLORS, the flat palette shifts and the classifier hue bands for
that sprite may need re-tuning (dump the palette and compare against the bands).

Usage:  python scripts/pixelate_sprites.py
Requires: Pillow  (pip install Pillow)
"""
import os

from PIL import Image, ImageChops, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
SPRITES = os.path.join(HERE, "..", "public", "undercity", "player_sprites")
SRC = os.path.join(SPRITES, "source")

GRID = 128
COLORS = 24
ALPHA_CUT = 128

# Sprites to process (the 1024px faux-pixel ones). The 64px files in the folder
# are already true pixel art and are left alone.
TARGETS = ["pest", "insect", "zombie", "saproling", "plant"]


def _trim_and_square(im):
    """Crop transparent margins, then re-centre on a square canvas so a figure
    that only filled a corner is drawn large when scaled to a fixed height."""
    bbox = im.getchannel("A").getbbox()
    if bbox:
        im = im.crop(bbox)
    w, h = im.size
    side = max(w, h)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(im, ((side - w) // 2, (side - h) // 2))
    return canvas


def _add_outline(im, color=(0, 0, 0)):
    """Darken the sprite's own outermost 1px ring to black — flush with the
    silhouette edge (no size growth), so it reads as a clean single edge rather
    than an added border."""
    a = im.getchannel("A").point(lambda v: 255 if v >= 128 else 0)
    eroded = a.filter(ImageFilter.MinFilter(3))  # 3x3 erosion = shrink 1px
    edge = ImageChops.subtract(a, eroded)  # the sprite's outermost 1px
    r, g, b, _ = im.split()
    rgb = Image.merge("RGB", (r, g, b))
    rgb.paste(color, (0, 0), edge)
    return Image.merge("RGBA", (*rgb.split(), a))  # alpha unchanged -> flush


def pixelate(name, grid=GRID, colors=COLORS):
    im = Image.open(os.path.join(SRC, name + ".png")).convert("RGBA")
    small = im.resize((grid, grid), Image.BILINEAR)

    r, g, b, a = small.split()
    a = a.point(lambda v: 255 if v >= ALPHA_CUT else 0)

    rgb = Image.merge("RGB", (r, g, b))
    rgb.paste((0, 0, 0), (0, 0), Image.eval(a, lambda v: 255 - v))

    q = rgb.quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert("RGB")
    out_small = Image.merge("RGBA", (*q.split(), a))
    out_small = _trim_and_square(out_small)
    out_small = _add_outline(out_small)
    big = out_small.resize((1024, 1024), Image.NEAREST)
    big.save(os.path.join(SPRITES, name + ".png"))

    uniq = len({(p[0], p[1], p[2]) for p in out_small.getdata() if p[3] >= 128})
    print("  %-10s grid=%d colors=%d -> %2d flat opaque colours" % (name, grid, colors, uniq))


def ensure_source():
    """Snapshot current working files into source/ the first time so the
    pipeline has an untouched input to re-run from."""
    os.makedirs(SRC, exist_ok=True)
    for name in TARGETS:
        s = os.path.join(SRC, name + ".png")
        w = os.path.join(SPRITES, name + ".png")
        if not os.path.exists(s) and os.path.exists(w):
            Image.open(w).save(s)
            print("  backed up working %s -> source/" % name)


if __name__ == "__main__":
    ensure_source()
    print("processing:")
    for name in TARGETS:
        if os.path.exists(os.path.join(SRC, name + ".png")):
            pixelate(name)
        else:
            print("  WARN no source for %s" % name)
