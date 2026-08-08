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
    """XP cost to go from `level` to `level + 1`.

    Progressive curve (design 2026-08-04): flat-ish early so casuals keep fast
    early levels, then a quadratic ramp above XP_CURVE_RAMP_FROM so leveling
    lasts the night and a single elite never auto-levels. Scalars in
    undercity_config; client mirror in src/app/undercity/data/forms.ts.
    """
    ramp = max(0, level - XP_CURVE_RAMP_FROM)
    return XP_CURVE_BASE + XP_CURVE_LINEAR * level + XP_CURVE_RAMP * ramp * ramp


# ── Creatures ────────────────────────────────────────────────────────────────

# Starter lines (tier 1). Stats are the level-1 base.
STARTERS = {
    'pest': {
        'name': 'Pest', 'hp': 25, 'atk': 5, 'def': 5, 'spd': 5,
        'passive': 'scrounger',
        'blurb': 'Balanced sewer rat. Scrounger: +25% Spores from all loot & bounties, '
                 'and scrounge Spores even from fights you lose or flee.',
    },
    'kraul': {
        'name': 'Kraul Grub', 'hp': 25, 'atk': 6, 'def': 3, 'spd': 5,
        'passive': 'first_bite',
        'blurb': 'Glass-cannon insect. First Bite: always strikes first in round 1.',
    },
    'saproling': {
        'name': 'Saproling', 'hp': 25, 'atk': 5, 'def': 5, 'spd': 6,
        'passive': 'drift',
        'blurb': 'Quick, expendable plant token — the swarm made flesh. Endless Ranks: +15% flee chance; bad mystery events reroll once.',
    },
    'zombie': {
        'name': 'Zombie', 'hp': 25, 'atk': 5, 'def': 6, 'spd': 3,
        'passive': 'regrowth',
        'blurb': 'Was somebody once; dead now, and it doesn\'t stay down. Regrowth: heal 20% max HP after any battle.',
    },
    'squirrel': {
        'name': 'Squirrel', 'hp': 25, 'atk': 5, 'def': 4, 'spd': 7,
        'passive': 'spell_haste',
        'blurb': 'A twitchy little caster. Spell Haste: your spell cooldowns are halved — cast twice as often as anyone else.',
    },
    'elf': {
        'name': 'Elf', 'hp': 25, 'atk': 6, 'def': 6, 'spd': 4,
        'passive': 'stonewright',
        'passives': ['stonewright', 'gift_of_fair_folk'],
        'blurb': 'Ancient and long-lived; her power is in her works. Natural Enchanter: '
                 'gear she upgrades comes out hardened (Gear+), and her pet fights a step '
                 'above its level. Gift of the Fair Folk: born gifted but slow to grow — '
                 'she starts with 5 attribute points to allocate but banks only 1 per '
                 'level instead of the usual 2.',
    },
}

# Cosmetic-only alternate sprite per starter. Client mirror: FORM_VARIANTS in
# src/app/undercity/data/species.ts. Value = the alt sprite keys the client may
# request; the base look needs no entry. Stored on the player doc as
# `spriteVariant` and echoed in public state like paint/hat.
STARTER_VARIANTS = {
    'pest': ['pest_2'],
    'saproling': ['saproling_2'],
    'zombie': ['zombie_2'],
    'kraul': ['insect_2'],
}

# Consumables every freshly-hatched creature carries in its bag on a new night —
# a starter cushion so the first bad fight isn't a dead end. Item ids from
# CONSUMABLES. Keep the total within BAG_SIZE.
STARTER_BAG = ['healing_moss']

# Tier 2 forms (level 5). `bonus` is applied on evolution (maxHp values already
# ×3 relative to a stat point). Creatures keep their line passive AND gain the
# form passive (Rootwall upgrades Regrowth rather than stacking).
TIER2 = {
    'brackish_trudge': {
        'name': 'Brackish Trudge', 'line': 'pest', 'bonus': {'maxHp': 6, 'atk': 2},
        'passive': 'bog_forager',
        'blurb': 'Scavenger. Bog Forager: scrounge a bigger share of the bounty even '
                 'from lost or fled fights, and bad mystery events reroll once.',
    },
    'vexing_pest': {
        'name': 'Vexing Pest', 'line': 'pest', 'bonus': {'maxHp': 6, 'atk': 1, 'def': 1, 'spd': 1},
        'passive': 'improvise',
        'blurb': 'All-rounder. Improvise: at the start of each battle it shores up its '
                 'weakest stat (+3 to the lowest of ATK/DEF/SPD) for that fight.',
    },
    'kraul_warrior': {
        'name': 'Grave Scarab', 'line': 'kraul', 'bonus': {'atk': 4},
        'passive': 'venom_barb',
        'blurb': 'Venomous striker. Venom Barb: every decisive strike injects a '
                 'poison stack that gnaws at the foe each round — the longer the '
                 'fight, the more the venom bites.',
    },
    'golgari_longlegs': {
        'name': 'Golgari Longlegs', 'line': 'kraul', 'bonus': {'spd': 4},
        'passive': 'reach',
        'blurb': 'Skirmisher. Reach: in round 1 the enemy’s decisive blow finds only air — you strike from outside its range.',
    },
    'slitherhead': {
        'name': 'Slitherhead', 'line': 'saproling', 'bonus': {'spd': 4},
        'passive': 'skitter',
        'blurb': 'Darter. Skitter: 25% chance enemy strikes miss.',
    },
    # id kept as 'woodwraith_strangler' for save-compat; displays as Sporeback Skirmisher.
    'woodwraith_strangler': {
        'name': 'Sporeback Skirmisher', 'line': 'saproling', 'bonus': {'spd': 2, 'maxHp': 4},
        'passive': 'outpace',
        'blurb': 'Skirmisher. Outpace: in round 1 the enemy’s decisive blow finds only air — you strike from outside its range.',
    },
    'shambling_shell': {
        'name': 'Shambling Shell', 'line': 'zombie', 'bonus': {'maxHp': 6, 'def': 2},
        'passive': 'spikeshell',
        'blurb': 'Thorned bulwark. Spiked Shell: retaliate 2 damage whenever a foe’s blow lands.',
    },
    'underrealm_lich': {
        'name': 'Underrealm Lich', 'line': 'zombie', 'bonus': {'maxHp': 6, 'atk': 2},
        'passive': 'rootwall',
        'blurb': 'Regenerating necromancer. Rootwall: Regrowth improves to 35%, and it '
                 'knits its wounds with an innate Mend Flesh.',
    },
    'corpsejack_menace': {
        'name': 'Jungle Creeper', 'line': 'saproling', 'bonus': {'spd': 2, 'atk': 2},
        'passive': 'flurry',
        'blurb': 'Whirlwind. Flurry: 25% chance for a bonus strike each round.',
    },
    'deathrite_shaman': {
        'name': 'Deathrite Shaman', 'line': 'zombie', 'bonus': {'maxHp': 6, 'def': 2},
        'passive': 'soul_trophy',
        'blurb': 'Grave ritualist. Soul Trophy: after any won fight, take a trophy — '
                 '+[foe level] to a stat you choose, for your next battle.',
    },
    'squirrel_warrior': {
        'name': 'Vinereap Mentor', 'line': 'squirrel', 'bonus': {'maxHp': 6, 'atk': 2},
        'passive': 'spell_warrior',
        'blurb': 'Spellblade. Spell Warrior: buffs and heals you cast on yourself are doubled (and you still cast 50% faster).',
    },
    'squirrel_mage': {
        'name': 'Squirrel Mage', 'line': 'squirrel', 'bonus': {'maxHp': 4, 'spd': 2},
        'passive': 'spell_mage',
        'blurb': 'Battlemage. Spell Mage: your damaging spells deal +50% and are twice as likely to land (and you still cast 50% faster).',
    },
    'wood_lurker': {
        'name': 'Wood Lurker', 'line': 'elf', 'bonus': {'maxHp': 6},
        'passive': 'mimicry',
        'blurb': 'Ambush shapeshifter. Mimicry: at the first blow it takes on the shape '
                 'of its prey — a stat bump matching how the foe fights.',
    },
    'gorgon': {
        'name': 'Gorgon', 'line': 'elf', 'bonus': {'spd': 2, 'atk': 2},
        'passive': 'stone_gaze',
        'blurb': 'Gaze-hunter. Stone Gaze: reads come easily, and every read you land '
                 'petrifies the foe — stacking slow that ends in a one-round freeze.',
    },
}

# Apex forms (level 10).
#
# Evolution design (2026-08-07): every starter LINE has a *signature* apex that
# ALL of its tier-2 forms can reach, and each tier-2 form's SECOND option is
# distinct from its siblings' so no two siblings share the same choice set.
#   pest      -> Colossal Grave-Reaver   kraul    -> Swarm Lord
#   saproling -> Primeval Warden (izoni)  zombie   -> Grave Titan
#   squirrel  -> Calamity Beast           elf      -> Daemogoth Titan
# Golgari Lich Lord is the one non-signature apex — the shared "undead lifesteal"
# pick. LINE_SIGNATURE (below) encodes the rule; a test enforces it.
APEX = {
    'grave_titan': {
        'name': 'Grave Titan', 'bonus': {'maxHp': 12, 'def': 4},
        'passive': 'colossus',
        # zombie signature (+ Brackish bog-brute, Sporeback fungal wall, Gorgon petrify->stone).
        'from': ['shambling_shell', 'underrealm_lich', 'deathrite_shaman', 'brackish_trudge', 'woodwraith_strangler', 'gorgon'],
        'blurb': 'Colossus: a hulking wall — shrugs off 15% of every blow and outlasts anything.',
    },
    'golgari_lich_lord': {
        'name': 'Golgari Lich Lord', 'bonus': {'atk': 2, 'maxHp': 6},
        'passive': 'drain_life',
        # non-signature shared apex: undead casters (lich, ritualist, corpsejack, squirrel mage).
        'from': ['underrealm_lich', 'deathrite_shaman', 'corpsejack_menace', 'squirrel_mage'],
        'blurb': 'Drain Life: heal for 50% of damage you deal.',
    },
    # id kept as 'swamp_dragon' for save-compat; displays as the Swarm Lord.
    'swamp_dragon': {
        'name': 'Swarm Lord', 'bonus': {'atk': 2, 'spd': 2},
        'passive': 'onslaught',
        # kraul signature (+ Slitherhead saproling burst).
        'from': ['kraul_warrior', 'golgari_longlegs', 'slitherhead'],
        'blurb': 'Onslaught: the swarm descends all at once — its round-1 strike hits for double.',
    },
    'izoni': {
        'name': 'Primeval Warden', 'bonus': {'spd': 4},
        'passive': 'swarm',
        # saproling signature (+ Vexing vermin, Longlegs brood, Wood Lurker forest).
        'from': ['slitherhead', 'woodwraith_strangler', 'corpsejack_menace', 'vexing_pest', 'golgari_longlegs', 'wood_lurker'],
        'blurb': 'Swarm: one extra strike every battle round.',
    },
    'daemogoth': {
        'name': 'Daemogoth Titan', 'bonus': {'atk': 2, 'def': 2},
        'passive': 'arsenal',
        # elf signature.
        'from': ['wood_lurker', 'gorgon'],
        'blurb': 'Arsenal: a fourth equipment slot — a demon of shadow and moss '
                 'wields an extra piece of gear in its spare arms that no other '
                 'creature can bear.',
    },
    'calamity_beast': {
        'name': 'Calamity Beast', 'bonus': {'maxHp': 6, 'spd': 2},
        'passive': 'wish',
        # squirrel signature (caster-only, mirrors Daemogoth being elf-only).
        'from': ['squirrel_warrior', 'squirrel_mage'],
        'blurb': 'Wish: learn the Wish spell — once ready, cast ANY spell in the world, from any list.',
    },
    'grave_reaver': {
        'name': 'Colossal Grave-Reaver', 'bonus': {'maxHp': 6, 'atk': 2, 'def': 2},
        'passive': 'treasure_sense',
        # pest signature (+ Grave Scarab, Shambling shell-hoard, Deathrite graverob, Vinereap 'reaver').
        'from': ['brackish_trudge', 'vexing_pest', 'kraul_warrior', 'shambling_shell', 'deathrite_shaman', 'squirrel_warrior'],
        'blurb': 'Treasure Sense: a hoarder\'s eye — gear turns up far more often, and one rarity tier richer.',
    },
}

# Each starter line's signature apex — reachable by ALL of the line's tier-2
# forms (see the APEX design note). Enforced by test_undercity_signatures.py.
LINE_SIGNATURE = {
    'pest': 'grave_reaver',
    'kraul': 'swamp_dragon',
    'saproling': 'izoni',
    'zombie': 'grave_titan',
    'squirrel': 'calamity_beast',
    'elf': 'daemogoth',
}


def tier2_options(line: str):
    return [fid for fid, f in TIER2.items() if f['line'] == line]


def apex_options(tier2_form: str):
    return [aid for aid, a in APEX.items() if tier2_form in a['from']]


