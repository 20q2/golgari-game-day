"""
Static game data for The Undercity — creatures, items, NPCs, and the board map.

Pure constants, no AWS imports, so the module is unit-testable. The board
graph loads from the checked-in map.json (source of truth — edited by the
/undercity/map-editor dev tool or by hand; map_bootstrap.py can re-seed a
fresh procedural board). After editing map.json run sync_map.py to refresh
the client copy at public/data/undercity-map.json. All balance numbers come
from the GDD tables.
"""
import json
from pathlib import Path

# Tunables (roll economy, debug flag, facility knobs) live in their own file
# so balancing never means digging through this one. Re-exported so everything
# keeps reading `data.ROLL_CAP` etc.
from undercity_config import *  # noqa: F401,F403

# ── Leveling ─────────────────────────────────────────────────────────────────

LEVEL_CAP = 12
HP_PER_LEVEL = 3
STAT_POINTS_PER_LEVEL = 2

XP_REWARDS = {
    'wild_loss': 5,
    'pvp_win': 20,
    'pvp_loss': 8,
    'timeout': 5,          # consolation for both sides on a 6-round draw
    'taught_claim': 5,
}


def xp_to_next(level: int) -> int:
    """XP cost to go from `level` to `level + 1`."""
    return 20 + 5 * level


# ── Creatures ────────────────────────────────────────────────────────────────

# Starter lines (tier 1). Stats are the level-1 base.
STARTERS = {
    'pest': {
        'name': 'Pest', 'hp': 30, 'atk': 6, 'def': 5, 'spd': 5,
        'passive': 'scrounger',
        'blurb': 'Balanced sewer rat. Scrounger: +2 Spores from every loot source.',
    },
    'kraul': {
        'name': 'Kraul Grub', 'hp': 24, 'atk': 8, 'def': 3, 'spd': 7,
        'passive': 'first_bite',
        'blurb': 'Glass-cannon insect. First Bite: always strikes first in round 1.',
    },
    'saproling': {
        'name': 'Saproling', 'hp': 38, 'atk': 5, 'def': 7, 'spd': 3,
        'passive': 'regrowth',
        'blurb': 'Tanky plant token. Regrowth: heal 20% max HP after any battle.',
    },
    'zombie': {
        'name': 'Zombie', 'hp': 27, 'atk': 5, 'def': 5, 'spd': 6,
        'passive': 'drift',
        'blurb': 'Was somebody once. Now part of the swarm. Endless Ranks: +15% flee chance; bad mystery events reroll once.',
    },
}

# Tier 2 forms (level 5). `bonus` is applied on evolution (maxHp values already
# ×3 relative to a stat point). Creatures keep their line passive AND gain the
# form passive (Rootwall upgrades Regrowth rather than stacking).
TIER2 = {
    'brackish_trudge': {
        'name': 'Brackish Trudge', 'line': 'pest', 'bonus': {'maxHp': 6, 'atk': 2},
        'passive': 'undying',
        'blurb': 'Bruiser. Undying: first compost each hour revives you at 50% HP instead.',
    },
    'stinkweed_imp': {
        'name': 'Stinkweed Imp', 'line': 'pest', 'bonus': {'spd': 2, 'atk': 2},
        'passive': 'flyby',
        'blurb': 'Speedster. Flyby: 25% chance enemy strikes miss.',
    },
    'kraul_warrior': {
        'name': 'Kraul Warrior', 'line': 'kraul', 'bonus': {'atk': 4},
        'passive': 'venom_barb',
        'blurb': 'Striker. Venom Barb: your first strike each battle deals +3.',
    },
    'golgari_longlegs': {
        'name': 'Golgari Longlegs', 'line': 'kraul', 'bonus': {'spd': 4},
        'passive': 'reach',
        'blurb': 'Skirmisher. Reach: in round 1 the enemy’s decisive blow finds only air — you strike from outside its range.',
    },
    'slitherhead': {
        'name': 'Slitherhead', 'line': 'saproling', 'bonus': {'atk': 2, 'maxHp': 6},
        'passive': 'scavenge',
        'blurb': 'Counterpuncher. Scavenge: retaliate for 2 damage whenever struck.',
    },
    # id kept as 'woodwraith_strangler' for save-compat; displays as Myconid Sporetender.
    'woodwraith_strangler': {
        'name': 'Myconid Sporetender', 'line': 'saproling', 'bonus': {'def': 2, 'maxHp': 6},
        'passive': 'rootwall',
        'blurb': 'Fortress. Rootwall: Regrowth improves to 35%.',
    },
    'shambling_shell': {
        'name': 'Shambling Shell', 'line': 'zombie', 'bonus': {'maxHp': 6, 'def': 2},
        'passive': 'dredge',
        'blurb': 'Durable trickster. Dredge: reclaim your snare after it triggers.',
    },
    'corpsejack_menace': {
        'name': 'Corpsejack Menace', 'line': 'saproling', 'bonus': {'atk': 4},
        'passive': 'doubling_rot',
        'blurb': 'Fungal tycoon. Doubling Rot: mystery-event Spore payouts doubled.',
    },
    'deathrite_shaman': {
        'name': 'Deathrite Shaman', 'line': 'zombie', 'bonus': {'maxHp': 6, 'def': 2},
        'passive': 'soul_harvest',
        'blurb': 'Ritualist. Soul Harvest: +50% Spores from wild & elite battle wins.',
    },
}

# Apex forms (level 10).
APEX = {
    'grave_titan': {
        'name': 'Grave Titan', 'bonus': {'maxHp': 6, 'def': 2},
        'passive': 'deathtouch_stomp',
        'from': ['brackish_trudge', 'woodwraith_strangler', 'shambling_shell', 'deathrite_shaman'],
        'blurb': 'Deathtouch Stomp: your strikes ignore 3 of the enemy’s DEF.',
    },
    'golgari_lich_lord': {
        'name': 'Golgari Lich Lord', 'bonus': {'atk': 2, 'maxHp': 6},
        'passive': 'drain_life',
        'from': ['slitherhead', 'woodwraith_strangler', 'corpsejack_menace', 'deathrite_shaman'],
        'blurb': 'Drain Life: heal for 50% of damage you deal.',
    },
    'swamp_dragon': {
        'name': 'Swamp Dragon', 'bonus': {'atk': 2, 'spd': 2},
        'passive': 'rot_breath',
        'from': ['brackish_trudge', 'stinkweed_imp', 'kraul_warrior', 'golgari_longlegs'],
        'blurb': 'Rot Breath: round-1 strike hits for double.',
    },
    'izoni': {
        'name': 'Izoni, Thousand-Eyed', 'bonus': {'spd': 4},
        'passive': 'swarm',
        'from': ['stinkweed_imp', 'kraul_warrior', 'golgari_longlegs', 'slitherhead', 'shambling_shell', 'corpsejack_menace'],
        'blurb': 'Swarm: one extra strike every battle round.',
    },
}


def tier2_options(line: str):
    return [fid for fid, f in TIER2.items() if f['line'] == line]


def apex_options(tier2_form: str):
    return [aid for aid, a in APEX.items() if tier2_form in a['from']]


ALL_FORMS = {**{k: dict(v, tier=1) for k, v in STARTERS.items()},
             **{k: dict(v, tier=2) for k, v in TIER2.items()},
             **{k: dict(v, tier=3) for k, v in APEX.items()}}


# ── Equipment & consumables ──────────────────────────────────────────────────

