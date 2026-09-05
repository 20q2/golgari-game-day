"""
Turn an AI-generated creature animation clip (Midjourney / Sora / Runway, plain
flat background) into a game-ready looping sprite sheet.

These clips are long, slow-looping, and rendered on an opaque backdrop, so a
naive "dump every frame" gives a sheet that is huge, jitters, and snaps at the
loop seam. This script fixes all three:

  1. LOOP DETECTION — scores every candidate cycle length k against frame 0 and
     keeps the k whose frame is most identical to the first, so the last cell
     flows back into the first. Sampling then walks one cycle, not the whole clip.
  2. BACKGROUND KEY — floods the flat backdrop inward from the image border, so
     only background *connected to the edge* is cut. White eye glints and other
     interior highlights survive, which a plain colour-distance key destroys.
     Edge pixels then get a real coverage estimate rather than a brightness
     threshold: each is matched to its nearest fully-opaque pixel F and solved
     for a in  C = F*a + bg*(1-a).  This matters — a thresholding key reads the
     pale end of an anti-aliased ramp into a black outline as "almost opaque
     light grey" and leaves a pale rim that glows against a dark board, when
     that pixel is really ~15% coverage of something black.
  3. SHARED CROP BOX — one union bounding box, computed across every sampled
     frame and applied to all of them. Cropping each frame to its own content
     makes the creature swim around its cell as limbs/wings extend; a shared box
     keeps it planted. Bottom-anchored by default so feet sit on the cell floor.

Frames are premultiplied before the downscale and un-premultiplied after, so the
RGB of transparent pixels can't bleed dark fringes into the silhouette.

Usage:
  python scripts/video_to_spritesheet.py <video> [-o out.png]
  python scripts/video_to_spritesheet.py clip.mp4 --frames 16 --cols 4 --cell 128
  python scripts/video_to_spritesheet.py clip.mp4 --anchor center --no-preview

Writes <out>.png (the sheet), <out>.json (frame metadata), and unless
--no-preview, <out>_preview.gif for eyeballing the loop at real speed.

Requires: opencv-python, Pillow, numpy
"""
import argparse
import json
import os

import cv2
import numpy as np
from PIL import Image

# A pixel within this channel distance of the backdrop colour is a backdrop
# candidate (only cut if it also floods from the border). Just wide enough to
# swallow mp4 compression noise on a flat backdrop.
KEY_LO = 10
# How far the anti-aliased edge band reaches inward from the flooded backdrop.
# Everything deeper is trusted as fully opaque, which is what protects interior
# highlights (a white eye glint) from being read as background.
EDGE_BAND = 4
# Fraction of the cell left as breathing room around the union crop box.
PAD = 0.04


