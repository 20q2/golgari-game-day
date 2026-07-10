"""
Static game data for The Undercity — creatures, items, NPCs, and the board map.

Pure constants + deterministic map construction. No AWS imports so the module
is unit-testable and reusable by generate_map_json.py (which dumps the client
copy of the board graph). All balance numbers come from the GDD tables; if you
tune anything here, regenerate public/data/undercity-map.json.
"""
import math

# ── Leveling ─────────────────────────────────────────────────────────────────

LEVEL_CAP = 12
HP_PER_LEVEL = 3
STAT_POINTS_PER_LEVEL = 2

XP_REWARDS = {
    'wild_win': 15,
    'wild_loss': 5,
    'pvp_win': 20,
    'pvp_loss': 8,
    'timeout': 5,          # consolation for both sides on a 6-round draw
    'shrine_tithe': 8,
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
    'spore': {
        'name': 'Spore', 'hp': 27, 'atk': 5, 'def': 5, 'spd': 6,
        'passive': 'drift',
        'blurb': 'Trickster fungus. Drift: +15% flee chance; bad mystery events reroll once.',
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
    'kraul_forager': {
        'name': 'Kraul Forager', 'line': 'kraul', 'bonus': {'def': 4},
        'passive': 'deathrite',
        'blurb': 'Raider. Deathrite: +50% Spores stolen on PvP wins.',
    },
    'slitherhead': {
        'name': 'Slitherhead', 'line': 'saproling', 'bonus': {'atk': 2, 'maxHp': 6},
        'passive': 'scavenge',
        'blurb': 'Counterpuncher. Scavenge: retaliate for 2 damage whenever struck.',
    },
    'woodwraith_strangler': {
        'name': 'Woodwraith Strangler', 'line': 'saproling', 'bonus': {'def': 2, 'maxHp': 6},
        'passive': 'rootwall',
        'blurb': 'Fortress. Rootwall: Regrowth improves to 35%.',
    },
    'shambling_shell': {
        'name': 'Shambling Shell', 'line': 'spore', 'bonus': {'maxHp': 6, 'def': 2},
        'passive': 'dredge',
        'blurb': 'Durable trickster. Dredge: reclaim your snare after it triggers.',
    },
    'corpsejack_menace': {
        'name': 'Corpsejack Menace', 'line': 'spore', 'bonus': {'atk': 4},
        'passive': 'doubling_rot',
        'blurb': 'Fungal tycoon. Doubling Rot: mystery-event Spore payouts doubled.',
    },
}

# Apex forms (level 10).
APEX = {
    'grave_titan': {
        'name': 'Grave Titan', 'bonus': {'maxHp': 6, 'def': 2},
        'passive': 'deathtouch_stomp',
        'from': ['brackish_trudge', 'kraul_forager', 'woodwraith_strangler', 'shambling_shell'],
        'blurb': 'Deathtouch Stomp: your strikes ignore 3 of the enemy’s DEF.',
    },
    'golgari_lich_lord': {
        'name': 'Golgari Lich Lord', 'bonus': {'atk': 2, 'maxHp': 6},
        'passive': 'drain_life',
        'from': ['kraul_forager', 'slitherhead', 'woodwraith_strangler', 'corpsejack_menace'],
        'blurb': 'Drain Life: heal for 50% of damage you deal.',
    },
    'swamp_dragon': {
        'name': 'Swamp Dragon', 'bonus': {'atk': 2, 'spd': 2},
        'passive': 'rot_breath',
        'from': ['brackish_trudge', 'stinkweed_imp', 'kraul_warrior'],
        'blurb': 'Rot Breath: round-1 strike hits for double.',
    },
    'izoni': {
        'name': 'Izoni, Thousand-Eyed', 'bonus': {'spd': 4},
        'passive': 'swarm',
        'from': ['stinkweed_imp', 'kraul_warrior', 'slitherhead', 'shambling_shell', 'corpsejack_menace'],
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
    'rusted_fang':  {'name': 'Rusted Fang',  'slot': 'fang',     'tier': 1, 'cost': 20, 'atk': 2},
    'kraul_barb':   {'name': 'Kraul Barb',   'slot': 'fang',     'tier': 2, 'cost': 45, 'atk': 4},
    'wurm_tooth':   {'name': 'Wurm Tooth',   'slot': 'fang',     'tier': 3, 'cost': 80, 'atk': 6, 'spd': 1},
    'chitin_scrap': {'name': 'Chitin Scrap', 'slot': 'carapace', 'tier': 1, 'cost': 20, 'def': 2},
    'bark_hide':    {'name': 'Bark Hide',    'slot': 'carapace', 'tier': 2, 'cost': 45, 'def': 4},
    'troll_hide':   {'name': 'Troll Hide',   'slot': 'carapace', 'tier': 3, 'cost': 80, 'def': 5, 'maxHp': 6},
}

CONSUMABLES = {
    'healing_moss': {'name': 'Healing Moss', 'cost': 12, 'blurb': 'Restore 50% max HP.'},
    'smoke_spore':  {'name': 'Smoke Spore',  'cost': 15, 'blurb': 'Held: your next failed flee auto-succeeds (consumed).'},
    'loaded_die':   {'name': 'Loaded Die',   'cost': 25, 'blurb': 'Choose your next roll’s value (1–6).'},
    'snare':        {'name': 'Snare',        'cost': 18, 'blurb': 'Trap your current space: next visitor spills 20% of their Spores and skips the space event.'},
}

BAG_SIZE = 3
GEAR_SELL_BACK = 0.5  # replacing gear auto-sells old piece for 50% of cost

# Trading post: the central-island exchange opens each night holding these 3
# house consumables (tagged "the Swarm"). Players swap one of their bag items
# for one of these; whatever they leave becomes the next visitor's stock,
# tagged with their name. Stock count stays fixed at 3 (swap in = swap out).
TRADING_POST_SEED = ['healing_moss', 'smoke_spore', 'loaded_die']
TRADING_POST_SIZE = len(TRADING_POST_SEED)

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


# ── Wild NPCs (stats scale off player level L) ───────────────────────────────

NPCS = [
    {'id': 'drudge_beetle', 'name': 'Drudge Beetle', 'min': 1, 'max': 4,
     'hp': (18, 2), 'atk': (4, 1), 'def': (2, 0.5), 'spd': 4, 'bounty': 6, 'itemChance': 0.0},
    {'id': 'sewer_shambler', 'name': 'Sewer Shambler', 'min': 2, 'max': 6,
     'hp': (24, 3), 'atk': (5, 1), 'def': (3, 0.5), 'spd': 3, 'bounty': 10, 'itemChance': 0.0},
    {'id': 'fetid_imp', 'name': 'Fetid Imp', 'min': 4, 'max': 9,
     'hp': (20, 2), 'atk': (6, 1), 'def': (3, 0.5), 'spd': 7, 'bounty': 14, 'itemChance': 0.15},
    {'id': 'rot_shambler', 'name': 'Rot Shambler', 'min': 7, 'max': 12,
     'hp': (30, 3), 'atk': (7, 1), 'def': (5, 0.5), 'spd': 4, 'bounty': 20, 'itemChance': 0.25},
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


# ── Roll economy ─────────────────────────────────────────────────────────────


ROLL_CAP = 6
JOIN_ROLLS = 3
SEAL_BONUS_CAP = 3
CLAIM_FINISHED_ROLLS = 2
CLAIM_WON_BONUS_ROLLS = 1
CLAIM_WON_SPORES = 10
CLAIM_FINISHED_COOLDOWN_MIN = 15
CLAIM_TAUGHT_ROLLS = 1
CLAIM_TAUGHT_MAX = 2
POKE_ROLL_LIMIT = 3          # first N pokes received per night grant +1 roll

HP_REGEN_PCT = 0.10          # of max HP
HP_REGEN_INTERVAL_MIN = 10
COMPOST_SHIELD_MIN = 15
COMPOST_RESPAWN_PCT = 0.5
PVP_SPORE_STEAL = 0.25
PVP_SPORE_STEAL_DEFEND = 0.10
DEATHRITE_STEAL_MULT = 1.5

SHRINE_BLESSING_COST = 15
SHRINE_TITHE_HP_PCT = 0.25
OSSUARY_MAX_BET = 20
OSSUARY_ROLLS_PER_VISIT = 3  # gambles allowed per landing; refills when you land again
SNARE_SPILL_PCT = 0.20


# ── Barriers & points of interest (v3: goals on the map) ────────────────────

# Fixed guardians blocking the gated routes. Unscaled: they're meant to be a
# wall until the party grows into them. Beating one opens the barrier for the
# WHOLE season (shared) and pays the winner alone.
BARRIER_GUARDIANS = {
    'bar_e': {'id': 'rubble_hulk', 'name': 'Golgari Grave-Troll',
              'hp': 46, 'atk': 9, 'def': 7, 'spd': 3, 'bounty': 30, 'xp': 25},
    'bar_s': {'id': 'bone_warden', 'name': 'Josu Vess, Lich Knight',
              'hp': 52, 'atk': 10, 'def': 6, 'spd': 5, 'bounty': 35, 'xp': 25},
}

# Mini-bosses at the lairs. First kill per player pays `first`; repeats pay
# `repeat`. Both are much stronger than any wild NPC. The five biome-dungeon
# lairs grant Guild Sigils on first clear; lair_titan is side content.
_LAIR_REWARD = {'first': {'spores': 60, 'xp': 35}, 'repeat': {'spores': 15, 'xp': 12}}
LAIR_BOSSES = {
    'lair_titan': {'id': 'gravebound_colossus', 'name': 'Lord of Extinction',
                   'hp': 70, 'atk': 12, 'def': 8, 'spd': 4, **_LAIR_REWARD},
    'city_lair': {'id': 'broodmother', 'name': 'Ishkanah, Grafwidow',
                  'hp': 60, 'atk': 13, 'def': 5, 'spd': 8, **_LAIR_REWARD},
    'cavern_lair': {'id': 'gloomglow_tyrant', 'name': 'Ghave, Guru of Spores',
                    'hp': 64, 'atk': 12, 'def': 6, 'spd': 7, **_LAIR_REWARD},
    'bog_lair': {'id': 'moor_wyrm', 'name': 'The Gitrog Monster',
                 'hp': 72, 'atk': 11, 'def': 7, 'spd': 5, **_LAIR_REWARD},
    'bone_lair': {'id': 'marrow_king', 'name': 'Death Baron',
                  'hp': 58, 'atk': 14, 'def': 6, 'spd': 6, **_LAIR_REWARD},
    'garden_lair': {'id': 'rot_shepherd', 'name': 'Slimefoot, the Stowaway',
                    'hp': 68, 'atk': 12, 'def': 7, 'spd': 4, **_LAIR_REWARD},
}

# The treasure vault: first visit per player pays out, later visits are set
# dressing.
VAULT_REWARD = {'spores': 80, 'xp': 20}

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

# One themed wild per dungeon — same (base, per-level) tuple shape as NPCS,
# ~15% meaner than the surface wild of the same band, +25% bounty. All bands
# span every level so the dungeon always spawns its own fauna.
DUNGEON_NPCS = {
    'city':   {'id': 'broodling',  'name': 'Hatchery Spider',   'min': 1, 'max': 12,
               'hp': (24, 2.5), 'atk': (6, 1), 'def': (3, 0.5), 'spd': 6,
               'bounty': 15, 'itemChance': 0.10},
    'cavern': {'id': 'glowmite',   'name': 'Vigorspore Wurm',    'min': 1, 'max': 12,
               'hp': (20, 2.5), 'atk': (7, 1), 'def': (2, 0.5), 'spd': 8,
               'bounty': 15, 'itemChance': 0.10},
    'bog':    {'id': 'mire_leech', 'name': 'Festering Newt',  'min': 1, 'max': 12,
               'hp': (28, 3), 'atk': (5, 1), 'def': (4, 0.5), 'spd': 4,
               'bounty': 15, 'itemChance': 0.10},
    'bone':   {'id': 'gravewight', 'name': 'Wight of Precinct Six',  'min': 1, 'max': 12,
               'hp': (26, 2.5), 'atk': (6, 1), 'def': (5, 0.5), 'spd': 3,
               'bounty': 16, 'itemChance': 0.10},
    'garden': {'id': 'rot_grub',   'name': 'Thallid',    'min': 1, 'max': 12,
               'hp': (30, 3), 'atk': (5, 1), 'def': (3, 0.5), 'spd': 5,
               'bounty': 15, 'itemChance': 0.15},
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


def dungeon_biome(node_id):
    """Biome key for a depths node ('city_d0' -> 'city'), else None."""
    node = MAP_NODES.get(node_id)
    if not node or node.get('region') != 'depths':
        return None
    return node_id.split('_')[0]

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

# TODO: dev/testing switch — rolling never checks or spends banked rolls while
# True. Flip back to False (and redeploy) before game night.
UNLIMITED_ROLLS = True

WORLD_W, WORLD_H = 3600, 2400
ISLAND_XY = (1800, 1150)
BOSS_NODE = 'boss'

# Home biomes: display name, ring geometry, and the hatch perk.
BIOMES = {
    'cavern': {'name': 'Mosslight Cavern', 'center': (900, 520),
               'rx': 360, 'ry': 225, 'perk': 'glowblessed',
               'perkName': 'Glowblessed', 'perkBlurb': '+10% flee chance.'},
    'bog': {'name': 'The Sedgemoor', 'center': (2700, 520),
            'rx': 370, 'ry': 215, 'perk': 'mirefoot',
            'perkName': 'Mirefoot', 'perkBlurb': 'Hazards cost you half.'},
    'garden': {'name': 'The Rot-Gardens', 'center': (3000, 1650),
               'rx': 330, 'ry': 240, 'perk': 'composter',
               'perkName': 'Composter', 'perkBlurb': '+2 Spores from every loot space.'},
    'city': {'name': 'The Undercity', 'center': (1800, 2050),
             'rx': 420, 'ry': 230, 'perk': 'city_rat',
             'perkName': 'City Rat', 'perkBlurb': '+15 starting Spores.'},
    'bone': {'name': 'Ossuary Fields', 'center': (600, 1650),
             'rx': 340, 'ry': 235, 'perk': 'marrowborn',
             'perkName': 'Marrowborn', 'perkBlurb': '+2 DEF against wild creatures.'},
}
DEFAULT_BIOME = 'city'

# Ring slot types, index 0 = the space facing the island. Slot 3 is the shop,
# slot 5 (outward side) anchors the ladder down to the biome's dungeon, slot
# 9 is the shrine (the Ossuary Fields gamble den replaces theirs).
_RING_TYPES = ['gate', 'loot', 'wild', 'shop', 'mystery',
               'hazard', 'loot', 'warp', 'wild', 'shrine']
_INNER_TYPES = ['mystery', 'wild']
# v6 pocket layouts: {suffix: (type, dx, dy)} + explicit edge list. All planar.
_POCKET_LAYOUTS = {
    # The Broodwarrens — figure-8 warren, hazard at the waist.
    'city': {
        'nodes': {
            '_lb':    ('ladder', 0, -160),
            '_d0':    ('wild',   150, -60),
            '_d1':    ('hazard', 0, 20),      # the waist, degree 4
            '_d3':    ('wild',  -150, -60),
            '_lair':  ('lair',   150, 130),
            '_cache': ('cache',  0, 210),
            '_d2':    ('loot',  -150, 130),
        },
        'edges': [('_lb', '_d0'), ('_d0', '_d1'), ('_d1', '_d3'), ('_d3', '_lb'),
                  ('_d1', '_lair'), ('_lair', '_cache'), ('_cache', '_d2'),
                  ('_d2', '_d1')],
    },
    # Gloomroot Hollow — a spiral that loops back on itself.
    'cavern': {
        'nodes': {
            '_lb':    ('ladder', -200, -140),
            '_d0':    ('wild',    120, -150),
            '_d1':    ('hazard',  190, 60),
            '_d2':    ('loot',    -40, 170),
            '_lair':  ('lair',   -150, 40),
            '_cache': ('cache',   -20, -40),   # innermost coil
        },
        'edges': [('_lb', '_d0'), ('_d0', '_d1'), ('_d1', '_d2'),
                  ('_d2', '_lair'), ('_lair', '_cache'), ('_cache', '_lb')],
    },
    # The Drownedway — flooded ring with the lair on a center island chord.
    'bog': {
        'nodes': {
            '_lb':    ('ladder',  0, -180),
            '_d0':    ('wild',    180, -80),
            '_d1':    ('hazard',  200, 100),
            '_d2':    ('loot',    0, 190),
            '_d3':    ('wild',   -200, 100),
            '_cache': ('cache',  -180, -80),
            '_lair':  ('lair',    0, 0),       # the island
        },
        'edges': [('_lb', '_d0'), ('_d0', '_d1'), ('_d1', '_d2'), ('_d2', '_d3'),
                  ('_d3', '_cache'), ('_cache', '_lb'),
                  ('_d0', '_lair'), ('_lair', '_d3')],
    },
    # The Marrow Pits — 2x3 crypt grid: outer ring plus one center rung.
    'bone': {
        'nodes': {
            '_lb':    ('ladder', -170, -70),
            '_d0':    ('wild',    0, -70),
            '_d1':    ('hazard',  170, -70),
            '_lair':  ('lair',    170, 110),
            '_cache': ('cache',   0, 110),
            '_d2':    ('loot',   -170, 110),
        },
        'edges': [('_lb', '_d0'), ('_d0', '_d1'), ('_d1', '_lair'),
                  ('_lair', '_cache'), ('_cache', '_d2'), ('_d2', '_lb'),
                  ('_d0', '_cache')],
    },
    # The Rotcellar — main root loop with a deeper side loop off the junction.
    'garden': {
        'nodes': {
            '_lb':    ('ladder', 0, -170),
            '_d0':    ('wild',   160, -70),
            '_d2':    ('hazard', 0, 30),      # the junction, degree 4
            '_d1':    ('loot',  -160, -70),
            '_lair':  ('lair',   150, 140),
            '_cache': ('cache',  0, 220),
            '_d3':    ('wild',  -150, 140),
        },
        'edges': [('_lb', '_d0'), ('_d0', '_d2'), ('_d2', '_d1'), ('_d1', '_lb'),
                  ('_d2', '_lair'), ('_lair', '_cache'), ('_cache', '_d3'),
                  ('_d3', '_d2')],
    },
}

HOME_GATES = {b: b + '_r0' for b in BIOMES}
GATE_NODE = HOME_GATES[DEFAULT_BIOME]  # legacy alias; respawns use homeBiome


def _build_map():
    nodes = {}
    edges = []

    def add(nid, ntype, x, y, region):
        nodes[nid] = {'id': nid, 'type': ntype, 'x': round(x),
                      'y': round(y), 'region': region, 'neighbors': []}

    def link(u, v):
        edges.append((u, v))

    def loop_link(ids):
        for i in range(len(ids)):
            link(ids[i], ids[(i + 1) % len(ids)])

    def nearest_ring_node(biome, px, py):
        best, bd = None, 1e18
        for i in range(10):
            n = nodes[biome + '_r' + str(i)]
            d = (n['x'] - px) ** 2 + (n['y'] - py) ** 2
            if d < bd:
                best, bd = n['id'], d
        return best

    ix, iy = ISLAND_XY
    for b, spec in BIOMES.items():
        cx, cy = spec['center']
        # Slot 0 faces the island so every gate looks toward the finale.
        base = math.atan2(iy - cy, ix - cx)
        ring = [b + '_r' + str(i) for i in range(10)]
        for i, nid in enumerate(ring):
            ang = base + i * (2 * math.pi / 10)
            ntype = _RING_TYPES[i]
            if b == 'bone':
                # Ossuary Fields is the dig-site biome: its two loot slots and
                # one mystery slot become excavation sites; the shrine is still
                # the gamble den.
                if i in (1, 4, 6):
                    ntype = 'excavation'
                elif ntype == 'shrine':
                    ntype = 'ossuary'
            add(nid, ntype, cx + spec['rx'] * math.cos(ang),
                cy + spec['ry'] * math.sin(ang), b)
        loop_link(ring)

        # Inner chord: r2 -> i0 -> i1 -> r8, cutting across the hollow.
        r2, r8 = nodes[b + '_r2'], nodes[b + '_r8']
        for j in range(2):
            t = (j + 1) / 3
            add(b + '_i' + str(j), _INNER_TYPES[j],
                r2['x'] + (r8['x'] - r2['x']) * t,
                r2['y'] + (r8['y'] - r2['y']) * t, b)
        link(b + '_r2', b + '_i0')
        link(b + '_i0', b + '_i1')
        link(b + '_i1', b + '_r8')

        # Dungeon pocket outward from the island, past the ring's r5 slot.
        ux, uy = cx - ix, cy - iy
        ulen = math.hypot(ux, uy) or 1
        ux, uy = ux / ulen, uy / ulen
        dxc = max(340, min(WORLD_W - 340, cx + ux * (spec['rx'] + 330)))
        dyc = max(300, min(WORLD_H - 300, cy + uy * (spec['ry'] + 300)))
        r5 = nodes[b + '_r5']
        lt, lb = b + '_lt', b + '_lb'
        add(lt, 'ladder', r5['x'] + ux * 150,
            max(160, min(WORLD_H - 160, r5['y'] + uy * 130)), b)
        # v6: each biome's pocket is a hand-laid, planar, unique shape.
        # Coordinates are local offsets from the pocket center (dxc, dyc);
        # orientation doesn't matter — pockets render in their own sub-view.
        # Contract: door = <b>_lb (only link to the surface), <b>_lair and
        # <b>_cache exist, every node keeps in-pocket degree >= 2.
        P = _POCKET_LAYOUTS[b]
        for suffix, (ntype, ox, oy) in P['nodes'].items():
            add(b + suffix, ntype, dxc + ox, dyc + oy, 'depths')
        for s1, s2 in P['edges']:
            link(b + s1, b + s2)
        link(b + '_r5', lt)
        link(lt, lb)

    # Tunnels between neighboring rings around the pentagon.
    ring_order = ['cavern', 'bog', 'garden', 'city', 'bone']
    tunnel_types = ['loot', 'hazard', 'wild', 'mystery', 'loot',
                    'wild', 'mystery', 'hazard', 'wild', 'loot']
    for k in range(5):
        a, c = ring_order[k], ring_order[(k + 1) % 5]
        ax, ay = BIOMES[a]['center']
        cx2, cy2 = BIOMES[c]['center']
        ids = []
        for j in range(2):
            t = (j + 1) / 3
            nid = 't_' + a + '_' + c + str(j)
            add(nid, tunnel_types[k * 2 + j],
                ax + (cx2 - ax) * t, ay + (cy2 - ay) * t,
                a if j == 0 else c)
            ids.append(nid)
        link(nearest_ring_node(a, nodes[ids[0]]['x'], nodes[ids[0]]['y']), ids[0])
        link(ids[0], ids[1])
        link(ids[1], nearest_ring_node(c, nodes[ids[1]]['x'], nodes[ids[1]]['y']))

    # The floating island: warp in, the trading post, ossuary, and the sealed
    # boss lair. The trading post sits between the warp and ossuary so every
    # player who warps to the isle passes the shared exchange.
    add('isl_warp', 'warp', ix - 115, iy + 55, 'isle')
    add('isl_trade', 'trading_post', ix - 55, iy + 8, 'isle')
    add('isl_ossuary', 'ossuary', ix, iy - 45, 'isle')
    add('boss', 'boss', ix + 120, iy + 30, 'isle')
    link('isl_warp', 'isl_trade')
    link('isl_trade', 'isl_ossuary')
    link('isl_ossuary', 'boss')

    # Titan's Rest — barrier-gated pocket east, between bog and garden.
    add('e0', 'wild', 3060, 900, 'bog')
    add('bar_e', 'barrier', 3180, 1020, 'ruin')
    add('e1', 'hazard', 3330, 940, 'ruin')
    add('e2', 'loot', 3420, 1100, 'ruin')
    add('lair_titan', 'lair', 3310, 1230, 'ruin')
    add('e3', 'wild', 3160, 1180, 'ruin')
    loop_link(['bar_e', 'e1', 'e2', 'lair_titan', 'e3'])
    link(nearest_ring_node('bog', 3060, 900), 'e0')
    link('e0', 'bar_e')

    # The Sunken Vaults — barrier-gated pocket in the city <-> bone gap.
    add('s0', 'mystery', 1120, 2180, 'city')
    add('bar_s', 'barrier', 950, 2260, 'ruin')
    add('s1', 'wild', 760, 2200, 'ruin')
    add('s2', 'hazard', 580, 2280, 'ruin')
    add('vault', 'vault', 420, 2170, 'ruin')
    add('s3', 'loot', 600, 2090, 'ruin')
    loop_link(['bar_s', 's1', 's3', 'vault', 's2'])
    link(nearest_ring_node('city', 1120, 2180), 's0')
    link('s0', 'bar_s')

    for u, v in edges:
        if v not in nodes[u]['neighbors']:
            nodes[u]['neighbors'].append(v)
            nodes[v]['neighbors'].append(u)

    return nodes


MAP_NODES = _build_map()
WARP_NODES = [nid for nid, n in MAP_NODES.items() if n['type'] == 'warp']

# Guild Sigils: first-clear of a biome dungeon's lair grants that sigil.
SIGIL_LAIRS = {b + '_lair': b for b in BIOMES}
SIGILS_REQUIRED = 3

# The island boss: one persistent HP pool per season. Anyone with enough
# sigils can chip at it; whoever lands the killing blow takes the kill, then
# the Sovereign reforms at full strength for the next challenger.
ROT_SOVEREIGN = {
    'id': 'rot_sovereign', 'name': 'Savra, Queen of the Golgari',
    'hp': 240, 'atk': 14, 'def': 9, 'spd': 6,
    'first': {'spores': 120, 'xp': 60},
    'repeat': {'spores': 40, 'xp': 20},
}