ALL_FORMS = {**{k: dict(v, tier=1) for k, v in STARTERS.items()},
             **{k: dict(v, tier=2) for k, v in TIER2.items()},
             **{k: dict(v, tier=3) for k, v in APEX.items()}}


# ── Attribute perk tracks (design 2026-07-21) ────────────────────────────────
# A perk unlocks when the INVESTED base stat (species base + level spends +
# evolution bonuses) PLUS equipped gear reaches its threshold; temporary buffs
# still never light a perk (see engine.perk_stat). Nodes at 6/12/18;
# base stats can already light the tier-1 node (kraul atk 8 -> Brutal Strikes).
# Client mirror: src/app/undercity/data/perks.ts
PERK_TRACKS = {
    'atk': [(6, 'brutal_strikes'), (12, 'menace'), (18, 'deathdrive')],
    'def': [(6, 'thick_hide'), (12, 'carapace_grind'), (18, 'last_stand')],
    'spd': [(6, 'fleetfoot'), (12, 'pathfinder'), (18, 'blink')],
}

PERKS = {
    'brutal_strikes': {'name': 'Brutal Strikes', 'track': 'atk', 'threshold': 6,
                       'blurb': 'Landing a decisive hit deals +30% damage.'},
    'menace':         {'name': 'Menace', 'track': 'atk', 'threshold': 12,
                       'blurb': 'Enemies bluff you less often.'},
    'deathdrive':     {'name': 'Deathdrive', 'track': 'atk', 'threshold': 18,
                       'blurb': 'Below half HP, your Aggress swings hit harder.'},
    'thick_hide':     {'name': 'Thick Hide', 'track': 'def', 'threshold': 6,
                       'blurb': '+5 Max HP and increased resistance against hazards.'},
    'carapace_grind': {'name': 'Carapace Grind', 'track': 'def', 'threshold': 12,
                       'blurb': '+10 Max HP, and holding Guard grinds the foe down.'},
    'last_stand':     {'name': 'Last Stand', 'track': 'def', 'threshold': 18,
                       'blurb': '+15 Max HP. Survive one lethal blow, rising at half your max HP. Recharges every hour.'},
    'fleetfoot':      {'name': 'Fleetfoot', 'track': 'spd', 'threshold': 6,
                       'blurb': 'You may reroll a die that shows 1.'},
    'pathfinder':     {'name': 'Pathfinder', 'track': 'spd', 'threshold': 12,
                       'blurb': 'Roll with advantage — roll two dice, keep either.'},
    'blink':          {'name': 'Blink', 'track': 'spd', 'threshold': 18,
                       'blurb': 'Choose your die value — then recharges for one roll.'},
}


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
    # Fang — new rarity rungs (complete the barbed/bloodfang/deep_biter/rabid/gutcleaver ladders)
    'cutter_fang':     {'name': 'Cutter Fang',     'slot': 'fang', 'tier': 1, 'cost': 22, 'atk': 2, 'rider': 'deep_biter'},
    'feral_nip':       {'name': 'Feral Nip',       'slot': 'fang', 'tier': 1, 'cost': 23, 'atk': 2, 'rider': 'rabid'},
    'notched_cleaver': {'name': 'Notched Cleaver', 'slot': 'fang', 'tier': 1, 'cost': 24, 'atk': 2, 'rider': 'gutcleaver'},
    'serpent_fang':    {'name': 'Serpent Fang',    'slot': 'fang', 'tier': 2, 'cost': 46, 'atk': 4, 'rider': 'barbed'},
    'sanguine_fang':   {'name': 'Sanguine Fang',   'slot': 'fang', 'tier': 2, 'cost': 47, 'atk': 4, 'rider': 'bloodfang'},
    'wyrm_venomtooth': {'name': 'Wyrm Venomtooth', 'slot': 'fang', 'tier': 3, 'cost': 82, 'atk': 6, 'spd': 1, 'rider': 'barbed'},
    'vampiric_maw':    {'name': 'Vampiric Maw',    'slot': 'fang', 'tier': 3, 'cost': 83, 'atk': 6, 'spd': 1, 'rider': 'bloodfang'},
    'gravecleaver':    {'name': 'Gravecleaver',    'slot': 'fang', 'tier': 3, 'cost': 84, 'atk': 6, 'rider': 'gutcleaver'},
    # Carapace — Guard riders
    'chitin_scrap': {'name': 'Chitin Scrap', 'slot': 'carapace', 'tier': 1, 'cost': 20, 'def': 2, 'rider': 'thick'},
    'bramble_hide': {'name': 'Bramble Hide', 'slot': 'carapace', 'tier': 1, 'cost': 25, 'def': 2, 'rider': 'bramble'},
    'bark_hide':    {'name': 'Bark Hide',    'slot': 'carapace', 'tier': 2, 'cost': 45, 'def': 4, 'rider': 'spiked'},
    'bulwark_plate': {'name': 'Bulwark Plate', 'slot': 'carapace', 'tier': 2, 'cost': 48, 'def': 3, 'maxHp': 3, 'rider': 'bulwark'},
    'mossback':     {'name': 'Mossback',     'slot': 'carapace', 'tier': 2, 'cost': 50, 'def': 3, 'rider': 'mossback'},
    'troll_hide':   {'name': 'Troll Hide',   'slot': 'carapace', 'tier': 3, 'cost': 80, 'def': 5, 'maxHp': 6, 'rider': 'spiked'},
    'ironshell_bulwark': {'name': 'Ironshell Bulwark', 'slot': 'carapace', 'tier': 3, 'cost': 85, 'def': 5, 'maxHp': 6, 'rider': 'bulwark'},
    # Carapace — new rarity rungs (complete the thick/bramble/spiked/bulwark/mossback ladders)
    'thornscrap_hide':   {'name': 'Thornscrap Hide', 'slot': 'carapace', 'tier': 1, 'cost': 22, 'def': 2, 'rider': 'spiked'},
    'barricade_shell':   {'name': 'Barricade Shell', 'slot': 'carapace', 'tier': 1, 'cost': 23, 'def': 2, 'rider': 'bulwark'},
    'mossling_hide':     {'name': 'Mossling Hide',   'slot': 'carapace', 'tier': 1, 'cost': 24, 'def': 2, 'rider': 'mossback'},
    'ridged_carapace':   {'name': 'Ridged Carapace', 'slot': 'carapace', 'tier': 2, 'cost': 46, 'def': 4, 'rider': 'thick'},
    'bramble_carapace':  {'name': 'Bramble Carapace', 'slot': 'carapace', 'tier': 2, 'cost': 47, 'def': 4, 'rider': 'bramble'},
    'colossus_shell':    {'name': 'Colossus Shell',  'slot': 'carapace', 'tier': 3, 'cost': 82, 'def': 5, 'maxHp': 6, 'rider': 'thick'},
    'bramble_aegis':     {'name': 'Bramble Aegis',   'slot': 'carapace', 'tier': 3, 'cost': 83, 'def': 5, 'maxHp': 6, 'rider': 'bramble'},
    'overgrown_bulwark': {'name': 'Overgrown Bulwark', 'slot': 'carapace', 'tier': 3, 'cost': 84, 'def': 5, 'maxHp': 6, 'rider': 'mossback'},
    # Carapace — Vital line (pure Max HP, no rider): trade DEF+rider for a big HP pool
    'bloatsac_plate':    {'name': 'Bloatsac Plate',    'slot': 'carapace', 'tier': 1, 'cost': 22, 'maxHp': 6},
    'engorged_carapace': {'name': 'Engorged Carapace', 'slot': 'carapace', 'tier': 2, 'cost': 46, 'maxHp': 12, 'def': 1},
    'leviathan_hide':    {'name': 'Leviathan Hide',    'slot': 'carapace', 'tier': 3, 'cost': 82, 'maxHp': 20, 'def': 2},
    # ── Hybrid line (tier 2) — two-stat, no rider. Off-ladder like Vital/
    # Illuminating: trade the rider for stats split across two PERK attributes
    # so one piece can bridge two perk nodes (perk_stat sums equipped gear).
    # Each sits on the slot matching its PRIMARY stat. Design 2026-07-23.
    'duelist_fang':   {'name': 'Duelist Fang',   'slot': 'fang',     'tier': 2, 'cost': 46, 'atk': 3, 'spd': 2},
    'warbrand_plate': {'name': 'Warbrand Plate', 'slot': 'carapace', 'tier': 2, 'cost': 46, 'def': 3, 'atk': 2},
    'wardens_charm':  {'name': "Warden's Charm",  'slot': 'charm',    'tier': 2, 'cost': 46, 'spd': 2, 'def': 2},
    # Charm — Feint riders (new slot; light on raw stats, value is the rider)
    'quartz_charm':   {'name': 'Quartz Charm',   'slot': 'charm', 'tier': 1, 'cost': 20, 'spd': 1, 'rider': 'trickster'},
    'venom_charm':    {'name': 'Venom Charm',    'slot': 'charm', 'tier': 1, 'cost': 25, 'spd': 1, 'rider': 'venomtrick'},
    'serrated_charm': {'name': 'Serrated Charm', 'slot': 'charm', 'tier': 2, 'cost': 45, 'spd': 1, 'rider': 'serrated'},
    'seer_charm':     {'name': 'Seer Charm',     'slot': 'charm', 'tier': 2, 'cost': 50, 'spd': 1, 'rider': 'seer', 'readBonus': 0.30},
    'cutpurse_charm': {'name': 'Cutpurse Charm', 'slot': 'charm', 'tier': 2, 'cost': 48, 'spd': 1, 'rider': 'cutpurse'},
    'glint_charm':    {'name': 'Glint Charm',    'slot': 'charm', 'tier': 3, 'cost': 80, 'spd': 2, 'rider': 'glint', 'readBonus': 0.15},
    # Charm — new rarity rungs (complete the trickster/venomtrick/serrated/seer/cutpurse/glint ladders)
    'chipped_charm':    {'name': 'Chipped Charm',   'slot': 'charm', 'tier': 1, 'cost': 22, 'spd': 1, 'rider': 'serrated'},
    'pickpocket_charm': {'name': 'Pickpocket Charm', 'slot': 'charm', 'tier': 1, 'cost': 23, 'spd': 1, 'rider': 'cutpurse'},
    'glass_eye':        {'name': 'Glass Eye',       'slot': 'charm', 'tier': 1, 'cost': 24, 'spd': 1, 'rider': 'seer', 'readBonus': 0.15},
    'glimmer_charm':    {'name': 'Glimmer Charm',   'slot': 'charm', 'tier': 1, 'cost': 24, 'spd': 1, 'rider': 'glint', 'readBonus': 0.08},
    'jesters_charm':    {'name': "Jester's Charm",  'slot': 'charm', 'tier': 2, 'cost': 46, 'spd': 1, 'rider': 'trickster'},
    'toxin_charm':      {'name': 'Toxin Charm',     'slot': 'charm', 'tier': 2, 'cost': 47, 'spd': 1, 'rider': 'venomtrick'},
    'gleam_charm':      {'name': 'Gleam Charm',     'slot': 'charm', 'tier': 2, 'cost': 50, 'spd': 1, 'rider': 'glint', 'readBonus': 0.12},
    'tricksters_idol':  {'name': "Trickster's Idol", 'slot': 'charm', 'tier': 3, 'cost': 82, 'spd': 2, 'rider': 'trickster'},
    'toxin_idol':       {'name': 'Plaguebloom Idol', 'slot': 'charm', 'tier': 3, 'cost': 83, 'spd': 2, 'rider': 'venomtrick'},
    'lacerating_idol':  {'name': 'Lacerating Idol', 'slot': 'charm', 'tier': 3, 'cost': 82, 'spd': 2, 'rider': 'serrated'},
    'oracles_idol':     {'name': "Oracle's Idol",   'slot': 'charm', 'tier': 3, 'cost': 82, 'spd': 2, 'rider': 'seer', 'readBonus': 0.45},
    'brigands_idol':    {'name': "Brigand's Idol",  'slot': 'charm', 'tier': 3, 'cost': 82, 'spd': 2, 'rider': 'cutpurse'},
    # Illuminating gear — light OR power. `light: 'full'` reveals the whole
    # dungeon (client-side fog). Deliberately weak on combat: the cost is a gear
    # slot + near-zero stats, in exchange for total information.
    'torchfang':       {'name': 'Torchfang',       'slot': 'fang',  'tier': 1, 'cost': 30, 'atk': 1, 'light': 'full'},
    'glowspore_charm': {'name': 'Glowspore Charm', 'slot': 'charm', 'tier': 1, 'cost': 30, 'light': 'full'},
    # ── Mythic (tier 4) — craft-only; forged from a Legendary at the Blacksmith
    # for 3 Chrysalis Ichor. Never dropped/sold/found (no tier-4 in GEAR_DROP,
    # the bazaar tier set, or the boss trove). One per rider family. New stat
    # band above T3 + the RIDER_SCALE[*][4] magnitude step. Names/stats are the
    # tune-undercity-balance surface.
    # Fangs
    'wyrm_godtooth':    {'name': 'Wyrm Godtooth',    'slot': 'fang', 'tier': 4, 'cost': 150, 'atk': 8, 'spd': 1, 'rider': 'barbed'},
    'sanguine_leviathan':{'name': 'Sanguine Leviathan','slot': 'fang','tier': 4, 'cost': 150, 'atk': 8, 'spd': 1, 'rider': 'bloodfang'},
    'worldrender_maw':  {'name': 'Worldrender Maw',   'slot': 'fang', 'tier': 4, 'cost': 150, 'atk': 8, 'spd': 1, 'rider': 'deep_biter'},
    'apex_ravener':     {'name': 'Apex Ravener',      'slot': 'fang', 'tier': 4, 'cost': 150, 'atk': 7, 'spd': 2, 'rider': 'rabid'},
    'worldcleaver':     {'name': 'Worldcleaver',      'slot': 'fang', 'tier': 4, 'cost': 150, 'atk': 8, 'rider': 'gutcleaver'},
    # Carapaces
    'titan_carapace':   {'name': 'Titan Carapace',    'slot': 'carapace', 'tier': 4, 'cost': 150, 'def': 6, 'maxHp': 8, 'rider': 'thick'},
    'thornlord_aegis':  {'name': 'Thornlord Aegis',   'slot': 'carapace', 'tier': 4, 'cost': 150, 'def': 6, 'maxHp': 8, 'rider': 'bramble'},
    'wyrmscale_wall':   {'name': 'Wyrmscale Wall',    'slot': 'carapace', 'tier': 4, 'cost': 150, 'def': 6, 'maxHp': 8, 'rider': 'spiked'},
    'adamant_bulwark':  {'name': 'Adamant Bulwark',   'slot': 'carapace', 'tier': 4, 'cost': 150, 'def': 6, 'maxHp': 8, 'rider': 'bulwark'},
    'ancient_grove_shell':{'name': 'Ancient Grove Shell','slot': 'carapace','tier': 4, 'cost': 150, 'def': 6, 'maxHp': 8, 'rider': 'mossback'},
    # Charms
    'godtrickster_idol':{'name': "Godtrickster's Idol",'slot': 'charm', 'tier': 4, 'cost': 150, 'spd': 3, 'rider': 'trickster'},
    'plaguelord_idol':  {'name': 'Plaguelord Idol',   'slot': 'charm', 'tier': 4, 'cost': 150, 'spd': 2, 'rider': 'venomtrick'},
    'eviscerator_idol': {'name': 'Eviscerator Idol',  'slot': 'charm', 'tier': 4, 'cost': 150, 'spd': 2, 'rider': 'serrated'},
    'allseeing_idol':   {'name': 'All-Seeing Idol',   'slot': 'charm', 'tier': 4, 'cost': 150, 'spd': 2, 'rider': 'seer', 'readBonus': 0.60},
    'kingpin_idol':     {'name': 'Kingpin Idol',      'slot': 'charm', 'tier': 4, 'cost': 150, 'spd': 3, 'rider': 'cutpurse'},
    'prism_idol':       {'name': 'Prism Idol',        'slot': 'charm', 'tier': 4, 'cost': 150, 'spd': 2, 'rider': 'glint', 'readBonus': 0.20},
}

