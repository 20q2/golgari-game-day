/**
 * CanvasRenderingContext2D.roundRect / Path2D.roundRect polyfill.
 *
 * Why: the Undercity board, plaza and signpost renderers call `ctx.roundRect`
 * unguarded, and the terrain bake runs inside the BoardCanvas constructor. On
 * browsers without the API — Safari < 16 (iOS 15 devices: iPhone 6s/7/SE 1st
 * gen) and Chrome < 99 — that constructor throws `roundRect is not a function`,
 * the board never mounts, and the player sees a black, flickering screen that
 * never finishes "loading". Filling the method in is cheaper and safer than
 * guarding every call site.
 *
 * Implements the spec'd signature: `radii` may be a number, a DOMPointInit
 * (`{x, y}` elliptical radius) or an array of 1–4 of either, in the same
 * corner order as CSS border-radius (top-left, top-right, bottom-right,
 * bottom-left). Radii are clamped so adjacent corners never overlap, as the
 * spec requires. Negative sizes are handled by flipping, matching the native
 * behaviour of drawing the rect from the other edge.
 */

type RadiusInit = number | { x?: number; y?: number };
type Corner = { x: number; y: number };

interface RoundRectPath {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  ellipse(
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
    counterclockwise?: boolean,
  ): void;
  closePath(): void;
}

function toCorner(r: RadiusInit): Corner {
  if (typeof r === 'number') {
    if (!Number.isFinite(r)) return { x: 0, y: 0 };
    if (r < 0) throw new RangeError('roundRect: radius must be non-negative');
    return { x: r, y: r };
  }
  const x = Number(r?.x ?? 0);
  const y = Number(r?.y ?? 0);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { x: 0, y: 0 };
  if (x < 0 || y < 0) throw new RangeError('roundRect: radius must be non-negative');
  return { x, y };
}

function expandRadii(radii: RadiusInit | RadiusInit[] | undefined): Corner[] {
  if (radii === undefined) return [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
  const list = Array.isArray(radii) ? radii : [radii];
  if (list.length < 1 || list.length > 4) {
    throw new RangeError('roundRect: radii must have between 1 and 4 elements');
  }
  const c = list.map(toCorner);
  // Fresh objects per corner: the overlap clamp below mutates them in place,
  // so shared corners must not alias one another.
  const cp = (k: Corner): Corner => ({ x: k.x, y: k.y });
  switch (c.length) {
    case 1:
      return [cp(c[0]), cp(c[0]), cp(c[0]), cp(c[0])];
    case 2:
      return [cp(c[0]), cp(c[1]), cp(c[0]), cp(c[1])];
    case 3:
      return [cp(c[0]), cp(c[1]), cp(c[2]), cp(c[1])];
    default:
      return [cp(c[0]), cp(c[1]), cp(c[2]), cp(c[3])];
  }
}

function roundRectPath(
  path: RoundRectPath,
  x: number,
  y: number,
  w: number,
  h: number,
  radii?: RadiusInit | RadiusInit[],
): void {
  if (![x, y, w, h].every(Number.isFinite)) return;
  let [tl, tr, br, bl] = expandRadii(radii);

  // Negative width/height: draw from the far edge and swap the corners so the
  // visual result matches the native implementation.
  if (w < 0) {
    x += w;
    w = -w;
    [tl, tr, br, bl] = [tr, tl, bl, br];
  }
  if (h < 0) {
    y += h;
    h = -h;
    [tl, tr, br, bl] = [bl, br, tr, tl];
  }

  // Scale all radii down uniformly if any pair would overlap along an edge.
  const scale = Math.min(
    1,
    w / Math.max(tl.x + tr.x, 1e-9),
    w / Math.max(bl.x + br.x, 1e-9),
    h / Math.max(tl.y + bl.y, 1e-9),
    h / Math.max(tr.y + br.y, 1e-9),
  );
  if (scale < 1) {
    for (const c of [tl, tr, br, bl]) {
      c.x *= scale;
      c.y *= scale;
    }
  }

  const right = x + w;
  const bottom = y + h;
  const HALF_PI = Math.PI / 2;

  path.moveTo(x + tl.x, y);
  path.lineTo(right - tr.x, y);
  if (tr.x > 0 || tr.y > 0) path.ellipse(right - tr.x, y + tr.y, tr.x, tr.y, 0, -HALF_PI, 0);
  path.lineTo(right, bottom - br.y);
  if (br.x > 0 || br.y > 0) path.ellipse(right - br.x, bottom - br.y, br.x, br.y, 0, 0, HALF_PI);
  path.lineTo(x + bl.x, bottom);
  if (bl.x > 0 || bl.y > 0) path.ellipse(x + bl.x, bottom - bl.y, bl.x, bl.y, 0, HALF_PI, Math.PI);
  path.lineTo(x, y + tl.y);
  if (tl.x > 0 || tl.y > 0) path.ellipse(x + tl.x, y + tl.y, tl.x, tl.y, 0, Math.PI, 1.5 * Math.PI);
  path.closePath();
  // The spec ends with a moveTo back to the start point so a following lineTo
  // begins a fresh subpath from the rect's origin corner.
  path.moveTo(x, y);
}

function install(proto: object | undefined): void {
  if (!proto || typeof (proto as { roundRect?: unknown }).roundRect === 'function') return;
  Object.defineProperty(proto, 'roundRect', {
    configurable: true,
    writable: true,
    enumerable: false,
    value: function roundRect(
      this: RoundRectPath,
      x: number,
      y: number,
      w: number,
      h: number,
      radii?: RadiusInit | RadiusInit[],
    ): void {
      roundRectPath(this, x, y, w, h, radii);
    },
  });
}

if (typeof window !== 'undefined') {
  install((window as unknown as { CanvasRenderingContext2D?: { prototype: object } }).CanvasRenderingContext2D?.prototype);
  install((window as unknown as { Path2D?: { prototype: object } }).Path2D?.prototype);
  install(
    (window as unknown as { OffscreenCanvasRenderingContext2D?: { prototype: object } })
      .OffscreenCanvasRenderingContext2D?.prototype,
  );
}
