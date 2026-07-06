import {
  AfterViewInit,
  Component,
  ElementRef,
  Input,
  OnDestroy,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { UndercityStateService } from '../services/undercity-state.service';
import { BoardCanvas, BoardMap } from '../engine/board-canvas';
import {
  BattleResult,
  Occupant,
  SpaceEvent,
  isShielded,
} from '../services/undercity-models';
import { GEAR, CONSUMABLES, SPACE_NAMES, GearInfo, ConsumableInfo } from '../data/items';
import { formName } from '../data/forms';
import { formSprite } from '../data/species';
import { getRecoloredDataUrl } from '../engine/sprite-engine';
import { BattlePlaybackComponent, BattleSide } from './battle-playback.component';

const NPC_EMOJI: Record<string, string> = {
  drudge_beetle: '🪲',
  sewer_shambler: '🧟',
  fetid_imp: '👿',
  rot_shambler: '🧌',
};

interface BattleView {
  battle: BattleResult;
  attacker: BattleSide;
  defender: BattleSide;
  resultText: string;
}

@Component({
  selector: 'app-undercity-board-tab',
  standalone: true,
  imports: [CommonModule, BattlePlaybackComponent],
  templateUrl: './board-tab.component.html',
  styleUrls: ['./board-tab.component.scss'],
})
export class BoardTabComponent implements AfterViewInit, OnDestroy {
  @Input({ required: true }) map!: BoardMap;
  @ViewChild('boardCanvas') canvasRef!: ElementRef<HTMLCanvasElement>;

  protected readonly store = inject(UndercityStateService);
  private board: BoardCanvas | null = null;

  protected readonly busy = signal(false);
  protected readonly toast = signal<string | null>(null);
  protected readonly spaceModal = signal<SpaceEvent | null>(null);
  protected readonly occupants = signal<Occupant[]>([]);
  protected readonly battleView = signal<BattleView | null>(null);
  protected readonly showShop = signal(false);
  protected readonly showShrine = signal(false);
  protected readonly showWarp = signal<string[] | null>(null);
  protected readonly showOssuary = signal(false);
  protected readonly bet = signal(5);
  protected readonly gambleResult = signal<string | null>(null);

  protected readonly gear = GEAR;
  protected readonly consumables = CONSUMABLES;
  protected readonly isShielded = isShielded;

  spaceName(type: string): string {
    return SPACE_NAMES[type] ?? 'The Undercity';
  }

  protected readonly nodeType = computed(() => {
    const pos = this.store.you()?.position;
    return this.map?.nodes.find((n) => n.id === pos)?.type ?? null;
  });

  protected readonly shopTier = computed(() => {
    const pos = this.store.you()?.position ?? '';
    return (this.map as BoardMap & { shopTiers?: Record<string, number> })?.shopTiers?.[pos] ?? 1;
  });

  protected readonly occupantsHere = computed<Occupant[]>(() => {
    const you = this.store.you();
    if (!you) return [];
    return this.store
      .players()
      .filter((p) => p.userId !== you.userId && p.position === you.position)
      .map((p) => ({
        userId: p.userId,
        username: p.username,
        formName: p.formName,
        level: p.level,
        shielded: isShielded(p),
        stance: p.stance,
      }));
  });

  constructor() {
    // Keep the canvas in sync with the polled store.
    effect(() => {
      const players = this.store.players();
      const you = this.store.you();
      if (!this.board) return;
      this.board.setPlayers(
        players.map((p) => ({
          userId: p.userId,
          username: p.username,
          form: p.form,
          level: p.level,
          paint: p.paint ?? {},
          position: p.position,
          shielded: isShielded(p),
        })),
      );
      this.board.setSnares(this.store.snares());
      this.board.setChoices(you?.pendingMove?.dests ?? null);
    });
  }

  ngAfterViewInit(): void {
    this.board = new BoardCanvas(
      this.canvasRef.nativeElement,
      this.map,
      (nodeId) => this.onTapNode(nodeId),
      this.store.ownUserId,
    );
    this.board.setSnares(this.store.snares());
    this.board.setPlayers(
      this.store.players().map((p) => ({
        userId: p.userId,
        username: p.username,
        form: p.form,
        level: p.level,
        paint: p.paint ?? {},
        position: p.position,
        shielded: isShielded(p),
      })),
    );
    this.board.setChoices(this.store.you()?.pendingMove?.dests ?? null);
    this.board.start();
  }

  ngOnDestroy(): void {
    this.board?.stop();
    this.board = null;
  }

  // ── Roll & move ────────────────────────────────────────────────────────────

  async roll(): Promise<void> {
    await this.run(async () => {
      await this.store.action('roll');
    });
  }

  private onTapNode(nodeId: string): void {
    const pm = this.store.you()?.pendingMove;
    if (pm && pm.dests.includes(nodeId)) {
      void this.move(nodeId);
    }
  }

  private async move(to: string): Promise<void> {
    const preHp = this.store.you()?.hp ?? 0;
    await this.run(async () => {
      const resp = await this.store.action('move', { to });
      this.board?.setChoices(null);
      if (resp.you) this.board?.centerOn(resp.you.position);
      const ev = resp.spaceEvent;
      this.occupants.set(resp.occupants ?? []);
      if (!ev) return;
      if (ev.type === 'wild' && ev.battle && ev.npc) {
        this.battleView.set({
          battle: ev.battle,
          attacker: {
            name: this.youBattleName(),
            spriteUrl: this.youSpriteUrl(),
            startHp: preHp,
            maxHp: this.store.you()?.maxHp ?? preHp,
          },
          defender: {
            name: ev.npc.name,
            emoji: NPC_EMOJI[ev.npc.id] ?? '👿',
            startHp: ev.npc.hp,
            maxHp: ev.npc.hp,
          },
          resultText: ev.text,
        });
      } else if (ev.type === 'warp' && ev.options) {
        this.showWarp.set(ev.options);
      } else if (ev.type === 'shop') {
        this.showShop.set(true);
      } else if (ev.type === 'shrine') {
        this.showShrine.set(true);
      } else if (ev.type === 'ossuary') {
        this.showOssuary.set(true);
      } else {
        this.spaceModal.set(ev);
      }
    });
  }

  // ── PvP ────────────────────────────────────────────────────────────────────

  async attack(target: Occupant): Promise<void> {
    const preHp = this.store.you()?.hp ?? 0;
    const targetPublic = this.store.players().find((p) => p.userId === target.userId);
    await this.run(async () => {
      const resp = await this.store.action('battle', { targetUserId: target.userId });
      if (!resp.battle) return;
      this.battleView.set({
        battle: resp.battle,
        attacker: {
          name: this.youBattleName(),
          spriteUrl: this.youSpriteUrl(),
          startHp: preHp,
          maxHp: this.store.you()?.maxHp ?? preHp,
        },
        defender: {
          name: `${target.username}'s ${target.formName}`,
          spriteUrl: targetPublic
            ? this.spriteUrl(targetPublic.form, targetPublic.paint)
            : null,
          emoji: '🐌',
          startHp: targetPublic?.hp ?? 30,
          maxHp: targetPublic?.maxHp ?? 30,
        },
        resultText: resp.text ?? '',
      });
      this.occupants.set([]);
    });
  }

  // ── Node facilities ────────────────────────────────────────────────────────

  async buy(item: GearInfo | ConsumableInfo): Promise<void> {
    await this.run(async () => {
      const resp = await this.store.action('buy', { itemId: item.id });
      this.showToast(resp.text ?? 'Purchased.');
    });
  }

  async shrine(choice: string): Promise<void> {
    await this.run(async () => {
      const resp = await this.store.action('shrine', { choice });
      this.showToast(resp.text ?? 'The shrine hums.');
      this.showShrine.set(false);
    });
  }

  async warpTo(to: string): Promise<void> {
    await this.run(async () => {
      await this.store.action('warp', { to });
      this.showWarp.set(null);
      this.board?.centerOn(to);
    });
  }

  async gamble(call: 'high' | 'low'): Promise<void> {
    await this.run(async () => {
      const resp = await this.store.action('gamble', { bet: this.bet(), call });
      this.gambleResult.set(resp.text ?? null);
    });
  }

  adjustBet(delta: number): void {
    this.bet.set(Math.max(1, Math.min(20, this.bet() + delta)));
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  protected youSpriteUrl(): string | null {
    const you = this.store.you();
    return you ? this.spriteUrl(you.form, you.paint) : null;
  }

  protected spriteUrl(form: string, paint: Record<string, number>): string | null {
    const spr = formSprite(form);
    return getRecoloredDataUrl(spr.sprite, paint ?? {}, spr.regions);
  }

  private youBattleName(): string {
    const you = this.store.you();
    return you ? `Your ${formName(you.form)}` : 'You';
  }

  closeBattle(): void {
    this.battleView.set(null);
    void this.store.refresh();
  }

  closeSpaceModal(): void {
    this.spaceModal.set(null);
  }

  closeFacilities(): void {
    this.showShop.set(false);
    this.showShrine.set(false);
    this.showWarp.set(null);
    this.showOssuary.set(false);
    this.gambleResult.set(null);
  }

  protected async run(fn: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await fn();
    } catch (e) {
      this.showToast(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      this.busy.set(false);
    }
  }

  private showToast(text: string): void {
    this.toast.set(text);
    setTimeout(() => {
      if (this.toast() === text) this.toast.set(null);
    }, 3500);
  }
}