# Effect-family index: rider tag -> {tier: gear_id}. After the rarity ladders
# (gear-rarity Phase 2) each (rider, tier) is a single piece, so this resolves a
# family's rungs for the drop "is-it-an-upgrade?" check and the Blacksmith's
# next-rung lookup. Light gear (no rider) is excluded.
GEAR_FAMILY = {}
for _gid, _g in GEAR.items():
    _rider = _g.get('rider')
    if _rider:
        GEAR_FAMILY.setdefault(_rider, {})[_g['tier']] = _gid

# ── Gear+ (Gorgon Stonewright mint) ──────────────────────────────────────────
# A Gorgon's Blacksmith upgrade mints a "+" variant of the piece: same slot,
# tier, and rider, with its primary stat bumped. Generated here from the base
# rider gear so the entire bare-id gear pipeline (equip, stash, market, salvage,
# client lookup) carries "+" ids for free. Runs AFTER GEAR_FAMILY so "+" ids are
# never treated as an upgrade rung.
PLUS_SUFFIX = '+'


def _gear_primary_stat(g):
    """Stat a Gear+ bump lands on: the largest of atk/def/spd (ties resolve in
    that order). maxHp is never the primary."""
    best, best_val = 'atk', -1
    for stat in ('atk', 'def', 'spd'):
        v = g.get(stat, 0)
        if v > best_val:
            best, best_val = stat, v
    return best


def plus_id(gid):
    """The Gear+ id for a base gid; idempotent (never doubles the suffix)."""
    return gid if gid.endswith(PLUS_SUFFIX) else gid + PLUS_SUFFIX


for _gid, _g in list(GEAR.items()):
    if _g.get('rider') in GEAR_FAMILY:          # upgradeable pieces only
        _p = dict(_g)
        _prime = _gear_primary_stat(_g)
        _bump = GEAR_PLUS_MYTHIC_BUMP if _g['tier'] >= 4 else GEAR_PLUS_BUMP
        _p[_prime] = _g.get(_prime, 0) + _bump
        _p['name'] = _g['name'] + ' +'
        _p['plus'] = True
        GEAR[plus_id(_gid)] = _p

# Gear the world is allowed to hand out: drops, bazaar stock, loot chests, and
# starter pieces. Excludes Gear+ ("+") variants — those are craft-only, minted
# solely by the Gorgon Stonewright at the Blacksmith (see undercity_db
# `_upgrade_gear`). Every random spawn pool MUST iterate this, never raw GEAR;
# equip/stash/salvage/market still look pieces up by id in GEAR, so "+" ids keep
# flowing through those by-id paths — they just can't be *found* in the wild.
WORLD_GEAR = {_gid: _g for _gid, _g in GEAR.items() if not _g.get('plus')}

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
    'enraged':  (0.45, {2: 0.5, 3: 0.5}),
}

# ── Ashen Fog (fog-of-war tile) d20 reveal table ─────────────────────────────
# The first player to land on a `fog` node rolls a d20; the tile locks to the
# revealed space type for the season. Ordered (hi, type) cutoffs covering 1..20
# — combat 8/20 (dangerous Wilds), cache the 5% jackpot on a nat 20.
# spec: specs/2026-07-29-undercity-ashen-fog-design.md
FOG_TABLE = [
    (8,  'wild'),     # 1–8   enemy (40%)
    (13, 'elite'),    # 9–13  elite enemy (25%)
    (15, 'loot'),     # 14–15 loot / Overgrown Cache puzzle (10%)
    (17, 'mystery'),  # 16–17 mystery (10%)
    (19, 'hazard'),   # 18–19 hazard (10%)
    (20, 'cache'),    # 20    cache — uncommon spore jackpot (5%)
]

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
# Per-stance signature-stat weight (spec 2026-07-21 rebalance). Guard keeps DEF's
# full weight (the tank's identity); Feint's SPD weight is lowered so SPD is a
# tempo/read stat, not also a heavy damage stat. Replaces the old single
# STANCE_SIG_WEIGHT (Guard↔DEF and Feint↔SPD used to share it at 1.0). Guard swing
# = OFFHAND_ATK×atk + GUARD_SIG_WEIGHT×def; Feint = OFFHAND_ATK×atk + FEINT_SIG_WEIGHT×spd.
GUARD_SIG_WEIGHT = 1.0
FEINT_SIG_WEIGHT = 0.6

# DEF is proportional mitigation, not flat subtraction (spec 2026-07-21). A hit is
# scaled by (1 - def/(def+MITIGATION_K)), capped at MITIGATION_CAP so nothing is
# invincible. def5 ~33%, def7 ~41%, def15 ~60% reduction.
MITIGATION_K = 10.0
MITIGATION_CAP = 0.75
# F-vs-F is a whiff: no damage either way.

ROT_PER_STACK   = 2   # damage per rot stack, ticked at end of each round
SWARM_CHIP_MULT = 0.5 # swarm: extra hit each round = hit * this (min 1)
FLURRY_CHANCE   = 0.25 # flurry: per-round chance for a bonus strike (weaker swarm)
SPIKESHELL_RETALIATE = 2  # spikeshell: damage dealt back when you LOSE an exchange
DEATHTOUCH_PIERCE  = 3  # RETIRED 2026-08-04 (Grave Titan is now Colossus); kept defined for save/backcompat only
FLYBY_DODGE        = 0.25  # skitter (fungus line): chance to dodge the punish when you LOSE an exchange
VENOM_BARB_BONUS   = 3   # RETIRED 2026-08-07 (Venom Barb now injects rot on each decisive win); kept defined for save/backcompat only
ONSLAUGHT_MULT = 2  # onslaught (ex rot_breath): first winning exchange * this

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
READ_MAX = 0.80              # cap so a read is never near-guaranteed (was 0.90)
READ_SPD_COEFF = 0.008       # faster creatures read better, but SPD no longer
                             # monopolises reads (was 0.015)
READ_PASSIVE_BONUS = {'first_bite': 0.20, 'stone_gaze': 0.15}  # First Bite insects + Gorgon gaze
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


def clone_bluff(level: int) -> float:
    """PvP clone bluff rate: scales with the target's level, capped. Scalars
    (CLONE_BLUFF_BY_LEVEL / CLONE_BLUFF_CAP) come from undercity_config."""
    return min(CLONE_BLUFF_CAP, max(0.0, CLONE_BLUFF_BY_LEVEL * level))

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
MIREFOOT_SPELL_DODGE = 12    # flat +dodge% vs field spells for bog natives (Mirefoot perk)
AWAY_EVENTS_CAP = 20
GRIMOIRE_DUPLICATE_SPORES = 15
MYSTERY_GRIMOIRE_CHANCE = 0.25  # mystery "free item" upgrades to an unowned book

