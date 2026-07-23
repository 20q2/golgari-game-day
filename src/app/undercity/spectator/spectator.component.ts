import {
  AfterViewInit,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  OnInit,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import * as QRCode from 'qrcode';

import { UndercityStateService } from '../services/undercity-state.service';
import { QueueService } from '../../services/queue.service';
import { QueueEntry } from '../../services/queue-models';
import { PublicPlayer, isShielded } from '../services/undercity-models';
import { BoardCanvas, BoardMap, BoardNode } from '../engine/board-canvas';
import { preloadAll, getRecoloredWithHatDataUrl } from '../engine/sprite-engine';
import { formSprite } from '../data/species';
import { GEAR } from '../data/items';
import { Scene, SpectatorDirector, SpectatorMapInfo } from './spectator-director';

const GEAR_BY_ID = new Map(GEAR.map((g) => [g.id, g]));

/**
 * /tv — a self-running spectator broadcast of the live Undercity game.
 *
 * Read-only: it polls the public game state (no player identity) and drives
 * the board canvas like a sports cam — flyovers, player hero cards, the renown
 * leaderboard, action hotspots, and the boss check — while a QR code stays
 * pinned in the corner to pull new players in. All sequencing lives in the
 * framework-free SpectatorDirector; this component owns the timer, the canvas,
 * and the overlays.
 */
@Component({
  selector: 'app-undercity-spectator',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  templateUrl: './spectator.component.html',
  styleUrls: ['./spectator.component.scss'],
})
export class SpectatorComponent implements OnInit, AfterViewInit, OnDestroy {
  protected readonly store = inject(UndercityStateService);
  protected readonly queue = inject(QueueService);
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly zone = inject(NgZone);

  @ViewChild('boardCanvas', { static: true }) boardRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('qrCanvas', { static: true }) qrRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('qrCanvasBig', { static: true }) qrBigRef!: ElementRef<HTMLCanvasElement>;

  private readonly map = signal<BoardMap | null>(null);
  private readonly assetsReady = signal(false);
  private readonly viewReady = signal(false);
  protected readonly scene = signal<Scene>({ kind: 'attract', holdMs: 0 });
  /** Drives the between-scenes wipe + label; recreated on each cut. */
  protected readonly transition = signal<{ label: string; icon: string } | null>(null);
  /** Operator chrome (the Exit button) — hidden until the mouse moves. */
  protected readonly controlsVisible = signal(false);
  private controlsTimer: ReturnType<typeof setTimeout> | null = null;

  private board: BoardCanvas | null = null;
  private director: SpectatorDirector | null = null;
  private sceneTimer: ReturnType<typeof setTimeout> | null = null;
  private transitionTimer: ReturnType<typeof setTimeout> | null = null;

  /** QR points at the Undercity entrance so onlookers can scan and descend. */
  protected readonly joinUrl = window.location.origin + '/golgari-game-day/undercity';

  /** Top players by renown — the leaderboard rail + spotlight read from this. */
  protected readonly leaderboard = computed(() =>
    [...this.store.players()].sort((a, b) => b.renown - a.renown),
  );

  constructor() {
    // Build the board + director the moment the canvas, map, and sprite atlas
    // are all ready, then start the show.
    effect(() => {
      if (this.board || !this.viewReady() || !this.assetsReady()) return;
      const map = this.map();
      if (!map) return;
      this.initBroadcast(map);
    });

    // Every poll feeds the director the fresh roster/events so it can react
    // (and jump the queue for a highlight) on the next scene change.
    effect(() => {
      const state = this.store.state();
      const entries = this.queue.entries();
      if (!this.director || !state) return;
      this.director.update({
        players: this.store.players(),
        events: this.store.events(),
        season: this.store.season(),
        queue: entries,
      });
      // If the game just went live (or just ended) while we're on the wrong
      // kind of screen, cut over now instead of waiting out the current hold.
      const live = this.store.season()?.status === 'active' && this.store.players().length > 0;
      const onAttract = this.scene().kind === 'attract';
      if (live === onAttract) this.restartLoop();
    });

    // Keep the canvas roster in sync each poll. Read the signals FIRST so they
    // are always tracked as dependencies — otherwise an early `!this.board`
    // return (before the board exists) would deregister them and the effect
    // would never re-run once the board mounts, leaving the map empty of tokens.
    effect(() => {
      const players = this.store.players();
      const snares = this.store.snares();
      const barriers = this.store.barriersOpen();
      const guardians = this.store.guardians();
      this.syncRoster(players, snares, barriers, guardians);
    });

    // Badge the board tokens of anyone seated at an active board-game table.
    // Read the signal FIRST so the dependency is tracked even before the board
    // exists (mirrors the roster effect's ordering).
    effect(() => {
      const ids = this.activeGameUserIds();
      if (!this.board) return;
      this.board.setDiceMarkers(ids);
    });
  }

  /** User ids currently seated at a game whose status is 'active'. */
  protected readonly activeGameUserIds = computed(() => {
    const ids = new Set<string>();
    for (const e of this.queue.entries()) {
      if (e.status !== 'active') continue;
      for (const m of e.joined) ids.add(m.userId);
    }
    return [...ids];
  });

  private syncRoster(
    players: PublicPlayer[],
    snares: string[],
    barriers: string[],
    guardians: Record<string, { hp: number; maxHp: number }>,
  ): void {
    if (!this.board) return;
    this.board.setPlayers(
      players.map((p) => ({
        userId: p.userId,
        username: p.username,
        form: p.form,
        spriteVariant: p.spriteVariant,
        level: p.level,
        paint: p.paint ?? {},
        position: p.position,
        shielded: isShielded(p),
        hat: p.hat,
      })),
    );
    this.board.setSnares(snares);
    this.board.setBarriersOpen(barriers);
    this.board.setGuardianPools(guardians);
  }

  ngOnInit(): void {
    void preloadAll().then(() => this.assetsReady.set(true));
    void firstValueFrom(this.http.get<BoardMap>('data/undercity-map.json')).then((m) =>
      this.map.set(m),
    );
    this.store.startPolling();
    this.queue.startPolling();
  }

  ngAfterViewInit(): void {
    for (const el of [this.qrRef.nativeElement, this.qrBigRef.nativeElement]) {
      QRCode.toCanvas(el, this.joinUrl, { width: 320, margin: 1 }).catch((err: unknown) =>
        console.error('QR render failed:', err),
      );
    }
    this.viewReady.set(true);
  }

  ngOnDestroy(): void {
    this.store.stopPolling();
    this.queue.stopPolling();
    if (this.sceneTimer) clearTimeout(this.sceneTimer);
    if (this.transitionTimer) clearTimeout(this.transitionTimer);
    if (this.controlsTimer) clearTimeout(this.controlsTimer);
    this.board?.stop();
  }

  /** Leave the broadcast (operator affordance — a TV usually just stays on). */
  protected exit(): void {
    void this.router.navigate(['/undercity']);
  }

  /** Reveal the Exit button on mouse movement; fade it back out when idle. */
  protected onActivity(): void {
    this.controlsVisible.set(true);
    if (this.controlsTimer) clearTimeout(this.controlsTimer);
    this.controlsTimer = setTimeout(() => this.controlsVisible.set(false), 3000);
  }

  private initBroadcast(map: BoardMap): void {
    this.board = new BoardCanvas(this.boardRef.nativeElement, map, () => {}, null, {
      interactive: false,
    });
    // Run the render loop OUTSIDE Angular. Zone.js patches requestAnimationFrame,
    // so a loop scheduled inside the zone would trigger full change detection
    // every frame — the source of the spectator camera's jitter. rAF re-schedules
    // itself from within this callback, so the whole loop stays zone-free.
    this.zone.runOutsideAngular(() => this.board!.start());
    // Populate tokens immediately — the roster effect won't re-fire just because
    // the board went non-null (it isn't a signal), so seed it here.
    this.syncRoster(
      this.store.players(),
      this.store.snares(),
      this.store.barriersOpen(),
      this.store.guardians(),
    );
    this.board.setDiceMarkers(this.activeGameUserIds());
    this.director = new SpectatorDirector(this.toMapInfo(map));
    this.director.update({
      players: this.store.players(),
      events: this.store.events(),
      season: this.store.season(),
      queue: this.queue.entries(),
    });
    this.runNextScene();
  }

  /** Cancel the pending scene and advance immediately (live/ended flips). */
  private restartLoop(): void {
    if (this.sceneTimer) clearTimeout(this.sceneTimer);
    this.runNextScene();
  }

  /** Self-scheduling loop: advance the director, cut to it, wait its hold. */
  private runNextScene(): void {
    if (!this.director) return;
    const scene = this.director.advance();
    this.scene.set(scene);
    this.cutTo(scene);
    this.sceneTimer = setTimeout(() => this.runNextScene(), Math.max(2000, scene.holdMs));
  }

  /** A scene cut: play the wipe/label, swap layer under it, start the glide. */
  private cutTo(scene: Scene): void {
    if (scene.kind !== 'attract') {
      // Recreate the transition element so its wipe animation replays each cut.
      this.transition.set(null);
      this.transitionTimer = setTimeout(() => {
        this.transition.set(this.transitionFor(scene));
        this.transitionTimer = setTimeout(() => this.transition.set(null), 2200);
      }, 40);
    }
    if (this.board && scene.focusNodeId) {
      this.board.showLayerOf(scene.focusNodeId);
      this.board.focusOn(scene.focusNodeId, scene.zoom, true, scene.glideMs);
    }
  }

  private transitionFor(scene: Scene): { label: string; icon: string } {
    switch (scene.kind) {
      case 'hero':
        return { label: scene.player ? this.creatureTitle(scene.player) : 'Contender', icon: 'person' };
      case 'leaderboard':
        return { label: 'Renown Standings', icon: 'leaderboard' };
      case 'hotspot':
        return { label: scene.player?.username ?? 'Action', icon: 'my_location' };
      case 'boss':
        return { label: 'Savra Stirs', icon: 'emoji_events' };
      case 'queue':
        return { label: 'Tonight at the Table', icon: 'casino' };
      case 'flyover':
      default:
        return { label: 'The Undercity', icon: 'travel_explore' };
    }
  }

  private toMapInfo(map: BoardMap): SpectatorMapInfo {
    return {
      gate: map.gate,
      boss: map.boss,
      flyoverAnchors: this.overworldAnchors(map),
    };
  }

  /** One representative overworld node per region (nearest its centroid). */
  private overworldAnchors(map: BoardMap): string[] {
    const byRegion = new Map<string, BoardNode[]>();
    for (const n of map.nodes) {
      const region = n.region ?? '';
      if (map.regions?.[region]?.dark) continue; // dungeon pockets aren't toured
      const list = byRegion.get(region) ?? [];
      list.push(n);
      byRegion.set(region, list);
    }
    const anchors: string[] = [];
    for (const nodes of byRegion.values()) {
      const cx = nodes.reduce((s, n) => s + n.x, 0) / nodes.length;
      const cy = nodes.reduce((s, n) => s + n.y, 0) / nodes.length;
      let best = nodes[0];
      let bestD = Infinity;
      for (const n of nodes) {
        const d = (n.x - cx) ** 2 + (n.y - cy) ** 2;
        if (d < bestD) {
          bestD = d;
          best = n;
        }
      }
      anchors.push(best.id);
    }
    return anchors.length ? anchors : [map.gate];
  }

  // ── Template helpers ────────────────────────────────────────────────────────

  /** True when the compact renown rail should sit on the right edge. */
  protected showRail(): boolean {
    return this.scene().kind === 'hotspot' || this.scene().kind === 'boss';
  }

  /** True when the persistent lobby pin should occupy the top-right corner.
   *  Yields to the renown rail on hotspot/boss scenes (same anchor), and
   *  hides entirely when nothing is gathering players. */
  protected showLobbyPin(): boolean {
    return this.lobbyGames().length > 0 && !this.showRail();
  }

  /** Queued games currently being played at a table. */
  protected activeGames(): QueueEntry[] {
    return this.queue.entries().filter((e) => e.status === 'active');
  }

  /** Queued games still gathering players. */
  protected lobbyGames(): QueueEntry[] {
    return this.queue.entries().filter((e) => e.status === 'lobby');
  }

  /** Comma-joined player names for a queue entry (fallbacks to the count). */
  protected rosterNames(e: QueueEntry): string {
    return e.joined.map((m) => m.username || 'Player').join(', ');
  }

  /** Recolored-portrait cache: toDataURL() is costly, and the template asks for
   *  the same form+paint on every change-detection pass. Key by form + paint. */
  private readonly portraitCache = new Map<string, string | null>();

  protected portrait(p: PublicPlayer): string | null {
    const key = `${p.form}|${p.spriteVariant ?? ''}|${JSON.stringify(p.paint ?? {})}|${p.hat ?? ''}`;
    const hit = this.portraitCache.get(key);
    if (hit !== undefined) return hit;
    const spr = formSprite(p.form, p.spriteVariant);
    const url = getRecoloredWithHatDataUrl(spr.sprite, p.paint ?? {}, spr.regions, p.hat);
    this.portraitCache.set(key, url);
    return url;
  }

  protected creatureTitle(p: PublicPlayer): string {
    return p.creatureName && p.creatureName !== p.formName
      ? `${p.creatureName} the ${p.formName}`
      : p.formName;
  }

  protected raceLabel(p: PublicPlayer): string {
    return p.species ? p.species.charAt(0).toUpperCase() + p.species.slice(1) : '';
  }

  protected hpPct(p: PublicPlayer): number {
    return Math.max(0, Math.min(100, Math.round((p.hp / Math.max(1, p.maxHp)) * 100)));
  }

  /** Equipped gear as display rows (slot + item name), empty slots skipped. */
  protected gearRows(p: PublicPlayer): { slot: string; name: string }[] {
    const gear = p.gear ?? {};
    return Object.entries(gear)
      .filter(([, id]) => GEAR_BY_ID.has(id))
      .map(([slot, id]) => ({ slot, name: GEAR_BY_ID.get(id)!.name }));
  }
}
