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
  gate: '#5ba672',
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

export const TYPE_SIDE_COLORS: Record<string, string> = Object.fromEntries(
  Object.entries(TYPE_COLORS).map(([k, c]) => [k, scaleHex(c, 0.55)]),
);

export interface SpaceDiscOpts {
  /** Barrier still walled off — draws the lock glyph instead of lock_open. */
  sealed?: boolean;
  /** Editor selection ring. */
  selected?: boolean;
}

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
  ctx.beginPath();
  ctx.ellipse(n.x, n.y + DISC_THICK, NODE_R, DISC_RY, 0, 0, Math.PI * 2);
  ctx.fillStyle = TYPE_SIDE_COLORS[n.type] ?? 'rgb(37, 37, 37)';
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(n.x, n.y, NODE_R, DISC_RY, 0, 0, Math.PI * 2);
  ctx.fillStyle = TYPE_COLORS[n.type] ?? '#444';
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

  const glyph =
    n.type === 'barrier'
      ? opts.sealed
        ? 'lock'
        : 'lock_open'
      : (SPACE_ICONS[n.type] ?? 'circle');
  ctx.font = "30px 'Material Icons'";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(250, 255, 250, 1)';
  ctx.fillText(glyph, n.x, n.y);

  if (opts.selected) {
    ctx.beginPath();
    ctx.ellipse(n.x, n.y, NODE_R + 8, DISC_RY + 6, 0, 0, Math.PI * 2);
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 3;
    ctx.stroke();
  }
}
