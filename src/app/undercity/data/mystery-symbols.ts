/**
 * Canonical mystery-outcome faces — one icon + color per outcome key stamped by
 * the server (`undercity_engine.mystery_outcome`). Shared so the reveal reel
 * (mystery-reel.component) and the event-card payoff animation
 * (mystery-fx.component) speak the same visual language for each outcome.
 */
export interface MysterySymbol {
  icon: string;
  color: string;
}

export const MYSTERY_SYMBOLS: Record<string, MysterySymbol> = {
  spores: { icon: 'grain', color: '#e0c069' },
  xp: { icon: 'auto_awesome', color: '#8fd0ff' },
  item: { icon: 'backpack', color: '#b79bff' },
  gear: { icon: 'shield', color: '#9ec6ff' },
  grimoire: { icon: 'menu_book', color: '#c9a0ff' },
  heal: { icon: 'favorite', color: '#7fce8f' },
  buff: { icon: 'bolt', color: '#ffd24a' },
  theft: { icon: 'money_off', color: '#e0a24a' },
  hurt: { icon: 'heart_broken', color: '#e07a7a' },
  warp: { icon: 'cyclone', color: '#4fc4bc' },
  curse: { icon: 'dangerous', color: '#d47ad0' },
  jackpot: { icon: 'casino', color: '#ffe08a' },
  mystery: { icon: 'help', color: '#c4a5ff' },
};

/** All canonical outcome keys, in the order defined above. */
export const MYSTERY_OUTCOMES = Object.keys(MYSTERY_SYMBOLS);
