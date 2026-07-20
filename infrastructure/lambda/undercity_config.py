"""
Undercity tunables — the one file to edit when balancing the game.

Every constant here is re-exported through undercity_data (via
`from undercity_config import *`), so code and tests keep referencing
`data.ROLL_CAP` etc. Weighted tables (dig loot, shop stock, mystery
events, NPC pools) stay in undercity_data.py — this file is scalars only.
"""

# ── Debug ────────────────────────────────────────────────────────────────────
# True: rolling never checks or spends banked rolls, and the client may pick
# the exact die face (the client shows its dev tools when the server reports
# this flag). Flip to False and `cdk deploy` before game night.
DEBUG = False

# ── Roll economy ─────────────────────────────────────────────────────────────
ROLL_CAP = 6
JOIN_ROLLS = 3
ROLL_REGEN_MINUTES = 30      # regen tick length in minutes, up to ROLL_CAP
ROLLS_PER_REGEN = 3          # rolls banked each tick (3 rolls every 30 minutes)
CLAIM_FINISHED_ROLLS = 2
CLAIM_WON_BONUS_ROLLS = 1
CLAIM_WON_SPORES = 10
CLAIM_FINISHED_COOLDOWN_MIN = 15
CLAIM_TAUGHT_ROLLS = 1
CLAIM_TAUGHT_MAX = 2
POKE_ROLL_LIMIT = 3          # first N pokes received per night grant +1 roll
POKE_COOLDOWN_MIN = 30       # a player can re-poke the SAME creature only every N min
GRIMOIRE_SWAP_COOLDOWN_MIN = 30  # opening a different grimoire is gated for N min
                             # (stowing your open book is always free) — client
                             # mirror in src/app/undercity/data/spells.ts

# ── HP / death / PvP ─────────────────────────────────────────────────────────
# Passive time-based HP regen is DISABLED (0). HP is restored ONLY by: a spell
# (e.g. Mend Flesh), a level-up / evolution, stopping at a gate (full heal), or
# an ability such as the Saproling's Regrowth. Players reported "randomly
# healing" — that was this passive regen ticking on every action. Set > 0 to
# re-enable "the swamp heals its own"; the regen plumbing (regen_hp) stays wired
# and simply heals nothing at 0.
HP_REGEN_PCT = 0.0           # of max HP per interval (0 = passive regen off)
HP_REGEN_INTERVAL_MIN = 10
COMPOST_SHIELD_MIN = 15
COMPOST_RESPAWN_PCT = 0.5
PVP_SPORE_STEAL = 0.25
PVP_SPORE_STEAL_DEFEND = 0.10
DEATHRITE_STEAL_MULT = 1.5
SOUL_HARVEST_MULT = 1.5   # Deathrite Shaman: ×Spores from wild & elite battle wins

# Gear rider knobs (combat riders in undercity_engine.resolve_round).
CUTPURSE_SPORES = 6   # flat Spores after a won fight in which you landed a Feint
BRAMBLE_REFLECT = 2   # flat damage a Bramble carapace reflects when struck

# ── Movement ─────────────────────────────────────────────────────────────────
# Units whose tier is <= this may enter `tunnel` spaces (the biome-boundary
# shortcuts). Evolved units (tier 2/3) are barred and routed through the
# Wilderness instead. See specs/2026-07-20-undercity-tunnels-wilderness-design.md.
TUNNEL_TIER_MAX = 1

# ── Facilities ───────────────────────────────────────────────────────────────
SHOP_REFRESH_MIN = 30        # bazaar restock window (minutes); the client's
                             # vendor rotation mirrors this — see BAZAAR_KEEPERS
                             # in board-tab.component.ts
SHOP_GEAR_SLOTS = 3          # gear lines offered per refresh (distinct slots)
SHOP_CONSUMABLE_SLOTS = 3    # consumable lines per refresh (>=1 in-battle)
SHOP_GRIMOIRE_SLOTS = 2      # tier-1 grimoires per refresh (never deplete)
SHOP_GEAR_QTY = 2            # units per stocked gear line
SHOP_CONSUMABLE_QTY = 2      # units per stocked consumable line
SHRINE_BLESSING_COST = 15
SHRINE_TITHE_HP_PCT = 0.25
OSSUARY_MAX_BET = 20
OSSUARY_ROLLS_PER_VISIT = 3  # gambles allowed per landing; refills when you land again
SNARE_SPILL_PCT = 0.20

# ── Renown shop (pre-spawn) ──────────────────────────────────────────────────
SHOP_START_RENOWN = 50       # seed for a brand-new player: one common hat OR one plain color
