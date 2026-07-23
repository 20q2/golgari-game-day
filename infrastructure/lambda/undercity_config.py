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
ROLL_CAP = 15
JOIN_ROLLS = 3
BRAVERY_BONUS_ROLLS = 1      # extra starting rolls for hatching a random creature
SHINY_HATCH_CHANCE = 0.05    # chance a hatched creature is shiny — purely cosmetic
                             # (a gold sparkle over its sprite + a hatch-log call-out)
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
GATE_PASS_HEAL_FRACTION = 0.5  # fraction of max HP restored for passing THROUGH a gate (landing still full-heals)
COMPOST_SHIELD_MIN = 15
COMPOST_RESPAWN_PCT = 0.5

# A treasure tile (trove/cache/vault) already plundered by its season-global
# first conqueror yields this fraction of spores/XP — and half its gear CHANCE —
# to every later first-time visitor. The first conqueror always gets the full haul.
PLUNDERED_LOOT_MULT = 0.5
PVP_SPORE_STEAL = 0.25
PVP_SPORE_STEAL_DEFEND = 0.10
DEATHRITE_STEAL_MULT = 1.5
SOUL_HARVEST_MULT = 1.5   # Deathrite Shaman: ×Spores from wild & elite battle wins
SCROUNGER_MULT = 1.25     # Pest passive: ×Spores from all loot (forage/dig/mystery)
                          # and combat bounties. A % (not a flat +2) so the pest
                          # stays the economy specialist as bounties scale — client
                          # blurb mirror in src/app/undercity/data/forms.ts
SCROUNGER_LOSS_FRACTION = 0.3  # Pest passive: even on a LOST / fled / stalemated
                          # wild or elite fight, scrounge this fraction of the
                          # bounty it would have won. Makes the pest's income
                          # survival-independent — the economy identity doesn't
                          # collapse when a fragile balanced statline dies.

# Gear rider knobs (combat riders in undercity_engine.resolve_round).
CUTPURSE_SPORES = 6   # flat Spores after a won fight in which you landed a Feint
BRAMBLE_REFLECT = 2   # flat damage a Bramble carapace reflects when struck

# ── Attribute perks (design 2026-07-21) ──────────────────────────────────────
# Carapace Grind (DEF-10 perk): a Guard holder deals a DEF-scaled chip each round
# it does NOT win the exchange, converting DEF to offense independent of the
# stance triangle. Gated on the perk so NPCs never do it. Sim-validated at 0.5
# (pure-DEF/Guard co-equal with ATK/Aggress vs the boss: 142 -> ~330 dmg; 0.7
# stronger, 1.0 overshoots). See infrastructure/lambda/sim/proto_fix.py.
GUARD_CHIP_COEFF = 0.5
CARAPACE_GRIND_MAXHP = 15  # DEF-12: bonus Max HP granted while the perk is held
DEATHDRIVE_MULT = 0.5  # ATK-15: Aggress swing multiplier while below half HP
MENACE_FACTOR = 0.5    # ATK-10: multiplies the enemy's telegraph bluff chance
THICK_HIDE_MULT = 0.5  # DEF-5: fraction of hazard/mystery HP loss actually taken
# Blink (SPD-15): choosing your die value is strong, so it paces itself — after a
# blink you must take this many ordinary rolls before you can blink again. 1 =
# "once every 2 rolls" (blink, roll, blink, ...). 0 disables the cooldown.
BLINK_COOLDOWN_ROLLS = 1

# ── Forge economy (gear stash · Salvage Yard · Blacksmith) ───────────────────
# See specs/2026-07-20-undercity-forge-economy-design.md. Found gear lands in a
# capped stash instead of auto-mulching; the Salvage Yard grinds stash pieces
# into materials (or sells for Spores); the Blacksmith spends materials to climb
# a piece up its rarity ladder.
GEAR_STASH_SIZE = 6           # capped hold for gear you aren't wearing
# Moltings (common material) yielded by grinding a piece of the given rarity.
SALVAGE_MOLTINGS = {1: 1, 2: 2, 3: 4}
SALVAGE_ICHOR = 1             # Chrysalis Ichor (rare material) from grinding a Legendary
# Blacksmith upgrade cost to reach the given tier (from the tier below).
UPGRADE_SPORES = {2: 40, 3: 80}
UPGRADE_MOLTINGS = {2: 3, 3: 6}
UPGRADE_ICHOR = {2: 0, 3: 1}  # Rare->Legendary needs 1 Ichor (deep-content gate)