SPELLS = {
    # Innate biome spells (one per home biome, always castable)
    'rot_surge':   {'name': 'Rot Surge', 'category': 'buff', 'tier': 1, 'cooldownMin': 30,
                    'effect': 'self_buff', 'buffKind': 'rot_surge',
                    'icon': 'local_fire_department', 'desc': '+3 ATK in your next battle.',
                    'blurb': '+3 ATK in your next battle.'},
    'bone_chill':  {'name': 'Bone Chill', 'category': 'field', 'tier': 1, 'cooldownMin': 30,
                    'effect': 'field_curse', 'buffKind': 'bone_chill', 'range': 5,
                    'icon': 'ac_unit', 'desc': 'Curse a rival: −2 ATK in their next battle.',
                    'blurb': 'Curse a rival: −2 ATK in their next battle.'},
    'bog_snare':   {'name': 'Bog Snare', 'category': 'field', 'tier': 1, 'cooldownMin': 30,
                    'effect': 'field_curse', 'buffKind': 'vines', 'range': 5,
                    'icon': 'water_drop', 'desc': 'Curse a rival: their next roll is halved.',
                    'blurb': 'Curse a rival: their next roll is halved.'},
    'glowveil':    {'name': 'Glowveil', 'category': 'buff', 'tier': 1, 'cooldownMin': 30,
                    'effect': 'self_buff', 'buffKind': 'glowveil',
                    'icon': 'flare', 'desc': '+2 SPD and +15% flee chance in your next battle.',
                    'blurb': '+2 SPD and +15% flee chance in your next battle.'},
    'scrap_toss':  {'name': 'Scrap Toss', 'category': 'field', 'tier': 1, 'cooldownMin': 30,
                    'effect': 'field_damage', 'power': 8, 'range': 5,
                    'icon': 'construction',
                    'desc': 'Hurl city scrap at a rival. Cannot drop a target below 1 HP.',
                    'blurb': 'Hurl city scrap at a rival for 8 damage.'},
    # Tier I (shop grimoires)
    'spore_bolt':  {'name': 'Spore Bolt', 'category': 'field', 'tier': 1, 'cooldownMin': 20,
                    'effect': 'field_damage', 'power': 12, 'range': 6,
                    'icon': 'flash_on',
                    'desc': 'A puff of caustic spores at range. Cannot drop a target below 1 HP.',
                    'blurb': 'A puff of caustic spores: 12 damage at range.'},
    'mend_flesh':  {'name': 'Mend Flesh', 'category': 'buff', 'tier': 1, 'cooldownMin': 20,
                    'effect': 'self_heal', 'power': 12,
                    'icon': 'healing', 'desc': 'Knit your wounds.',
                    'blurb': 'Knit your wounds: restore 12 HP.'},
    'harden_shell': {'name': 'Harden Shell', 'category': 'buff', 'tier': 1, 'cooldownMin': 20,
                     'effect': 'self_buff', 'buffKind': 'harden_shell',
                     'icon': 'shield', 'desc': '+2 DEF in your next battle.',
                     'blurb': '+2 DEF in your next battle.'},
    'skitter_step': {'name': 'Skitter Step', 'category': 'traversal', 'tier': 1,
                     'cooldownMin': 25, 'effect': 'fate_die', 'maxValue': 3,
                     'icon': 'directions_run', 'desc': 'Skitter ahead: choose your next roll (1–3).',
                     'blurb': 'Skitter ahead: choose your next roll (1–3).'},
    'sinkstep':    {'name': 'Sinkstep', 'category': 'traversal', 'tier': 1,
                    'cooldownMin': 25, 'effect': 'fate_die', 'maxValue': 1,
                    'icon': 'directions_walk',
                    'desc': 'Plant one sure step in the mire — your next roll is a guaranteed 1.',
                    'blurb': 'Your next roll is a guaranteed 1 — land exactly where you mean to.'},
    # Tier II (rare books — acquisition lands in phase 3)
    'rot_bolt':    {'name': 'Rot Bolt', 'category': 'field', 'tier': 2, 'cooldownMin': 25,
                    'effect': 'field_damage', 'power': 20, 'range': 7,
                    'icon': 'thunderstorm',
                    'desc': 'A lance of concentrated rot at range. Cannot drop a target below 1 HP.',
                    'blurb': 'A lance of concentrated rot: 20 damage at range.'},
    'weaken_hex':  {'name': 'Weaken Hex', 'category': 'field', 'tier': 2, 'cooldownMin': 25,
                    'effect': 'field_curse', 'buffKind': 'weaken_hex', 'range': 6,
                    'icon': 'heart_broken', 'desc': 'Curse a rival: −3 ATK in their next battle.',
                    'blurb': 'Curse a rival: −3 ATK in their next battle.'},
    'mycelial_recall': {'name': 'Mycelial Recall', 'category': 'traversal', 'tier': 2,
                        'cooldownMin': 45, 'effect': 'recall',
                        'icon': 'home', 'desc': 'The threads drag you home to your biome gate.',
                        'blurb': 'The threads drag you home to your biome gate.'},
    'fate_die':    {'name': 'Fate Die', 'category': 'traversal', 'tier': 2,
                    'cooldownMin': 40, 'effect': 'fate_die',
                    'icon': 'casino', 'desc': 'Choose the value of your next roll (1–6).',
                    'blurb': 'Choose the value of your next roll (1–6).'},
    # Tier III (legendary books — acquisition lands in phase 3)
    'spore_burst': {'name': 'Spore Burst', 'category': 'field', 'tier': 3, 'cooldownMin': 30,
                    'effect': 'field_damage', 'power': 30, 'range': 8,
                    'icon': 'coronavirus',
                    'desc': 'A detonation of spores at range. Cannot drop a target below 1 HP.',
                    'blurb': 'A detonation of spores: 30 damage at range.'},
    'deep_step':   {'name': 'Deep Step', 'category': 'traversal', 'tier': 3,
                    'cooldownMin': 30, 'effect': 'teleport', 'range': 6,
                    'icon': 'alt_route', 'desc': 'Blink to any space within 6 steps.',
                    'blurb': 'Blink to any space within 6 steps.'},
    'queens_bane': {'name': "Queen's Bane", 'category': 'boss', 'tier': 3,
                    'cooldownMin': 60, 'effect': 'boss_strike', 'power': 15,
                    'icon': 'gavel',
                    'desc': 'Sear the Queen or a lair boss, from anywhere. Cannot drop a '
                            'target below 1 HP — finish it in person.',
                    'blurb': 'Sear the Queen or a lair boss for 15, from anywhere.'},
    # Calamity Beast (T3) innate — cast ANY spell in the world. Not in any
    # grimoire or biome; granted by the `wish` passive. See squirrel-simple design.
    'wish':        {'name': 'Wish', 'category': 'boss', 'tier': 3,
                    'cooldownMin': 60, 'effect': 'wish',
                    'icon': 'auto_awesome', 'desc': 'Cast any spell in existence, from any list.',
                    'blurb': 'Bend the world: cast any spell in existence, from any list.'},
    # ── Expansion 2026-07-23 (spec: undercity-spell-expansion) ──
    'ember_fleck':  {'name': 'Ember Fleck', 'category': 'field', 'tier': 1, 'cooldownMin': 15,
                     'effect': 'field_damage', 'power': 10, 'range': 4,
                     'icon': 'whatshot',
                     'desc': 'A quick fleck of ember at close range. Cannot drop a target below 1 HP.',
                     'blurb': 'A fleck of ember scorches your rival.'},
    'necrotic_lance': {'name': 'Necrotic Lance', 'category': 'field', 'tier': 2, 'cooldownMin': 28,
                       'effect': 'field_damage', 'power': 16, 'range': 9,
                       'icon': 'colorize',
                       'desc': 'A long lance of necrotic rot. Cannot drop a target below 1 HP.',
                       'blurb': 'A lance of necrotic rot strikes from afar.'},
    'withering_gout': {'name': 'Withering Gout', 'category': 'field', 'tier': 3, 'cooldownMin': 26,
                       'effect': 'field_damage', 'power': 26, 'range': 6,
                       'icon': 'coronavirus',
                       'desc': 'A gout of withering decay. Cannot drop a target below 1 HP.',
                       'blurb': 'A gout of withering decay engulfs your rival.'},
    'renewing_bloom': {'name': 'Renewing Bloom', 'category': 'buff', 'tier': 2, 'cooldownMin': 25,
                       'effect': 'self_heal', 'power': 20,
                       'icon': 'local_florist', 'desc': 'A bloom of renewing spores.',
                       'blurb': 'Renewing spores bloom across your wounds.'},
    'deep_mend':    {'name': 'Deep Mend', 'category': 'buff', 'tier': 3, 'cooldownMin': 30,
                     'effect': 'self_heal', 'power': 34,
                     'icon': 'healing', 'desc': 'Deep restorative mycelium knits you whole.',
                     'blurb': 'Deep mycelium knits you whole.'},
    'sear_throne':  {'name': 'Sear the Throne', 'category': 'boss', 'tier': 3, 'cooldownMin': 60,
                     'effect': 'boss_strike', 'power': 22, 'lethal': True,
                     'icon': 'local_fire_department',
                     'desc': 'Sear the Queen or a lair boss from anywhere — the only spell '
                             'that can land the killing blow at range.',
                     'blurb': 'A searing bolt lances the throne from afar — it can slay outright.'},
    'shadowstep':   {'name': 'Shadowstep', 'category': 'traversal', 'tier': 2, 'cooldownMin': 25,
                     'effect': 'teleport', 'range': 3,
                     'icon': 'nightlight', 'desc': 'Blink to any space within 3 steps.',
                     'blurb': 'You step through the dark.'},
    'savage_roar':  {'name': 'Savage Roar', 'category': 'buff', 'tier': 2, 'cooldownMin': 25,
                     'effect': 'self_buff', 'buffKind': 'savage_roar',
                     'icon': 'local_fire_department', 'desc': '+5 ATK in your next battle.',
                     'blurb': '+5 ATK in your next battle.'},
    'iron_hide':    {'name': 'Iron Hide', 'category': 'buff', 'tier': 2, 'cooldownMin': 25,
                     'effect': 'self_buff', 'buffKind': 'iron_hide',
                     'icon': 'security', 'desc': '+4 DEF in your next battle.',
                     'blurb': '+4 DEF in your next battle.'},
    'fleetfoot_draught': {'name': 'Fleetfoot Draught', 'category': 'buff', 'tier': 2, 'cooldownMin': 25,
                          'effect': 'self_buff', 'buffKind': 'fleetfoot',
                          'icon': 'directions_run', 'desc': '+3 SPD in your next battle.',
                          'blurb': '+3 SPD in your next battle.'},
    'warding_dance': {'name': 'Warding Dance', 'category': 'buff', 'tier': 3, 'cooldownMin': 30,
                      'effect': 'self_buff', 'buffKind': 'warding_dance',
                      'icon': 'shield_moon', 'desc': '+3 DEF and +3 SPD in your next battle.',
                      'blurb': '+3 DEF and +3 SPD in your next battle.'},
    'sap_vigor':    {'name': 'Sap Vigor', 'category': 'field', 'tier': 2, 'cooldownMin': 25,
                     'effect': 'field_curse', 'buffKind': 'sap_vigor', 'range': 6,
                     'icon': 'trending_down', 'desc': 'Curse a rival: −3 SPD in their next battle.',
                     'blurb': 'Curse a rival: −3 SPD in their next battle.'},
    'rust_curse':   {'name': 'Rust Curse', 'category': 'field', 'tier': 3, 'cooldownMin': 28,
                     'effect': 'field_curse', 'buffKind': 'rust_curse', 'range': 6,
                     'icon': 'broken_image', 'desc': 'Curse a rival: −4 DEF in their next battle.',
                     'blurb': 'Curse a rival: −4 DEF in their next battle.'},
    'acorn_fury':   {'name': 'Acorn Fury', 'category': 'buff', 'tier': 1, 'cooldownMin': 15,
                     'effect': 'self_buff', 'buffKind': 'acorn_fury',
                     'icon': 'pest_control_rodent', 'desc': '+2 ATK in your next battle.',
                     'blurb': '+2 ATK in your next battle.'},
}

# Form passive -> an extra innate spell that form grants. Because passives
# accumulate through evolution (see _evolve), a form's apexes keep the spell,
# and existing live creatures gain it with no migration. Mirror: FORM_SPELLS in
# src/app/undercity/data/spells.ts + innateSpellIds().
FORM_SPELLS = {
    'rootwall': 'mend_flesh',   # Shambling Shell (+ its apexes) knit their wounds
}

# Home biome -> innate spell (always castable, no grimoire needed).
BIOME_SPELLS = {
    'garden': 'rot_surge',    # The Rot-Gardens (Composter)
    'bone':   'bone_chill',   # Ossuary Fields (Marrowborn)
    'bog':    'sinkstep',     # The Sedgemoor (Mirefoot) — self-utility fate step (bog_snare stays in its grimoire)
    'cavern': 'glowveil',     # Mosslight Cavern (Darkvision)
    'city':   'scrap_toss',   # The Undercity (City Rat)
}

# Species (starter line) -> extra innate spell, castable alongside the biome
# innate. `species` is the stored starter id and persists through evolution.
SPECIES_SPELLS = {
    'squirrel': 'acorn_fury',   # caster race signature
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
    # ── Expansion 2026-07-23 books ──
    'skirmishers_notes': {'name': "Skirmisher's Notes", 'tier': 1, 'cost': 32,
                          'spells': ['ember_fleck'],
                          'blurb': 'Hit-and-run scribbles for the light-footed.'},
    'bulwark_breviary': {'name': 'Bulwark Breviary', 'tier': 2, 'cost': 70,
                         'spells': ['iron_hide', 'renewing_bloom'],
                         'blurb': 'Stand firm, then knit what breaks through.'},
    'snipers_folio':    {'name': "Sniper's Folio", 'tier': 2, 'cost': 70,
                         'spells': ['necrotic_lance', 'fleetfoot_draught'],
                         'blurb': 'Reach out and touch them, from across the dark.'},
    'saboteurs_libram': {'name': "Saboteur's Libram", 'tier': 2, 'cost': 70,
                         'spells': ['sap_vigor', 'shadowstep'],
                         'blurb': 'Slow them down, then slip away.'},
    'berserkers_roll':  {'name': "Berserker's Roll", 'tier': 2, 'cost': 72,
                         'spells': ['savage_roar', 'ember_fleck'],
                         'blurb': 'Work yourself into a froth, then swing.'},
    'throneburner_codex': {'name': 'Throneburner Codex', 'tier': 3, 'cost': 150,
                           'spells': ['sear_throne', 'withering_gout', 'rust_curse'],
                           'blurb': 'Rites to unmake thrones and titans alike.'},
    'warding_tome':     {'name': 'Warding Tome', 'tier': 3, 'cost': 150,
                         'spells': ['warding_dance', 'deep_mend'],
                         'blurb': 'Deep wards and deeper mending.'},
}

# ── Spell scrolls (design 2026-07-23 bog-witch-scrolls) ──────────────────────
# A scroll carries one spell. It can be cast one-shot (source: 'scroll', no
# cooldown) or inscribed into a grimoire at the Sedgemoor Witch. Which spell
# tier a scroll from each reward source carries (chances in SCROLL_DROP_CHANCE).
SCROLL_DROP_TIER = {
    'loot': 1, 'mystery': 1,
    'elite': 2, 'dig': 2, 'cache': 2,
    'lair': 3, 'vault': 3, 'boss': 3,
}

# Spell ids grouped by tier for weighted scroll rolls (equal weight within tier).
SCROLLABLE_BY_TIER = {
    1: [sid for sid, s in SPELLS.items() if s['tier'] == 1 and s['effect'] != 'wish'],
    2: [sid for sid, s in SPELLS.items() if s['tier'] == 2 and s['effect'] != 'wish'],
    3: [sid for sid, s in SPELLS.items() if s['tier'] == 3 and s['effect'] != 'wish'],
}

# The Sedgemoor Witch's tier-I scroll stock (price = INSCRIBE_COST × markup).
WITCH_SCROLL_STOCK = ['spore_bolt', 'mend_flesh', 'harden_shell', 'scrap_toss']

