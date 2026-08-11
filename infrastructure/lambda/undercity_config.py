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
ROLL_CAP = 10                # active roll bank ceiling (~1.7h of tempo before overflow)
JOIN_ROLLS = 3
BRAVERY_BONUS_ROLLS = 1      # extra starting rolls for hatching a random creature
SHINY_HATCH_CHANCE = 0.05    # chance a hatched creature is shiny — purely cosmetic
                             # (a gold sparkle over its sprite + a hatch-log call-out)
ROLL_REGEN_MINUTES = 30      # regen tick length in minutes, up to ROLL_CAP
ROLLS_PER_REGEN = 3          # rolls banked each tick (3 rolls every 30 minutes)
RESTED_CAP = 15              # overflow protection, in rolls (~5 "stacks" of 3). At cap,
                             # a tick banks ROLLS_PER_REGEN here; below cap a tick pays
                             # DOUBLE and draws the extra from rested — net-neutral until
                             # this ceiling. Client shows it; payout is automatic.
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

# ── XP curve (design 2026-08-08 retune; supersedes 2026-08-04 pacing) ────────
# Progressive per-level cost so leveling paces a whole game night instead of
# capping early. Flat-ish early (casuals unaffected), ramps after RAMP_FROM so
# a single T2/T3 elite rarely auto-levels. Cap stays 12 — this changes PACE,
# not the power ceiling.
#
# Retuned from session 20260808-182231, where BOTH engaged players hit the L12
# cap with time to spare (Rumtin 00:22, 45min early; Andrew 01:01) and then
# burned 499 XP into a level that doesn't exist. Design target is now:
#   • L10 = the normal ceiling for a solidly engaged night ("most but not all")
#   • L11/L12 = genuine stretch goals ("12 should be REALLY good")
# Calibrated to that night's MEASURED income over 6h45m / ~55-57 rolls: the
# top two players earned 883 and 970 XP. Totals L1->12 = 950 (was 677), L1->10
# = 510 (was 420) — so 970 scrapes L12 by 20 XP and 883 ends at L11. Levels
# 1-6 are UNCHANGED (cumulative 150) on purpose: the fast early climb is the
# new-player onramp and every player that night died within 5 minutes of
# hatching, so the first hour must not get slower.
# Client mirror in src/app/undercity/data/forms.ts::xpToNext; sim harness in
# infrastructure/lambda/sim/.
XP_CURVE_BASE = 15
XP_CURVE_LINEAR = 5
XP_CURVE_RAMP = 5          # the "C" coefficient (quadratic ramp magnitude)
XP_CURVE_RAMP_FROM = 5     # ramp only bites for levels above this
# Flat XP granted the first time a player claims a biome Guild Sigil (on top of
# the lair boss's own XP). Five biome sigils => up to 250 bonus XP over a night,
# an alternative progression path to grinding wilds.
SIGIL_XP = 50

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
BOG_FORAGER_LOSS_FRACTION = 0.5  # Brackish Trudge "Bog Forager": a deeper scavenge
                          # than base Scrounger on a lost/fled/stalemated wild or
                          # elite fight. Layers on the pest's inherited scrounger.

# ── Consumable buffs (design 2026-08-10) ────────────────────────────────────
# Tonic buffs last several BATTLES, not one. Spells are effectively unlimited —
# you re-cast them off a cooldown — so a bought, consumed item that evaporated
# after a single fight was strictly the worse deal. Three fights makes a tonic a
# decision you make before a dungeon run rather than before one swing.
CONSUMABLE_BUFF_BATTLES = 3
# The Sovereign's Draught runs its own buff kinds (sovereign_*) so it LAYERS on
# top of the individual tonics instead of overlapping them. Slightly under the
# tonic values each, because you get all three at once plus a full heal.
SOVEREIGN_ATK = 4
SOVEREIGN_DEF = 2
SOVEREIGN_SPD = 2
# Mid-battle heal (Mending Salve): fraction of max HP restored, played with a
# stance like any other combat item.
COMBAT_HEAL_FRAC = 0.25

# Gear rider knobs (combat riders in undercity_engine.resolve_round).
CUTPURSE_SPORES = 6   # flat Spores after a won fight in which you landed a Feint
BRAMBLE_REFLECT = 2   # flat damage a Bramble carapace reflects when struck