# ── Player Market (Plaza, priced) ────────────────────────────────────────────
# List stashed gear at a Spore price bounded to a band around its base cost so
# nobody posts a 9999-Spore troll listing. Distinct from the board barter
# Trading Post (which stays). See specs/2026-07-20-undercity-forge-economy-design.md.
MARKET_PRICE_MIN_PCT = 0.5    # floor = ceil(base cost * this)
MARKET_PRICE_MAX_PCT = 2.0    # ceiling = floor(base cost * this)
MARKET_MAX_LISTINGS = 5       # active listings per seller

# Per-rarity rider magnitude ladder (see gear-rarity Phase 1 plan). Each value is
# anchored to the rider's current live magnitude at the tier it occupies today, so
# no existing piece is nerfed; the only intended change is the modest T3 buff to
# riders that today share their T2 value (deep_biter/spiked/rabid/bulwark) so the
# ladder is monotonic. seer/glint are NOT here — read-rate scales via gear readBonus.
RIDER_SCALE = {
    # rider          {1: common, 2: rare, 3: legendary}   # unit / anchor to today's value
    'barbed':        {1: 1,    2: 2,    3: 3},     # rot stacks on Aggress (T1 today=1)
    'bloodfang':     {1: 0.40, 2: 0.50, 3: 0.60},  # heal frac of Aggress-win dmg (T1 today=0.40)
    'deep_biter':    {1: 0.35, 2: 0.50, 3: 0.70},  # +win MULTIPLIER (T2 today=0.50; T3 buffed)
    'rabid':         {1: 1,    2: 2,    3: 3},      # +ATK ramp per Aggress win (T2 today=2; T3 buffed)
    'gutcleaver':    {1: 0.35, 2: 0.50, 3: 0.70},  # +win multiplier vs <30% HP (T2 today=0.50)
    'thick':         {1: 0.15, 2: 0.20, 3: 0.25},  # stall chip-through mult (T1 today=0.15)
    'spiked':        {1: 1.3,  2: 1.5,  3: 1.8},    # guard-counter reflect mult (T2 today=1.5; T3 buffed)
    'bramble':       {1: 2,    2: 3,    3: 4},      # flat reflect when struck (T1 today=2)
    'bulwark':       {1: 1,    2: 1,    3: 2},      # +DEF per Guard round (T2 today=1; T3 buffed)
    'mossback':      {1: 2,    2: 3,    3: 4},      # heal per Guard round (T2 today=3)
    'trickster':     {1: 0.50, 2: 0.60, 3: 0.70},  # frac of lost-Feint punish negated (T1 today=0.50)
    'serrated':      {1: 1,    2: 2,    3: 3},      # flat cut to foe next-round dmg (T2 today=2)
    'venomtrick':    {1: 1,    2: 2,    3: 3},      # rot on a winning Feint (T1 today=1)
    'cutpurse':      {1: 4,    2: 6,    3: 9},      # Spores after a won fight w/ Feint (T2 today=6)
}

# ── Movement ─────────────────────────────────────────────────────────────────
# Units whose tier is <= this may enter `tunnel` spaces (the biome-boundary
# shortcuts). Evolved units (tier 2/3) are barred and routed through the
# Wilderness instead. See specs/2026-07-20-undercity-tunnels-wilderness-design.md.
TUNNEL_TIER_MAX = 1

# Spore toll to cross a bridge (a `tunnel` node), keyed by tier. Tiers <=
# TUNNEL_TIER_MAX cross free ("kids"); a tier WITH an entry pays that toll
# ("adults"); a tier with NO entry is too large to fit and is blocked from
# bridges entirely (Tier 3 today — "dragons & lich lords"). See _blocked_nodes
# and _stop_nodes in undercity_db.py. The client mirrors this rule in the
# tollkeeper dialog prose only.
TUNNEL_TOLL = {2: 50}

# ── Facilities ───────────────────────────────────────────────────────────────
SHOP_REFRESH_MIN = 30        # bazaar restock window (minutes); the client's
                             # vendor rotation mirrors this — see BAZAAR_KEEPERS
                             # in board-tab.component.ts
