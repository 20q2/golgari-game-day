import { Component, computed, effect, inject, signal } from '@angular/core';
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
import { GEAR_MAP, CONSUMABLE_MAP, tierRarity } from '../data/items';
import {
  BIOME_SPELLS,
  GRIMOIRE_MAP,
  GRIMOIRES,
  GrimoireInfo,
  SPELL_MAP,
  SpellInfo,
  cooldownLeftMin,
  grimoireSwapLeftMin,
} from '../data/spells';
import { HATS, PAINTS, HatInfo, PaintInfo } from '../data/cosmetics';
import { formSprite } from '../data/species';
import { getRecoloredDataUrl, getRecoloredWithHatDataUrl } from '../engine/sprite-engine';
import { isShielded } from '../services/undercity-models';
import { DUNGEONS, SIGILS_REQUIRED } from '../data/dungeons';

type CreatureSubTab = 'stats' | 'gear' | 'wardrobe' | 'sigils';

/** localStorage key remembering the last-open creature sub-tab across tab
 *  switches (the component is destroyed when you leave) and page reloads. */
const SUBTAB_KEY = 'uc-creature-subtab';
const SUBTABS: readonly CreatureSubTab[] = ['stats', 'gear', 'wardrobe', 'sigils'];

function loadSubTab(): CreatureSubTab {
  try {
    const v = localStorage.getItem(SUBTAB_KEY) as CreatureSubTab | null;
    if (v && SUBTABS.includes(v)) return v;
  } catch {
    /* storage blocked — fall back to the default */
  }
  return 'stats';
}

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
  protected readonly loadedDiePick = signal(false);

  /** Which sub-panel of the creature screen is showing below the pinned hero.
   *  Seeded from and persisted to localStorage so it survives leaving the tab. */
  protected readonly subTab = signal<CreatureSubTab>(loadSubTab());

  constructor() {
    effect(() => {
      const tab = this.subTab();
      try {
        localStorage.setItem(SUBTAB_KEY, tab);
      } catch {
        /* storage full/blocked — stay session-only */
      }
    });
  }

  /** Which stat's description panel is open ('atk' | 'def' | 'spd' | null). */
  protected readonly openStat = signal<string | null>(null);

  /** The stat mid-celebration after a point was spent, plus the number it
   *  rolled up from — drives the count-up flourish on the tile. */
  protected readonly rollStat = signal<string | null>(null);
  protected readonly rollFrom = signal(0);

  /** Plain-language stat descriptions, matching the battle engine's math. */
  protected readonly statInfo: Record<string, { label: string; icon: string; desc: string }> = {
    atk: {
      label: 'Attack',
      icon: 'uc-sword',
      desc: "The muscle behind each strike. Higher ATK means more damage per hit — minus whatever the enemy's DEF soaks up.",
    },
    def: {
      label: 'Defense',
      icon: 'shield',
      desc: 'Armor against blows. Every point of DEF shaves damage off each hit you take.',
    },
    spd: {
      label: 'Speed',
      icon: 'bolt',
      desc: "Strike first when it beats your foe's Speed, and slip away more often when you try to flee.",
    },
  };

  selectStat(stat: string): void {
    this.openStat.update((cur) => (cur === stat ? null : stat));
  }

  /** Flat stat bonus contributed by currently-equipped gear, per stat.
   * Mirrors the backend's effective_stats() gear sum — the stored atk/def/spd
   * on `you` are base values, so this surfaces what the gear adds on top. */
  protected readonly gearMods = computed<Record<string, number>>(() => {
    const gear = this.store.you()?.gear ?? {};
    const mods: Record<string, number> = { atk: 0, def: 0, spd: 0, maxHp: 0 };
    for (const id of Object.values(gear)) {
      const g = id ? GEAR_MAP[id] : undefined;
      if (!g) continue;
      mods['atk'] += g.atk ?? 0;
      mods['def'] += g.def ?? 0;
      mods['spd'] += g.spd ?? 0;
      mods['maxHp'] += g.maxHp ?? 0;
    }
    return mods;
  });

  protected readonly passiveBlurbs = PASSIVE_BLURBS;

  passiveName(p: string): string {
    return PASSIVE_NAMES[p] ?? p;
  }
  protected readonly gearMap = GEAR_MAP;
  protected readonly tierRarity = tierRarity;
  /** Rarity key ('common'|'rare'|'legendary') for an equipped gear id, or null. */
  protected rarityKey(id: string | undefined | null): string | null {
    const g = id ? GEAR_MAP[id] : undefined;
    return g ? tierRarity(g.tier).key : null;
  }
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
    return getRecoloredWithHatDataUrl(spr.sprite, you.paint ?? {}, spr.regions, you.hat);
  });

  /** Recolorable zones for the current form — drives the wardrobe paint groups.
   * Empty for finished art that isn't tintable, two for the insect, three for
   * the marker-based sprites. */
  protected readonly paintRegions = computed(() => {
    const you = this.store.you();
    return you ? formSprite(you.form).regions : [];
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

  /** The five biome Guild Sigils, in fixed display order. */
  protected readonly sigilEntries = Object.entries(DUNGEONS).map(([biome, d]) => ({
    biome,
    ...d,
  }));
  protected readonly sigilsRequired = SIGILS_REQUIRED;

  hasSigil(biome: string): boolean {
    return (this.store.you()?.poiClaims ?? []).includes(`${biome}_lair`);
  }

  protected readonly sigilCount = computed(() => {
    const claims = this.store.you()?.poiClaims ?? [];
    return this.sigilEntries.filter((d) => claims.includes(`${d.biome}_lair`)).length;
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

  /** Minutes until a *different* grimoire can be opened (0 = ready). */
  protected readonly grimoireSwapLeft = computed(() =>
    grimoireSwapLeftMin(this.store.you()?.lastGrimoireSwap),
  );

  async equipBook(id: string): Promise<void> {
    // Clicking the already-open book is a no-op — never stow to no-book (that
    // silently strips every spell and confuses players). Opening a *different*
    // book is what the swap cooldown gates.
    if (this.store.you()?.equippedGrimoire === id) {
      this.showToast('Already open.');
      return;
    }
    await this.run(async () => {
      const resp = await this.store.action('equip-grimoire', { grimoireId: id });
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

  async spendStat(stat: string): Promise<void> {
    const you = this.store.you();
    const before = you ? (you as unknown as Record<string, number>)[stat] : 0;
    await this.run(async () => {
      await this.store.action('spend-stat', { stat });
      // Kick off the roll only once the store holds the new value.
      this.rollFrom.set(before);
      this.rollStat.set(stat);
      setTimeout(() => {
        if (this.rollStat() === stat) this.rollStat.set(null);
      }, 700);
    });
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

  /** How a bag item is actioned: usable now, planted here, a passive hold, or a
   *  battle-only consumable (so we never offer a "Use" that the server rejects). */
  protected itemAction(item: string): 'use' | 'plant' | 'passive' | 'battle' {
    if (item === 'snare') return 'plant';
    if (item === 'smoke_spore') return 'passive';
    if (CONSUMABLE_MAP[item]?.inBattle) return 'battle';
    return 'use';
  }

  /** Index of the bag row awaiting drop confirmation (null = none). */
  protected readonly dropConfirm = signal<number | null>(null);

  protected askDrop(index: number): void {
    this.dropConfirm.set(index);
  }

  protected cancelDrop(): void {
    this.dropConfirm.set(null);
  }

  async confirmDrop(item: string): Promise<void> {
    await this.run(async () => {
      const resp = await this.store.action('drop-item', { item });
      this.dropConfirm.set(null);
      this.showToast(resp.text ?? 'Dropped.');
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
