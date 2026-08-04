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
ROLL_NUDGE_THRESHOLD = 3     # push "rolls ready" when idle rolls regen up to this
ROLL_NUDGE_IDLE_MIN = 10     # ...but not if the player acted within this many minutes
CLAIM_FINISHED_ROLLS = 2
CLAIM_WON_BONUS_ROLLS = 1
CLAIM_WON_SPORES = 10
CLAIM_FINISHED_COOLDOWN_MIN = 15
CLAIM_TAUGHT_ROLLS = 1
CLAIM_TAUGHT_MAX = 2
POKE_COOLDOWN_MIN = 15       # each creature can be poked once every N min, by ANYONE
                             # (every poke grants the target +1 roll)
HIGH_FIVE_COOLDOWN_MIN = 30  # a player can re-high-five the SAME creature only every N min
GRIMOIRE_SWAP_COOLDOWN_MIN = 30  # opening a different grimoire is gated for N min
                             # (stowing your open book is always free) — client
                             # mirror in src/app/undercity/data/spells.ts

# ── Overgrown Cache (loot Flow puzzle) ───────────────────────────────────────
# The cache is a routing puzzle: connect the green start to the amber goal by
# any path. Every tile crossed grants spores, capped so the space stays economy-
# fair (~old forage floor of ~10). Client mirror lives at the top of
# src/app/undercity/tabs/flow-puzzle.component.ts.
FLOW_SPORE_PER_CELL = 0.5    # spores per tile crossed (path length)
FLOW_SPORE_CAP = 10          # hard ceiling on a single cache's movement spores
FLOW_MOLTING_REWARD = 1      # Moltings granted per Overgrown Cache molting pickup

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
# PvP clone duel (design 2026-07-27): attacking a player fights a full-HP AI
# clone of them. The clone's stance-AI personality is themed from its
# gear-inclusive stat spread — the top stat must exceed the runner-up by at
# least this fraction to lock in a theme, else the clone is 'balanced'.
CLONE_DOMINANCE_MARGIN = 0.20
# Higher-level clones read/bluff harder (mirrors elites vs fodder), capped so it
# never feels random. bluff = min(CLONE_BLUFF_CAP, CLONE_BLUFF_BY_LEVEL × level).
CLONE_BLUFF_BY_LEVEL = 0.02
CLONE_BLUFF_CAP = 0.30
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
# DEF-6 Thick Hide hazard dodge (design 2026-08-01): a DEF-scaled chance to avoid
# a hazard entirely, surfaced as "lucky safety wedges" on the hazard wheel. Scales
# with the DEF perk-stat (base + gear, temp buffs excluded); depths hazards dodge
# at half the chance so the boss approach stays brutal. The THICK_HIDE_MULT halving
# above still applies on a hit — the dodge is additive.
THICK_HIDE_DODGE_BASE = 0.15         # dodge chance at DEF perk-stat 6 (tier-1 unlock)
THICK_HIDE_DODGE_PER_DEF = 0.02      # +chance per DEF point above 6
THICK_HIDE_DODGE_MAX = 0.40          # cap
THICK_HIDE_DODGE_DUNGEON_MULT = 0.5  # depths/dungeon hazards dodge at half the surface chance
# Baseline "lucky" hazard avoid (design 2026-08-02): the hazard wheel always
# carries one lucky slice — a small chance for ANY creature that a surface hazard
# just fizzles (flavourwise pure luck, mechanically identical to a Thick Hide
# resist). Deliberately SURFACE-only (0 in the depths) so the boss approach stays
# brutal — down there only Thick Hide's own resist can turn a hazard aside.
HAZARD_LUCKY_AVOID = 0.08            # surface-only baseline no-harm chance (everyone)
# DEF-18 Last Stand (design 2026-08-01): revive at half max HP on an otherwise-
# lethal blow, recharging on a real-time cooldown instead of once per descent.
LAST_STAND_HP_FRAC = 0.5             # fraction of max HP to revive at (was a flat 1)
LAST_STAND_COOLDOWN_MINUTES = 60     # real-time recharge between saves
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
SALVAGE_MOLTINGS = {1: 1, 2: 2, 3: 4, 4: 6}
SALVAGE_ICHOR = 1             # Chrysalis Ichor from grinding a Legendary OR Mythic (tier >= 3)
# Blacksmith upgrade cost to reach the given tier (from the tier below).
UPGRADE_SPORES = {2: 40, 3: 80, 4: 150}
UPGRADE_MOLTINGS = {2: 3, 3: 6, 4: 0}    # Mythic's gate is Ichor, not Moltings
UPGRADE_ICHOR = {2: 0, 3: 1, 4: 3}  # Rare->Legendary needs 1 Ichor; Legendary->Mythic needs 3

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
    # rider          {1: common, 2: rare, 3: legendary, 4: mythic}   # unit / anchor to today's value
    'barbed':        {1: 1,    2: 2,    3: 3,    4: 4},     # rot stacks on Aggress (T1 today=1)
    'bloodfang':     {1: 0.40, 2: 0.50, 3: 0.60, 4: 0.70},  # heal frac of Aggress-win dmg (T1 today=0.40)
    'deep_biter':    {1: 0.35, 2: 0.50, 3: 0.70, 4: 0.90},  # +win MULTIPLIER (T2 today=0.50; T3 buffed)
    'rabid':         {1: 1,    2: 2,    3: 3,    4: 4},      # +ATK ramp per Aggress win (T2 today=2; T3 buffed)
    'gutcleaver':    {1: 0.35, 2: 0.50, 3: 0.70, 4: 0.90},  # +win multiplier vs <30% HP (T2 today=0.50)
    'thick':         {1: 0.15, 2: 0.20, 3: 0.25, 4: 0.30},  # stall chip-through mult (T1 today=0.15)
    'spiked':        {1: 1.3,  2: 1.5,  3: 1.8,  4: 2.0},    # guard-counter reflect mult (T2 today=1.5; T3 buffed)
    'bramble':       {1: 2,    2: 3,    3: 4,    4: 5},      # flat reflect when struck (T1 today=2)
    'bulwark':       {1: 1,    2: 1,    3: 2,    4: 3},      # +DEF per Guard round (T2 today=1; T3 buffed)
    'mossback':      {1: 2,    2: 3,    3: 4,    4: 5},      # heal per Guard round (T2 today=3)
    'trickster':     {1: 0.50, 2: 0.60, 3: 0.70, 4: 0.80},  # frac of lost-Feint punish negated (T1 today=0.50)
    'serrated':      {1: 1,    2: 2,    3: 3,    4: 4},      # flat cut to foe next-round dmg (T2 today=2)
    'venomtrick':    {1: 1,    2: 2,    3: 3,    4: 4},      # rot on a winning Feint (T1 today=1)
    'cutpurse':      {1: 4,    2: 6,    3: 9,    4: 12},     # Spores after a won fight w/ Feint (T2 today=6)
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
SHRINE_BLESSING_COST = 30
OSSUARY_MAX_BET = 20
OSSUARY_ROLLS_PER_VISIT = 3  # gambles allowed per landing; refills when you land again
SNARE_SPILL_PCT = 0.20

