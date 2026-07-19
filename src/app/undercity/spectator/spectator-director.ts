/**
 * SpectatorDirector — the "broadcast producer" for the /tv view.
 *
 * Pure, framework-free scene sequencer. It holds the latest public game state
 * and, each time the current scene's hold elapses, decides what the camera and
 * overlays should show next: a slow flyover, a player hero card, the renown
 * leaderboard, an action hotspot, or the boss check. Recent events jump the
 * queue so a fresh evolve / win / boss-hit pulls that player on screen.
 *
 * The component (spectator.component.ts) owns the timer and the actual canvas
 * camera; it asks the director for the next Scene and applies it. Keeping the
 * logic here (no Angular, no canvas) makes the rotation unit-testable.
 */
import { GameEvent, PublicPlayer, Season } from '../services/undercity-models';
import { QueueEntry } from '../../services/queue-models';

export type SceneKind =
  | 'attract'
  | 'flyover'
  | 'hero'
  | 'leaderboard'
  | 'hotspot'
  | 'boss'
  | 'queue';

export interface Scene {
  kind: SceneKind;
  /** Node to center the camera on (undefined = leave the camera where it is). */
  focusNodeId?: string;
  /** Camera zoom for this scene (higher = closer). */
  zoom?: number;
  /** Glide duration to the focus, in ms (flyovers glide slowly). */
  glideMs?: number;
  /** The featured player, for hero / hotspot beats. */
  player?: PublicPlayer;
  /** How long to hold this scene before advancing, in ms. */
  holdMs: number;
}

export interface SpectatorMapInfo {
  gate: string;
  boss?: string | null;
  /** Overworld node ids to tour during flyovers (roughly one per region). */
  flyoverAnchors: string[];
}

export interface SpectatorState {
  players: PublicPlayer[];
  events: GameEvent[];
  season: Season | null;
  /** Tonight's board-game queue (lobby + active tables); [] when nothing queued. */
  queue?: QueueEntry[];
}

// Scene hold durations (ms) and camera zooms — tuned for a glanceable TV loop.
export const HOLD = {
  attract: 12_000,
  flyover: 15_000,
  hero: 10_000,
  leaderboard: 12_000,
  hotspot: 10_000,
  boss: 10_000,
  queue: 13_000,
} as const;

export const ZOOM = {
  flyover: 0.5,
  hero: 1.6,
  hotspot: 1.1,
  boss: 1.25,
} as const;

// Glide (camera travel) durations, ms. Deliberately long and slow — the camera
// should drift like a lazy broadcast cam, never snap. Each is shorter than its
// scene hold so the move settles before the next cut.
export const GLIDE = {
  flyover: 9_000,
  hero: 4_000,
  leaderboard: 7_000,
  hotspot: 4_500,
  boss: 5_000,
} as const;

/** The rotation of scene "slots"; boss is skipped when the Queen sleeps. */
const BASE_ROTATION: SceneKind[] = [
  'flyover',
  'hero',
  'leaderboard',
  'queue',
  'hero',
  'hotspot',
  'boss',
];

/** Event types worth interrupting the rotation to celebrate. */
const HIGHLIGHT_EVENTS = new Set([
  'evolve',
  'pvp_win',
  'wild_win',
  'boss_hit',
  'boss_damage',
  'barrier',
  'champion',
]);

export class SpectatorDirector {
  private players: PublicPlayer[] = [];
  private events: GameEvent[] = [];
  private season: Season | null = null;
  private queue: QueueEntry[] = [];

  private slot = -1; // index into BASE_ROTATION
  private heroIdx = 0; // round-robin over players for hero beats
  private flyIdx = 0; // round-robin over flyover anchors
  private lastEventKey: string | null = null;
  private pendingActor: PublicPlayer | null = null;
  private scene: Scene = { kind: 'attract', holdMs: HOLD.attract };

  constructor(private map: SpectatorMapInfo) {}

  /** Feed the latest poll. Detects new highlight events to jump the queue. */
  update(state: SpectatorState): void {
    this.players = state.players ?? [];
    this.events = state.events ?? [];
    this.season = state.season ?? null;
    this.queue = state.queue ?? [];
    this.detectNewHighlight();
  }

  current(): Scene {
    return this.scene;
  }

  /** Advance to the next scene and return it. */
  advance(): Scene {
    this.scene = this.computeNext();
    return this.scene;
  }