GEAR = {
    # Fang — Aggress riders
    'rusted_fang':  {'name': 'Rusted Fang',  'slot': 'fang', 'tier': 1, 'cost': 20, 'atk': 2, 'rider': 'barbed'},
    'bloodfang':    {'name': 'Bloodfang',    'slot': 'fang', 'tier': 1, 'cost': 25, 'atk': 2, 'rider': 'bloodfang'},
    'kraul_barb':   {'name': 'Kraul Barb',   'slot': 'fang', 'tier': 2, 'cost': 45, 'atk': 4, 'rider': 'deep_biter'},
    'rabid_fang':   {'name': 'Rabid Fang',   'slot': 'fang', 'tier': 2, 'cost': 48, 'atk': 3, 'spd': 1, 'rider': 'rabid'},
    'gutcleaver':   {'name': 'Gutcleaver',   'slot': 'fang', 'tier': 2, 'cost': 50, 'atk': 4, 'rider': 'gutcleaver'},
    'wurm_tooth':   {'name': 'Wurm Tooth',   'slot': 'fang', 'tier': 3, 'cost': 80, 'atk': 6, 'spd': 1, 'rider': 'deep_biter'},
    'ravening_maw': {'name': 'Ravening Maw', 'slot': 'fang', 'tier': 3, 'cost': 85, 'atk': 5, 'spd': 1, 'rider': 'rabid'},
    # Carapace — Guard riders
    'chitin_scrap': {'name': 'Chitin Scrap', 'slot': 'carapace', 'tier': 1, 'cost': 20, 'def': 2, 'rider': 'thick'},
    'bramble_hide': {'name': 'Bramble Hide', 'slot': 'carapace', 'tier': 1, 'cost': 25, 'def': 2, 'rider': 'bramble'},
    'bark_hide':    {'name': 'Bark Hide',    'slot': 'carapace', 'tier': 2, 'cost': 45, 'def': 4, 'rider': 'spiked'},
    'bulwark_plate': {'name': 'Bulwark Plate', 'slot': 'carapace', 'tier': 2, 'cost': 48, 'def': 3, 'maxHp': 3, 'rider': 'bulwark'},
    'mossback':     {'name': 'Mossback',     'slot': 'carapace', 'tier': 2, 'cost': 50, 'def': 3, 'rider': 'mossback'},
    'troll_hide':   {'name': 'Troll Hide',   'slot': 'carapace', 'tier': 3, 'cost': 80, 'def': 5, 'maxHp': 6, 'rider': 'spiked'},
    'ironshell_bulwark': {'name': 'Ironshell Bulwark', 'slot': 'carapace', 'tier': 3, 'cost': 85, 'def': 5, 'maxHp': 6, 'rider': 'bulwark'},
    # Charm — Feint riders (new slot; light on raw stats, value is the rider)
    'quartz_charm':   {'name': 'Quartz Charm',   'slot': 'charm', 'tier': 1, 'cost': 20, 'spd': 1, 'rider': 'trickster'},
    'venom_charm':    {'name': 'Venom Charm',    'slot': 'charm', 'tier': 1, 'cost': 25, 'spd': 1, 'rider': 'venomtrick'},
    'serrated_charm': {'name': 'Serrated Charm', 'slot': 'charm', 'tier': 2, 'cost': 45, 'spd': 1, 'rider': 'serrated'},
    'seer_charm':     {'name': 'Seer Charm',     'slot': 'charm', 'tier': 2, 'cost': 50, 'spd': 1, 'rider': 'seer', 'readBonus': 0.30},
    'cutpurse_charm': {'name': 'Cutpurse Charm', 'slot': 'charm', 'tier': 2, 'cost': 48, 'spd': 1, 'rider': 'cutpurse'},
    'glint_charm':    {'name': 'Glint Charm',    'slot': 'charm', 'tier': 3, 'cost': 80, 'spd': 2, 'rider': 'glint', 'readBonus': 0.15},
}

# Rider → the stance it modifies + a human blurb (client reads this in Plan 3).
GEAR_RIDERS = {
    'barbed':    {'stance': 'aggress', 'blurb': 'Your Aggress applies rot even on a clash or loss.'},
    'deep_biter':{'stance': 'aggress', 'blurb': 'Winning exchanges hit harder; nothing on a loss.'},
    'thick':     {'stance': 'guard',   'blurb': 'Your Guard chips in a stall and softens being wrong.'},
    'spiked':    {'stance': 'guard',   'blurb': 'Your Guard counter reflects part of the blocked hit.'},
    'trickster': {'stance': 'feint',   'blurb': 'A lost Feint is not fully punished.'},
    'serrated':  {'stance': 'feint',   'blurb': 'Your Feint break lowers the enemy next-round damage.'},
    'glint':     {'stance': 'feint',   'blurb': 'Winning a Feint reveals the enemy true next intent; +read rate.'},
    'seer':      {'stance': 'feint',   'blurb': 'Sharply raises how often you read the enemy intent.'},
    # Aggress (fang) — new
    'bloodfang':  {'stance': 'aggress', 'blurb': 'Heal 40% of the damage your winning Aggress deals.'},
    'rabid':      {'stance': 'aggress', 'blurb': 'Each Aggress you win, your Aggress hits gain +2 for the rest of the fight.'},
    'gutcleaver': {'stance': 'aggress', 'blurb': 'A winning Aggress against a foe below 30% HP deals +50%.'},
    # Guard (carapace) — new
    'bramble':    {'stance': 'guard',   'blurb': 'Reflect 2 damage whenever you are struck.'},
    'bulwark':    {'stance': 'guard',   'blurb': 'Each round you end in Guard, gain +1 DEF for the rest of the fight.'},
    'mossback':   {'stance': 'guard',   'blurb': 'Heal 3 each round you end in Guard.'},
    # Feint (charm) — new
    'venomtrick': {'stance': 'feint',   'blurb': 'Winning a Feint applies 1 rot to the foe.'},
    'cutpurse':   {'stance': 'feint',   'blurb': 'Land a winning Feint and pocket +6 Spores after a won fight.'},
}

CONSUMABLES = {
    'healing_moss': {'name': 'Healing Moss', 'cost': 12, 'blurb': 'Restore 50% max HP.'},
    'smoke_spore':  {'name': 'Smoke Spore',  'cost': 15, 'blurb': 'Held: your next failed flee auto-succeeds (consumed).'},
    'loaded_die':   {'name': 'Loaded Die',   'cost': 25, 'blurb': 'Choose your next roll’s value (1–6).'},
    'snare':        {'name': 'Snare',        'cost': 18, 'blurb': 'Trap your current space: next visitor spills 20% of their Spores and skips the space event.'},
    'scrying_spore': {'name': 'Scrying Spore', 'cost': 20, 'combat': True,
                      'effect': 'reveal', 'blurb': 'In battle: reveal the enemy true intent this round.'},
    'rot_bomb':      {'name': 'Rot Bomb', 'cost': 22, 'combat': True,
                      'effect': 'double_punish', 'blurb': 'In battle: double your damage if you win this round.'},
    'chitin_ward':   {'name': 'Chitin Ward', 'cost': 22, 'combat': True,
                      'effect': 'negate', 'blurb': 'In battle: cancel the punish from one wrong guess.'},
    'ambush_musk':   {'name': 'Ambush Musk', 'cost': 25, 'combat': True,
                      'effect': 'auto_win', 'blurb': 'In battle: win one exchange regardless of choices.'},
}

BAG_SIZE = 3
GEAR_SELL_BACK = 0.5  # replacing gear auto-sells old piece for 50% of cost

GEAR_SLOTS = ('fang', 'carapace', 'charm')

# The Swamp Torch: a toggleable light for the dark dungeons. Lit, it widens your
# fog-of-war radius (client-side, `lightHops`) but saps combat power — light OR
# fight, never both. Penalties are negative deltas applied in
# engine.effective_stats; both floor at 1 there. Tunable knobs; see
# specs/2026-07-19-undercity-deep-dungeons-design.md.
TORCH = {'atk': -3, 'def': -2, 'lightHops': 2}

