import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { UndercityStateService } from '../services/undercity-state.service';
import { PlazaCanvas, PlazaCreature } from '../engine/plaza-canvas';
import { PublicPlayer, evolveGlowActive, isShielded } from '../services/undercity-models';
import { GEAR_MAP, tierRarity, nextRung, UPGRADE_COST, SALVAGE_YIELD, GearInfo } from '../data/items';

interface UpgradeRow {
  where: 'equipped' | 'stash';
  slot?: string;
  index?: number;
  from: GearInfo;
  to: GearInfo;
  cost: { spores: number; moltings: number; ichor: number };
}

const GEAR_SELL_BACK = 0.5; // mirrors undercity_data.GEAR_SELL_BACK

@Component({
  selector: 'app-undercity-plaza-tab',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  templateUrl: './plaza-tab.component.html',
  styleUrls: ['./plaza-tab.component.scss'],
})
export class PlazaTabComponent implements AfterViewInit, OnDestroy {
  @ViewChild('plazaCanvas') canvasRef!: ElementRef<HTMLCanvasElement>;

  protected readonly store = inject(UndercityStateService);
  private plaza: PlazaCanvas | null = null;

  protected readonly selected = signal<PlazaCreature | null>(null);
  protected readonly busy = signal(false);
  protected readonly toast = signal<string | null>(null);

  // ── Forge buildings (Salvage Yard · Blacksmith) ──────────────────────────
  protected readonly gearMap = GEAR_MAP;
  protected readonly tierRarity = tierRarity;
  protected readonly building = signal<'salvage' | 'blacksmith' | null>(null);

  protected readonly materials = computed(
    () => this.store.you()?.materials ?? { moltings: 0, ichor: 0 },
  );

  protected readonly stashRows = computed(() =>
    (this.store.you()?.gearStash ?? [])
      .map((id, index) => ({ index, info: GEAR_MAP[id] }))
      .filter((r) => !!r.info),
  );

  protected readonly upgradeRows = computed<UpgradeRow[]>(() => {
    const you = this.store.you();
    if (!you) return [];
    const rows: UpgradeRow[] = [];
    for (const slot of ['fang', 'carapace', 'charm']) {
      const id = you.gear?.[slot];
      const nxt = id ? nextRung(id) : null;
      if (id && nxt) {
        rows.push({ where: 'equipped', slot, from: GEAR_MAP[id], to: GEAR_MAP[nxt],
                    cost: UPGRADE_COST[GEAR_MAP[nxt].tier] });
      }
    }
    (you.gearStash ?? []).forEach((id, index) => {
      const nxt = nextRung(id);
      if (nxt) {
        rows.push({ where: 'stash', index, from: GEAR_MAP[id], to: GEAR_MAP[nxt],
                    cost: UPGRADE_COST[GEAR_MAP[nxt].tier] });
      }
    });
    return rows;
  });

  protected salvageYield(tier: number): { moltings: number; ichor: number } {
    return SALVAGE_YIELD[tier] ?? { moltings: 0, ichor: 0 };
  }
  protected sellSpores(info: GearInfo): number {
    return Math.floor(info.cost * GEAR_SELL_BACK);
  }
  protected canAfford(cost: { spores: number; moltings: number; ichor: number }): boolean {
    const you = this.store.you();
    const m = this.materials();
    return !!you && you.spores >= cost.spores && m.moltings >= cost.moltings && m.ichor >= cost.ichor;
  }

  protected openBuilding(b: 'salvage' | 'blacksmith'): void {
    this.building.set(b);
  }
  protected closeBuilding(): void {
    this.building.set(null);
  }

  async salvage(index: number, mode: 'grind' | 'sell'): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const resp = await this.store.action('salvage-gear', { index, mode });
      this.showToast(resp.text ?? 'Salvaged.');
    } catch (e) {
      this.showToast(e instanceof Error ? e.message : 'Salvage failed');
    } finally {
      this.busy.set(false);
    }
  }

  async equip(index: number): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const resp = await this.store.action('equip-gear', { index });
      this.showToast(resp.text ?? 'Equipped.');
    } catch (e) {
      this.showToast(e instanceof Error ? e.message : 'Equip failed');
    } finally {
      this.busy.set(false);
    }
  }

  async upgrade(row: UpgradeRow): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const target =
        row.where === 'equipped'
          ? { where: 'equipped', slot: row.slot }
          : { where: 'stash', index: row.index };
      const resp = await this.store.action('upgrade-gear', { target });
      this.showToast(resp.text ?? 'Forged!');
    } catch (e) {
      this.showToast(e instanceof Error ? e.message : 'Upgrade failed');
    } finally {
      this.busy.set(false);
    }
  }

  constructor() {
    effect(() => {
      const players = this.store.players();
      if (!this.plaza) return;
      this.plaza.updatePartners(players.map((p) => this.toCreature(p)));
    });
    effect(() => {
      const diff = this.store.rosterDiff();
      if (!this.plaza) return;
      for (const id of diff.departed) this.plaza.fadeOutDino(id);
      for (const id of diff.arrived) this.plaza.dropInDino(id);
      for (const id of diff.restyled) this.plaza.boingDino(id);
    });
  }

  private toCreature(p: PublicPlayer): PlazaCreature {
    return {
      userId: p.userId,
      username: p.username,
      form: p.form,
      formName: p.formName,
      creatureName: p.creatureName,
      level: p.level,
      paint: p.paint ?? {},
      hat: p.hat,
      shielded: isShielded(p),
      evolveGlow: evolveGlowActive(p as { evolvedAt?: string }),
    };
  }

  ngAfterViewInit(): void {
    this.plaza = new PlazaCanvas(
      this.canvasRef.nativeElement,
      this.store.players().map((p) => this.toCreature(p)),
      (creature) => this.selected.set(creature),
      this.store.ownUserId,
    );
    this.plaza.start();
  }

  ngOnDestroy(): void {
    this.plaza?.stop();
    this.plaza = null;
  }

  async poke(): Promise<void> {
    const target = this.selected();
    if (!target || this.busy()) return;
    this.busy.set(true);
    try {
      const resp = await this.store.action('poke', { targetUserId: target.userId });
      this.plaza?.boingDino(target.userId);
      this.showToast(
        resp.granted
          ? `You poked ${target.username} — they gained a roll!`
          : `You poked ${target.username}.`,
      );
      this.selected.set(null);
    } catch (e) {
      this.showToast(e instanceof Error ? e.message : 'Poke failed');
    } finally {
      this.busy.set(false);
    }
  }

  private showToast(text: string): void {
    this.toast.set(text);
    setTimeout(() => {
      if (this.toast() === text) this.toast.set(null);
    }, 3000);
  }
}
