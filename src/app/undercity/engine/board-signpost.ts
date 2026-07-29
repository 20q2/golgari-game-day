/**
 * Planted tunnel signpost — a small post beside a tunnel mouth carrying a
 * framed thumbnail of the destination region's backdrop + its name. Shared by
 * the live game board (board-canvas) and the map editor (editor-canvas) so both
 * render it identically. Pure canvas drawing in world coordinates.
 */
import { regionInfo, tunnelDest } from '../data/regions';
import { NODE_R, DISC_RY } from './board-space';

/** Structural node shape (compatible with BoardNode). */
interface SignNode {
  id: string;
  x: number;
  y: number;
  type: string;
  region?: string;
  neighbors: string[];
}

type FloorTex = Partial<Record<string, HTMLImageElement>>;

/**
 * Draw the signpost for one node. No-op unless the node is a `tunnel` whose
 * destination region has RegionInfo. The caller decides which nodes are
 * visible (fog-of-war on the board, active layer in the editor) — this just
 * draws when handed a candidate.
 */
export function drawTunnelSignpost(
  ctx: CanvasRenderingContext2D,
  n: SignNode,
  nodes: SignNode[],
  floorTex: FloorTex,
): void {
  if (n.type !== 'tunnel') return;
  const dest = tunnelDest(nodes, n);
  const info = dest ? regionInfo(dest) : undefined;
  if (!dest || !info) return;

  // Point the sign toward the destination-region neighbours.
  const byId = new Map(nodes.map((m) => [m.id, m]));
  let dx = 0;
  let dy = -1;
  const near = n.neighbors
    .map((id) => byId.get(id))
    .filter((m): m is SignNode => !!m && m.region === dest);
  if (near.length) {
    const cx = near.reduce((s, m) => s + m.x, 0) / near.length;
    const cy = near.reduce((s, m) => s + m.y, 0) / near.length;
    const len = Math.hypot(cx - n.x, cy - n.y) || 1;
    dx = (cx - n.x) / len;
    dy = (cy - n.y) / len;
  }
  drawPanel(ctx, n.x, n.y, dx, dy, info.name, floorTex[dest]);
}

/** A short post rising to a framed backdrop thumbnail + name plaque, planted to
 *  the SIDE of the tunnel disc (perpendicular to the path) so it clears the
 *  ribbon instead of sitting on it. */
function drawPanel(
  ctx: CanvasRenderingContext2D,
  nx: number,
  ny: number,
  dx: number,
  dy: number,
  name: string,
  img: HTMLImageElement | undefined,
): void {
  const PW = 66;
  const PH = 52;
  const PLAQUE = 15;
  const POST = 16;
  // (dx,dy) points along the path toward the destination; offset PERPENDICULAR
  // to it — the upward-leaning side — so the sign sits beside the ribbon.
  let ox = -dy;
  let oy = dx;
  if (oy > 0) {
    ox = dy;
    oy = -dx;
  }
  const SIDE = NODE_R * 1.35;
  const bx = nx + ox * SIDE;
  const by = ny - DISC_RY * 0.2 + oy * SIDE;
  const px = bx;
  const py = by - POST - PH / 2;

  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 3;

  // Post.
  ctx.fillStyle = '#3b2f22';
  ctx.fillRect(bx - 4, py + PH / 2 - 2, 8, POST + 4);

  // Panel frame.
  const fx = px - PW / 2;
  const fy = py - PH / 2;
  ctx.beginPath();
  ctx.roundRect(fx, fy, PW, PH, 7);
  ctx.fillStyle = '#0d0f0b';
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(120, 96, 60, 0.9)';
  ctx.stroke();

  // Backdrop thumbnail (cover-fit, clipped to the image area).
  const ix = fx + 4;
  const iy = fy + 4;
  const iw = PW - 8;
  const ih = PH - PLAQUE - 6;
  if (img && img.width) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(ix, iy, iw, ih, 4);
    ctx.clip();
    const scale = Math.max(iw / img.width, ih / img.height);
    ctx.drawImage(
      img,
      ix + (iw - img.width * scale) / 2,
      iy + (ih - img.height * scale) / 2,
      img.width * scale,
      img.height * scale,
    );
    ctx.restore();
  }

  // Name plaque.
  ctx.fillStyle = 'rgba(13, 15, 11, 0.92)';
  ctx.fillRect(fx + 3, fy + PH - PLAQUE, PW - 6, PLAQUE - 3);
  ctx.fillStyle = '#e6dcc2';
  ctx.font = '600 9px Georgia, "Times New Roman", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, px, fy + PH - PLAQUE / 2 - 1, PW - 10);
  ctx.restore();
}
