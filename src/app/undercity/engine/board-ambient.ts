/**
 * Ambient atmosphere for the Undercity board: drifting spore motes and the
 * occasional bat flight across the dark. Pure visual flavor on the dynamic
 * layer — nothing here reads or writes game state. (Wandering wild-creature
 * sprites were removed as distracting; enemies live only on their spaces.)
 */
import type { BoardMap } from './board-canvas';

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Mote {
  x: number;
  y: number;
  r: number;
  phase: number;
  violet: boolean;
}

/** A barely-there drifting fog patch, wrapping east across the world. */
interface FogBank {
  x: number;
  y: number;
  r: number;
  phase: number;
}

/** Particle look per context: overworld default + one per dungeon biome. */
interface AmbientStyle {
  colors: [string, string]; // [common, rare] as 'r, g, b'
  riseSpeed: number; // px/s drift (negative = sink)
  wobble: number; // horizontal sway amplitude
}

const AMBIENT_STYLES: Record<string, AmbientStyle> = {
  overworld: { colors: ['120, 220, 200', '186, 148, 255'], riseSpeed: 9, wobble: 26 },
  city: { colors: ['230, 200, 150', '235, 190, 160'], riseSpeed: 4, wobble: 10 }, // eggsac motes
  cavern: { colors: ['120, 250, 220', '190, 160, 255'], riseSpeed: 12, wobble: 30 }, // glow spores
  bog: { colors: ['110, 190, 180', '150, 220, 180'], riseSpeed: -3, wobble: 6 }, // marsh bubbles
  bone: { colors: ['220, 214, 190', '190, 184, 160'], riseSpeed: 2, wobble: 14 }, // bone dust
  garden: { colors: ['190, 210, 90', '160, 130, 60'], riseSpeed: 7, wobble: 34 }, // rot flies
};

export interface Viewport {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export class BoardAmbient {
  private motes: Mote[] = [];
  /** How many motes actually draw — the full 150 on the overworld reads as
   *  ~20 per screen; a small dungeon pocket caps lower or it's a blizzard. */
  private activeMotes = 150;
  private fog: FogBank[] = [];
  private rand = mulberry32(hashStr('undercity-ambient'));
  private styleKey = 'overworld';

  // One small bat flock crossing the map now and then.
  private batFrom = { x: 0, y: 0 };
  private batTo = { x: 0, y: 0 };
  private batStart = 0;
  private batDur = 12000;
  private batNextAt = 0;

  constructor(private map: BoardMap) {
    for (let i = 0; i < 150; i++) {
      this.motes.push({
        x: 60 + this.rand() * (map.worldW - 120),
        y: 100 + this.rand() * (map.worldH - 160),
        r: 1.5 + this.rand() * 1.8,
        phase: this.rand() * 100,
        violet: this.rand() < 0.3,
      });
    }
    for (let i = 0; i < 8; i++) {
      this.fog.push({
        x: this.rand() * map.worldW,
        y: 120 + this.rand() * (map.worldH - 240),
        r: 170 + this.rand() * 120,
        phase: this.rand() * Math.PI * 2,
      });
    }
  }


  /**
   * Switch the particle set (overworld | dungeon biome key). Optional bounds
   * re-scatter the motes over the active layer so a small dungeon pocket
   * still reads alive (the world-wide scatter would leave it near-empty).
   */
  setContext(styleKey: string, bounds?: { x: number; y: number; w: number; h: number }): void {
    const next = styleKey in AMBIENT_STYLES ? styleKey : 'overworld';
    if (next === this.styleKey) return;
    this.styleKey = next;
    this.activeMotes = bounds ? 48 : 150;
    if (bounds) {
      for (const m of this.motes) {
        m.x = bounds.x + 60 + this.rand() * Math.max(1, bounds.w - 120);
        m.y = bounds.y + 100 + this.rand() * Math.max(1, bounds.h - 160);
      }
      for (const f of this.fog) {
        f.x = bounds.x + this.rand() * Math.max(1, bounds.w);
        f.y = bounds.y + 80 + this.rand() * Math.max(1, bounds.h - 160);
      }
    }
  }