# ── Home-biome hatch perks ───────────────────────────────────────────────────
MARROWBORN_MAXHP = 8   # Ossuary Fields (bone) home: flat +Max HP, applied at hatch

# ── Renown shop (pre-spawn) ──────────────────────────────────────────────────
SHOP_START_RENOWN = 100      # seed for a brand-new player: e.g. two common hats or a plain color + hat

# ── World Event ("The Great Beast") ──────────────────────────────────────────
# A season-shared co-op boss that spawns in the wilderness once the first sigil
# lair is cleared. Players chip a shared HP pool in bounded skirmishes; on death
# every contributor is paid by damage bracket. Mirror in
# src/app/undercity/data/world-event.ts when tuned.
WORLD_EVENT_HP          = 200   # shared pool; sized so it takes many skirmishes
WORLD_EVENT_ROUND_CAP   = 6     # a single skirmish auto-ends after this many rounds
WORLD_EVENT_MAJOR_SHARE = 0.25  # damage-share threshold for the Major bracket
WORLD_EVENT_MINOR_SHARE = 0.10  # damage-share threshold for the Minor bracket

# Per-bracket payout. Vanquisher = single top damage dealer. `tiers` is the gear
# drop's tier-weight profile (keys are gear tiers, values relative weights) — one
# guaranteed piece per contributor, weighted better as the bracket rises. `xp` is
# the kill-bonus XP on top of the per-skirmish participation XP. Mirror the
# spores/renown/xp in src/app/undercity/data/world-event.ts when tuned.
WORLD_EVENT_REWARDS = {
    'vanquisher':  {'spores': 120, 'renown': 5, 'xp': 60, 'tiers': {2: 0.4, 3: 0.6}},
    'major':       {'spores': 80,  'renown': 3, 'xp': 40, 'tiers': {2: 0.7, 3: 0.3}},
    'minor':       {'spores': 45,  'renown': 2, 'xp': 25, 'tiers': {1: 0.5, 2: 0.5}},
    'participant': {'spores': 20,  'renown': 0, 'xp': 15, 'tiers': {1: 1.0}},
}

