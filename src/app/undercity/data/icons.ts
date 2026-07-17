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

/** All Undercity SVG icons keyed by their `uc-…` registry name. */
export const UC_SVG_ICONS: Record<string, string> = {
  'uc-sword': UC_SWORD_SVG,
};