  /** Spore motes + bat flock — call after tokens/labels, still in world space. */
  drawAtmosphere(ctx: CanvasRenderingContext2D, now: number, view: Viewport): void {
    const t = now * 0.001;
    const style = AMBIENT_STYLES[this.styleKey];
    ctx.save();
    // Barely-there fog banks drifting east, wrapping across the world.
    ctx.globalCompositeOperation = 'lighter';
    const span = this.map.worldW + 600;
    for (const f of this.fog) {
      const x = ((f.x + t * 8 + 300) % span) - 300;
      const y = f.y + Math.sin(t * 0.3 + f.phase) * 18;
      if (x < view.x0 - f.r || x > view.x1 + f.r || y < view.y0 - f.r || y > view.y1 + f.r) continue;
      const g = ctx.createRadialGradient(x, y, 0, x, y, f.r);
      g.addColorStop(0, `rgba(${style.colors[0]}, 0.022)`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - f.r, y - f.r, f.r * 2, f.r * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < this.activeMotes; i++) {
      const m = this.motes[i];
      const cycle = (t * Math.abs(style.riseSpeed) + m.phase * 47) % 240;
      const y = m.y - (style.riseSpeed >= 0 ? cycle : -cycle);
      const x = m.x + Math.sin(t * 0.5 + m.phase) * style.wobble;
      if (x < view.x0 - 20 || x > view.x1 + 20 || y < view.y0 - 20 || y > view.y1 + 20) continue;
      const life = cycle / 240; // fade in, drift, fade out
      const alpha = Math.sin(life * Math.PI) * 0.32;
      ctx.beginPath();
      ctx.arc(x, y, m.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${m.violet ? style.colors[1] : style.colors[0]}, ${alpha})`;
      ctx.fill();
    }
    ctx.restore();
    if (this.styleKey !== 'overworld') return; // bats fly only on the surface

    // Bat flock: schedule a crossing every so often.
    if (this.batNextAt === 0) this.batNextAt = now + 4000 + this.rand() * 10000;
    if (now >= this.batNextAt && this.batStart === 0) {
      const ltr = this.rand() < 0.5;
      this.batFrom = {
        x: ltr ? -150 : this.map.worldW + 150,
        y: 150 + this.rand() * (this.map.worldH - 300),
      };
      this.batTo = {
        x: ltr ? this.map.worldW + 150 : -150,
        y: 150 + this.rand() * (this.map.worldH - 300),
      };
      this.batStart = now;
      this.batDur = 9000 + this.rand() * 6000;
    }
    if (this.batStart > 0) {
      const ft = (now - this.batStart) / this.batDur;
      if (ft >= 1) {
        this.batStart = 0;
        this.batNextAt = now + 8000 + this.rand() * 20000;
      } else {
        const cx = this.batFrom.x + (this.batTo.x - this.batFrom.x) * ft;
        const cy =
          this.batFrom.y + (this.batTo.y - this.batFrom.y) * ft + Math.sin(ft * Math.PI * 3) * 40;
        for (let i = 0; i < 4; i++) {
          const bx = cx - i * 26 * Math.sign(this.batTo.x - this.batFrom.x) + Math.sin(t * 2 + i) * 8;
          const by = cy + Math.sin(t * 3 + i * 1.7) * 12 - i * 6;
          this.drawBat(ctx, bx, by, now * 0.02 + i);
        }
      }
    }
  }

  private drawBat(ctx: CanvasRenderingContext2D, x: number, y: number, flapT: number): void {
    const flap = Math.sin(flapT) * 5;
    ctx.save();
    ctx.strokeStyle = 'rgba(30, 22, 36, 0.85)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - 9, y - flap);
    ctx.quadraticCurveTo(x - 4, y + 3, x, y);
    ctx.quadraticCurveTo(x + 4, y + 3, x + 9, y - flap);
    ctx.stroke();
    ctx.restore();
  }
}
