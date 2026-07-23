/** Hat + paint manifests (mirrors undercity_data.py; art from Dino Party). */

export interface HatInfo {
  id: string;
  name: string;
  rarity: 'common' | 'uncommon' | 'legendary';
  /** File under undercity/hats/. */
  file: string;
  /** Vertical nudge in sprite pixels (positive = lower on head). */
  offsetY: number;
}

export const HATS: HatInfo[] = [
  { id: 'party_hat', name: 'Party Hat', rarity: 'common', file: 'partyhat.png', offsetY: 1 },
  { id: 'cowboy_hat', name: 'Cowboy Hat', rarity: 'common', file: 'cowboyhat.png', offsetY: 2 },
  { id: 'top_hat', name: 'Top Hat', rarity: 'common', file: 'tophat.png', offsetY: 0 },
  { id: 'flower_crown', name: 'Flower Crown', rarity: 'common', file: 'flowercrownhat.png', offsetY: 2 },
  { id: 'chef_hat', name: 'Chef Hat', rarity: 'common', file: 'chefhat.png', offsetY: 2 },
  { id: 'headband', name: 'Headband', rarity: 'common', file: 'headband.png', offsetY: 2 },
  { id: 'beanie', name: 'Beanie', rarity: 'common', file: 'beanie.png', offsetY: 2 },
  { id: 'bow', name: 'Bow', rarity: 'common', file: 'bow.png', offsetY: 4 },
  { id: 'viking_helmet', name: 'Viking Helmet', rarity: 'uncommon', file: 'vikinghelmet.png', offsetY: 1 },
  { id: 'wizard_hat', name: 'Wizard Hat', rarity: 'uncommon', file: 'wizardhat.png', offsetY: 0 },
  { id: 'pirate_hat', name: 'Pirate Hat', rarity: 'uncommon', file: 'piratehat.png', offsetY: 1 },
  { id: 'crown', name: 'Crown', rarity: 'uncommon', file: 'crown.png', offsetY: 1 },
  { id: 'halo', name: 'Halo', rarity: 'uncommon', file: 'halo.png', offsetY: 4 },
  { id: 'birthday_blessing', name: 'Swarm Balloons', rarity: 'legendary', file: 'birthdayblessing.png', offsetY: 0 },
  { id: 'kaiju_slayer', name: 'Behemoth-Slayer’s Mantle', rarity: 'legendary', file: 'kaijuslayer.png', offsetY: 2 },
];

export const HAT_MAP: Record<string, HatInfo> = Object.fromEntries(HATS.map((h) => [h.id, h]));

export interface PaintInfo {
  id: string;
  name: string;
  hue: number;
}

export const PAINTS: PaintInfo[] = [
  { id: 'crimson', name: 'Crimson', hue: 0 },
  { id: 'orange', name: 'Orange', hue: 30 },
  { id: 'gold', name: 'Gold', hue: 50 },
  { id: 'forest', name: 'Forest', hue: 130 },
  { id: 'emerald', name: 'Emerald', hue: 155 },
  { id: 'cyan', name: 'Cyan', hue: 180 },
  { id: 'sky', name: 'Sky', hue: 200 },
  { id: 'navy', name: 'Navy', hue: 230 },
  { id: 'violet', name: 'Violet', hue: 270 },
  { id: 'rose', name: 'Rose', hue: 340 },
];

export const PAINT_MAP: Record<string, PaintInfo> = Object.fromEntries(PAINTS.map((p) => [p.id, p]));

/** Renown prices (mirror HAT_PRICES / PAINT_PRICE in undercity_data.py). */
export const HAT_PRICES: Record<HatInfo['rarity'], number> = {
  common: 50,
  uncommon: 120,
  legendary: 300,
};
export const PAINT_PRICE = 40;

export interface SpecialPaintInfo {
  id: string;
  name: string;
}

/** Animated whole-creature effects (mirror SPECIAL_PAINTS in undercity_data.py). */
export const SPECIAL_PAINTS: SpecialPaintInfo[] = [
  { id: 'prismatic', name: 'Prismatic' },
  { id: 'rainbow', name: 'Rainbow' },
  { id: 'metallic', name: 'Metallic' },
  { id: 'starry', name: 'Starry' },
];

export const SPECIAL_PAINT_MAP: Record<string, SpecialPaintInfo> = Object.fromEntries(
  SPECIAL_PAINTS.map((p) => [p.id, p]),
);

/** Renown price per special paint (mirror SPECIAL_PAINT_PRICE in undercity_data.py). */
export const SPECIAL_PAINT_PRICE = 500;
