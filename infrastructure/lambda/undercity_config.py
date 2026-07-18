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
DEBUG = True

# ── Roll economy ─────────────────────────────────────────────────────────────
ROLL_CAP = 6
JOIN_ROLLS = 3
SEAL_BONUS_CAP = 3
ROLL_REGEN_MINUTES = 10      # +1 banked roll per N minutes, up to ROLL_CAP
CLAIM_FINISHED_ROLLS = 2
CLAIM_WON_BONUS_ROLLS = 1
CLAIM_WON_SPORES = 10
CLAIM_FINISHED_COOLDOWN_MIN = 15
CLAIM_TAUGHT_ROLLS = 1
CLAIM_TAUGHT_MAX = 2
POKE_ROLL_LIMIT = 3          # first N pokes received per night grant +1 roll

# ── HP / death / PvP ─────────────────────────────────────────────────────────
HP_REGEN_PCT = 0.10          # of max HP
HP_REGEN_INTERVAL_MIN = 10
COMPOST_SHIELD_MIN = 15
COMPOST_RESPAWN_PCT = 0.5
PVP_SPORE_STEAL = 0.25
PVP_SPORE_STEAL_DEFEND = 0.10
DEATHRITE_STEAL_MULT = 1.5

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
