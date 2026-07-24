/**
 * Custom inline SVG icons for the Undercity, registered with Angular Material's
 * MatIconRegistry at app startup so `<mat-icon svgIcon="uc-…">` works anywhere.
 * (The classic Material Icons font has no sword glyph.)
 *
 * Convention: any icon token starting with `uc-` is a registered SVG icon and
 * must be rendered via `[svgIcon]`, not as ligature text content.
 */

/** Upright sword — the Attack/Strength stat and the Aggress stance. */
export const UC_SWORD_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">' +
  '<path d="M12 1.4 L14 5.2 L13.7 13.4 L10.3 13.4 L10 5.2 Z"/>' +
  '<rect x="5.4" y="13.2" width="13.2" height="2.8" rx="0.9"/>' +
  '<rect x="10.6" y="15.8" width="2.8" height="4" rx="0.7"/>' +
  '<rect x="9.4" y="19.4" width="5.2" height="2.8" rx="1.1"/>' +
  '</svg>';

/** Fang — the Aggress gear slot. Two curved canines hanging from a gum bar. */
export const UC_FANG_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">' +
  '<path d="M4.4 4.6 h15.2 a1.4 1.4 0 0 1 0 2.8 H4.4 a1.4 1.4 0 0 1 0-2.8 Z"/>' +
  '<path d="M6.6 7.4 C7 13.5 8.2 17.8 9.5 20.4 C10 19 10.7 14.5 10.6 7.4 Z"/>' +
  '<path d="M17.4 7.4 C17 13.5 15.8 17.8 14.5 20.4 C14 19 13.3 14.5 13.4 7.4 Z"/>' +
  '</svg>';

/** Carapace — the Guard gear slot. A segmented beetle-shell dome. */
export const UC_CARAPACE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" fill-rule="evenodd">' +
  '<path d="M12 3.4 C7 3.4 3.4 7.6 3.4 15.2 C3.4 17.2 4.6 18.4 6.8 18.4 L17.2 18.4 ' +
  'C19.4 18.4 20.6 17.2 20.6 15.2 C20.6 7.6 17 3.4 12 3.4 Z ' +
  'M11.4 6 h1.2 V16.6 h-1.2 Z M7.9 8.2 h1 V16.2 h-1 Z M15.1 8.2 h1 V16.2 h-1 Z"/>' +
  '</svg>';

/** Charm — the Feint gear slot. A faceted gem amulet on a hoop. */
export const UC_CHARM_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" fill-rule="evenodd">' +
  '<path d="M9.2 4.4 a2.8 2.8 0 1 0 5.6 0 a2.8 2.8 0 1 0 -5.6 0 Z ' +
  'M10.9 4.4 a1.1 1.1 0 1 0 2.2 0 a1.1 1.1 0 1 0 -2.2 0 Z"/>' +
  '<path d="M12 7 L17 12.2 L12 21.6 L7 12.2 Z"/>' +
  '</svg>';

/** Shield — the Defense stat. A crested heater shield with a central ridge. */
export const UC_SHIELD_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" fill-rule="evenodd">' +
  '<path d="M12 1.8 L19.6 4.6 V11.2 C19.6 16.4 16.3 20.4 12 22.4 ' +
  'C7.7 20.4 4.4 16.4 4.4 11.2 V4.6 Z ' +
  'M11.3 5.8 h1.4 V18.6 h-1.4 Z"/>' +
  '</svg>';

/** Bolt — the Speed stat. A chunky lightning strike. */
export const UC_BOLT_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">' +
  '<path d="M13.4 1.6 L4.8 13.4 H9.8 L8.4 22.4 L18.8 9.6 H13.4 L16.2 1.6 Z"/>' +
  '</svg>';

/** Spore pod — the spores loot reward. A round cap on a short stalk. */
export const UC_SPORE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">' +
  '<path d="M12 3 C6.8 3 3.4 6.4 3.4 10.2 C3.4 11.4 4.4 12 6 12 L18 12 ' +
  'C19.6 12 20.6 11.4 20.6 10.2 C20.6 6.4 17.2 3 12 3 Z"/>' +
  '<rect x="10.8" y="12" width="2.4" height="7.2" rx="1.1"/>' +
  '<circle cx="8.2" cy="8.2" r="1.1"/><circle cx="12" cy="6.8" r="1.2"/>' +
  '<circle cx="15.6" cy="8.6" r="1"/>' +
  '</svg>';

/** Pouch — the consumable-item loot reward. A drawstring bag. */
export const UC_POUCH_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">' +
  '<path d="M8 6 L16 6 L15 8.4 C18 9.8 20 12.6 20 15.6 C20 19 16.4 21.4 12 21.4 ' +
  'C7.6 21.4 4 19 4 15.6 C4 12.6 6 9.8 9 8.4 Z"/>' +
  '<path d="M8.4 4 L15.6 4 A0.9 0.9 0 0 1 15.6 6.4 L8.4 6.4 A0.9 0.9 0 0 1 8.4 4 Z"/>' +
  '</svg>';

/** Chest — the gear loot reward. A banded treasure chest with a latch. */
export const UC_CHEST_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" fill-rule="evenodd">' +
  '<path d="M3.4 9 C3.4 6.4 6.6 4.4 12 4.4 C17.4 4.4 20.6 6.4 20.6 9 L20.6 10.4 ' +
  'L3.4 10.4 Z"/>' +
  '<path d="M3.4 12 L20.6 12 L20.6 18.2 A1.4 1.4 0 0 1 19.2 19.6 L4.8 19.6 ' +
  'A1.4 1.4 0 0 1 3.4 18.2 Z M10.8 12 h2.4 v3.2 h-2.4 Z"/>' +
  '</svg>';

/** Duffel — the Gear tab. A kit bag: capsule body with two carry hoops, a
 *  zipper seam and end panels. (Replaces the brick-like Material `backpack`.) */
export const UC_DUFFEL_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" fill-rule="evenodd">' +
  '<path d="M7.2 10 C7.2 5.2 11.6 5.2 11.6 10 L10.2 10 C10.2 6.9 8.6 6.9 8.6 10 Z"/>' +
  '<path d="M12.4 10 C12.4 5.2 16.8 5.2 16.8 10 L15.4 10 C15.4 6.9 13.8 6.9 13.8 10 Z"/>' +
  '<path d="M7.5 9.2 h9 a4.4 4.4 0 0 1 0 8.8 h-9 a4.4 4.4 0 0 1 0-8.8 Z ' +
  'M6.6 12.4 h10.8 v1.1 h-10.8 Z ' +
  'M8.2 10.3 v6.6 h0.9 v-6.6 Z ' +
  'M14.9 10.3 v6.6 h0.9 v-6.6 Z"/>' +
  '</svg>';

/** All Undercity SVG icons keyed by their `uc-…` registry name. */
export const UC_SVG_ICONS: Record<string, string> = {
  'uc-sword': UC_SWORD_SVG,
  'uc-fang': UC_FANG_SVG,
  'uc-carapace': UC_CARAPACE_SVG,
  'uc-charm': UC_CHARM_SVG,
  'uc-shield': UC_SHIELD_SVG,
  'uc-bolt': UC_BOLT_SVG,
  'uc-spore': UC_SPORE_SVG,
  'uc-pouch': UC_POUCH_SVG,
  'uc-chest': UC_CHEST_SVG,
  'uc-duffel': UC_DUFFEL_SVG,
};
