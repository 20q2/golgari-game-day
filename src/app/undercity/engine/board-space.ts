/**
 * The Dokapon-style space "coin" — shared by the game board (BoardCanvas) and
 * the map editor so both render spaces pixel-identically.
 */
import { SPACE_ICONS } from '../data/items';
import type { BoardNode } from './board-canvas';

export const NODE_R = 36; // disc rx, also the tap radius — chunky Dokapon-style coins
export const DISC_RY = 26; // squashed ellipse top face for the 2.5D read
export const DISC_THICK = 9; // coin side wall visible below the top face

// Brighter than the terrain mid-tones on purpose: the board should pop off
// the scenery like Dokapon spaces glowing against grass.
export const TYPE_COLORS: Record<string, string> = {
  loot: '#529257',
  wild: '#a83c3c',
  elite: '#7c2440',
  mystery: '#7a5cc2',
  shop: '#bd8c3e',
  trading_post: '#5a9a6a',
  excavation: '#b8934e',
  shrine: '#caa04a',
  hazard: '#647694',
  warp: '#3aa8a4',
  gate: '#ffffff',
  boss: '#45285c',
  ossuary: '#93795c',
  barrier: '#8a5040',
  lair: '#96304e',
  vault: '#c8a53e',
  cache: '#b08a2e',
  ladder: '#527a8a',
};

function scaleHex(hex: string, f: number): string {
  const v = parseInt(hex.slice(1), 16);
  const ch = (n: number) => Math.round(((v >> n) & 255) * f);
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}

/** Perceived luminance test so glyphs stay legible on light discs (e.g. the white gate). */
function isLightHex(hex: string): boolean {
  const v = parseInt(hex.slice(1), 16);
  const r = (v >> 16) & 255;
  const g = (v >> 8) & 255;
  const b = v & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 176;
}

/** Bone skull glyph for boss + monster lairs — 'Material Icons' has no skull ligature. */
export function drawSkull(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1.25, 1.25);
  // Cranium + cheeks
  ctx.fillStyle = '#ece3d0';
  ctx.beginPath();
  ctx.arc(0, -3, 9, Math.PI, 0);
  ctx.lineTo(9, 2);
  ctx.quadraticCurveTo(9, 7, 4, 7);
  ctx.lineTo(4, 10);
  ctx.lineTo(-4, 10);
  ctx.lineTo(-4, 7);
  ctx.quadraticCurveTo(-9, 7, -9, 2);
  ctx.closePath();
  ctx.fill();
  // Jaw
  ctx.fillRect(-5, 8.5, 10, 2.5);
  // Eye sockets + nose
  ctx.fillStyle = '#20140f';
  ctx.beginPath();
  ctx.ellipse(-3.8, -1, 2.6, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(3.8, -1, 2.6, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0, 2);
  ctx.lineTo(-1.6, 5);
  ctx.lineTo(1.6, 5);
  ctx.closePath();
  ctx.fill();
  // Teeth grooves
  ctx.strokeStyle = '#20140f';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const tx of [-2.5, 0, 2.5]) {
    ctx.moveTo(tx, 8.5);
    ctx.lineTo(tx, 11);
  }
  ctx.stroke();
  ctx.restore();
}

export const TYPE_SIDE_COLORS: Record<string, string> = Object.fromEntries(
  Object.entries(TYPE_COLORS).map(([k, c]) => [k, scaleHex(c, 0.55)]),
);

export interface SpaceDiscOpts {
  /** Barrier still walled off — draws the lock glyph instead of lock_open. */
  sealed?: boolean;
  /** Editor selection ring. */
  selected?: boolean;
  /**
   * Sealed off behind an unbroken barrier: the coin renders in grey (its type
   * colour muted away) so it clearly can't be visited yet, without dimming the
   * whole space out.
   */
  locked?: boolean;
}

// Muted stone-grey for locked spaces — top face + darker side wall.
const LOCKED_COLOR = '#6a7069';
const LOCKED_SIDE = scaleHex(LOCKED_COLOR, 0.55);

/**
 * Halo, ground shadow, coin side + top face, sheen, outline, and the space's
 * Material Icons glyph (sprite-engine preloads the font).
 */
export function drawSpaceDisc(
  ctx: CanvasRenderingContext2D,
  n: BoardNode,
  opts: SpaceDiscOpts = {},
): void {
  const halo = ctx.createRadialGradient(n.x, n.y + 3, NODE_R * 0.6, n.x, n.y + 3, NODE_R * 2);
  halo.addColorStop(0, 'rgba(235, 255, 240, 0.13)');
  halo.addColorStop(1, 'rgba(235, 255, 240, 0)');
  ctx.fillStyle = halo;
  ctx.fillRect(n.x - NODE_R * 2, n.y - NODE_R * 1.6, NODE_R * 4, NODE_R * 3.2);
  ctx.beginPath();
  ctx.ellipse(n.x, n.y + 11, NODE_R + 5, DISC_RY + 3, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fill();
  // Locked spaces render in grey instead of their type colour.
  const topColor = opts.locked ? LOCKED_COLOR : (TYPE_COLORS[n.type] ?? '#444');
  const sideColor = opts.locked ? LOCKED_SIDE : (TYPE_SIDE_COLORS[n.type] ?? 'rgb(37, 37, 37)');
  ctx.beginPath();
  ctx.ellipse(n.x, n.y + DISC_THICK, NODE_R, DISC_RY, 0, 0, Math.PI * 2);
  ctx.fillStyle = sideColor;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(n.x, n.y, NODE_R, DISC_RY, 0, 0, Math.PI * 2);
  ctx.fillStyle = topColor;
  ctx.fill();
  const hl = ctx.createRadialGradient(n.x - 10, n.y - 8, 0, n.x, n.y, NODE_R);
  hl.addColorStop(0, 'rgba(255,255,255,0.28)');
  hl.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = hl;
  ctx.beginPath();
  ctx.ellipse(n.x, n.y, NODE_R, DISC_RY, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(n.x, n.y, NODE_R, DISC_RY, 0, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // A locked space fades its icon too, so the whole coin reads as inactive.
  if (opts.locked) ctx.globalAlpha = 0.4;
  if (n.type === 'boss' || n.type === 'lair') {
    drawSkull(ctx, n.x, n.y);
  } else {
    const glyph =
      n.type === 'barrier'
        ? opts.sealed
          ? 'lock'
          : 'lock_open'
        : (SPACE_ICONS[n.type] ?? 'circle');
    ctx.font = "30px 'Material Icons'";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Dark glyph on light discs (e.g. the white gate) so it stays legible.
    ctx.fillStyle = isLightHex(topColor) ? 'rgba(24, 28, 22, 0.92)' : 'rgba(250, 255, 250, 1)';
    ctx.fillText(glyph, n.x, n.y);
  }
  if (opts.locked) ctx.globalAlpha = 1;

  if (opts.selected) {
    ctx.beginPath();
    ctx.ellipse(n.x, n.y, NODE_R + 8, DISC_RY + 6, 0, 0, Math.PI * 2);
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 3;
    ctx.stroke();
  }
}