# Trading post: the central-island exchange opens each night holding these 3
# house consumables (tagged "the Swarm"). Players swap one of their bag items
# for one of these; whatever they leave becomes the next visitor's stock,
# tagged with their name. Stock count stays fixed at 3 (swap in = swap out).
TRADING_POST_SEED = ['healing_moss', 'smoke_spore', 'loaded_die']
TRADING_POST_SIZE = len(TRADING_POST_SEED)

# Rot-Farm Bazaar limited-stock knobs (SHOP_*) live in undercity_config.py.

# ── Bazaar gear tiers ────────────────────────────────────────────────────────
# Standard (biome) bazaars stock these tiers only (uniform pick among all pieces
# of these tiers within the chosen slot). T3 reaches biome shops solely via the
# rare BAZAAR_BLACKMARKET_CHANCE event (see undercity_db._gen_shop_stock).
BAZAAR_GEAR_TIERS = {1, 2}

# Island bazaars pick a tier by weight (then a random piece of it). ~70% T2 /
# ~30% T3 -> "mostly T2, some T3".
ISLAND_BAZAAR_GEAR_TIERS = {2: 7, 3: 3}

# Bazaar nodes that use ISLAND_BAZAAR_GEAR_TIERS instead of the biome table.
ISLAND_BAZAAR_NODES = {'isl_bg1'}

# ── Umori's sealed auction — ranked mystery boxes (design 2026-08-05) ─────────
# Each rank rolls ONE reward from its weighted table (a treat, never a guaranteed
# endgame piece — the fix for the give-junk-get-legendary exploit). Reward specs:
#   ('gear', tier)                  a random gear piece of that tier
#   ('grimoire', tier)              a random grimoire of that tier
#   ('egg', tier)                   a companion egg of that tier
#   ('consumable',)                 a random consumable
#   ('materials', ichor, moltings)  crafting materials (ichor == Gemstones)
# Higher ranks skew toward the rare end; the materials entries are the "never a
# total whiff" floor. A rank whose winning bid is under its reserve
# (UMORI_RESERVES) rolls UMORI_BOX_CONSOLATION instead of its own table. Weights
# are tunable (tune-undercity-balance skill); client mirror in data/undercity-*.ts.
UMORI_BOX_TABLES = {
    1: {  # Gilded Coffer
        ('gear', 3): 3,
        ('grimoire', 3): 2,
        ('egg', 3): 2,
        ('gear', 2): 3,
        ('materials', 3, 4): 5,
    },
    2: {  # Curio Box
        ('gear', 2): 4,
        ('grimoire', 2): 2,
        ('egg', 2): 2,
        ('consumable',): 2,
        ('materials', 1, 3): 5,
    },
    3: {  # Trinket Pouch
        ('consumable',): 4,
        ('egg', 1): 2,
        ('materials', 0, 2): 6,
    },
}

# Rolled by any rank whose winning bid fell short of its reserve.
UMORI_BOX_CONSOLATION = {
    ('consumable',): 3,
    ('materials', 0, 2): 6,
    ('egg', 1): 1,
}

# Display names per rank (client mirror in data/undercity-*.ts).
UMORI_BOX_NAMES = {1: 'Gilded Coffer', 2: 'Curio Box', 3: 'Trinket Pouch'}

# Excavation dig sites (Ossuary Fields focus). A shared 5x5 grid holds four
# buried items sized by footprint; each landing grants 6 digs (reveal one cell
# each), refilled per visit like the Ossuary. Revealing an item's last cell
# collects it for whoever dug it; clearing the final item resets the grid and
# pays the finder a Spore bonus. Loot scales with footprint (see _roll_dig_loot
# in undercity_db). Partial reveals persist for the next player. No 1x1 finds —
# a single buried cell is too hard to hit blind, so every find is 1x2 or larger.
# If the digger's bag is full, the find is auto-listed on the Player Market at a
# fair mid price instead of being lost.
EXCAVATION_DIGS_PER_VISIT = 6
EXCAVATION_GRID = (5, 5)                     # (width, height)
EXCAVATION_ITEMS = ['1x2', '1x2', '1x2', '2x2']  # shapes buried per site
EXCAVATION_CLEAR_BONUS = 25                  # Spores for clearing the last item
# Mining is the crafting-material tap (design 2026-07-27): the vein + excavation
# pay Chrysalis Ichor + Moltings so gear-upgrades are actually reachable. Target
# (2026-08-01): a full night's mining tops a 3-slot loadout out at all-Legendary
# + 1-2 Mythic (~6-9 Gemstones; Rare->Mythic is 4 Gemstones). Clearing a whole
# dig site pays a materials cache:
EXCAVATION_CLEAR_ICHOR = 1
EXCAVATION_CLEAR_MOLTINGS = 2

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
VEIN_RARE_ITEMS = ['loaded_die', 'smoke_spore']
# Mining is a pure CRAFTING-MATERIAL tap — it pays Moltings + Gemstones (Ichor)
# and item finds, but NO Spores (Spores come from combat/board loot; a vein that
# also rained Spores made one night's haul far too rich). Materials per
# successful (non-cave-in) strike: always some Moltings, plus a level-scaling
# Gemstone roll (deeper shafts pay better — the risk/reward payoff).
# Rate tuned (2026-08-01) so a full night's mining tops a 3-slot loadout out at
# all-Legendary + 1-2 Mythic (~6-9 Gemstones): ~0.9 Gemstones/visit.
VEIN_MOLTINGS_PER_STRIKE = 1
VEIN_ICHOR_BASE = 0.2                 # ichor chance at level 1
VEIN_ICHOR_PER_LEVEL = 0.03           # + per level entered (≈0.56 at max depth)
VEIN_HEARTSTONE_ICHOR = 2             # bonus Ichor for prying the Heartstone

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


# ── Enemy stat blocks (one per creature; the species IS the difficulty) ──────
# No level scaling anywhere: when you see a beetle you know exactly what a
# beetle is. Difficulty is WHERE you fight — REGION_NPCS (below) gives each
# region its own flavored wild/elite pool, and a creature has ONE fixed stat
# block everywhere it appears. `personality`/`bluff` drive the stance AI:
# overworld fodder is readable (bluff 0) so good play reliably wins; elites and
# bosses bluff more. Every id here MUST have art at
# public/undercity/enemies/<id>.png (locked by test_every_placed_creature_has_art).
# Blocks added 2026-08-07 (the real-MTG art wired in that day) carry PRE-SIM
# starting numbers — the sim gate (sim/, tune-undercity-balance skill) may
# retune them. Roster + rationale:
# specs/2026-08-07-undercity-per-biome-spawn-pools-design.md
_SPEC = {s['id']: s for s in [
    # ── Undercity (city, T1) ─────────────────────────────────────────────────
    {'id': 'acolyte_of_affliction', 'name': 'Acolyte of Affliction',
     'hp': 26, 'atk': 8, 'def': 3, 'spd': 5, 'bounty': 8, 'xp': 10,
     'itemChance': 0.0, 'personality': 'trickster', 'bluff': 0.0},
    {'id': 'sewer_shambler', 'name': 'Sewer Shambler',
     'hp': 30, 'atk': 8, 'def': 4, 'spd': 4, 'bounty': 9, 'xp': 10,
     'itemChance': 0.0, 'personality': 'balanced', 'bluff': 0.0},
    # A city WILD (not elite) — T1-wild band, readable fast assassin.
    {'id': 'attendant_of_vraska', 'name': 'Attendant of Vraska',
     'hp': 28, 'atk': 8, 'def': 4, 'spd': 7, 'bounty': 8, 'xp': 10,
     'itemChance': 0.0, 'personality': 'trickster', 'bluff': 0.0},
    {'id': 'obelisk_spider', 'name': 'Obelisk Spider',
     'hp': 32, 'atk': 10, 'def': 6, 'spd': 6, 'bounty': 18, 'xp': 25,
     'itemChance': 0.28, 'personality': 'balanced', 'bluff': 0.12},
    # ── Rot-Gardens (garden, T1) ─────────────────────────────────────────────
    {'id': 'thallid', 'name': 'Thallid',
     'hp': 32, 'atk': 7, 'def': 4, 'spd': 3, 'bounty': 8, 'xp': 10,
     'itemChance': 0.0, 'personality': 'balanced', 'bluff': 0.0},
    {'id': 'thallid_shell_dweller', 'name': 'Thallid Shell-Dweller',
     'hp': 34, 'atk': 6, 'def': 6, 'spd': 2, 'bounty': 9, 'xp': 10,
     'itemChance': 0.0, 'personality': 'turtle', 'bluff': 0.0},
    # Fast glass biter — readable (bluff 0), low HP/DEF but stings.
    {'id': 'ravenous_squirrel', 'name': 'Ravenous Squirrel',
     'hp': 24, 'atk': 7, 'def': 2, 'spd': 7, 'bounty': 8, 'xp': 10,
     'itemChance': 0.0, 'personality': 'trickster', 'bluff': 0.0},
    {'id': 'canker_abomination', 'name': 'Canker Abomination',
     'hp': 34, 'atk': 8, 'def': 4, 'spd': 3, 'bounty': 9, 'xp': 10,
     'itemChance': 0.0, 'personality': 'brute', 'bluff': 0.0},
    {'id': 'rotwood_elemental', 'name': 'Rotwood Elemental',
     'hp': 32, 'atk': 10, 'def': 6, 'spd': 5, 'bounty': 18, 'xp': 25,
     'itemChance': 0.28, 'personality': 'turtle', 'bluff': 0.10},
    # ── Ossuary Fields (bone, T1 — no elite spaces on the map) ────────────────
    {'id': 'boneyard_lurker', 'name': 'Boneyard Lurker',
     'hp': 30, 'atk': 8, 'def': 4, 'spd': 4, 'bounty': 9, 'xp': 10,
     'itemChance': 0.0, 'personality': 'balanced', 'bluff': 0.0},
    # Re-statted 2026-08-07 into the T1-wild band (was a T1-elite block): a
    # non-elite home wild should read Lv1-2, not spike. Balanced shape kept.
    {'id': 'fiend_artisan', 'name': 'Fiend Artisan',
     'hp': 30, 'atk': 8, 'def': 5, 'spd': 4, 'bounty': 9, 'xp': 10,
     'itemChance': 0.0, 'personality': 'balanced', 'bluff': 0.0},
    # Re-statted from its old T2 block down to a T1 wild (balanced skeleton).
    {'id': 'mosspit_skeleton', 'name': 'Mosspit Skeleton',
     'hp': 34, 'atk': 8, 'def': 5, 'spd': 5, 'bounty': 9, 'xp': 10,
     'itemChance': 0.0, 'personality': 'balanced', 'bluff': 0.0},
    # ── Mosslight Cavern (cavern, T1) ─────────────────────────────────────────
    {'id': 'duskwood_watcher', 'name': 'Duskwood Watcher',
     'hp': 28, 'atk': 7, 'def': 4, 'spd': 5, 'bounty': 8, 'xp': 10,
     'itemChance': 0.0, 'personality': 'balanced', 'bluff': 0.0},
    # Re-statted from its old T2 block to a T1 wild; fast-glass shape kept.
    {'id': 'leyline_prowler', 'name': 'Leyline Prowler',
     'hp': 30, 'atk': 8, 'def': 3, 'spd': 7, 'bounty': 8, 'xp': 10,
     'itemChance': 0.0, 'personality': 'trickster', 'bluff': 0.0},
    # Re-statted from its old T2 block to a T1 wild; tanky (high DEF, low SPD).
    {'id': 'loleth_troll', 'name': 'Lotleth Troll',
     'hp': 36, 'atk': 7, 'def': 6, 'spd': 3, 'bounty': 9, 'xp': 10,
     'itemChance': 0.0, 'personality': 'turtle', 'bluff': 0.0},
    # Cavern elite, dialled from a Lv6 spike down to a fair Lv4 (ATK 16->13).
    {'id': 'large_bear', 'name': 'Large Bear',
     'hp': 44, 'atk': 13, 'def': 5, 'spd': 7, 'bounty': 22, 'xp': 42,
     'itemChance': 0.15, 'personality': 'brute', 'bluff': 0.10},
    # ── The Sedgemoor (bog, T1) ───────────────────────────────────────────────
    {'id': 'bogwater_lumarent', 'name': 'Bogwater Lumarent',
     'hp': 28, 'atk': 7, 'def': 3, 'spd': 6, 'bounty': 8, 'xp': 10,
     'itemChance': 0.0, 'personality': 'trickster', 'bluff': 0.0},
    {'id': 'hag_hedgemage', 'name': 'Hag Hedgemage',
     'hp': 30, 'atk': 8, 'def': 3, 'spd': 5, 'bounty': 9, 'xp': 10,
     'itemChance': 0.0, 'personality': 'trickster', 'bluff': 0.0},
    {'id': 'drudge_beetle', 'name': 'Drudge Beetle',
     'hp': 22, 'atk': 6, 'def': 2, 'spd': 5, 'bounty': 6, 'xp': 10,
     'itemChance': 0.0, 'personality': 'brute', 'bluff': 0.0},
    {'id': 'golgari_rotwurm', 'name': 'Golgari Rotwurm',
     'hp': 44, 'atk': 13, 'def': 4, 'spd': 6, 'bounty': 26, 'xp': 42,
     'itemChance': 0.20, 'personality': 'brute', 'bluff': 0.10},
    # ── Deep dwellers — The Depths + The Ruinways (depths/ruin, T2) ───────────
    # In the Depths, 75% of wild rolls are the biome's boss familiar
    # (LAIR_SIGNATURE) so the Rendclaw Troll / Teacher's Pest fallback fills the rest.
    # Proper T2 wilds (Lv3-4) — at least T1-elite grade, below the Depths elites
    # (Moldering Karock Lv4 / Catacomb Shifter Lv6), with T2 rewards.
    {'id': 'rendclaw_troll', 'name': 'Rendclaw Troll',
     'hp': 46, 'atk': 13, 'def': 5, 'spd': 5, 'bounty': 24, 'xp': 42,
     'itemChance': 0.20, 'personality': 'brute', 'bluff': 0.10},
    {'id': 'teachers_pest', 'name': "Teacher's Pest",
     'hp': 38, 'atk': 11, 'def': 4, 'spd': 8, 'bounty': 22, 'xp': 40,
     'itemChance': 0.20, 'personality': 'trickster', 'bluff': 0.15},
    {'id': 'moldering_karock', 'name': 'Moldering Karock',
     'hp': 56, 'atk': 11, 'def': 6, 'spd': 3, 'bounty': 28, 'xp': 45,
     'itemChance': 0.25, 'personality': 'turtle', 'bluff': 0.10},
    {'id': 'catacomb_shifter', 'name': 'Catacomb Shifter',
     'hp': 54, 'atk': 15, 'def': 7, 'spd': 8, 'bounty': 28, 'xp': 48,
     'itemChance': 0.25, 'personality': 'trickster', 'bluff': 0.18},
    # ── The Wilderness (wilderness, T2) ───────────────────────────────────────
    {'id': 'infested_thrinax', 'name': 'Infested Thrinax',
     'hp': 48, 'atk': 13, 'def': 5, 'spd': 7, 'bounty': 28, 'xp': 45,
     'itemChance': 0.25, 'personality': 'balanced', 'bluff': 0.15},
    # Glass-cannon sniper — top-of-band ATK/SPD, paper DEF/HP; punish feints.
    {'id': 'poison_tip_archer', 'name': 'Poison-Tip Archer',
     'hp': 44, 'atk': 14, 'def': 4, 'spd': 10, 'bounty': 27, 'xp': 44,
     'itemChance': 0.22, 'personality': 'trickster', 'bluff': 0.18},
    {'id': 'sluiceway_scorpion', 'name': 'Sluiceway Scorpion',
     'hp': 48, 'atk': 14, 'def': 6, 'spd': 9, 'bounty': 22, 'xp': 46,
     'itemChance': 0.15, 'personality': 'trickster', 'bluff': 0.15},
    # A menacing flyer — races to open on Aggress; a Guard turns its swing back.
    {'id': 'vulturous_zombie', 'name': 'Vulturous Zombie',
     'hp': 68, 'atk': 18, 'def': 5, 'spd': 9, 'bounty': 38, 'xp': 56,
     'itemChance': 0.32, 'personality': 'brute', 'bluff': 0.18},
    # ── Sigil Isle (isle, T3 — endgame) ───────────────────────────────────────
    {'id': 'putrid_leech', 'name': 'Putrid Leech',
     'hp': 100, 'atk': 20, 'def': 6, 'spd': 7, 'bounty': 50, 'xp': 70,
     'itemChance': 0.40, 'personality': 'brute', 'bluff': 0.15},
    # Sim-tuned 2026-08-07: softened from 120/22/9/4 so the isle WILD is a fair-
    # hard fight, not harder than the elite (it was 24% at-level; a wild shouldn't
    # out-threaten the apex). Still a tanky mini-boss presence.
    {'id': 'molderhulk', 'name': 'Molderhulk',
     'hp': 108, 'atk': 20, 'def': 8, 'spd': 5, 'bounty': 60, 'xp': 85,
     'itemChance': 0.45, 'personality': 'brute', 'bluff': 0.20},
    # Sim-tuned 2026-08-07: faster + harder-hitting so it reads as the true isle
    # APEX (a slow turtle got out-tempoed to 87% winnable — too easy for Lv10).
    {'id': 'deity_of_scars', 'name': 'Deity of Scars',
     'hp': 140, 'atk': 27, 'def': 10, 'spd': 8, 'bounty': 72, 'xp': 98,
     'itemChance': 0.50, 'personality': 'brute', 'bluff': 0.25},
]}