# Gear drops from loot sources. Each entry: (chance, {tier: weight}).
# Common sources sit at ~0.10; one-time/hard POIs are elevated so a "treasure"
# actually feels like one. Chances/weights are the tuning surface.
GEAR_DROP = {
    'wild':     (0.10, {1: 1.0}),
    'elite':    (0.12, {1: 0.6, 2: 0.4}),
    'loot':     (0.10, {1: 1.0}),
    'mystery':  (0.12, {1: 0.6, 2: 0.4}),
    'treasure': (0.50, {2: 0.6, 3: 0.4}),
    'lair':     (0.35, {2: 0.5, 3: 0.5}),
    'boss':     (0.35, {2: 0.4, 3: 0.6}),
}

# ── Combat: stance triangle tuning (spec 2026-07-14 §1) ──────────────────────
# The triangle decides who wins an exchange; ATK/DEF set the magnitude. A "hit"
# is max(1, round(atk * uniform(0.85,1.15)) - effective_def); the multipliers
# below scale that hit per matchup. Balance baseline validated 2026-07-14
# (test_balance_good_play_beats_fodder: perfect reads beat fodder in ~3 rounds;
# a bare L1 creature cannot mash past an elite) — revisit after live playtest.
STANCES = ('aggress', 'guard', 'feint')

STANCE_WIN_MULT       = 1.5   # decisive winner (A>F, F>G) deals hit * this
STANCE_GUARD_MITIGATE = 0.4   # aggressor's hit when Guard wins (G>A)
STANCE_GUARD_COUNTER  = 0.6   # guard's counter hit when Guard wins (G>A)
STANCE_CLASH_MULT     = 1.0   # both sides on A-vs-A
STANCE_STALL_MULT     = 0.15  # both sides on G-vs-G
STANCE_STAT_WEIGHT    = 0.5   # Aggress double-dip: swing = atk × (1 + this). ATK
                              # is the aggressor's whole identity, so it stacks.
STANCE_OFFHAND_ATK_WEIGHT = 0.5  # ATK's PARTIAL base on Guard/Feint swings — low
                              # so a pure-ATK build can't also swing hard while
                              # guarding or feinting.
STANCE_SIG_WEIGHT     = 1.0   # Guard↔DEF / Feint↔SPD scaling. Guard swing =
                              # OFFHAND_ATK×atk + this×def; Feint likewise off SPD.
                              # Set high (≥ the double-dip) so a DEDICATED tank or
                              # speedster hits hard in its stance — DEF/SPD builds
                              # feel good to play, not just ATK.
# F-vs-F is a whiff: no damage either way.

ROT_PER_STACK   = 2   # damage per rot stack, ticked at end of each round
SWARM_CHIP_MULT = 0.5 # swarm: extra hit each round = hit * this (min 1)
SCAVENGE_RETALIATE = 2  # scavenge: damage dealt back when you LOSE an exchange
DEATHTOUCH_PIERCE  = 3  # deathtouch_stomp: Aggress reduces target eff-DEF by this
FLYBY_DODGE        = 0.25  # chance to dodge the punish when you LOSE an exchange
VENOM_BARB_BONUS   = 3   # first winning exchange +this
FIRST_WIN_ROT_BREATH_MULT = 2  # rot_breath: first winning exchange * this

MAX_ROUNDS_COMBAT = 6  # reference span the escalation ramp is tuned around (see FRENZY_*)
COMBAT_HARD_CAP   = 24  # safety terminator: no fight can exceed this many rounds. The
                        # escalation ramp (below) makes every fight — even a mutual
                        # stall — build to a real kill well before this bound, so it
                        # is unreachable insurance, NOT the normal stalemate resolver.

# Combat escalation (formerly "the Collapse"): the arena NEVER deals its own
# damage. Instead, from FRENZY_START each creature's OWN swings ramp up so a
# dragging fight resolves to a real kill instead of stalling forever. Every
# swing (via _base_hit) is scaled by 1 + FRENZY_RAMP * tier, where tier = rnd -
# FRENZY_START + 1. Applies to ALL fight kinds; a mutual-Guard lock still chips
# (the grind) once the ramp is live, so no fight ends in an empty timeout. The
# fighter who entered the escalation at the higher HP FRACTION (the tank)
# outlasts the foe. frenzy_from=None disables the ramp (persistent-pool paths).
FRENZY_START = 4     # first round the escalation ramp applies (of MAX_ROUNDS_COMBAT)
FRENZY_RAMP  = 0.2   # per-tier bonus to each creature's own swing (round 4 = x1.2)

# Reads: a "read" is an on-screen prediction of the foe's next stance. It only
# procs some rounds (base below) — reading is the reader build's payoff, not a
# freebie. Chance is snapshotted once per battle from the player's SPD, reader
# passives, and reader gear. Scrying Spore forces a true read on demand; a Glint
# feint-win guarantees the next round's read (see engine reveal_next).
READ_BASE = 0.25
READ_MAX = 0.90              # cap so a read is never fully guaranteed by stacking
READ_SPD_COEFF = 0.015       # faster creatures read better (+1.5%/SPD)
READ_PASSIVE_BONUS = {'first_bite': 0.20, 'flyby': 0.15}  # the fast insect lines
# gear read bonuses live on GEAR[*]['readBonus'] (Glint + Seer charms)

# Monster AI (spec §1). Each personality is a weight triple over
# (aggress, guard, feint); the monster's true stance is drawn from it and then
# telegraphed truthfully except on a bluff. Bluff rate scales difficulty.
STANCE_PERSONALITIES = {
    'brute':     (0.60, 0.25, 0.15),
    'turtle':    (0.20, 0.60, 0.20),
    'trickster': (0.20, 0.20, 0.60),
    'balanced':  (0.34, 0.33, 0.33),
}
NPC_DEFAULT_PERSONALITY = 'balanced'
NPC_DEFAULT_BLUFF = 0.0   # overworld fodder never bluffs; elites/bosses do

# ── Spells & grimoires ───────────────────────────────────────────────────────
# The spell system (specs/2026-07-10-undercity-spells-design.md). Innate biome
# spells are always castable; grimoire spells require the book equipped — you
# own every book you ever find (permanent collection), but only one is open at
# a time. Cooldowns are real-time minutes; `range` is BFS board distance.
# No spell can ever kill: player HP and boss pools floor at 1.

SPELL_DODGE_BASE = 10        # %
SPELL_DODGE_PER_SPD = 3      # % per point of (target SPD − caster SPD)
SPELL_DODGE_MIN = 5
SPELL_DODGE_MAX = 40
AWAY_EVENTS_CAP = 20
GRIMOIRE_DUPLICATE_SPORES = 15
MYSTERY_GRIMOIRE_CHANCE = 0.25  # mystery "free item" upgrades to an unowned book