# Form-passive combat knobs (design 2026-08-04 pest-line/Grave Titan rework).
COLOSSUS_DR = 0.15    # Grave Titan "Colossus": incoming enemy STRIKE damage is
                      # scaled by (1 - this). Applies to decisive/counter/clash/
                      # chip/swarm hits — NOT rot ticks or the Collapse ramp.
IMPROVISE_BONUS = 3   # Vexing Pest "Improvise": +this to the creature's lowest of
                      # ATK/DEF/SPD, applied as a one-battle buff at battle start.

# ── Attribute perks (design 2026-07-21) ──────────────────────────────────────
# Carapace Grind (DEF-10 perk): a Guard holder deals a DEF-scaled chip each round
# it does NOT win the exchange, converting DEF to offense independent of the
# stance triangle. Gated on the perk so NPCs never do it. Sim-validated at 0.5
# (pure-DEF/Guard co-equal with ATK/Aggress vs the boss: 142 -> ~330 dmg; 0.7
# stronger, 1.0 overshoots). See infrastructure/lambda/sim/proto_fix.py.
GUARD_CHIP_COEFF = 0.5
# DEF track now grants stacking bonus Max HP at each node (design 2026-08-04).
# Cumulative: DEF 6 -> +5, DEF 12 -> +15 (=5+10, matches the old flat +15 on
# Carapace Grind), DEF 18 -> +30. Applied in effective_stats while the perk holds.
THICK_HIDE_MAXHP = 5       # DEF-6:  bonus Max HP from Thick Hide
CARAPACE_GRIND_MAXHP = 10  # DEF-12: additional bonus Max HP from Carapace Grind
LAST_STAND_MAXHP = 15      # DEF-18: additional bonus Max HP from Last Stand
DEATHDRIVE_MULT = 0.5  # ATK-15: Aggress swing multiplier while below half HP
# Brutal Strikes (ATK-6 perk, design 2026-08-04): a decisive win hits for this
# much extra damage. Replaces Rend — a flat damage amp that leads naturally into
# Menace (ATK-12) making foes easier to read and out-hit.
BRUTAL_STRIKES_MULT = 0.30
# Foe HP fraction below which a gutcleaver fang's execute bonus applies. Raised
# from 0.30 (2026-08-10): at 30% the window almost never mattered — by the time
# a foe is that low the frenzy ramp has made ordinary hits lethal anyway, so the
# rider read as dead text. At 50% it actually shapes the back half of a fight.
GUTCLEAVER_EXECUTE_FRAC = 0.50

# ── Boss-familiar / boss signature traits (design 2026-08-04) ────────────────
# Grave Growth (Skullbriar): unconditional per-round ramp, ATK-leaning, capped.
GRAVE_GROWTH_ATK = 2
GRAVE_GROWTH_DEF = 1
GRAVE_GROWTH_MAX = 6
# Doom Counters (Sarulf): +DOOM_STEP to ATK/DEF/SPD each round the holder wins or
# ties a mirror; bigger but deniable (force it to LOSE and it stalls). Capped.
DOOM_STEP = 2
DOOM_MAX = 4
# Dredge (Gitrog): flat HP regrow each round; kept small so escalating swings
# (and the player's DPS) still out-pace it and the fight terminates.
DREDGE_REGEN = 3
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
MARKET_MAX_LISTINGS = 10      # active listings per seller

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
    'gutcleaver':    {1: 0.35, 2: 0.50, 3: 0.70, 4: 0.90},  # +win multiplier vs a foe under
                                                             # GUTCLEAVER_EXECUTE_FRAC HP
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
# Umori, the wandering collector: minutes he dwells at one wilderness node before
# hopping. Each window is ONE sealed-bid auction. Shortened from 120 so a 6-8h
# game-day event gets ~5-8 auction beats rather than 3-4 (see the auction design).
UMORI_DWELL_MIN = 75
# Sealed-bid auction (design 2026-08-05). Bids are Spores; the top UMORI_WINNERS
# bidders each pull a ranked mystery box. A rank whose winning bid is below its
# reserve rolls the consolation table instead of its rich table — the anti-exploit
# floor that stops a lone cheap bid from cracking the best box.
UMORI_MIN_BID = 5
UMORI_WINNERS = 3
UMORI_RESERVES = {1: 80, 2: 40, 3: 15}
SHRINE_BLESSING_COST = 30
OSSUARY_MAX_BET = 20
OSSUARY_ROLLS_PER_VISIT = 3  # gambles allowed per landing; refills when you land again

