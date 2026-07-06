/**
 * Creature-form → placeholder-sprite manifest (GDD §5 "Sprite placeholders").
 * Dino Party pixel art stands in until real Golgari sprites exist; swapping
 * art later means editing only this file. Sprites carry green marker regions
 * for hue-shift recoloring and a red-pixel hat anchor (see sprite-engine.ts).
 */
export interface SpeciesSprite {
  /** Sprite asset key — file is `undercity/sprites/${sprite}.png`. */
  sprite: string;
  /** Ordered recolor region names matching the sprite's marker families. */
  regions: string[];
  /** Extra draw scale on top of the level-based scale. */
  scale: number;
}

const DINO_REGIONS = ['body', 'belly', 'stripes'];

export const FORM_SPRITES: Record<string, SpeciesSprite> = {
  // Tier 1 starters
  pest: { sprite: 'rex', regions: DINO_REGIONS, scale: 0.7 },
  kraul: { sprite: 'spino', regions: DINO_REGIONS, scale: 0.7 },
  saproling: { sprite: 'trike', regions: DINO_REGIONS, scale: 0.7 },
  spore: { sprite: 'anky', regions: DINO_REGIONS, scale: 0.7 },
  // Tier 2 — same line sprite, grown up
  brackish_trudge: { sprite: 'rex', regions: DINO_REGIONS, scale: 1.0 },
  stinkweed_imp: { sprite: 'rex', regions: DINO_REGIONS, scale: 0.9 },
  kraul_warrior: { sprite: 'spino', regions: DINO_REGIONS, scale: 1.0 },
  kraul_forager: { sprite: 'spino', regions: DINO_REGIONS, scale: 0.95 },
  slitherhead: { sprite: 'trike', regions: DINO_REGIONS, scale: 1.0 },
  woodwraith_strangler: { sprite: 'trike', regions: DINO_REGIONS, scale: 1.05 },
  shambling_shell: { sprite: 'anky', regions: DINO_REGIONS, scale: 1.0 },
  corpsejack_menace: { sprite: 'anky', regions: DINO_REGIONS, scale: 0.95 },
  // Apexes
  grave_titan: { sprite: 'godzilla', regions: ['body', 'spines', 'spines_dark'], scale: 1.25 },
  golgari_lich_lord: { sprite: 'pachy', regions: DINO_REGIONS, scale: 1.3 },
  swamp_dragon: { sprite: 'parasaur', regions: DINO_REGIONS, scale: 1.3 },
  izoni: { sprite: 'diplo', regions: DINO_REGIONS, scale: 1.3 },
};

export const ALL_SPRITES = [...new Set(Object.values(FORM_SPRITES).map((s) => s.sprite))];

export function formSprite(form: string | undefined): SpeciesSprite {
  return FORM_SPRITES[form ?? 'pest'] ?? FORM_SPRITES['pest'];
}