SPELLS = {
    # Innate biome spells (one per home biome, always castable)
    'rot_surge':   {'name': 'Rot Surge', 'category': 'buff', 'tier': 1, 'cooldownMin': 30,
                    'effect': 'self_buff', 'buffKind': 'rot_surge',
                    'blurb': '+3 ATK in your next battle.'},
    'bone_chill':  {'name': 'Bone Chill', 'category': 'field', 'tier': 1, 'cooldownMin': 30,
                    'effect': 'field_curse', 'buffKind': 'bone_chill', 'range': 5,
                    'blurb': 'Curse a rival: −2 ATK in their next battle.'},
    'bog_snare':   {'name': 'Bog Snare', 'category': 'field', 'tier': 1, 'cooldownMin': 30,
                    'effect': 'field_curse', 'buffKind': 'vines', 'range': 5,
                    'blurb': 'Curse a rival: their next roll is halved.'},
    'glowveil':    {'name': 'Glowveil', 'category': 'buff', 'tier': 1, 'cooldownMin': 30,
                    'effect': 'self_buff', 'buffKind': 'glowveil',
                    'blurb': '+2 SPD and +15% flee chance in your next battle.'},
    'scrap_toss':  {'name': 'Scrap Toss', 'category': 'field', 'tier': 1, 'cooldownMin': 30,
                    'effect': 'field_damage', 'power': 8, 'range': 5,
                    'blurb': 'Hurl city scrap at a rival for 8 damage.'},
    # Tier I (shop grimoires)
    'spore_bolt':  {'name': 'Spore Bolt', 'category': 'field', 'tier': 1, 'cooldownMin': 20,
                    'effect': 'field_damage', 'power': 12, 'range': 6,
                    'blurb': 'A puff of caustic spores: 12 damage at range.'},
    'mend_flesh':  {'name': 'Mend Flesh', 'category': 'buff', 'tier': 1, 'cooldownMin': 15,
                    'effect': 'self_heal', 'power': 12,
                    'blurb': 'Knit your wounds: restore 12 HP.'},
    'harden_shell': {'name': 'Harden Shell', 'category': 'buff', 'tier': 1, 'cooldownMin': 20,
                     'effect': 'self_buff', 'buffKind': 'harden_shell',
                     'blurb': '+2 DEF in your next battle.'},
    'skitter_step': {'name': 'Skitter Step', 'category': 'traversal', 'tier': 1,
                     'cooldownMin': 25, 'effect': 'teleport', 'range': 3,
                     'blurb': 'Blink to any space within 3 steps.'},
    # Tier II (rare books — acquisition lands in phase 3)
    'rot_bolt':    {'name': 'Rot Bolt', 'category': 'field', 'tier': 2, 'cooldownMin': 25,
                    'effect': 'field_damage', 'power': 20, 'range': 7,
                    'blurb': 'A lance of concentrated rot: 20 damage at range.'},
    'weaken_hex':  {'name': 'Weaken Hex', 'category': 'field', 'tier': 2, 'cooldownMin': 25,
                    'effect': 'field_curse', 'buffKind': 'weaken_hex', 'range': 6,
                    'blurb': 'Curse a rival: −3 ATK in their next battle.'},
    'mycelial_recall': {'name': 'Mycelial Recall', 'category': 'traversal', 'tier': 2,
                        'cooldownMin': 45, 'effect': 'recall',
                        'blurb': 'The threads drag you home to your biome gate.'},
    'fate_die':    {'name': 'Fate Die', 'category': 'traversal', 'tier': 2,
                    'cooldownMin': 40, 'effect': 'fate_die',
                    'blurb': 'Choose the value of your next roll (1–6).'},
    # Tier III (legendary books — acquisition lands in phase 3)
    'spore_burst': {'name': 'Spore Burst', 'category': 'field', 'tier': 3, 'cooldownMin': 30,
                    'effect': 'field_damage', 'power': 30, 'range': 8,
                    'blurb': 'A detonation of spores: 30 damage at range.'},
    'deep_step':   {'name': 'Deep Step', 'category': 'traversal', 'tier': 3,
                    'cooldownMin': 30, 'effect': 'teleport', 'range': 6,
                    'blurb': 'Blink to any space within 6 steps.'},
    'queens_bane': {'name': "Queen's Bane", 'category': 'boss', 'tier': 3,
                    'cooldownMin': 60, 'effect': 'boss_strike', 'power': 15,
                    'blurb': 'Sear the Queen or a lair boss for 15, from anywhere.'},
}

# Home biome -> innate spell (always castable, no grimoire needed).
BIOME_SPELLS = {
    'garden': 'rot_surge',    # The Rot-Gardens (Composter)
    'bone':   'bone_chill',   # Ossuary Fields (Marrowborn)
    'bog':    'bog_snare',    # The Sedgemoor (Mirefoot)
    'cavern': 'glowveil',     # Mosslight Cavern (Glowblessed)
    'city':   'scrap_toss',   # The Undercity (City Rat)
}

# Found books come pre-loaded with a FIXED 1–3 spell bundle — the book IS the
# loadout; players never learn loose spells. Higher tiers carry stronger
# spells: that is the whole upgrade system.
GRIMOIRES = {
    # Tier I — stocked at every Rot-Farm Bazaar
    'moldering_folio':   {'name': 'Moldering Folio', 'tier': 1, 'cost': 25,
                          'spells': ['spore_bolt'],
                          'blurb': 'A waterlogged primer of offensive sporecraft.'},
    'gardeners_primer':  {'name': "Gardener's Primer", 'tier': 1, 'cost': 30,
                          'spells': ['mend_flesh', 'harden_shell'],
                          'blurb': 'Homestead magic: mend flesh, harden shell.'},
    'vagrants_chapbook': {'name': "Vagrant's Chapbook", 'tier': 1, 'cost': 30,
                          'spells': ['skitter_step'],
                          'blurb': 'Scrawled shortcuts through the tunnels.'},
    'warcasters_screed': {'name': "Warcaster's Screed", 'tier': 1, 'cost': 35,
                          'spells': ['rot_surge', 'spore_bolt'],
                          'blurb': 'Aggressor liturgy: swell with rot, then loose it.'},
    'hexweavers_codex':  {'name': "Hexweaver's Codex", 'tier': 1, 'cost': 35,
                          'spells': ['bone_chill', 'bog_snare'],
                          'blurb': 'Two curses for the price of one grudge.'},
    'nightrunners_ledger': {'name': "Nightrunner's Ledger", 'tier': 1, 'cost': 32,
                            'spells': ['glowveil', 'skitter_step'],
                            'blurb': 'Slip the light, then slip the room.'},
    'tinkers_manual':    {'name': "Tinker's Manual", 'tier': 1, 'cost': 30,
                          'spells': ['harden_shell', 'scrap_toss'],
                          'blurb': 'Brace the shell, then throw the scrap heap.'},
    # Tier II — rare finds (phase 3 acquisition; defined now for the data model)
    'kraul_warcodex':    {'name': 'Kraul Warcodex', 'tier': 2, 'cost': 70,
                          'spells': ['rot_bolt', 'weaken_hex'],
                          'blurb': 'Battle-liturgy of the kraul warhosts.'},
    'wayfarers_atlas':   {'name': "Wayfarer's Atlas", 'tier': 2, 'cost': 70,
                          'spells': ['mycelial_recall', 'fate_die', 'skitter_step'],
                          'blurb': 'Every tunnel, and several that should not exist.'},
    # Tier III — legendary (phase 3 acquisition)
    'queensbane_grimoire': {'name': 'Queensbane Grimoire', 'tier': 3, 'cost': 150,
                            'spells': ['queens_bane', 'spore_burst'],
                            'blurb': 'Heretical rites that wound what cannot be reached.'},
    'tome_of_deep_roads':  {'name': 'Tome of the Deep Roads', 'tier': 3, 'cost': 150,
                            'spells': ['deep_step', 'fate_die', 'mycelial_recall'],
                            'blurb': 'The mycelium remembers every road.'},
}

# Trading post: the central-island exchange opens each night holding these 3
# house consumables (tagged "the Swarm"). Players swap one of their bag items
# for one of these; whatever they leave becomes the next visitor's stock,
# tagged with their name. Stock count stays fixed at 3 (swap in = swap out).
TRADING_POST_SEED = ['healing_moss', 'smoke_spore', 'loaded_die']
TRADING_POST_SIZE = len(TRADING_POST_SEED)

# Rot-Farm Bazaar limited-stock knobs (SHOP_*) live in undercity_config.py.

# Excavation dig sites (Ossuary Fields focus). A shared 5x5 grid holds four
# buried items sized by footprint; each landing grants 3 digs (reveal one cell
# each), refilled per visit like the Ossuary. Revealing an item's last cell
# collects it for whoever dug it; clearing the final item resets the grid and
# pays the finder a Spore bonus. Loot scales with footprint (see _roll_dig_loot
# in undercity_db). Partial reveals persist for the next player.
EXCAVATION_DIGS_PER_VISIT = 3
EXCAVATION_GRID = (5, 5)                     # (width, height)
EXCAVATION_ITEMS = ['1x1', '1x1', '1x2', '2x2']  # shapes buried per site
EXCAVATION_CLEAR_BONUS = 25                  # Spores for clearing the last item

