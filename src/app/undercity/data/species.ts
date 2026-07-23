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

// Every sprite's mask (undercity/player_sprites/<key>.mask.png) segments it into
// the same three recolor zones — red→body, green→belly, blue→stripes — which the
// wardrobe paints target in this order. One shared const puts every form on that
// standard: the recolor engine (sprite-engine.ts canRecolor) only tints a sprite
// once its mask ships, so forms whose art has no mask yet simply draw unchanged
// until the file lands — no per-form regions bookkeeping needed.
const MASK_REGIONS = ['body', 'belly', 'stripes'];

export const FORM_SPRITES: Record<string, SpeciesSprite> = {
  // Tier 1 starters
  pest: { sprite: 'pest', regions: MASK_REGIONS, scale: 0.7 },
  kraul: { sprite: 'insect', regions: MASK_REGIONS, scale: 0.7 },
  saproling: { sprite: 'saproling', regions: MASK_REGIONS, scale: 0.7 },
  zombie: { sprite: 'zombie', regions: MASK_REGIONS, scale: 0.7 },
  squirrel: { sprite: 'squirrel', regions: MASK_REGIONS, scale: 0.7 },
  // Tier 2 — same line sprite, grown up
  brackish_trudge: { sprite: 'brackish_trudge', regions: MASK_REGIONS, scale: 1.0 },
  vexing_pest: { sprite: 'vexing_pest', regions: MASK_REGIONS, scale: 0.9 },
  kraul_warrior: { sprite: 'grave_shell_scarab', regions: MASK_REGIONS, scale: 1.0 },
  golgari_longlegs: { sprite: 'golgari_longlegs', regions: MASK_REGIONS, scale: 1.0 },
  slitherhead: { sprite: 'slitherhead', regions: MASK_REGIONS, scale: 1.0 },
  // woodwraith_strangler id now displays as Myconid Sporetender.
  woodwraith_strangler: { sprite: 'myconid_sporetender', regions: MASK_REGIONS, scale: 1.05 },
  shambling_shell: { sprite: 'shambling_shell', regions: MASK_REGIONS, scale: 1.0 },
  corpsejack_menace: { sprite: 'corpsejack_menace', regions: MASK_REGIONS, scale: 0.95 },
  // Deathrite Shaman has no dedicated art yet — reuse the zombie pawn as placeholder.
  deathrite_shaman: { sprite: 'zombie', regions: MASK_REGIONS, scale: 1.0 },
  // Apexes
  grave_titan: { sprite: 'grave_titan', regions: MASK_REGIONS, scale: 1.25 },
  golgari_lich_lord: { sprite: 'golgari_lich_lord', regions: MASK_REGIONS, scale: 1.3 },
  swamp_dragon: { sprite: 'swamp_dragon', regions: MASK_REGIONS, scale: 1.3 },
  izoni: { sprite: 'diplo', regions: MASK_REGIONS, scale: 1.3 }, // still Dino Party placeholder
  // Squirrel T2/T3
  squirrel_warrior: { sprite: 'squirrel_general', regions: MASK_REGIONS, scale: 1.0 },
  squirrel_mage: { sprite: 'squirrel_mage', regions: MASK_REGIONS, scale: 1.0 },
  calamity_beast: { sprite: 'clamity_beast', regions: MASK_REGIONS, scale: 1.3 },
};

/** A selectable cosmetic look for a starter. `id` is the sprite key stored
 *  server-side (mirror: STARTER_VARIANTS in undercity_data.py); the base look
 *  reuses the form's plain key. `name` labels the hatch picker. */
export interface FormVariant extends SpeciesSprite {
  id: string;
  name: string;
}

/** Base variant reuses the form's existing FORM_SPRITES entry, so the two
 *  never drift on scale/regions. */
function baseVariant(form: string): FormVariant {
  return { id: form, name: 'Classic', ...FORM_SPRITES[form] };
}

export const FORM_VARIANTS: Record<string, FormVariant[]> = {
  pest: [baseVariant('pest'), { id: 'pest_2', name: 'Alt', sprite: 'pest_2', regions: MASK_REGIONS, scale: 0.7 }],
  saproling: [baseVariant('saproling'), { id: 'saproling_2', name: 'Alt', sprite: 'saproling_2', regions: MASK_REGIONS, scale: 0.7 }],
  zombie: [baseVariant('zombie'), { id: 'zombie_2', name: 'Alt', sprite: 'zombie_2', regions: MASK_REGIONS, scale: 0.7 }],
  kraul: [baseVariant('kraul'), { id: 'insect_2', name: 'Alt', sprite: 'insect_2', regions: MASK_REGIONS, scale: 0.7 }],
};

export const ALL_SPRITES = [
  ...new Set([
    ...Object.values(FORM_SPRITES).map((s) => s.sprite),
    ...Object.values(FORM_VARIANTS)
      .flat()
      .map((v) => v.sprite),
  ]),
];

export function formSprite(form: string | undefined, variant?: string | null): SpeciesSprite {
  const variants = FORM_VARIANTS[form ?? ''];
  if (variants && variant) {
    const v = variants.find((x) => x.id === variant);
    if (v) return v;
  }
  return FORM_SPRITES[form ?? 'pest'] ?? FORM_SPRITES['pest'];
}