# ── Region-gated flavored spawn pools (design 2026-08-07 per-biome) ──────────
# Difficulty is WHERE you are. Each region draws its OWN flavored wild/elite
# pool (not a shared tier pool). REGION_TIER keeps the difficulty ramp for XP /
# renown calibration and client sprite scaling (mirror:
# src/app/undercity/engine/board-enemy-tier.ts). The ramp:
#   T1 surface homes → T2 depths/ruin/wilderness → T3 isle.
REGION_TIER = {
    'city': 1, 'garden': 1, 'bone': 1, 'cavern': 1, 'bog': 1,
    'ruin': 2, 'depths': 2, 'wilderness': 2,
    'isle': 3,
}

# The Depths and the Ruinways share one T2 "deep dwellers" pool. In the Depths,
# 75% of wild rolls are the biome's boss familiar (SIGNATURE_SPAWN_CHANCE), so
# this fallback fills the remainder; the Ruinways lean on their moldering_karock
# signature the same way.
_DEEP_DWELLERS = {
    'wild':  [_SPEC['rendclaw_troll'], _SPEC['teachers_pest']],
    'elite': [_SPEC['moldering_karock'], _SPEC['catacomb_shifter']],
}

# Per-region pools. Map realities (map.json, 305 nodes) baked in: 'bone' has NO
# elite spaces (wild-only); 'wilderness' wild encounters arrive via its Ashen-
# Fog tiles. Molderhulk deliberately appears in both isle wild and elite (a
# mini-boss presence in the small endgame roster).
REGION_NPCS = {
    'city':       {'wild':  [_SPEC['acolyte_of_affliction'], _SPEC['sewer_shambler'],
                             _SPEC['attendant_of_vraska']],
                   'elite': [_SPEC['obelisk_spider']]},
    'garden':     {'wild':  [_SPEC['thallid'], _SPEC['thallid_shell_dweller'],
                             _SPEC['ravenous_squirrel'], _SPEC['canker_abomination']],
                   'elite': [_SPEC['rotwood_elemental']]},
    'bone':       {'wild':  [_SPEC['boneyard_lurker'], _SPEC['fiend_artisan'], _SPEC['mosspit_skeleton']],
                   'elite': []},   # no elite spaces on the map
    'cavern':     {'wild':  [_SPEC['duskwood_watcher'], _SPEC['leyline_prowler'], _SPEC['loleth_troll']],
                   'elite': [_SPEC['large_bear']]},
    'bog':        {'wild':  [_SPEC['bogwater_lumarent'], _SPEC['hag_hedgemage'], _SPEC['drudge_beetle']],
                   'elite': [_SPEC['golgari_rotwurm']]},
    'depths':     _DEEP_DWELLERS,
    'ruin':       _DEEP_DWELLERS,
    'wilderness': {'wild':  [_SPEC['infested_thrinax'], _SPEC['poison_tip_archer'], _SPEC['sluiceway_scorpion']],
                   'elite': [_SPEC['vulturous_zombie']]},
    'isle':       {'wild':  [_SPEC['molderhulk'], _SPEC['putrid_leech']],
                   'elite': [_SPEC['deity_of_scars'], _SPEC['molderhulk']]},
}


def region_tier(region):
    """Difficulty tier (1-3) for a board region; unknown/None -> 1 (safe)."""
    return REGION_TIER.get(region or '', 1)


def region_npcs(region, elite=False):
    """Flavored spawn pool for a region. Unknown/None region -> city (safe
    home). An empty elite pool (only 'bone') falls back to the wild pool so a
    caller never draws from an empty list."""
    pools = REGION_NPCS.get(region or '', REGION_NPCS['city'])
    return (pools['elite'] if elite else pools['wild']) or pools['wild']


# ── Boss familiars (design 2026-08-04) ───────────────────────────────────────
# Bespoke minions that exist ONLY in their boss's turf (not in any wild/elite
# pool). Each is a mini-elite whose menace is its signature trait, not its HP —
# low HP (below the boss and the depths wilds) so a ~level-5 creature powers
# through, which also keeps the stacking traits from spiralling. Each shares its
# trait with its lair boss (LAIR_BOSSES), so the familiar teaches the fight.
# Rolled at WILD spaces via SIGNATURE_SPAWN_CHANCE in _wild_battle. Sprite art
# lives in public/undercity/boss_spawns/; `sprites` lists the variants that art
# rotates through per encounter (Gitrog has two). Starting numbers pre-sim
# (design §2.2) — the sim gate (sim/sim_boss_familiars.py) may retune them.
LAIR_FAMILIAR = {
    'skullbriars_familiar': {
        # Squishier than its peers: Grave Growth is unconditional, so a shorter
        # fight (lower HP/ATK) keeps the ramp from walling defensive/low-ATK play
        # (sim gate 2026-08-04 — 32/12 fell below the good-play floor).
        'id': 'skullbriars_familiar', 'name': "Skullbriar's Familiar",
        'hp': 27, 'atk': 11, 'def': 4, 'spd': 6, 'bounty': 20, 'xp': 30,
        'itemChance': 0.25, 'personality': 'brute', 'bluff': 0.18,
        'passives': ['grave_growth'], 'sprites': ['skullbriars_familiar']},
    'slimefoots_saprolings': {
        'id': 'slimefoots_saprolings', 'name': "Slimefoot's Saprolings",
        'hp': 34, 'atk': 10, 'def': 5, 'spd': 5, 'bounty': 20, 'xp': 30,
        'itemChance': 0.25, 'personality': 'balanced', 'bluff': 0.12,
        'passives': ['swarm'], 'sprites': ['slimefoots_saprolings']},
    'gitrog_spawn': {
        'id': 'gitrog_spawn', 'name': 'Gitrog Spawn',
        'hp': 34, 'atk': 10, 'def': 6, 'spd': 5, 'bounty': 20, 'xp': 30,
        'itemChance': 0.25, 'personality': 'turtle', 'bluff': 0.12,
        'passives': ['dredge'], 'sprites': ['gitrog_spawn', 'gitrog_spawn2']},
    'sarulfs_packmate': {
        'id': 'sarulfs_packmate', 'name': "Sarulf's Packmate",
        'hp': 30, 'atk': 11, 'def': 4, 'spd': 8, 'bounty': 20, 'xp': 30,
        'itemChance': 0.25, 'personality': 'trickster', 'bluff': 0.18,
        'passives': ['doom_counters'], 'sprites': ['sarulfs_packmate']},
    'ishkanahs_hatchling': {
        'id': 'ishkanahs_hatchling', 'name': "Ishkanah's Hatchling",
        'hp': 30, 'atk': 11, 'def': 4, 'spd': 8, 'bounty': 20, 'xp': 30,
        'itemChance': 0.25, 'personality': 'trickster', 'bluff': 0.18,
        'passives': ['web_venom'], 'sprites': ['ishankas_hatchling']},
}

# The five biome bosses spawn their familiar on WILD turf; the ruin keeps its
# borrowed pool signature (Lord of Extinction / Doomgape are separate content).
LAIR_SIGNATURE = {
    'bone':   'skullbriars_familiar',   # Skullbriar, the Walking Grave
    'garden': 'slimefoots_saprolings',  # Slimefoot, the Stowaway
    'bog':    'gitrog_spawn',           # The Gitrog Monster
    'cavern': 'sarulfs_packmate',       # Sarulf, Realm Eater
    'city':   'ishkanahs_hatchling',    # Ishkanah, Grafwidow
    'ruin':   'moldering_karock',       # Lord of Extinction / Doomgape (unchanged)
}

# Trait passives surfaced as inspectable battle chips (client STATUS_INFO mirror).
TRAIT_PASSIVES = ('grave_growth', 'doom_counters', 'dredge', 'swarm', 'web_venom', 'venom_barb')

# Every wild/elite enemy spec, indexed by id, so a signature (LAIR_SIGNATURE)
# can be pulled from whichever region pool it lives in.
ENEMY_SPECS_BY_ID = dict(_SPEC)