# Crystal Veins (Mosslight Cavern focus). One shared vein per region: a depth
# counter every player advances. Landing grants up to 3 strikes and the FIRST
# is mandatory (resolved with the landing event). Each strike descends one
# level; cave-in chance and loot both scale with the level entered. A cave-in
# hurts the striker (HP floors at 1) and collapses the shared depth to 0 for
# everyone. Surviving the strike into the bottom level takes the Heartstone.
VEIN_STRIKES_PER_VISIT = 3
VEIN_MAX_DEPTH = 12
VEIN_CAVE_IN_PCT_PER_LEVEL = 0.04    # cave-in chance = level entered * this
VEIN_CAVE_IN_DMG_PER_LEVEL = 2       # damage = level entered * this
VEIN_HEARTSTONE_SPORES = 40
VEIN_RARE_ITEMS = ['loaded_die', 'smoke_spore']

# The Guildvault (Undercity focus). One shared Mastermind lock per region:
# a hidden combination of 3 DISTINCT sigils from the 6 below. Landing grants
# 3 pick attempts (no attempt is mandatory — reading the ledger is free).
# Every failed guess is appended to a PUBLIC history (communal intel) and
# jams tribute into the pot. Cracking it takes the pot + a rare item, then
# the combination rerolls, the ledger wipes, and the pot reseeds.
VAULT_SIGILS = ['spore', 'bone', 'web', 'moss', 'skull', 'beetle']
VAULT_SLOTS = 3
VAULT_PICKS_PER_VISIT = 3
VAULT_POT_SEED = 30
VAULT_POT_PER_FAIL = 2


# ── Wild NPCs (fixed stats — the species IS the difficulty tier) ─────────────
# No level scaling anywhere: when you see a beetle you know exactly what a
# beetle is. Tier feel (verified by the balance tests in
# tests/test_undercity_engine.py against reference statlines):
#   normal — a fresh level-1 starter wins in 4-5 rounds with chip damage
#   elite  — easy meat at level 4-5, lethal to a level 1-2 (flee!)
# XP rides on each spec (per-tier rewards); wild_loss/timeout stay flat.

# `personality`/`bluff` drive the stance AI (spec §1). Overworld fodder is
# readable (no bluff) so good play reliably wins; elites/bosses bluff more.
# Basic wilds are a REAL threat to a bare level-1 starter (design 2026-07-19):
# an ungeared creature can lose to the tougher two, and only reliably clears
# the whole pool once it has a gear piece (rusted_fang / chitin_scrap) or gets
# lucky with reads. See the level-1 balance tests. The weak-but-fast beetle is
# the one a bare starter still beats.
NPCS = [
    {'id': 'drudge_beetle', 'name': 'Drudge Beetle',
     'hp': 22, 'atk': 6, 'def': 2, 'spd': 5, 'bounty': 6, 'xp': 10,
     'itemChance': 0.0, 'personality': 'brute', 'bluff': 0.0},
    {'id': 'sewer_shambler', 'name': 'Sewer Shambler',
     'hp': 30, 'atk': 8, 'def': 4, 'spd': 4, 'bounty': 9, 'xp': 10,
     'itemChance': 0.0, 'personality': 'balanced', 'bluff': 0.0},
    {'id': 'myconid', 'name': 'Myconid',
     'hp': 34, 'atk': 7, 'def': 5, 'spd': 2, 'bounty': 9, 'xp': 10,
     'itemChance': 0.0, 'personality': 'turtle', 'bluff': 0.0},
]

# Elites live only at 'elite' board spaces — never a surprise on a wild space.
ELITE_NPCS = [
    {'id': 'fetid_imp', 'name': 'Fetid Imp',
     'hp': 30, 'atk': 10, 'def': 5, 'spd': 8, 'bounty': 20, 'xp': 25,
     'itemChance': 0.25, 'personality': 'trickster', 'bluff': 0.15},
    {'id': 'rot_shambler', 'name': 'Rot Shambler',
     'hp': 32, 'atk': 11, 'def': 5, 'spd': 4, 'bounty': 25, 'xp': 25,
     'itemChance': 0.30, 'personality': 'brute', 'bluff': 0.10},
]

# Wilderness fauna — the T2+ frontier. Every wild AND elite space in the
# 'wilderness' region draws from these (via _wild_battle region=), so evolved
# units forced onto the travel layer always face tier-appropriate danger.
# See specs/2026-07-20-undercity-wilderness-expansion-design.md.
WILDERNESS_NPCS = [
    {'id': 'ashen_stalker', 'name': 'Ashen Stalker',
     'hp': 48, 'atk': 14, 'def': 6, 'spd': 9, 'bounty': 30, 'xp': 35,
     'itemChance': 0.15, 'personality': 'trickster', 'bluff': 0.15},
    {'id': 'bramble_horror', 'name': 'Bramble Horror',
     'hp': 58, 'atk': 13, 'def': 8, 'spd': 4, 'bounty': 32, 'xp': 38,
     'itemChance': 0.15, 'personality': 'turtle', 'bluff': 0.10},
    {'id': 'cinder_wolf', 'name': 'Cinder Wolf',
     'hp': 46, 'atk': 16, 'def': 5, 'spd': 10, 'bounty': 30, 'xp': 35,
     'itemChance': 0.15, 'personality': 'brute', 'bluff': 0.10},
    {'id': 'wastes_marauder', 'name': 'Wastes Marauder',
     'hp': 52, 'atk': 15, 'def': 6, 'spd': 7, 'bounty': 33, 'xp': 38,
     'itemChance': 0.20, 'personality': 'balanced', 'bluff': 0.15},
]

WILDERNESS_ELITE_NPCS = [
    {'id': 'embermaw_alpha', 'name': 'Embermaw Alpha',
     'hp': 64, 'atk': 17, 'def': 8, 'spd': 10, 'bounty': 42, 'xp': 50,
     'itemChance': 0.35, 'personality': 'brute', 'bluff': 0.15},
    {'id': 'thornclad_revenant', 'name': 'Thornclad Revenant',
     'hp': 70, 'atk': 16, 'def': 10, 'spd': 6, 'bounty': 45, 'xp': 50,
     'itemChance': 0.35, 'personality': 'turtle', 'bluff': 0.15},
    {'id': 'ashfiend_matriarch', 'name': 'Ashfiend Matriarch',
     'hp': 60, 'atk': 18, 'def': 7, 'spd': 12, 'bounty': 45, 'xp': 52,
     'itemChance': 0.40, 'personality': 'trickster', 'bluff': 0.25},
]


# ── Cosmetics ────────────────────────────────────────────────────────────────

HATS = [
    {'id': 'party_hat', 'name': 'Party Hat', 'rarity': 'common'},
    {'id': 'cowboy_hat', 'name': 'Cowboy Hat', 'rarity': 'common'},
    {'id': 'top_hat', 'name': 'Top Hat', 'rarity': 'common'},
    {'id': 'flower_crown', 'name': 'Flower Crown', 'rarity': 'common'},
    {'id': 'chef_hat', 'name': 'Chef Hat', 'rarity': 'common'},
    {'id': 'headband', 'name': 'Headband', 'rarity': 'common'},
    {'id': 'beanie', 'name': 'Beanie', 'rarity': 'common'},
    {'id': 'bow', 'name': 'Bow', 'rarity': 'common'},
    {'id': 'viking_helmet', 'name': 'Viking Helmet', 'rarity': 'uncommon'},
    {'id': 'wizard_hat', 'name': 'Wizard Hat', 'rarity': 'uncommon'},
    {'id': 'pirate_hat', 'name': 'Pirate Hat', 'rarity': 'uncommon'},
    {'id': 'crown', 'name': 'Crown', 'rarity': 'uncommon'},
    {'id': 'halo', 'name': 'Halo', 'rarity': 'uncommon'},
    {'id': 'birthday_blessing', 'name': 'Swarm Balloons', 'rarity': 'legendary'},
    {'id': 'kaiju_slayer', 'name': 'Behemoth-Slayer’s Mantle', 'rarity': 'legendary'},
]
HAT_RARITY_WEIGHTS = {'common': 70, 'uncommon': 25, 'legendary': 5}
DUPLICATE_SPORES = 10