# ── Enraged wilderness monsters (design 2026-07-30) ──────────────────────────
# A single shared, spell-targetable terror roams the wilderness, relocating to a
# new deterministic node every ENRAGED_DWELL_MIN minutes (pure wall-clock window,
# no server tick — same model as Umori). Guardian-style: land on it to fight, or
# soften/curse it from range; a lethal strike (or the killing melee blow) claims
# the reward. Mirror in src/app/undercity/data/enraged.ts when tuned.
ENRAGED_DWELL_MIN = 90       # minutes a monster haunts one node before it hops
ENRAGED_KILL_RENOWN = 18     # renown to the killing blow's perm doc (design: 15–20)
ENRAGED_KILL_XP = 30         # XP to the killer

# ── Boss-area signature minions ──────────────────────────────────────────────
# Each biome depths pocket (and the ruins) has one themed "signature" enemy that
# is thematically aligned with the boss that lairs there — Skullbriar's ossuary
# crawls with skeletons, Slimefoot's rotcellar with saproling-spawners, etc.
# (data.LAIR_SIGNATURE). At a WILD space in that boss's area this fraction of
# encounters roll the signature instead of the flat region pool, so it reads as
# that boss's turf without erasing variety. Elite spaces keep the full pool.
SIGNATURE_SPAWN_CHANCE = 0.40

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


# ── Companions ────────────────────────────────────────────────────────────
# Minutes an egg sits in the (single) incubator before it can hatch.
PET_INCUBATE_MINUTES = 5

# Activated-ability real-time cooldowns (minutes), keyed by ROLE; leveling the
# pet shortens the wait down to a floor. Mirrors the spell-cooldown idiom.
PET_ABILITY_COOLDOWN_MIN = {'scout': 30, 'forage': 20}
PET_ABILITY_COOLDOWN_PER_LVL = 2      # minutes shaved per level above 1
PET_ABILITY_COOLDOWN_FLOOR = 5        # never faster than this

# Mouse scavenge yield (scalars; level-scaled in the handler): a small spore
# cache plus a level-scaled chance to also dig up a consumable.
PET_MOUSE_SPORES_BASE = 8
PET_MOUSE_SPORES_PER_LVL = 3
PET_MOUSE_ITEM_CHANCE_BASE = 0.20
PET_MOUSE_ITEM_CHANCE_PER_LVL = 0.05

# Grub passive: a small moltings trickle on every completed move, feeding the
# gear/pet upgrade loop. Grows slowly with the pet's level.
PET_GRUB_MOLTINGS_BASE = 1
PET_GRUB_MOLTINGS_PER_LVL = 0.34

# The Rot Bazaar's Eggs tab: a couple of eggs stocked per 30-min window, skewed
# to low tiers, each a Spore-priced gamble. Deterministic per (node, window) like
# the rest of the shop stock. Mirror in board-tab.component.ts egg rows.
SHOP_EGG_SLOTS = 2                 # egg lines rolled per window (may collapse by tier)
SHOP_EGG_QTY = 1                   # units per stocked egg tier
SHOP_EGG_TIER_WEIGHTS = {1: 0.6, 2: 0.3, 3: 0.1}
SHOP_EGG_COST = {1: 25, 2: 60, 3: 130, 4: 250}

# Player-market resale value of a companion / egg — the price band centers on
# this via MARKET_PRICE_MIN/MAX_PCT, exactly like gear. Pets scale with level.
PET_MARKET_VALUE = {1: 20, 2: 55, 3: 120, 4: 240}
PET_MARKET_PER_LEVEL = 6
EGG_MARKET_VALUE = {1: 25, 2: 60, 3: 130, 4: 250}


# ── Respawning ruin lairs (design 2026-08-02) ────────────────────────────────
# The two side-content ruin lairs (Lord of Extinction, Doomgape) don't share the
# season pool or reform a Vestige. A personal kill leaves the lair abandoned for
# this many minutes (per player), then it respawns at full strength.
LAIR_RESPAWN_MINUTES = 60
# While abandoned, a visit scrounges this many Spores (inclusive range) once, plus
# a small chance of one minor consumable.
LAIR_SCAVENGE_SPORES = (5, 10)
LAIR_SCAVENGE_ITEM_CHANCE = 0.18