# ── Derived opponent level (battle UI) ───────────────────────────────────────
# Enemies store no level. This maps a stat block onto the player's own level
# scale so the "Lv. N" beside a foe reads as "roughly what player level this is a
# fair fight for." Calibrated against the enemy tables and the recommended-level
# notes scattered above: basic wilds ~Lv1, elites ~Lv2-3, wilderness wilds
# ~Lv5-6, wilderness elites ~Lv7-8, lair/barrier bosses ~Lv3-5. maxHp is capped
# so the finale boss's huge SHARED persistent pool (Savra, 400 HP) doesn't read
# as an absurd level — her menace is the shared pool the HP bar already shows.
# The battle_start / battle-resume payloads carry the computed level to the
# client (no client mirror — the value always arrives with the fight).
ENEMY_LEVEL_HP_CAP = 80   # above any normal enemy (max is 70); clips only the boss pool


def enemy_level(atk: int, dfn: int, spd: int, max_hp: int) -> int:
    """A 1-based power level derived from a foe's stat block (see note above)."""
    power = atk + dfn + spd + min(max_hp, ENEMY_LEVEL_HP_CAP) / 4
    return max(1, round((power - 17) / 4.5))


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
    # Achromatic paints. Real hues are 0–359; these carry out-of-range sentinel
    # values (< 0) stored verbatim in a creature's `paint`. The server treats
    # them as opaque numbers — the client recolor reads "< 0" as greyscale and
    # remaps brightness into a band (NEUTRAL_BANDS in src/app/undercity/data/
    # cosmetics.ts). Keep ids/values in sync with that client mirror.
    {'id': 'white', 'name': 'White', 'hue': -1},
    {'id': 'grey', 'name': 'Grey', 'hue': -2},
    {'id': 'black', 'name': 'Black', 'hue': -3},
]
DEFAULT_PAINTS = ['forest', 'gold']  # everyone owns these from their first hatch

HAT_MAP = {h['id']: h for h in HATS}
PAINT_MAP = {p['id']: p for p in PAINTS}

# Reverse lookup for granting a rolled shell color as an owned paint (hues are
# unique across PAINTS, so this is unambiguous). Mirror: undercity_db._join.
HUE_TO_PAINT = {p['hue']: p['id'] for p in PAINTS}

# ── Renown shop (pre-spawn) prices ───────────────────────────────────────────
HAT_PRICES = {'common': 50, 'uncommon': 120, 'legendary': 300}
PAINT_PRICE = 40  # any non-default color

# ── Special paints (animated whole-creature effects; Dino Party port) ─────────
# Distinct from hue paints: a special paint sets a creature's `effect`, an
# animated overlay drawn client-side on top of its hues. Bought/owned like hats.
SPECIAL_PAINTS = [
    {'id': 'prismatic', 'name': 'Prismatic'},
    {'id': 'rainbow',   'name': 'Rainbow'},
    {'id': 'metallic',  'name': 'Metallic'},
    {'id': 'starry',    'name': 'Starry'},
]
SPECIAL_PAINT_MAP = {p['id']: p for p in SPECIAL_PAINTS}
SPECIAL_PAINT_PRICE = 500  # renown, per special paint

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
# (shared) and pays the winner alone. The Corpsejack Menace seals the ruin
# pocket that holds the Doomgape lair (n288): unlike the two turtles it is a
# fast glass striker (high SPD/ATK, thin DEF), so it rewards a different counter.
BARRIER_GUARDIANS = {
    'bar_e': {'id': 'golgari_grave_troll', 'name': 'Golgari Grave-Troll',
              'hp': 36, 'atk': 11, 'def': 6, 'spd': 3, 'bounty': 30, 'xp': 25,
              'personality': 'turtle', 'bluff': 0.30},
    'bar_s': {'id': 'wight_of_the_reliquary', 'name': 'Wight of the Reliquary',
              'hp': 42, 'atk': 12, 'def': 6, 'spd': 5, 'bounty': 35, 'xp': 25,
              'personality': 'turtle', 'bluff': 0.30},
    'n286': {'id': 'corpsejack_menace', 'name': 'Corpsejack Menace',
             'hp': 44, 'atk': 14, 'def': 5, 'spd': 9, 'bounty': 40, 'xp': 28,
             'personality': 'trickster', 'bluff': 0.30},
}

# Mini-bosses at the lairs. First kill per player pays `first`; repeats pay
# `repeat`. Tuned so a level-6-7 creature kills them inside the 6-round cap
# (see the tier-balance tests). The five biome-dungeon lairs grant Guild
# Sigils on first clear; lair_titan is side content.
_LAIR_REWARD = {'first': {'spores': 60, 'xp': 35}, 'repeat': {'spores': 15, 'xp': 12}}
LAIR_BOSSES = {
    'lair_titan': {'id': 'lord_of_extinction', 'name': 'Lord of Extinction',
                   'hp': 46, 'atk': 14, 'def': 7, 'spd': 4,
                   'personality': 'brute', 'bluff': 0.35, **_LAIR_REWARD},
    'n288': {'id': 'doomgape', 'name': 'Doomgape',
             'hp': 46, 'atk': 15, 'def': 6, 'spd': 5,
             'personality': 'brute', 'bluff': 0.35, **_LAIR_REWARD},
    'city_lair': {'id': 'ishkanah', 'name': 'Ishkanah, Grafwidow',
                  'hp': 42, 'atk': 14, 'def': 5, 'spd': 8,
                  'personality': 'trickster', 'bluff': 0.35,
                  'passives': ['web_venom'], **_LAIR_REWARD},
    'cavern_lair': {'id': 'sarulf', 'name': 'Sarulf, Realm Eater',
                    'hp': 44, 'atk': 13, 'def': 6, 'spd': 7,
                    'personality': 'balanced', 'bluff': 0.35,
                    'passives': ['doom_counters'], **_LAIR_REWARD},
    'bog_lair': {'id': 'gitrog_monster', 'name': 'The Gitrog Monster',
                 'hp': 48, 'atk': 12, 'def': 7, 'spd': 5,
                 'personality': 'turtle', 'bluff': 0.35,
                 'passives': ['dredge'], **_LAIR_REWARD},
    'bone_lair': {'id': 'skullbriar', 'name': 'Skullbriar, the Walking Grave',
                  'hp': 40, 'atk': 15, 'def': 6, 'spd': 6,
                  'personality': 'brute', 'bluff': 0.35,
                  'passives': ['grave_growth'], **_LAIR_REWARD},
    'garden_lair': {'id': 'slimefoot', 'name': 'Slimefoot, the Stowaway',
                    'hp': 46, 'atk': 13, 'def': 7, 'spd': 4,
                    'personality': 'turtle', 'bluff': 0.35,
                    'passives': ['swarm'], **_LAIR_REWARD},
}

# The two ruin lairs are side content: instead of the shared pool + permanent
# Vestige, each player kills them, the lair sits abandoned for LAIR_RESPAWN_MINUTES,
# then it respawns fresh. See specs/2026-08-02-undercity-respawning-ruin-lairs-design.md
RESPAWN_LAIRS = {'lair_titan', 'n288'}

LAIR_ABANDONED_DIALOGUE = {
    'lair_titan': "The Lord of Extinction's lair lies still and abandoned — bones "
                  'and shed carapace litter the dark. Nothing left but scraps.',
    'n288': "Doomgape's pit is silent, its maw gone. Only spoor and spore remain "
            'among the ruin.',
}

# Minor consumables scrounged from an abandoned lair (bag-full falls back to Spores).
LAIR_SCAVENGE_ITEMS = ['healing_moss', 'smoke_spore', 'scrying_spore']

# The wilderness World Event boss. `spriteId` maps to public/undercity/sigil_boss/
# art on the client. Stats are per-swing combat stats; the live shared pool comes
# from WORLD_EVENT_HP (config, re-exported above) via the WORLDEVENT record.
WORLD_EVENT = {
    'id': 'moor_wyrm',
    'name': 'The Moor-Wyrm',
    'spriteId': 'moor_wyrm',
    'atk': 12, 'def': 6, 'spd': 5,
    'personality': 'brute', 'bluff': 0.30,
}


def world_event_reward(share, is_top):
    """Map a contributor's damage `share` (dealt / maxHp, 0..1) and whether they
    are the single top damage dealer to a bracket key + its reward dict.
    Returns (bracket_key, {'spores': int, 'renown': int}). WORLD_EVENT_* scalars
    come from undercity_config via the `import *` at the top of this module."""
    if is_top:
        key = 'vanquisher'
    elif share >= WORLD_EVENT_MAJOR_SHARE:
        key = 'major'
    elif share >= WORLD_EVENT_MINOR_SHARE:
        key = 'minor'
    else:
        key = 'participant'
    return key, WORLD_EVENT_REWARDS[key]


# Enraged wilderness monsters. Four stat-distinct variants, one picked
# deterministically per ENRAGED_DWELL_MIN window (see undercity_db._enraged_*).
# ~40 HP in the barrier/lair band so decent gear can down them; each rewards a
# different build. `bounty` is the renown-echo used in flavor; the real perm
# renown grant is ENRAGED_KILL_RENOWN (config). Rooted → curses convert to speed
# penalties via GUARDIAN_DEBUFF, same as guardians. Each variant borrows a real
# enemy sprite (public/undercity/enemies/<sprite>.png) so the roaming monster
# always shows actual art on the board + battle card — every id below MUST have a
# matching PNG. `sprite` is emitted as the client `spriteId`. The four archetypes
# still reward distinct builds (brute / wall / speedster / all-rounder). Mirror
# names + sprites in src/app/undercity/data/enraged.ts.
ENRAGED_MONSTERS = {
    'enr_brute':    {'id': 'enr_brute', 'name': 'Enraged Lotleth Troll',
                     'sprite': 'loleth_troll',
                     'hp': 38, 'atk': 15, 'def': 4, 'spd': 5,
                     'bounty': 16, 'xp': 30, 'personality': 'brute', 'bluff': 0.25},
    'enr_carapace': {'id': 'enr_carapace', 'name': 'Enraged Sluiceway Scorpion',
                     'sprite': 'sluiceway_scorpion',
                     'hp': 44, 'atk': 10, 'def': 9, 'spd': 3,
                     'bounty': 18, 'xp': 32, 'personality': 'turtle', 'bluff': 0.30},
    'enr_swift':    {'id': 'enr_swift', 'name': 'Enraged Leyline Prowler',
                     'sprite': 'leyline_prowler',
                     'hp': 36, 'atk': 12, 'def': 5, 'spd': 10,
                     'bounty': 16, 'xp': 30, 'personality': 'trickster', 'bluff': 0.30},
    'enr_ravager':  {'id': 'enr_ravager', 'name': 'Enraged Golgari Rot Wurm',
                     'sprite': 'golgari_rotwurm',
                     'hp': 40, 'atk': 14, 'def': 6, 'spd': 7,
                     'bounty': 20, 'xp': 34, 'personality': 'balanced', 'bluff': 0.28},
}

# Stable ordered id list for deterministic per-window picks (sorted so it is
# reproducible across Python runs, independent of dict insertion order).
ENRAGED_ORDER = sorted(ENRAGED_MONSTERS)


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
               'itemChance': 0.10, 'personality': 'turtle', 'bluff': 0.10},
    'garden': {'id': 'rot_grub',   'name': 'Thallid',
               'hp': 28, 'atk': 7, 'def': 3, 'spd': 5, 'bounty': 14, 'xp': 15,
               'itemChance': 0.15, 'personality': 'turtle', 'bluff': 0.10},
}

# Signature hazards — display copy here; behavior lives in undercity_db._hazard.
DUNGEON_HAZARDS = {
    'city':   {'id': 'webbing', 'name': 'Webbing',
               'text': 'Sticky broodsilk cinches tight — your next two rolls are '
                       'halved, and the silk saws into you.'},
    'cavern': {'id': 'spore_cloud', 'name': 'Spore Cloud',
               'text': 'A luminous cloud bursts! The hollow lurches and slams you elsewhere.'},
    'bog':    {'id': 'sinkwater', 'name': 'Sinkwater',
               'text': 'The floor is water, and it wants your pouch and your breath.'},
    'bone':   {'id': 'bone_chill', 'name': 'Bone Chill',
               'text': 'Grave-cold seizes your joints: −3 ATK and −2 DEF in your next battle.'},
    'garden': {'id': 'rot_bloom', 'name': 'Rot Bloom',
               'text': 'Bursting rot-pods flay your hide — but the compost pays well.'},
}

# First visit per player pays out; tracked in poiClaims as 'cache:<nodeId>'
# (~half a vault; renown flows automatically via per_poi).
CACHE_REWARD = {'spores': 40, 'xp': 10}

# Rest room: a hidden alcove that mends you fully, once per descent. Clears the
# lingering hazard debuffs (vines / bone_chill / cursed_idol) too.
REST_CURES = ('vines', 'bone_chill', 'grave_chill', 'cursed_idol')


def dungeon_biome(node_id):
    """Biome key for a depths node ('city_d0' -> 'city'), else None."""
    node = MAP_NODES.get(node_id)
    if not node or node.get('region') != 'depths':
        return None
    return node_id.split('_')[0]


def dungeon_entrance(biome):
    """The depths-side ladder MOUTH of a dungeon (`<biome>_lb`) — the respawn
    point for a death in that biome's dark. The post-boss escape ladder
    (`<biome>_esc`) is also a depths ladder, so match the mouth by name rather
    than by type."""
    mouth = biome + '_lb'
    return mouth if mouth in MAP_NODES else None