PAINTS = [
    {'id': 'crimson', 'name': 'Crimson', 'hue': 0},
    {'id': 'orange', 'name': 'Orange', 'hue': 30},
    {'id': 'gold', 'name': 'Gold', 'hue': 50},
    {'id': 'forest', 'name': 'Forest', 'hue': 130},
    {'id': 'emerald', 'name': 'Emerald', 'hue': 155},
    {'id': 'cyan', 'name': 'Cyan', 'hue': 180},
    {'id': 'sky', 'name': 'Sky', 'hue': 200},
    {'id': 'navy', 'name': 'Navy', 'hue': 230},
    {'id': 'violet', 'name': 'Violet', 'hue': 270},
    {'id': 'rose', 'name': 'Rose', 'hue': 340},
]
DEFAULT_PAINTS = ['forest', 'gold']  # everyone owns these from their first hatch

HAT_MAP = {h['id']: h for h in HATS}
PAINT_MAP = {p['id']: p for p in PAINTS}

# ── Renown shop (pre-spawn) prices ───────────────────────────────────────────
HAT_PRICES = {'common': 50, 'uncommon': 120, 'legendary': 300}
PAINT_PRICE = 40  # any non-default color

# Fixed one-night starter kit. Real ids grant from GEAR/CONSUMABLES; the
# synthetic 'spore_pouch' just adds `amount` Spores. Costs are in Renown.
RENOWN_SHOP_ITEMS = [
    {'id': 'healing_moss', 'kind': 'consumable', 'cost': 20},
    {'id': 'rusted_fang',  'kind': 'gear',       'cost': 25},
    {'id': 'chitin_scrap', 'kind': 'gear',       'cost': 25},
    {'id': 'spore_pouch',  'kind': 'spores', 'amount': 15, 'cost': 15},
]
RENOWN_SHOP_ITEMS_MAP = {i['id']: i for i in RENOWN_SHOP_ITEMS}


# ── Roll economy ─────────────────────────────────────────────────────────────

# All roll-economy, HP-regen, PvP, shrine/ossuary/snare scalars live in
# undercity_config.py (re-exported above).


# ── Barriers & points of interest (v3: goals on the map) ────────────────────

# Fixed guardians blocking the gated routes. Staggered milestones: the
# Grave-Troll falls to a ~level-5 creature, the Wight to ~level 6, so the
# east route opens first. Beating one opens the barrier for the WHOLE season
# (shared) and pays the winner alone.
BARRIER_GUARDIANS = {
    'bar_e': {'id': 'golgari_grave_troll', 'name': 'Golgari Grave-Troll',
              'hp': 36, 'atk': 11, 'def': 6, 'spd': 3, 'bounty': 30, 'xp': 25,
              'personality': 'turtle', 'bluff': 0.15},
    'bar_s': {'id': 'wight_of_the_reliquary', 'name': 'Wight of the Reliquary',
              'hp': 42, 'atk': 12, 'def': 6, 'spd': 5, 'bounty': 35, 'xp': 25,
              'personality': 'turtle', 'bluff': 0.20},
}

# Mini-bosses at the lairs. First kill per player pays `first`; repeats pay
# `repeat`. Tuned so a level-6-7 creature kills them inside the 6-round cap
# (see the tier-balance tests). The five biome-dungeon lairs grant Guild
# Sigils on first clear; lair_titan is side content.
_LAIR_REWARD = {'first': {'spores': 60, 'xp': 35}, 'repeat': {'spores': 15, 'xp': 12}}
LAIR_BOSSES = {
    'lair_titan': {'id': 'gravebound_colossus', 'name': 'Lord of Extinction',
                   'hp': 46, 'atk': 14, 'def': 7, 'spd': 4,
                   'personality': 'brute', 'bluff': 0.20, **_LAIR_REWARD},
    'city_lair': {'id': 'ishkanah', 'name': 'Ishkanah, Grafwidow',
                  'hp': 42, 'atk': 14, 'def': 5, 'spd': 8,
                  'personality': 'trickster', 'bluff': 0.20, **_LAIR_REWARD},
    'cavern_lair': {'id': 'sarulf', 'name': 'Sarulf, Realm Eater',
                    'hp': 44, 'atk': 13, 'def': 6, 'spd': 7,
                    'personality': 'balanced', 'bluff': 0.20, **_LAIR_REWARD},
    'bog_lair': {'id': 'gitrog_monster', 'name': 'The Gitrog Monster',
                 'hp': 48, 'atk': 12, 'def': 7, 'spd': 5,
                 'personality': 'turtle', 'bluff': 0.20, **_LAIR_REWARD},
    'bone_lair': {'id': 'skullbriar', 'name': 'Skullbriar, the Walking Grave',
                  'hp': 40, 'atk': 15, 'def': 6, 'spd': 6,
                  'personality': 'brute', 'bluff': 0.25, **_LAIR_REWARD},
    'garden_lair': {'id': 'slimefoot', 'name': 'Slimefoot, the Stowaway',
                    'hp': 46, 'atk': 13, 'def': 7, 'spd': 4,
                    'personality': 'turtle', 'bluff': 0.20, **_LAIR_REWARD},
}

# Field-curse buffs, when they land on a rooted guardian/boss, resolve to a
# flat NPC stat penalty applied for its NEXT battle (floored at 1). Roll-halving
# (vines/bog_snare) is meaningless for an NPC, so it becomes a speed bite.
# Keys are field_curse buffKinds; mirror any new field curse here.
GUARDIAN_DEBUFF = {
    'bone_chill': {'atk': -2},
    'weaken_hex': {'atk': -3},
    'vines':      {'spd': -2},
}


# The treasure vault: first visit per player pays out, later visits are set
# dressing.
VAULT_REWARD = {'spores': 80, 'xp': 20}

# Trove: a hidden dungeon strongroom. Fatter than a cache/vault and a GUARANTEED
# high-tier gear drop — the payoff for exploring the dark instead of beelining.
TROVE_REWARD = {'spores': 110, 'xp': 30}
TROVE_GEAR_TIERS = {2: 0.5, 3: 0.5}

# ── Unique dungeons (v6) ─────────────────────────────────────────────────────
# Each biome's ladder-down pocket is a distinct place: its own name, shape
# (laid out in _build_map), signature hazard, themed wild, and one first-visit
# treasure cache. The rite line is client flavor shown on first descent.

DUNGEONS = {
    'city':   {'name': 'The Broodwarrens', 'wild': 'broodling', 'hazard': 'webbing',
               'rite': 'The Broodwarrens. The walls pulse.'},
    'cavern': {'name': 'Gloomroot Hollow', 'wild': 'glowmite', 'hazard': 'spore_cloud',
               'rite': 'Gloomroot Hollow. The light here is alive.'},
    'bog':    {'name': 'The Drownedway', 'wild': 'mire_leech', 'hazard': 'sinkwater',
               'rite': 'The Drownedway. Black water swallows your steps.'},
    'bone':   {'name': 'The Marrow Pits', 'wild': 'gravewight', 'hazard': 'bone_chill',
               'rite': 'The Marrow Pits. The dead are load-bearing.'},
    'garden': {'name': 'The Rotcellar', 'wild': 'rot_grub', 'hazard': 'rot_bloom',
               'rite': 'The Rotcellar. Sweet decay, thick as soup.'},
}