# ── Home-biome hatch perks ───────────────────────────────────────────────────
MARROWBORN_MAXHP = 8   # Ossuary Fields (bone) home: flat +Max HP, applied at hatch

# ── Renown shop (pre-spawn) ──────────────────────────────────────────────────
SHOP_START_RENOWN = 100      # seed for a brand-new player: e.g. two common hats or a plain color + hat

# ── World Event ("The Great Beast") ──────────────────────────────────────────
# A season-shared co-op boss that spawns in the wilderness once the first sigil
# lair is cleared. Players chip a shared HP pool in bounded skirmishes; on death
# every contributor is paid by damage bracket. Mirror in
# src/app/undercity/data/world-event.ts when tuned.
#
# DAMAGE CHECK (design 2026-08-09). The beast has NO kill pool — it cannot be
# felled. The hunt runs for a fixed window; everyone wades in and deals what
# damage they can, and when the clock expires the beast withdraws and the spoils
# are dealt out by damage bracket. Its skirmish stat block carries a nominal HP
# that the ROUND_CAP always ends first, so a fight is always a damage check and
# never a race to a killing blow.
#
# Fixes what session 20260808-182231 showed: the beast lived 4h19m, exactly one
# player ever engaged it, and he took the whole prize for ~2 turns of work that
# nobody else could dip into. With no kill, nobody can end the event early and
# lock everyone else out; with a deadline, the payout lands while people are
# still at the table.
#
# Wall-clock is correct here (cf. the step-timer rule): this is SHARED world
# state, so step-timing it would desync players against each other.
WORLD_EVENT_SKIRMISH_HP = 99999  # nominal per-skirmish HP. Never depleted — the
                                 # round cap always ends the fight first.
WORLD_EVENT_DURATION_MIN = 90    # minutes from spawn until the beast withdraws.
                                 # It spawns on the first sigil clear (~1.5h into
                                 # a night), so the payout lands mid-evening while
                                 # everyone is still playing.
WORLD_EVENT_ROUND_CAP   = 6      # a single skirmish auto-ends after this many rounds
# Brackets are ABSOLUTE cumulative damage, not a share of a pool (there is no
# pool) and not a share of the group's total. Your reward reflects what YOU did,
# so a big turnout never dilutes anyone and a small one never inflates them —
# consistent with "equal turns, wealth gaps are legitimate". The single top
# dealer still takes the Vanquisher crown on top, so there's something to race
# for. Calibrated to observed damage: an apex creature deals ~50-100 in one
# 6-round skirmish, a fresh one ~20-40.
WORLD_EVENT_MAJOR_DAMAGE = 150   # cumulative damage for the Major bracket
WORLD_EVENT_MINOR_DAMAGE = 60    # cumulative damage for the Minor bracket

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
# Tuned high (2026-08-05): a boss lair should crawl with its familiars — the
# signature dominates wild encounters, leaving ~1-in-4 for pool variety.
SIGNATURE_SPAWN_CHANCE = 0.75

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
# Board spaces an egg must be carried before it can hatch (design 2026-08-10).
# Incubation is a STEP timer, not a clock — same philosophy as forage's
# PET_FORAGE_RECHARGE_SPACES below. The game is meant to be played in short
# bursts, so nothing you start should be finishable only by waiting: walk it out
# and it hatches, every time, under your control. (The old 5-minute clock is why
# a player in session 20260808-182231 started an incubator as their last act and
# never saw it open.) Sized to sit comfortably inside one roll bank (ROLL_CAP 10)
# so a burst player can always finish what they start.
PET_INCUBATE_SPACES = 5

# Activated abilities now ALL recharge by distance, not by clock (design
# 2026-08-10) — forage led the way and scout followed, so nothing a companion
# does can be gated behind waiting rather than playing.
#
# Scout: base spaces to recharge, shaved as the pet levels, never below a floor.
# Sized against the old 30-minute clock the same way forage was: at the observed
# pace (~9 board spaces/hour) the wall-clock cost lands a bit higher than the
# timer it replaces, but it is now entirely under the player's control.
PET_SCOUT_RECHARGE_SPACES = 9
PET_SCOUT_RECHARGE_PER_LVL = 1        # spaces shaved per level above 1
PET_SCOUT_RECHARGE_FLOOR = 4          # never fewer than this