# Every entry in a player's poiClaims list ('bar_e', 'lair_titan', 'vault',
# ...) feeds renown via compute_renown below.


# ── Renown ───────────────────────────────────────────────────────────────────

# Renown is earned only by *fighting* and by *firsts* — never by passive
# progression. Levelling and hoarding Spores (both of which accrue from
# exploration, salvage, mystery rooms, timeouts, etc.) grant no Renown.
#   • beating enemies  → per_wild_win / per_pvp_win
#   • beating bosses   → boss_damage_per_point (the finale) + the lair first-kill
#                        that also books a per_poi claim
#   • doing a "first"  → per_poi, one claim per player for each barrier broken,
#                        lair first-kill, vault, trove, and treasure cache
RENOWN = {
    'per_pvp_win': 15,
    'per_wild_win': 3,  # legacy flat combat-win value; still the fallback (see below)
    'per_poi': 25,  # each barrier broken / lair first-kill / vault / trove / cache
    'boss_damage_per_point': 10,
}

# Per-kill leaderboard renown, scaled by enemy class and zone tier (design
# 2026-08-05). Harder kills pay a little more; T1 fodder pays a hair less than the
# old flat 3. Accumulated at kill-time into the player's `winRenown` field (the
# flat `wildWins` counter can't know tier/class after the fact); compute_renown
# reads winRenown, falling back to per_wild_win * wildWins for older docs. Kinds
# absent here (e.g. 'enraged') fall back to per_wild_win, so nothing regresses.
RENOWN_WIN = {
    'wild':  {1: 2, 2: 3, 3: 4},   # normal wild-space kill
    'elite': {1: 3, 2: 4, 3: 6},   # elite-space kill
    'lair':  8,                    # lair mini-boss (flat, any biome)
}


def win_renown(kind: str, tier: int = 1) -> int:
    """Leaderboard renown for one combat win of `kind` at zone `tier`."""
    w = RENOWN_WIN.get(kind, RENOWN['per_wild_win'])
    return w.get(tier, RENOWN['per_wild_win']) if isinstance(w, dict) else w


def compute_renown(player: dict) -> int:
    # PvP renown is gated to wins against equal-or-higher-level foes, tracked in
    # pvpRenownWins. Players from before the split fall back to their raw pvpWins
    # so their already-earned renown is grandfathered in.
    pvp_renown_wins = player.get('pvpRenownWins', player.get('pvpWins', 0))
    # Combat renown: tier/class-scaled winRenown accumulator, falling back to the
    # legacy flat per_wild_win * wildWins for docs from before the split.
    win_renown_total = player.get('winRenown',
                                  RENOWN['per_wild_win'] * player.get('wildWins', 0))
    return (RENOWN['per_pvp_win'] * pvp_renown_wins
            + win_renown_total
            + RENOWN['per_poi'] * len(player.get('poiClaims', []))
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
               'rx': 320, 'ry': 260, 'sq': 3.6, 'perk': 'darkvision',
               'perkName': 'Darkvision', 'perkBlurb': 'See 2 spaces away in dungeons.'},
    # Wide, low oblong — a sprawling moor.
    'bog': {'name': 'The Sedgemoor', 'center': (2700, 520),
            'rx': 440, 'ry': 190, 'sq': 2.0, 'perk': 'mirefoot',
            'perkName': 'Mirefoot', 'perkBlurb': 'Hazards cost you half, and rival spells more often miss you.'},
    # Angular diamond of overgrowth.
    'garden': {'name': 'The Rot-Gardens', 'center': (3000, 1650),
               'rx': 300, 'ry': 285, 'sq': 1.45, 'perk': 'composter',
               'perkName': 'Composter', 'perkBlurb': '+2 Spores from every loot space.'},
    # Sprawling rounded rectangle — a city block.
    'city': {'name': 'The Undercity', 'center': (1800, 2050),
             'rx': 410, 'ry': 235, 'sq': 4.4, 'perk': 'city_rat',
             'perkName': 'City Rat', 'perkBlurb': 'Hatch with a random Tier-1 item, equipped.'},
    # Tall, narrow pit.
    'bone': {'name': 'Ossuary Fields', 'center': (600, 1600),
             'rx': 255, 'ry': 300, 'sq': 2.2, 'perk': 'marrowborn',
             'perkName': 'Marrowborn', 'perkBlurb': '+8 Max HP.'},
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
# Wilderness nodes Umori can wander to (stable insertion order from map.json →
# deterministic picks). Recomputed from the map, so it tracks edits.
UMORI_NODES = [nid for nid, n in MAP_NODES.items() if n.get('region') == 'wilderness']

# The board splits into a fixed surface and regenerable dungeon pockets. The
# depths (region == 'depths') are procedurally regenerated per night when
# PROCEDURAL_DUNGEONS is on (see the procedural-dungeons design); everything else
# is the fixed committed board.
SURFACE_NODES = {nid: n for nid, n in MAP_NODES.items() if n.get('region') != 'depths'}
COMMITTED_DEPTHS = {nid: n for nid, n in MAP_NODES.items() if n.get('region') == 'depths'}


def merge_map(depths):
    """Full node graph = fixed surface + a night's depths (dict of node dicts).
    Pure; callers supply the depths (stored, generated, or COMMITTED_DEPTHS)."""
    return {**SURFACE_NODES, **depths}


def _tunnel_exit(nid):
    """The far-biome node a unit lands on when it crosses this tunnel: the
    non-tunnel neighbour of this node's paired tunnel node."""
    pair = next(x for x in MAP_NODES[nid]['neighbors']
                if MAP_NODES[x]['type'] == 'tunnel')
    return next(x for x in MAP_NODES[pair]['neighbors']
                if MAP_NODES[x]['type'] != 'tunnel')


TUNNEL_EXITS = {nid: _tunnel_exit(nid) for nid in TUNNEL_NODES}

# Guild Sigils: first-clear of a biome dungeon's lair grants that sigil.
SIGIL_LAIRS = {b + '_lair': b for b in BIOMES}
SIGILS_REQUIRED = 3

# Post-boss escape ladders: one dead-end 'ladder' spur off each sigil lair,
# revealed per-player once you hold that lair's claim (its node in poiClaims).
# Maps escape-node id -> its lair-node id. Two-step climb (2026-07-22): landing
# STOPS you on the spur; a later roll offers the surface mouth as a tap-to-climb
# destination that hauls you one-way up to <biome>_lt. There is no edge back down,
# so it can never be used to skip into the lair. See
# specs/2026-07-20-undercity-escape-ladder-design.md.
ESCAPE_LADDERS = {b + '_esc': b + '_lair' for b in BIOMES}

# Escape spur -> the biome's surface mouth it climbs out to (the one-way relocate
# target; no graph edge exists between them, so the climb bypasses walk rules).
ESCAPE_EXITS = {b + '_esc': b + '_lt' for b in BIOMES}

# Every ladder node on the board (descent pairs <biome>_lt / <biome>_lb plus the
# post-boss escape spurs <biome>_esc). Ladders are walk-stops: a mover halts ON a
# ladder and never corridors through, then crosses for free via the ladder-cross
# action. Static from the committed board; procedural depths preserve these ids.
LADDER_NODES = frozenset(n for n, nd in MAP_NODES.items() if nd['type'] == 'ladder')

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


# ── Companions ────────────────────────────────────────────────────────────
# Each pet is an instance whose `tier` is its rarity (1 Common .. 4 Mythic),
# mirroring gear. A pet's ROLE (not its species name) selects how it acts, so
# every role has two collectible species that share one ability. Art lives at
# public/undercity/pets/<role>/<species>.png (client mirror: data/pets.ts).
PET_ROLES = {
    'attack':  {'kind': 'combat-passive', 'blurb': 'Chance to strike a follow-up hit in battle.'},
    'defend':  {'kind': 'combat-passive', 'blurb': 'Chance to deflect a few points of damage.'},
    'forage':  {'kind': 'activated',      'blurb': 'Scavenges a small cache of loot; recharges as you move.'},
    'scout':   {'kind': 'activated',      'blurb': 'Delivers gear from your local bazaar without a visit.'},
    'economy': {'kind': 'economy',        'blurb': 'Scavenges Spores from loot spaces you pass — tap to collect.'},
}

# species id (== sprite filename) -> (display name, role). Two per role.
_PET_ROSTER = {
    'baby_leyline_prowler':     ('Leyline Prowler', 'attack'),
    'baby_moldering_karock':    ('Moldering Karock', 'attack'),
    'decimator_beetle':         ('Decimator Beetle', 'defend'),
    'small_bear':               ('Bear Cub', 'defend'),
    'baby_broodspinner':        ('Broodspinner', 'economy'),
    'slime':                    ('Slime', 'economy'),
    'baby_darkheart_sliver':    ('Darkheart Sliver', 'forage'),
    'rat':                      ('Rat', 'forage'),
    'baby_gloomshrieker':       ('Gloomshrieker', 'scout'),
    'baby_winding_constrictor': ('Winding Constrictor', 'scout'),
}

# Denormalize role -> kind/blurb onto each species so callers can keep reading
# PET_SPECIES[sid]['kind'] / ['blurb'] / ['role'] directly.
PET_SPECIES = {
    sid: {'name': name, 'role': role,
          'kind': PET_ROLES[role]['kind'], 'blurb': PET_ROLES[role]['blurb']}
    for sid, (name, role) in _PET_ROSTER.items()
}


def _pet_hatch_weight(role, tier):
    """Higher-tier eggs skew away from the economy role toward the rarer actives."""
    if role == 'economy':
        return {1: 1.0, 2: 0.6, 3: 0.4, 4: 0.3}[tier]
    if role in ('forage', 'scout'):
        return {1: 1.0, 2: 1.0, 3: 0.8, 4: 0.6}[tier]
    return 1.0


# Egg tier -> weighted species outcomes. An egg always hatches; the egg's tier
# also becomes the hatched pet's starting tier.
PET_HATCH = {
    tier: {sid: _pet_hatch_weight(spec['role'], tier) for sid, spec in PET_SPECIES.items()}
    for tier in (1, 2, 3, 4)
}

# Combat-pet magnitudes, keyed by ROLE (both attack species share one profile,
# both defend species another). Small and level-scaled.
PET_COMBAT = {
    'attack': {'chance_base': 0.10, 'chance_per_lvl': 0.07,
               'flat_base': 2, 'flat_per_lvl': 0.75},
    'defend': {'chance_base': 0.10, 'chance_per_lvl': 0.07,
               'flat_base': 2, 'flat_per_lvl': 0.75},
}


def pet_role(species):
    """Role of a companion species ('attack'|'defend'|'forage'|'scout'|'economy'),
    or None for an unknown species."""
    return PET_SPECIES.get(species, {}).get('role')

# Egg drops mirror GEAR_DROP: source -> (chance, {egg_tier: weight}).
# Eggs are rarer than gear; richer sources skew toward higher-tier eggs.
EGG_DROP = {
    # Monster Nests (the two RESPAWN_LAIRS) are the signature companion farm:
    # `ruin_lair` (guaranteed T3 on the guardian kill) and `ruin_scavenge`
    # (guaranteed lesser egg on EVERY scavenge of a downed nest). Caches trickle
    # eggs like other loot. loot/mystery/combat are unchanged; the old unused
    # 'lair' entry was removed (Sigil lairs stay eggless).
    'loot':          (0.06, {1: 0.7, 2: 0.3}),
    'mystery':       (0.08, {1: 0.5, 2: 0.4, 3: 0.1}),
    'combat':        (0.05, {1: 0.6, 2: 0.4}),
    'cache':         (0.10, {1: 0.4, 2: 0.4, 3: 0.2}),
    'ruin_lair':     (1.0,  {3: 1.0}),
    'ruin_scavenge': (1.0,  {1: 0.7, 2: 0.3}),
}

# Level cap per tier — merging raises tier, leveling fills to the cap.
PET_LEVEL_CAP = {1: 3, 2: 5, 3: 7, 4: 9}

# Merge: each fodder pet contributes points by ITS tier; a pet advances one tier
# when accumulated mergeProgress reaches PET_MERGE_COST[next_tier]. Remainder
# carries over. Same-species fodder only (enforced in the handler).
PET_MERGE_POINTS = {1: 1, 2: 3, 3: 7, 4: 15}
PET_MERGE_COST   = {2: 2, 3: 3, 4: 4}   # points to reach tier 2 / 3 / 4

# Per-level upgrade cost, by the pet's current tier.
PET_LEVEL_MOLTINGS = {1: 2, 2: 3, 3: 5, 4: 8}
PET_LEVEL_ICHOR    = {1: 0, 2: 0, 3: 1, 4: 1}

# Salvage yield: moltings = base[tier] + (level-1); ichor if tier >= threshold.
PET_SALVAGE_MOLTINGS       = {1: 1, 2: 2, 3: 4, 4: 6}
PET_SALVAGE_ICHOR_MIN_TIER = 3