# One themed wild per dungeon — fixed stats in the level-2-3 band (comfortable
# at L2-3, survivable-but-scary at L1), ~+50% bounty over surface wilds.
DUNGEON_NPCS = {
    'city':   {'id': 'broodling',  'name': 'Hatchery Spider',
               'hp': 26, 'atk': 8, 'def': 3, 'spd': 6, 'bounty': 14, 'xp': 15,
               'itemChance': 0.10, 'personality': 'trickster', 'bluff': 0.10},
    'cavern': {'id': 'glowmite',   'name': 'Vigorspore Wurm',
               'hp': 22, 'atk': 9, 'def': 2, 'spd': 8, 'bounty': 14, 'xp': 15,
               'itemChance': 0.10, 'personality': 'brute', 'bluff': 0.10},
    'bog':    {'id': 'mire_leech', 'name': 'Festering Newt',
               'hp': 28, 'atk': 7, 'def': 3, 'spd': 4, 'bounty': 14, 'xp': 15,
               'itemChance': 0.10, 'personality': 'turtle', 'bluff': 0.10},
    'bone':   {'id': 'gravewight', 'name': 'Wight of Precinct Six',
               'hp': 24, 'atk': 8, 'def': 4, 'spd': 3, 'bounty': 15, 'xp': 15,
               'itemChance': 0.10, 'personality': 'balanced', 'bluff': 0.10},
    'garden': {'id': 'rot_grub',   'name': 'Thallid',
               'hp': 28, 'atk': 7, 'def': 3, 'spd': 5, 'bounty': 14, 'xp': 15,
               'itemChance': 0.15, 'personality': 'turtle', 'bluff': 0.10},
}

# Signature hazards — display copy here; behavior lives in undercity_db._hazard.
DUNGEON_HAZARDS = {
    'city':   {'id': 'webbing', 'name': 'Webbing',
               'text': 'Sticky broodsilk wraps your legs — your next roll is halved.'},
    'cavern': {'id': 'spore_cloud', 'name': 'Spore Cloud',
               'text': 'A luminous cloud bursts! The hollow spins around you…'},
    'bog':    {'id': 'sinkwater', 'name': 'Sinkwater',
               'text': 'The floor is water. Your pouch is not waterproof.'},
    'bone':   {'id': 'bone_chill', 'name': 'Bone Chill',
               'text': 'Grave-cold seeps into your joints: -2 ATK in your next battle.'},
    'garden': {'id': 'rot_bloom', 'name': 'Rot Bloom',
               'text': 'Bursting rot-pods sting your hide — but the compost is rich.'},
}

# First visit per player pays out; tracked in poiClaims as 'cache:<nodeId>'
# (~half a vault; renown flows automatically via per_poi).
CACHE_REWARD = {'spores': 40, 'xp': 10}

# Rest room: a hidden alcove that mends you fully, once per descent. Clears the
# lingering hazard debuffs (vines / bone_chill / cursed_idol) too.
REST_CURES = ('vines', 'bone_chill', 'cursed_idol')


def dungeon_biome(node_id):
    """Biome key for a depths node ('city_d0' -> 'city'), else None."""
    node = MAP_NODES.get(node_id)
    if not node or node.get('region') != 'depths':
        return None
    return node_id.split('_')[0]


def dungeon_entrance(biome):
    """The depths-side ladder mouth of a dungeon — the respawn point for a death
    in that biome's dark. Exactly one ladder node per depths pocket (map-linted)."""
    for nid, n in MAP_NODES.items():
        if n.get('region') == 'depths' and n['type'] == 'ladder' \
                and nid.split('_')[0] == biome:
            return nid
    return None

# Every entry in a player's poiClaims list ('bar_e', 'lair_titan', 'vault',
# ...) feeds renown via compute_renown below.


# ── Renown ───────────────────────────────────────────────────────────────────

RENOWN = {
    'per_level': 10,
    'per_pvp_win': 15,
    'per_wild_win': 3,
    'per_poi': 25,  # each barrier broken / lair first-kill / vault find
    'spores_per_point': 5,
    'boss_damage_per_point': 10,
}