  private get isLive(): boolean {
    return this.season?.status === 'active' && this.players.length > 0;
  }

  private detectNewHighlight(): void {
    // The newest event sits at the end of the feed (chronological); find the
    // latest highlight and, if we haven't shown it yet, queue its actor.
    for (let i = this.events.length - 1; i >= 0; i--) {
      const ev = this.events[i];
      if (!HIGHLIGHT_EVENTS.has(ev.type)) continue;
      const key = `${ev.ts}|${ev.type}|${ev.actor ?? ''}`;
      if (key === this.lastEventKey) return; // already seen the freshest one
      this.lastEventKey = key;
      const actor = this.findPlayer(ev.actor);
      if (actor) this.pendingActor = actor;
      return;
    }
  }

  private findPlayer(ref?: string): PublicPlayer | null {
    if (!ref) return null;
    return (
      this.players.find((p) => p.userId === ref || p.username === ref) ?? null
    );
  }

  private computeNext(): Scene {
    if (!this.isLive) {
      this.slot = -1;
      return { kind: 'attract', holdMs: HOLD.attract };
    }

    // A fresh highlight interrupts the rotation with that player's hero card.
    if (this.pendingActor) {
      const p = this.pendingActor;
      this.pendingActor = null;
      return this.heroScene(p);
    }

    // Walk the base rotation, skipping the boss slot until the Queen wakes.
    for (let guard = 0; guard < BASE_ROTATION.length; guard++) {
      this.slot = (this.slot + 1) % BASE_ROTATION.length;
      const kind = BASE_ROTATION[this.slot];
      if (kind === 'boss' && !this.season?.bossPhase) continue;
      if (kind === 'queue' && this.queue.length === 0) continue; // nothing to show
      return this.sceneFor(kind);
    }
    // Rotation was entirely skippable (only a sleeping boss slot) — flyover.
    return this.flyoverScene();
  }

  private sceneFor(kind: SceneKind): Scene {
    switch (kind) {
      case 'hero':
        return this.heroScene(this.nextHeroPlayer());
      case 'leaderboard':
        return {
          kind: 'leaderboard',
          focusNodeId: this.nextAnchor(),
          zoom: ZOOM.flyover,
          glideMs: GLIDE.leaderboard,
          holdMs: HOLD.leaderboard,
        };
      case 'hotspot':
        return this.hotspotScene();
      case 'queue':
        return {
          kind: 'queue',
          focusNodeId: this.nextAnchor(),
          zoom: ZOOM.flyover,
          glideMs: GLIDE.flyover,
          holdMs: HOLD.queue,
        };
      case 'boss':
        return {
          kind: 'boss',
          focusNodeId: this.map.boss ?? this.map.gate,
          zoom: ZOOM.boss,
          glideMs: GLIDE.boss,
          holdMs: HOLD.boss,
        };
      case 'flyover':
      default:
        return this.flyoverScene();
    }
  }

  private flyoverScene(): Scene {
    return {
      kind: 'flyover',
      focusNodeId: this.nextAnchor(),
      zoom: ZOOM.flyover,
      glideMs: GLIDE.flyover,
      holdMs: HOLD.flyover,
    };
  }

  private heroScene(p: PublicPlayer): Scene {
    return {
      kind: 'hero',
      focusNodeId: p.position,
      zoom: ZOOM.hero,
      glideMs: GLIDE.hero,
      player: p,
      holdMs: HOLD.hero,
    };
  }

  private hotspotScene(): Scene {
    // No specific event pending — spotlight the current renown leader's tile.
    const leader = [...this.players].sort((a, b) => b.renown - a.renown)[0];
    return {
      kind: 'hotspot',
      focusNodeId: leader?.position ?? this.map.gate,
      zoom: ZOOM.hotspot,
      glideMs: GLIDE.hotspot,
      player: leader,
      holdMs: HOLD.hotspot,
    };
  }

  private nextHeroPlayer(): PublicPlayer {
    const p = this.players[this.heroIdx % this.players.length];
    this.heroIdx = (this.heroIdx + 1) % Math.max(1, this.players.length);
    return p;
  }

  private nextAnchor(): string {
    const anchors = this.map.flyoverAnchors.length ? this.map.flyoverAnchors : [this.map.gate];
    const id = anchors[this.flyIdx % anchors.length];
    this.flyIdx = (this.flyIdx + 1) % anchors.length;
    return id;
  }
}
