import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { UndercityStateService } from '../services/undercity-state.service';
import { STARTERS, TIER2, FormInfo, PASSIVE_BLURBS } from '../data/forms';
import { PAINTS, PAINT_MAP } from '../data/cosmetics';
import { getRecoloredDataUrl } from '../engine/sprite-engine';
import { formSprite } from '../data/species';
import { randomCreatureName } from '../data/names';

@Component({
  selector: 'app-undercity-hatch-flow',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  templateUrl: './hatch-flow.component.html',
  styleUrls: ['./hatch-flow.component.scss'],
})
export class HatchFlowComponent {
  protected readonly store = inject(UndercityStateService);

  protected readonly taps = signal(0);
  protected readonly hatched = computed(() => this.taps() >= 3);
  protected readonly eggHue = signal<number>(130);
  protected readonly joining = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly starters = STARTERS;
  protected readonly paints = PAINTS;
  protected readonly passiveBlurbs = PASSIVE_BLURBS;

  /** Chosen creature, held while the player then picks a home biome. */
  protected readonly chosenStarter = signal<FormInfo | null>(null);

  /** Chosen home biome, held while the player names the creature. */
  protected readonly chosenBiome = signal<string | null>(null);

  /** Creature name input, pre-filled with a suggestion. */
  protected readonly creatureName = signal<string>(randomCreatureName());
  protected readonly nameValid = computed(() => {
    const n = this.creatureName().trim();
    return n.length >= 1 && n.length <= 16;
  });

  /** Home biomes — mirrors BIOMES in undercity_data.py (id order = display). */
  protected readonly biomes = [
    { id: 'city', name: 'The Undercity', icon: 'location_city',
      perk: 'City Rat', blurb: '+15 starting Spores.' },
    { id: 'cavern', name: 'Mosslight Cavern', icon: 'diamond',
      perk: 'Glowblessed', blurb: '+10% flee chance.' },
    { id: 'bog', name: 'The Sedgemoor', icon: 'water',
      perk: 'Mirefoot', blurb: 'Hazards cost you half.' },
    { id: 'bone', name: 'Ossuary Fields', icon: 'skull',
      perk: 'Marrowborn', blurb: '+2 DEF against wild creatures.' },
    { id: 'garden', name: 'The Rot-Gardens', icon: 'psychiatry',
      perk: 'Composter', blurb: '+2 Spores from every loot space.' },
  ];

  protected readonly canPickShell = computed(() => (this.store.wardrobe()?.seals ?? 0) >= 1);
  protected readonly sealBonus = computed(() => Math.min(this.store.wardrobe()?.seals ?? 0, 3));

  tapEgg(): void {
    if (!this.hatched()) this.taps.set(this.taps() + 1);
  }

  pickShell(hue: number): void {
    this.eggHue.set(hue);
  }

  spriteUrl(starter: FormInfo): string | null {
    const spr = formSprite(starter.id);
    return getRecoloredDataUrl(
      spr.sprite,
      { body: this.eggHue(), belly: 50, stripes: this.eggHue(), spines: 50, spines_dark: this.eggHue() },
      spr.regions,
    );
  }

  evolutionPreview(starter: FormInfo): string {
    return TIER2.filter((f) => f.line === starter.id)
      .map((f) => f.name)
      .join(' / ');
  }

  paintName(hue: number): string {
    return PAINTS.find((p) => p.hue === hue)?.name ?? PAINT_MAP['forest'].name;
  }

  /** Step 1: pick the creature, then advance to the home-biome choice. */
  chooseStarter(starter: FormInfo): void {
    this.chosenStarter.set(starter);
  }

  /** Step 2: pick a home biome, then advance to naming. */
  chooseBiome(biomeId: string): void {
    this.chosenBiome.set(biomeId);
    this.error.set(null);
  }

  rerollName(): void {
    this.creatureName.set(randomCreatureName(this.creatureName()));
  }

  /** Step 3: name the creature and hatch for real. */
  async hatch(): Promise<void> {
    const starter = this.chosenStarter();
    const biome = this.chosenBiome();
    if (!starter || !biome || this.joining() || !this.nameValid()) return;
    this.joining.set(true);
    this.error.set(null);
    try {
      await this.store.action('join', {
        starter: starter.id,
        home: biome,
        eggHue: this.eggHue(),
        creatureName: this.creatureName().trim(),
      });
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Could not hatch');
      this.joining.set(false);
    }
  }
}