def compute_renown(player: dict) -> int:
    return (RENOWN['per_level'] * player.get('level', 1)
            + RENOWN['per_pvp_win'] * player.get('pvpWins', 0)
            + RENOWN['per_wild_win'] * player.get('wildWins', 0)
            + RENOWN['per_poi'] * len(player.get('poiClaims', []))
            + player.get('spores', 0) // RENOWN['spores_per_point']
            + player.get('bossDamage', 0) // RENOWN['boss_damage_per_point'])


# ── The board map (v4: five home biomes around the island) ──────────────────
#
# Five biome rings sit in a pentagon around the floating boss island. Each
# ring has 10 spaces (gate facing the island, shop, warp, shrine/ossuary,
# loot/wild/mystery/hazard mix), an inner 2-space chord path across its
# hollow, and a dungeon pocket hanging off its outward side reached only by a
# ladder pair. First-clearing a dungeon's lair grants that biome's Guild
# Sigil; hold SIGILS_REQUIRED and the island boss unseals for you. Two
# barrier-gated side pockets (Titan's Rest, the Sunken Vaults) remain as
# optional treasure routes.

# The board graph — nodes/edges plus client-side regions{} and decals[]
# (ignored server-side). See map_bootstrap.py for the retired generator.
_MAP_DOC = json.loads(Path(__file__).with_name('map.json').read_text(encoding='utf-8'))
WORLD_W, WORLD_H = _MAP_DOC['worldW'], _MAP_DOC['worldH']
BOSS_NODE = _MAP_DOC['boss']

# Home biomes: display name, ring geometry, and the hatch perk.
# Ring silhouette is a superellipse: `sq` is the squareness exponent (2 = plain
# ellipse, >2 boxy/rounded-rectangle, <2 pinched/diamond); rx/ry set the size
# and oblongness. Each biome gets its own shape so no two chambers look alike.
BIOMES = {
    # Rounded-square cavern mouth.
    'cavern': {'name': 'Mosslight Cavern', 'center': (900, 520),
               'rx': 320, 'ry': 260, 'sq': 3.6, 'perk': 'glowblessed',
               'perkName': 'Glowblessed', 'perkBlurb': '+10% flee chance.'},
    # Wide, low oblong — a sprawling moor.
    'bog': {'name': 'The Sedgemoor', 'center': (2700, 520),
            'rx': 440, 'ry': 190, 'sq': 2.0, 'perk': 'mirefoot',
            'perkName': 'Mirefoot', 'perkBlurb': 'Hazards cost you half.'},
    # Angular diamond of overgrowth.
    'garden': {'name': 'The Rot-Gardens', 'center': (3000, 1650),
               'rx': 300, 'ry': 285, 'sq': 1.45, 'perk': 'composter',
               'perkName': 'Composter', 'perkBlurb': '+2 Spores from every loot space.'},
    # Sprawling rounded rectangle — a city block.
    'city': {'name': 'The Undercity', 'center': (1800, 2050),
             'rx': 410, 'ry': 235, 'sq': 4.4, 'perk': 'city_rat',
             'perkName': 'City Rat', 'perkBlurb': '+15 starting Spores.'},
    # Tall, narrow pit.
    'bone': {'name': 'Ossuary Fields', 'center': (600, 1600),
             'rx': 255, 'ry': 300, 'sq': 2.2, 'perk': 'marrowborn',
             'perkName': 'Marrowborn', 'perkBlurb': '+2 DEF against wild creatures.'},
}


DEFAULT_BIOME = 'city'

# Each home biome's gate is found by node type, not naming convention — the
# map editor can move a region's gate to any space and this follows it.
# Contract (tested + editor-linted): exactly one gate node per region.
HOME_GATES = {n['region']: n['id']
              for n in _MAP_DOC['nodes'] if n['type'] == 'gate'}
GATE_NODE = HOME_GATES[DEFAULT_BIOME]  # legacy alias; respawns use homeBiome


MAP_NODES = {n['id']: n for n in _MAP_DOC['nodes']}
WARP_NODES = [nid for nid, n in MAP_NODES.items() if n['type'] == 'warp']
TUNNEL_NODES = frozenset(nid for nid, n in MAP_NODES.items() if n['type'] == 'tunnel')

# Guild Sigils: first-clear of a biome dungeon's lair grants that sigil.
SIGIL_LAIRS = {b + '_lair': b for b in BIOMES}
SIGILS_REQUIRED = 3

# The island boss: one persistent HP pool per season. Anyone with enough
# sigils can chip at it; whoever lands the killing blow takes the kill, then
# the Sovereign reforms at full strength for the next challenger.
ROT_SOVEREIGN = {
    'id': 'rot_sovereign', 'name': 'Savra, Queen of the Golgari',
    # Tuned as a tough-but-doable finale for a T3 apex creature with T3 gear
    # (was 240/9 — a lvl-8 glass cannon melted it in one attempt). It's a
    # SHARED persistent pool, so a full table brings her down faster; a lone
    # challenger needs ~2 strong attempts plus chip.
    'hp': 400, 'atk': 14, 'def': 11, 'spd': 6,
    'personality': 'trickster', 'bluff': 0.30,
    'first': {'spores': 120, 'xp': 60},
    'repeat': {'spores': 40, 'xp': 20},
}


# ── Flow loot puzzles ────────────────────────────────────────────────────────
# Single-color path puzzles gating loot-space rewards. Each has a `solution`
# (list of [row, col]) that doubles as a solvability guarantee — a pytest
# (test_flow_puzzles_all_solvable) asserts every solution validates. Cells are
# [row, col], 0-indexed. Easy on purpose: 4x4-5x5, 0-2 rocks. `flow_puzzle(id)`
# looks one up. Pack was machine-generated + verified; regenerate (Hamiltonian
# path search) rather than hand-editing coordinates — grid graphs are bipartite,
# so most rock layouts are unsolvable and only a search finds valid endpoints.
FLOW_PUZZLES = [
    {'id': 'p01', 'w': 4, 'h': 4, 'start': [0, 0], 'end': [2, 3], 'rocks': [],
     'solution': [[0, 0], [1, 0], [2, 0], [3, 0], [3, 1], [2, 1], [1, 1], [0, 1], [0, 2], [0, 3], [1, 3], [1, 2], [2, 2], [3, 2], [3, 3], [2, 3]]},
    {'id': 'p02', 'w': 4, 'h': 4, 'start': [0, 3], 'end': [3, 0], 'rocks': [[1, 1]],
     'solution': [[0, 3], [1, 3], [2, 3], [3, 3], [3, 2], [2, 2], [1, 2], [0, 2], [0, 1], [0, 0], [1, 0], [2, 0], [2, 1], [3, 1], [3, 0]]},
    {'id': 'p03', 'w': 4, 'h': 4, 'start': [0, 3], 'end': [3, 0], 'rocks': [[2, 2]],
     'solution': [[0, 3], [1, 3], [2, 3], [3, 3], [3, 2], [3, 1], [2, 1], [1, 1], [1, 2], [0, 2], [0, 1], [0, 0], [1, 0], [2, 0], [3, 0]]},
    {'id': 'p04', 'w': 5, 'h': 4, 'start': [0, 0], 'end': [3, 4], 'rocks': [],
     'solution': [[0, 0], [1, 0], [2, 0], [3, 0], [3, 1], [2, 1], [1, 1], [0, 1], [0, 2], [1, 2], [2, 2], [3, 2], [3, 3], [2, 3], [1, 3], [0, 3], [0, 4], [1, 4], [2, 4], [3, 4]]},
    {'id': 'p05', 'w': 5, 'h': 4, 'start': [3, 0], 'end': [0, 3], 'rocks': [[2, 2]],
     'solution': [[3, 0], [2, 0], [1, 0], [0, 0], [0, 1], [0, 2], [1, 2], [1, 1], [2, 1], [3, 1], [3, 2], [3, 3], [3, 4], [2, 4], [2, 3], [1, 3], [1, 4], [0, 4], [0, 3]]},
    {'id': 'p06', 'w': 5, 'h': 4, 'start': [3, 0], 'end': [0, 3], 'rocks': [[1, 1]],
     'solution': [[3, 0], [2, 0], [1, 0], [0, 0], [0, 1], [0, 2], [1, 2], [2, 2], [2, 1], [3, 1], [3, 2], [3, 3], [3, 4], [2, 4], [2, 3], [1, 3], [1, 4], [0, 4], [0, 3]]},
    {'id': 'p07', 'w': 4, 'h': 5, 'start': [0, 0], 'end': [4, 3], 'rocks': [],
     'solution': [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [4, 1], [3, 1], [2, 1], [1, 1], [0, 1], [0, 2], [0, 3], [1, 3], [1, 2], [2, 2], [2, 3], [3, 3], [3, 2], [4, 2], [4, 3]]},
    {'id': 'p08', 'w': 4, 'h': 5, 'start': [0, 0], 'end': [2, 3], 'rocks': [[2, 1], [2, 2]],
     'solution': [[0, 0], [0, 1], [0, 2], [0, 3], [1, 3], [1, 2], [1, 1], [1, 0], [2, 0], [3, 0], [4, 0], [4, 1], [3, 1], [3, 2], [4, 2], [4, 3], [3, 3], [2, 3]]},
    {'id': 'p09', 'w': 4, 'h': 5, 'start': [0, 3], 'end': [3, 0], 'rocks': [[2, 2]],
     'solution': [[0, 3], [0, 2], [0, 1], [0, 0], [1, 0], [2, 0], [2, 1], [1, 1], [1, 2], [1, 3], [2, 3], [3, 3], [4, 3], [4, 2], [3, 2], [3, 1], [4, 1], [4, 0], [3, 0]]},
    {'id': 'p10', 'w': 5, 'h': 5, 'start': [0, 0], 'end': [4, 4], 'rocks': [],
     'solution': [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [4, 1], [3, 1], [2, 1], [1, 1], [0, 1], [0, 2], [1, 2], [2, 2], [3, 2], [4, 2], [4, 3], [3, 3], [2, 3], [1, 3], [0, 3], [0, 4], [1, 4], [2, 4], [3, 4], [4, 4]]},
    {'id': 'p11', 'w': 5, 'h': 5, 'start': [0, 0], 'end': [3, 4], 'rocks': [[2, 2]],
     'solution': [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [4, 1], [3, 1], [2, 1], [1, 1], [0, 1], [0, 2], [1, 2], [1, 3], [0, 3], [0, 4], [1, 4], [2, 4], [2, 3], [3, 3], [3, 2], [4, 2], [4, 3], [4, 4], [3, 4]]},
    {'id': 'p12', 'w': 5, 'h': 5, 'start': [0, 0], 'end': [3, 4], 'rocks': [[0, 2]],
     'solution': [[0, 0], [0, 1], [1, 1], [1, 0], [2, 0], [3, 0], [4, 0], [4, 1], [3, 1], [2, 1], [2, 2], [1, 2], [1, 3], [0, 3], [0, 4], [1, 4], [2, 4], [2, 3], [3, 3], [3, 2], [4, 2], [4, 3], [4, 4], [3, 4]]},
]


_FLOW_BY_ID = {p['id']: p for p in FLOW_PUZZLES}


def flow_puzzle(pid):
    """Return the full puzzle (incl. solution) for an id, or None."""
    return _FLOW_BY_ID.get(pid)