# Forage recharges by DISTANCE, not time: using it primes a countdown of this
# many board spaces; every space walked ticks it down, ready again at 0. Flat
# (does not scale with level — leveling still raises the Spore payout instead).
# This rewards movement/speed instead of forcing players back on a clock. Mirror
# in src/app/undercity/data/pets.ts.
PET_FORAGE_RECHARGE_SPACES = 6

# Scout courier: the max ITEM tier a scout can haul back from its biome bazaar,
# indexed by the pet's level - 1 (clamped). Merging up a scout (raising its level
# cap via tier) is what unlocks the rare T3 black-market gear and T3/T4 eggs.
# Levels 1-2 -> T1, 3-4 -> T2, 5-6 -> T3, 7-9 -> T4.
PET_SCOUT_TIER_BY_LEVEL = [1, 1, 2, 2, 3, 3, 4, 4, 4]

# Mouse scavenge yield (scalars; level-scaled in the handler): a small spore
# cache plus a level-scaled chance to also dig up a consumable.
PET_MOUSE_SPORES_BASE = 8
PET_MOUSE_SPORES_PER_LVL = 3
PET_MOUSE_ITEM_CHANCE_BASE = 0.20
PET_MOUSE_ITEM_CHANCE_PER_LVL = 0.05

# Economy companion: scavenges Spores as you MOVE. Each loot space you pass OVER
# (an interior node of the walk, not the space you land on) banks a few Spores
# onto the pet, which the player taps to redeem via its board quick-use box.
# Per-loot yield + the bank cap scale with the pet's level; the cap keeps a bank
# finite so it stays a "gather while you explore, then collect" loop. Mirror in
# src/app/undercity/data/pets.ts.
PET_SPORE_PER_LOOT_BASE = 5         # Spores banked per loot space passed, at level 1
PET_SPORE_PER_LOOT_PER_LVL = 1      # added per level above 1 (climbs toward the max)
PET_SPORE_PER_LOOT_MAX = 8          # per-loot yield caps here no matter how high the level
PET_SPORE_CAP_BASE = 60             # most that can bank before you must collect
PET_SPORE_CAP_PER_LVL = 30          # added per level above 1

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

# ── Elf innate abilities (split 2026-08-05; constant names kept for stability) ─
# Gift of the Fair Folk (id 'gift_of_fair_folk'):
GORGON_START_POINTS = 5           # banked stat points the Elf spawns with
GORGON_STAT_POINTS_PER_LEVEL = 1  # she banks 1/level instead of the usual 2
# Natural Enchanter (id 'stonewright'):
GORGON_PET_LEVEL_BONUS = 1        # her active pet fights as if this many levels higher
GEAR_PLUS_BUMP = 1                # Gear+ adds this to a piece's primary stat…
GEAR_PLUS_MYTHIC_BUMP = 2         # …or this at Mythic (tier 4)

# ── Gorgon abilities (Petrify) ───────────────────────────────────────────────
PETRIFY_SLOW = 2          # -SPD applied to the enemy per Petrify stack
PETRIFY_FREEZE_AT = 4     # Petrify stacks that trigger a one-round freeze (then reset)

# ── Wood Lurker (Mimicry) ────────────────────────────────────────────────────
MIMIC_MIRROR = 3     # +stat matching the foe's fighting style (brute/turtle/trickster)
MIMIC_BALANCED = 1   # +ATK/+DEF/+SPD vs a balanced foe