SHOP_GEAR_SLOTS = 3          # gear lines offered per refresh (distinct slots)
SHOP_CONSUMABLE_SLOTS = 3    # consumable lines per refresh (>=1 in-battle)
SHOP_GRIMOIRE_SLOTS = 2      # tier-1 grimoires per refresh (never deplete)
SHOP_GEAR_QTY = 2            # units per stocked gear line
SHOP_CONSUMABLE_QTY = 2      # units per stocked consumable line
# Per-(node, window) chance a biome bazaar rolls a rare "black-market" event
# that forces ONE of its gear slots to a T3 piece. 30-min windows -> roughly one
# sighting per bazaar every ~10 hours. Island bazaars ignore this (they stock T3
# directly). Endgame T3 gear should be a treat, never a shortcut.
BAZAAR_BLACKMARKET_CHANCE = 0.05
# Umori, the wandering trading post: minutes it dwells at one wilderness node
# before hopping to a new random one. Location/stock are pure functions of this
# window (see undercity_db._umori_window) — no server tick.
UMORI_DWELL_MIN = 120
SHRINE_BLESSING_COST = 15
OSSUARY_MAX_BET = 20
OSSUARY_ROLLS_PER_VISIT = 3  # gambles allowed per landing; refills when you land again
SNARE_SPILL_PCT = 0.20

# ── Home-biome hatch perks ───────────────────────────────────────────────────
MARROWBORN_MAXHP = 8   # Ossuary Fields (bone) home: flat +Max HP, applied at hatch

# ── Renown shop (pre-spawn) ──────────────────────────────────────────────────
SHOP_START_RENOWN = 50       # seed for a brand-new player: one common hat OR one plain color

# ── World Event ("The Great Beast") ──────────────────────────────────────────
# A season-shared co-op boss that spawns in the wilderness once the first sigil
# lair is cleared. Players chip a shared HP pool in bounded skirmishes; on death
# every contributor is paid by damage bracket. Mirror in
# src/app/undercity/data/world-event.ts when tuned.
WORLD_EVENT_HP          = 200   # shared pool; sized so it takes many skirmishes
WORLD_EVENT_ROUND_CAP   = 6     # a single skirmish auto-ends after this many rounds
WORLD_EVENT_MAJOR_SHARE = 0.25  # damage-share threshold for the Major bracket
WORLD_EVENT_MINOR_SHARE = 0.10  # damage-share threshold for the Minor bracket

# Per-bracket payout: (spores, renown). Vanquisher = single top damage dealer.
WORLD_EVENT_REWARDS = {
    'vanquisher':  {'spores': 120, 'renown': 5},
    'major':       {'spores': 80,  'renown': 3},
    'minor':       {'spores': 45,  'renown': 2},
    'participant': {'spores': 20,  'renown': 0},
}

# ── Procedural dungeons ──────────────────────────────────────────────────────
# When True, each night's five dungeon pockets are regenerated from a per-season
# graph (built at season-start, stored on the SEASON#<sid>/MAP record) instead of
# the committed depths in map.json. Off = the committed board, exactly as before.
# See specs/2026-07-20-undercity-procedural-dungeons-design.md.
PROCEDURAL_DUNGEONS = True

# ── Spell scaling (design 2026-07-22, §2.5 pillar 1) ─────────────────────────
# Every power-carrying spell (damage/heal/boss-strike) gains this much magnitude
# per character level above 1: effective = base + round(PER_LEVEL * (level - 1)).
# Level-1 casts still land for the printed base. Buffs/curses stay flat.
SPELL_POWER_PER_LEVEL = 1.0

# ── Squirrel caster passives (design 2026-07-23 squirrel-simple) ─────────────
SPELL_HASTE_MULT = 0.5        # spell_haste (T1): spell cooldowns × this
SPELL_WARRIOR_MULT = 2        # spell_warrior (T2): self-buff/heal magnitude × this
SPELL_MAGE_DAMAGE_MULT = 1.5  # spell_mage (T2): the mage's damage/boss spells × this
SPELL_MAGE_DODGE_MULT = 0.5   # spell_mage (T2): dodge chance vs the mage × this (2× hit)

# ── Spell scrolls & the Sedgemoor Witch (design 2026-07-23 bog-witch-scrolls) ─
SCROLL_SATCHEL_CAP = 6                       # held scrolls before drops convert to Spores
GRIMOIRE_CAPACITY = {1: 2, 2: 3, 3: 4}       # spells a book can hold, by book tier
INSCRIBE_COST = {1: 10, 2: 20, 3: 30}        # Spore fee to inscribe, by scroll tier
SCROLL_OVERFLOW_SPORES = 12                  # Spores when a scroll drop/over-cap is refunded
WITCH_SCROLL_MARKUP = 1.6                    # witch tier-I scroll price = inscribe cost × this
# Per-source scroll drop chance (which tier drops where lives in SCROLL_DROP_TIER).
SCROLL_DROP_CHANCE = {
    'loot': 0.08, 'mystery': 0.10,
    'elite': 0.15, 'dig': 0.20, 'cache': 0.18,
    'lair': 0.35, 'vault': 0.40, 'boss': 0.50,
}
