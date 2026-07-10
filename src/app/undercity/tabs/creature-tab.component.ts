import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { UndercityStateService } from '../services/undercity-state.service';
import {
  FormInfo,
  PASSIVE_BLURBS,
  PASSIVE_NAMES,
  evolutionOptions,
  formName,
  xpToNext,
} from '../data/forms';
import { GEAR_MAP, CONSUMABLE_MAP } from '../data/items';
import {
  BIOME_SPELLS,
  GRIMOIRE_MAP,
  GRIMOIRES,
  GrimoireInfo,
  SPELL_MAP,
  SpellInfo,
  cooldownLeftMin,
} from '../data/spells';
import { HATS, PAINTS, HatInfo, PaintInfo } from '../data/cosmetics';
import { formSprite } from '../data/species';
import { getRecoloredDataUrl } from '../engine/sprite-engine';
import { isShielded } from '../services/undercity-models';

@Component({
  selector: 'app-undercity-creature-tab',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  templateUrl: './creature-tab.component.html',
  styleUrls: ['./creature-tab.component.scss'],
})
export class CreatureTabComponent {
  protected readonly store = inject(UndercityStateService);

  protected readonly busy = signal(false);
  protected readonly toast = signal<string | null>(null);
  protected readonly showEvolve = signal(false);
  protected readonly showWardrobe = signal(false);
  protected readonly loadedDiePick = signal(false);

  /** Which stat's description panel is open ('atk' | 'def' | 'spd' | null). */
  protected readonly openStat = signal<string | null>(null);

  /** Plain-language stat descriptions, matching the battle engine's math. */
  protected readonly statInfo: Record<string, { label: string; icon: string; desc: string }> = {
    atk: {
      label: 'Attack',
      icon: 'sports_mma',
      desc: "The muscle behind each strike. Higher ATK means more damage per hit — minus whatever the enemy's DEF soaks up.",
    },
    def: {
      label: 'Defense',
      icon: 'shield',
      desc: 'Armor against blows. Every point of DEF shaves damage off each hit you take. The Defend stance boosts it further.',
    },
    spd: {
      label: 'Speed',
      icon: 'bolt',
      desc: "Strike first when it beats your foe's Speed, and slip away more often when your stance is set to Flee.",
    },
  };

  selectStat(stat: string): void {
    this.openStat.update((cur) => (cur === stat ? null : stat));
  }

  protected readonly passiveBlurbs = PASSIVE_BLURBS;

  passiveName(p: string): string {
    return PASSIVE_NAMES[p] ?? p;
  }
  protected readonly gearMap = GEAR_MAP;
  protected readonly consumableMap = CONSUMABLE_MAP;
  protected readonly hats = HATS;
  protected readonly paints = PAINTS;
  protected readonly formName = formName;
  protected readonly isShielded = isShielded;
  protected readonly dieValues = [1, 2, 3, 4, 5, 6];

  protected readonly spriteUrl = computed(() => {
    const you = this.store.you();
    if (!you) return null;
    const spr = formSprite(you.form);
    return getRecoloredDataUrl(spr.sprite, you.paint ?? {}, spr.regions);
  });

  protected readonly xpNext = computed(() => {
    const you = this.store.you();
    return you ? xpToNext(you.level) : 0;
  });

  /** Troll Hide is the only gear that raises max HP (mirrors the HUD header). */
  protected readonly effectiveMaxHp = computed(() => {
    const you = this.store.you();
    if (!you) return 1;
    return you.maxHp + (you.gear?.['carapace'] === 'troll_hide' ? 6 : 0);
  });

  protected readonly hpPct = computed(() => {
    const you = this.store.you();
    if (!you) return 0;
    return Math.round((you.hp / Math.max(1, this.effectiveMaxHp())) * 100);
  });

  protected readonly xpPct = computed(() => {
    const you = this.store.you();
    if (!you) return 0;
    return Math.min(100, Math.round((you.xp / Math.max(1, this.xpNext())) * 100));
  });

  protected readonly evolveReady = computed(() => {
    const you = this.store.you();
    if (!you) return false;
    return (you.tier === 1 && you.level >= 5) || (you.tier === 2 && you.level >= 10);
  });

