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

// Full-colour player art whose custom classifier (sprite-engine.ts) segments
// it into the same body / belly / stripes zones the wardrobe paints target.
const PLAYER_REGIONS = ['body', 'belly', 'stripes'];

// Finished Golgari art has no recolor markers — regions: [] disables the
// hue-shift (wardrobe paints won't tint these forms) and hats fall back to
// the default anchor.
export const FORM_SPRITES: Record<string, SpeciesSprite> = {
  // Tier 1 starters
  pest: { sprite: 'pest', regions: PLAYER_REGIONS, scale: 0.7 },
  // Centipede art (undercity/player_sprites/insect.png) — carapace + legs only,
  // so just the first two of the standard regions.
  kraul: { sprite: 'insect', regions: PLAYER_REGIONS.slice(0, 2), scale: 0.7 },
  saproling: { sprite: 'saproling', regions: PLAYER_REGIONS, scale: 0.7 },
  zombie: { sprite: 'zombie', regions: PLAYER_REGIONS, scale: 0.7 },
  // Tier 2 — same line sprite, grown up
  brackish_trudge: { sprite: 'brackish_trudge', regions: [], scale: 1.0 },
  stinkweed_imp: { sprite: 'stinkweed_imp', regions: [], scale: 0.9 },
  kraul_warrior: { sprite: 'grave_shell_scarab', regions: [], scale: 1.0 },
  golgari_longlegs: { sprite: 'golgari_longlegs', regions: [], scale: 1.0 },
  slitherhead: { sprite: 'slitherhead', regions: [], scale: 1.0 },
  // woodwraith_strangler id now displays as Myconid Sporetender — real art.
  woodwraith_strangler: { sprite: 'myconid_sporetender', regions: [], scale: 1.05 },
  shambling_shell: { sprite: 'shambling_shell', regions: [], scale: 1.0 },
  corpsejack_menace: { sprite: 'corpsejack_menace', regions: [], scale: 0.95 },
  // Deathrite Shaman has no dedicated art yet — reuse the zombie pawn as placeholder.
  deathrite_shaman: { sprite: 'zombie', regions: PLAYER_REGIONS, scale: 1.0 },
  // Apexes — real Golgari art (regions: [] disables recolor markers)
  grave_titan: { sprite: 'grave_titan', regions: [], scale: 1.25 },
  golgari_lich_lord: { sprite: 'golgari_lich_lord', regions: [], scale: 1.3 },
  swamp_dragon: { sprite: 'swamp_dragon', regions: [], scale: 1.3 },
  izoni: { sprite: 'diplo', regions: DINO_REGIONS, scale: 1.3 }, // still Dino Party placeholder
};

export const ALL_SPRITES = [...new Set(Object.values(FORM_SPRITES).map((s) => s.sprite))];

export function formSprite(form: string | undefined): SpeciesSprite {
  return FORM_SPRITES[form ?? 'pest'] ?? FORM_SPRITES['pest'];
}