# ── Colossal Grave-Reaver: Treasure Sense (design 2026-08-07) ────────────────
# The economy apex finds gear far more often and one rarity tier higher.
TREASURE_SENSE_DROP_MULT   = 2.0  # gear-drop chance multiplier for the passive
TREASURE_SENSE_CHANCE_CAP  = 0.95 # cap so a boosted drop never becomes guaranteed
TREASURE_SENSE_RARITY_BUMP = 1    # rolled gear tier is bumped by this
# ── Gear rarity ceiling (design 2026-08-09 mid-game difficulty) ──────────────
# Found gear can't exceed the rarity your CREATURE TIER has earned: tier 1 ->
# Common, tier 2 -> Rare, tier 3 -> Legendary (Mythic stays craft-only). Before
# this there was no gate at all, and treasure tiles (cache/trove/vault) FLOOR at
# Rare with a 40% Legendary roll — so one early cache put a level-3 player in
# Legendary gear. Measured: that build wins 100% of every biome band and 65% of
# wilderness elites, i.e. it solves the board before the mid-game starts.
# Evolving is now what unlocks better loot. Applied to the base roll; Treasure
# Sense still bumps one step above (that passive is apex-only and already capped
# by TREASURE_SENSE_MAX_TIER).
GEAR_RARITY_CAP_BY_TIER = {1: 1, 2: 2, 3: 3}

# ── Dungeon sigil scaling (design 2026-08-09) ────────────────────────────────
# Dungeon interiors (region 'depths') and their lair guardians get tougher for
# every Guild Sigil the player ALREADY holds, so the 4th dungeon pushes back
# harder than the 1st and there's a reason to surface between runs and spend the
# dungeon's rewards on gear.
#
# This is the ONE deliberate exception to _wild_battle's "never scaled to the
# player" rule, and it keys off QUESTLINE PROGRESS rather than level or power:
# everyone meets the same curve at the same point in the run, so being ahead
# just means reaching the hard dungeons sooner — no catch-up, no rubberbanding.
# Home biome rings stay flat and easy on purpose; they're the T1 starting areas.
#
# Enemy stat multiplier = 1 + DUNGEON_SIGIL_SCALING * sigils_held.
# Tuned on the level/sigil diagonal actually observed in session 20260808-182231
# (sigils landed at ~L7/0 held, L9/1, L10/2, L11/3, L12/4). At 0.40 the sim win
# rate on dungeon wilds runs 100% -> 99% -> 98% -> 82% -> 68% across a five-
# dungeon run, while lair guardians only fall 98% -> 89%. That's deliberate: the
# CRAWL wears you down and sends you back up to re-gear, but the sigil objective
# itself never becomes a wall. 0.12 was invisible past L8; 0.50 was a wall.
DUNGEON_SIGIL_SCALING = 0.40
# SPD is deliberately excluded — initiative and the stance triangle are tuned
# per creature, and scaling them would change fight *shape*, not just pressure.
DUNGEON_SIGIL_SCALED_STATS = ('hp', 'atk', 'def')
TREASURE_SENSE_MAX_TIER    = 3    # ceiling — never bumps into craft-only tier-4 mythics

# ── Grime Gorger (design 2026-08-10) ─────────────────────────────────────────
# The apex that edits the board. Gorge turns junk into Mulch; Reclaim spends
# Mulch, standing on a space, to rewrite what that space is.
GORGE_BAG_SIZE = 10           # its consumable bag; every other form keeps BAG_SIZE 5
# Yields by item rarity (the shared 1-4 Common/Rare/Legendary/Mythic ladder).
# Gear is worth double a consumable of the same rarity, matching the real price
# tables (gear 23/47/82/150 vs consumables 12/25/45/80). Deliberately slightly
# WORSE per forgone Spore at high rarity, so Commons are the efficient fuel and
# the Gorger buys the table's junk instead of eating its own best gear.
GORGE_MULCH_CONSUMABLE = {1: 1, 2: 2, 3: 3, 4: 4}
GORGE_MULCH_GEAR       = {1: 2, 2: 4, 3: 6, 4: 8}

# Price of creating each space type. Cheap spaces buy XP, expensive spaces buy
# wealth — that tension is the point of the spread. `shop` at 60 is the number
# least trusted here; revisit it after a real session.
RECLAIM_PRICES = {'wild': 4, 'mystery': 6, 'loot': 10, 'elite': 12,
                  'cache': 14, 'rest': 18, 'crystal_vein': 24,
                  'excavation': 24, 'trove': 30, 'shop': 60}
# `restsUsed` is tracked PER NODE, not as a per-descent count, so a creatable
# rest node in the depths manufactures extra full heals and dissolves descent
# attrition. A created shop is the same failure in economic form: a descent's
# tension is committing without resupply. Both are free to build on the surface.
RECLAIM_SURFACE_ONLY = ('rest', 'shop')
RECLAIM_MAX_CLAIMS = 3        # standing claims per player; a 4th collapses the oldest