  protected readonly innateSpell = computed<SpellInfo | null>(() => {
    const biome = this.store.you()?.homeBiome;
    return biome ? (SPELL_MAP[BIOME_SPELLS[biome]] ?? null) : null;
  });

  protected readonly equippedBook = computed<GrimoireInfo | null>(() => {
    const id = this.store.you()?.equippedGrimoire;
    return id ? (GRIMOIRE_MAP[id] ?? null) : null;
  });

  protected readonly ownedBooks = computed<GrimoireInfo[]>(() => {
    const owned = new Set(this.store.you()?.grimoires ?? []);
    return GRIMOIRES.filter((g) => owned.has(g.id));
  });

  bookSpells(book: GrimoireInfo): SpellInfo[] {
    return book.spells.map((id) => SPELL_MAP[id]).filter(Boolean);
  }

  cooldownLabel(spellId: string): string {
    const left = cooldownLeftMin(this.store.you()?.spellCooldowns, spellId);
    return left > 0 ? `${left} min` : 'Ready';
  }

  async equipBook(id: string): Promise<void> {
    const already = this.store.you()?.equippedGrimoire === id;
    await this.run(async () => {
      const resp = await this.store.action('equip-grimoire', {
        grimoireId: already ? null : id,
      });
      this.showToast(resp.text ?? 'Done.');
    });
  }

  protected readonly evolveChoices = computed<FormInfo[]>(() => {
    const you = this.store.you();
    if (!you) return [];
    return evolutionOptions(you.tier, you.species, you.form);
  });

  protected readonly ownedHats = computed<HatInfo[]>(() => {
    const owned = new Set(this.store.wardrobe()?.hats ?? []);
    return HATS.filter((h) => owned.has(h.id));
  });

  protected readonly ownedPaints = computed<PaintInfo[]>(() => {
    const owned = new Set(this.store.wardrobe()?.paints ?? []);
    return PAINTS.filter((p) => owned.has(p.id));
  });

  formSpriteUrl(form: FormInfo): string | null {
    const you = this.store.you();
    const spr = formSprite(form.id);
    return getRecoloredDataUrl(spr.sprite, you?.paint ?? {}, spr.regions);
  }

  bonusText(form: FormInfo): string {
    if (!form.bonus) return '';
    return Object.entries(form.bonus)
      .map(([k, v]) => `+${v} ${k === 'maxHp' ? 'HP' : k.toUpperCase()}`)
      .join(', ');
  }

  async setStance(stance: string): Promise<void> {
    await this.run(() => this.store.action('set-stance', { stance }).then(() => undefined));
  }

  async spendStat(stat: string): Promise<void> {
    await this.run(() => this.store.action('spend-stat', { stat }).then(() => undefined));
  }

  async evolve(form: FormInfo): Promise<void> {
    await this.run(async () => {
      await this.store.action('evolve', { form: form.id });
      this.showEvolve.set(false);
      this.showToast(`You are now a ${form.name}! Fully healed.`);
    });
  }

  async useItem(item: string): Promise<void> {
    if (item === 'loaded_die') {
      this.loadedDiePick.set(true);
      return;
    }
    await this.run(async () => {
      const resp = await this.store.action('use-item', { item });
      this.showToast(resp.text ?? 'Used.');
    });
  }

  async useLoadedDie(value: number): Promise<void> {
    await this.run(async () => {
      const resp = await this.store.action('use-item', { item: 'loaded_die', value });
      this.loadedDiePick.set(false);
      this.showToast(resp.text ?? 'Loaded.');
    });
  }

  async setHat(hat: string | null): Promise<void> {
    await this.run(() => this.store.action('customize', { hat: hat ?? '' }).then(() => undefined));
  }

  async setPaint(region: 'body' | 'belly' | 'stripes', paint: PaintInfo): Promise<void> {
    const you = this.store.you();
    if (!you) return;
    const next = { ...you.paint, [region]: paint.hue };
    await this.run(() => this.store.action('customize', { paint: next, hat: you.hat ?? '' }).then(() => undefined));
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
