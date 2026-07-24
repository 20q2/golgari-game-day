// Pure "why is this greyed out?" reason strings, shared by the board and plaza
// tabs so identical blockers read identically everywhere. Each function returns
// null when the action is ALLOWED, or a short human reason when it is BLOCKED.
// No Angular / no signals here — just data in, string out.

/** Spore price you can't cover. Returns null when affordable. */
export function affordReason(have: number, cost: number): string | null {
  return have >= cost ? null : `Not enough Spores (you have ${have})`;
}

/** A destination inventory is full. `label` is the container's display name,
 *  e.g. 'Stash', 'Bag', 'Scroll satchel'. Returns null when there's room. */
export function containerFullReason(len: number, cap: number, label: string): string | null {
  return len >= cap ? `${label} full — make room first` : null;
}

/** A minute-granularity cooldown. `verb` e.g. 'On cooldown' | 'Recharging'.
 *  Returns null when ready (minsLeft <= 0). */
export function cooldownReason(minsLeft: number, verb: string): string | null {
  return minsLeft > 0 ? `${verb} (${minsLeft}m)` : null;
}

/** Crafting-material shortfall (Blacksmith). Itemizes what's missing.
 *  Returns null when both materials are covered. */
export function materialReason(
  haveMoltings: number,
  haveIchor: number,
  needMoltings: number,
  needIchor: number,
): string | null {
  const short: string[] = [];
  if (haveMoltings < needMoltings) short.push(`${needMoltings - haveMoltings} moltings`);
  if (haveIchor < needIchor) short.push(`${needIchor - haveIchor} ichor`);
  return short.length ? `Need ${short.join(', ')}` : null;
}
