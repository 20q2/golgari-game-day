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
SNARE_SPILL_PCT = 0.20


# ── Renown ───────────────────────────────────────────────────────────────────

RENOWN = {
    'per_level': 10,
    'per_pvp_win': 15,
    'per_wild_win': 3,
    'spores_per_point': 5,
    'boss_damage_per_point': 10,
}


def compute_renown(player: dict) -> int:
    return (RENOWN['per_level'] * player.get('level', 1)
            + RENOWN['per_pvp_win'] * player.get('pvpWins', 0)
            + RENOWN['per_wild_win'] * player.get('wildWins', 0)
            + player.get('spores', 0) // RENOWN['spores_per_point']
            + player.get('bossDamage', 0) // RENOWN['boss_damage_per_point'])


# ── The board map ────────────────────────────────────────────────────────────
#
# Topology (GDD §6): outer loop of 26 nodes (n0..n25, n0 = Gate of the Swarm),
# tunnel A of 6 nodes (a0..a5) joining n4↔n17, tunnel B of 5 nodes (b0..b4)
# joining n11↔n24, and a central island: warp → ossuary → boss lair. The boss
# lair is sealed until the boss phase (demo: always sealed; landing bounces).

GATE_NODE = 'n0'
BOSS_NODE = 'boss'

_LOOP_TYPES = {
    'n0': 'gate',
    'n1': 'mystery', 'n2': 'wild', 'n3': 'hazard', 'n4': 'loot',
    'n5': 'shop', 'n6': 'wild', 'n7': 'warp', 'n8': 'mystery',
    'n9': 'wild', 'n10': 'shrine', 'n11': 'loot', 'n12': 'hazard',
    'n13': 'loot', 'n14': 'shop', 'n15': 'wild', 'n16': 'mystery',
    'n17': 'loot', 'n18': 'hazard', 'n19': 'loot', 'n20': 'warp',
    'n21': 'wild', 'n22': 'mystery', 'n23': 'shrine', 'n24': 'loot',
    'n25': 'wild',
    'a0': 'loot', 'a1': 'wild', 'a2': 'shop', 'a3': 'mystery',
    'a4': 'hazard', 'a5': 'mystery',
    'b0': 'hazard', 'b1': 'loot', 'b2': 'shrine', 'b3': 'wild', 'b4': 'mystery',
    'isl_warp': 'warp', 'isl_ossuary': 'ossuary', 'boss': 'boss',
}

# Shops stock gear tiers up to their depth.
SHOP_TIERS = {'n5': 1, 'n14': 2, 'a2': 3}


def _build_map():
    """
    Three linked caverns: The Undercity (large south loop, gate + tier-1
    shop), Mosslight Cavern (northwest loop, tier-2 shop), and The Sedgemoor
    bog (northeast loop, tier-3 shop), joined by two-node tunnels, with the
    warp-only boss island floating in the central hollow. Every walkable node
    stays on a cycle (degree >= 2) so exact-count movement can't strand; the
    island keeps its original linear chain. Each node carries a `region` tag
    (city | cavern | bog | isle) that the client terrain renderer themes by.
    """
    city_loop = ['n0', 'n1', 'n2', 'n3', 'n4', 'n5',
                 'n6', 'n7', 'n8', 'n9', 'n24', 'n25']
    cavern_loop = ['n10', 'n11', 'n12', 'n13', 'n14',
                   'n15', 'n16', 'n17', 'a5', 'b4']
    bog_loop = ['n23', 'a2', 'n22', 'n21', 'n20', 'n19', 'n18', 'b0', 'a1']

    nodes = {}

    def add(nid, x, y, region):
        nodes[nid] = {'id': nid, 'type': _LOOP_TYPES[nid], 'x': round(x),
                      'y': round(y), 'region': region, 'neighbors': []}

    def ring(ids, cx, cy, rx, ry, region):
        # First id sits at the bottom of the ellipse; successive ids walk the
        # loop counterclockwise (east first in canvas coordinates).
        step = 2 * math.pi / len(ids)
        for i, nid in enumerate(ids):
            ang = math.pi / 2 - i * step
            add(nid, cx + rx * math.cos(ang), cy + ry * math.sin(ang), region)

    ring(city_loop, 900, 880, 560, 190, 'city')
    ring(cavern_loop, 420, 320, 300, 180, 'cavern')
    ring(bog_loop, 1370, 310, 250, 175, 'bog')

    # Tunnels — each node leans toward the chamber its end touches.
    add('a0', 330, 700, 'city')     # Undercity n8 -> Mosslight n10
    add('a4', 350, 595, 'cavern')
    add('b1', 1455, 680, 'city')    # Undercity n4 -> Sedgemoor n23
    add('b2', 1445, 575, 'bog')
    add('b3', 670, 130, 'cavern')   # Mosslight n15 -> Sedgemoor n18, over the hollow
    add('a3', 920, 125, 'bog')

    # Boss island in the dark hollow between the three chambers.
    add('isl_warp', 830, 500, 'isle')
    add('isl_ossuary', 905, 430, 'isle')
    add('boss', 985, 480, 'isle')

    edges = []
    for loop in (city_loop, cavern_loop, bog_loop):
        edges.extend((loop[i], loop[(i + 1) % len(loop)]) for i in range(len(loop)))
    edges += [
        ('n8', 'a0'), ('a0', 'a4'), ('a4', 'n10'),
        ('n4', 'b1'), ('b1', 'b2'), ('b2', 'n23'),
        ('n15', 'b3'), ('b3', 'a3'), ('a3', 'n18'),
        ('isl_warp', 'isl_ossuary'), ('isl_ossuary', 'boss'),
    ]

    for u, v in edges:
        nodes[u]['neighbors'].append(v)
        nodes[v]['neighbors'].append(u)

    return nodes


MAP_NODES = _build_map()
WARP_NODES = [nid for nid, n in MAP_NODES.items() if n['type'] == 'warp']

# The bridge that opens during the boss phase (deferred in demo, defined so the
# data model doesn't change later).
BOSS_BRIDGE = ('n13', 'boss')