def read_frames(path):
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise SystemExit("cannot open video: %s" % path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 24.0
    frames = []
    while True:
        ok, f = cap.read()
        if not ok:
            break
        frames.append(f)
    cap.release()
    if not frames:
        raise SystemExit("no frames decoded from %s" % path)
    return frames, fps


def detect_cycle(frames, min_k):
    """Pick the cycle length whose frame best matches frame 0, so the sheet's
    last cell loops cleanly back into its first. Only considers k >= min_k, so a
    short sub-rhythm (a wing flap) can't be mistaken for the whole cycle and
    force duplicate cells."""
    gray = [cv2.cvtColor(f, cv2.COLOR_BGR2GRAY).astype(np.float32) for f in frames]
    hi = len(frames) - 1
    if min_k > hi:
        return hi
    scores = [(float(np.abs(gray[0] - gray[k]).mean()), k) for k in range(min_k, hi + 1)]
    best, k = min(scores)
    print("  loop: %d frames (frame %d differs from frame 0 by %.2f/255)" % (k, k, best))
    return k


def _nearest_opaque(bgr, core):
    """For every pixel, the colour of the nearest fully-opaque ('core') pixel.
    This is the F term in the coverage solve, and doubles as the de-contaminated
    colour for edge pixels."""
    src = np.where(core, 0, 255).astype(np.uint8)  # zeros are the search targets
    _, labels = cv2.distanceTransformWithLabels(src, cv2.DIST_L2, 3, labelType=cv2.DIST_LABEL_PIXEL)
    coords = np.argwhere(src == 0)  # row-major, same order OpenCV numbers labels
    lut = np.zeros((int(labels.max()) + 1, 2), np.int32)
    lut[labels[src == 0]] = coords
    at = lut[labels]
    return bgr[at[:, :, 0], at[:, :, 1]]


def key_background(frame, bg_bgr):
    """Cut the flat backdrop to alpha, flooding inward from the border so only
    edge-connected background is removed. Returns float RGBA, 0-255."""
    bgr = frame.astype(np.float32)
    bg_c = np.array(bg_bgr, np.float32)
    # Distance from the backdrop colour, per pixel (max over channels).
    dist = np.abs(bgr - bg_c).max(axis=2)

    near = (dist <= KEY_LO).astype(np.uint8)
    # Label the near-backdrop pixels; any blob touching the border is background.
    _, labels = cv2.connectedComponents(near, connectivity=4)
    border = np.concatenate([labels[0, :], labels[-1, :], labels[:, 0], labels[:, -1]])
    bg_labels = [int(v) for v in np.unique(border) if v != 0]
    bg = np.isin(labels, bg_labels) if bg_labels else np.zeros(near.shape, bool)

    # Only pixels within EDGE_BAND of the flooded backdrop are treated as
    # anti-aliased; everything deeper is opaque by definition.
    band = cv2.dilate(bg.astype(np.uint8), np.ones((3, 3), np.uint8),
                      iterations=EDGE_BAND).astype(bool) & ~bg
    core = ~bg & ~band

    alpha = np.ones(dist.shape, np.float32)
    rgb = bgr.copy()
    if core.any() and band.any():
        F = _nearest_opaque(bgr, core)
        # Solve C = F*a + bg*(1-a) on whichever channel separates F from the
        # backdrop most strongly (the best-conditioned one).
        den = bg_c - F
        num = bg_c - bgr
        ch = np.abs(den).argmax(axis=2)[:, :, None]
        d = np.take_along_axis(den, ch, axis=2)[:, :, 0]
        n = np.take_along_axis(num, ch, axis=2)[:, :, 0]
        cov = np.clip(n / np.where(np.abs(d) < 1.0, 1.0, d), 0.0, 1.0)
        cov[np.abs(d) < 1.0] = 1.0  # F indistinguishable from backdrop: keep it
        alpha[band] = cov[band]
        rgb[band] = F[band]  # de-contaminated: the real colour behind the blend
    alpha[bg] = 0.0
    rgb[bg] = 0

    return np.dstack([rgb[:, :, ::-1], alpha * 255.0])  # BGR -> RGB


def union_box(rgbas, thresh=8):
    """One content box covering every sampled frame, so the sprite doesn't swim
    around its cell as limbs extend."""
    x0, y0 = 10**9, 10**9
    x1, y1 = -1, -1
    for r in rgbas:
        ys, xs = np.nonzero(r[:, :, 3] > thresh)
        if not len(xs):
            continue
        x0, y0 = min(x0, int(xs.min())), min(y0, int(ys.min()))
        x1, y1 = max(x1, int(xs.max())), max(y1, int(ys.max()))
    if x1 < 0:
        raise SystemExit("every frame keyed out to empty - is the background flat?")
    return x0, y0, x1, y1


def square_crop(box, anchor):
    """Grow the union box to a padded square. Bottom-anchored keeps a standing
    creature's feet on the cell floor with headroom above."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0 + 1, y1 - y0 + 1
    side = int(round(max(w, h) * (1 + 2 * PAD)))
    cx = (x0 + x1) / 2.0
    sx = int(round(cx - side / 2.0))
    if anchor == "bottom":
        sy = int(round(y1 + side * PAD - side))
    else:
        sy = int(round((y0 + y1) / 2.0 - side / 2.0))
    return sx, sy, side


def crop_to_cell(rgba, sx, sy, side, cell, resample, alpha_cut):
    """Lift the crop window (which may hang off the source edges) onto a
    transparent canvas and scale it down to one cell.

    NEAREST is the default: the source is a faux-pixel render, so point-sampling
    keeps its colour blocks flat and crisp instead of smearing them into new
    in-between shades. AREA is available for painterly art, where it averages
    honestly — but it must run premultiplied, or transparent pixels' RGB bleeds
    a dark fringe into the silhouette."""
    h, w = rgba.shape[:2]
    canvas = np.zeros((side, side, 4), np.float32)
    # Overlap between the requested window and the actual frame.
    dx0, dy0 = max(0, -sx), max(0, -sy)
    sx0, sy0 = max(0, sx), max(0, sy)
    sx1, sy1 = min(w, sx + side), min(h, sy + side)
    canvas[dy0:dy0 + (sy1 - sy0), dx0:dx0 + (sx1 - sx0)] = rgba[sy0:sy1, sx0:sx1]

    if resample == "nearest":
        small = cv2.resize(canvas, (cell, cell), interpolation=cv2.INTER_NEAREST)
    else:
        a = canvas[:, :, 3:4] / 255.0
        premul = np.dstack([canvas[:, :, :3] * a, canvas[:, :, 3]])
        small = cv2.resize(premul, (cell, cell), interpolation=cv2.INTER_AREA)
        sa = np.maximum(small[:, :, 3:4] / 255.0, 1e-3)
        small = np.dstack([np.clip(small[:, :, :3] / sa, 0, 255), small[:, :, 3]])

    if alpha_cut:
        # Binary alpha, same as pixelate_sprites.py: pixel art wants a hard
        # silhouette edge, not a rim of semi-transparent leftovers.
        small[:, :, 3] = np.where(small[:, :, 3] >= alpha_cut, 255.0, 0.0)
    return np.clip(small, 0, 255).astype(np.uint8)


def build(args):
    frames, fps = read_frames(args.video)
    print("source: %d frames @ %.3g fps, %dx%d" % (len(frames), fps, frames[0].shape[1], frames[0].shape[0]))

    start = args.start
    span = args.cycle if args.cycle else detect_cycle(frames[start:], args.frames)
    idx = [start + int(round(i * span / float(args.frames))) % len(frames) for i in range(args.frames)]
    print("  sampling frames: %s" % ", ".join(str(i) for i in idx))

    bg = tuple(int(c) for c in args.bg.split(",")) if args.bg else tuple(int(c) for c in frames[0][0, 0])
    print("  backdrop key (BGR): %s" % (bg,))

    keyed = [key_background(frames[i], bg) for i in idx]
    box = union_box(keyed)
    sx, sy, side = square_crop(box, args.anchor)
    print("  union box: x%d-%d y%d-%d -> %dpx square at (%d,%d), %s-anchored"
          % (box[0], box[2], box[1], box[3], side, sx, sy, args.anchor))

    cut = 0 if args.soft_alpha else args.alpha_cut
    print("  resample: %s, alpha: %s" % (args.resample, "hard cut @%d" % cut if cut else "soft"))
    cells = [crop_to_cell(k, sx, sy, side, args.cell, args.resample, cut) for k in keyed]

    rows = (args.frames + args.cols - 1) // args.cols
    sheet = Image.new("RGBA", (args.cols * args.cell, rows * args.cell), (0, 0, 0, 0))
    for n, c in enumerate(cells):
        sheet.paste(Image.fromarray(c, "RGBA"), ((n % args.cols) * args.cell, (n // args.cols) * args.cell))

    out = args.out or os.path.splitext(args.video)[0] + "_sheet.png"
    sheet.save(out)
    print("wrote %s (%dx%d, %d frames, %dx%d grid)"
          % (out, sheet.width, sheet.height, args.frames, args.cols, rows))

    meta = {
        "image": os.path.basename(out),
        "frameWidth": args.cell,
        "frameHeight": args.cell,
        "frames": args.frames,
        "cols": args.cols,
        "rows": rows,
        "fps": round(fps, 3),
        "loop": True,
        "source": os.path.basename(args.video),
    }
    meta_path = os.path.splitext(out)[0] + ".json"
    with open(meta_path, "w") as fh:
        json.dump(meta, fh, indent=2)
    print("wrote %s" % meta_path)

    if not args.no_preview:
        gif = os.path.splitext(out)[0] + "_preview.gif"
        pics = [Image.fromarray(c, "RGBA") for c in cells]
        pics[0].save(gif, save_all=True, append_images=pics[1:],
                     duration=int(1000 / fps), loop=0, disposal=2, transparency=0)
        print("wrote %s (loop preview @ %.3g fps)" % (gif, fps))


def main():
    p = argparse.ArgumentParser(description="Video -> looping sprite sheet")
    p.add_argument("video")
    p.add_argument("-o", "--out", help="output PNG (default: <video>_sheet.png)")
    p.add_argument("--frames", type=int, default=16, help="cells in the sheet (default 16)")
    p.add_argument("--cols", type=int, default=4, help="cells per row (default 4)")
    p.add_argument("--cell", type=int, default=128, help="cell size in px (default 128)")
    p.add_argument("--start", type=int, default=0, help="first source frame (default 0)")
    p.add_argument("--cycle", type=int, default=0, help="force cycle length instead of detecting it")
    p.add_argument("--bg", help="backdrop colour as B,G,R (default: sample pixel 0,0)")
    p.add_argument("--anchor", choices=["bottom", "center"], default="bottom",
                   help="where the subject sits in its cell (default bottom)")
    p.add_argument("--resample", choices=["nearest", "area"], default="nearest",
                   help="downscale filter; nearest keeps pixel blocks crisp (default nearest)")
    p.add_argument("--alpha-cut", type=int, default=128,
                   help="binary alpha threshold for crisp edges (default 128)")
    p.add_argument("--soft-alpha", action="store_true",
                   help="keep anti-aliased alpha instead of a hard cut")
    p.add_argument("--no-preview", action="store_true", help="skip the preview GIF")
    build(p.parse_args())


if __name__ == "__main__":
    main()
