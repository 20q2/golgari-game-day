"""Unit tests for the pure Undercity rules engine (GDD §5–§8)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import undercity_data as data
import undercity_db as db
from undercity_engine import (
    Combatant, resolve_battle, legal_destinations, validate_walk, board_distance,
    roll_mystery, apply_level_ups, spend_stat, effective_stats, regen_hp,
    regen_rolls, pick_npc, pvp_spore_steal,
)


class FakeRng:
    """Deterministic rng: uniform() returns 1.0, random()/randint() replay scripts."""

    def __init__(self, randoms=None, randints=None, uniform=1.0):
        self.randoms = list(randoms or [])
        self.randints = list(randints or [])
        self._uniform = uniform

    def uniform(self, a, b):
        return self._uniform

    def random(self):
        return self.randoms.pop(0) if self.randoms else 0.99

    def randint(self, a, b):
        return self.randints.pop(0) if self.randints else a

    def choice(self, seq):
        return seq[0]


# Tier whose RIDER_SCALE magnitude these engine tests were written against (the
# pre-rarity live value). Fixed per rider so the tests stay independent of which
# gear rungs exist in the roster.
_TEST_RIDER_TIER = {
    'barbed': 1, 'bloodfang': 1, 'deep_biter': 2, 'rabid': 2, 'gutcleaver': 2,
    'thick': 1, 'spiked': 2, 'bramble': 1, 'bulwark': 2, 'mossback': 2,
    'trickster': 1, 'serrated': 2, 'venomtrick': 1, 'cutpurse': 2,
}


def _default_rider_mag(riders):
    """Reproduce each rider's live magnitude (RIDER_SCALE at its canonical test
    tier) so rider tests read the same values as before rarity scaling. Rider
    effects now come from Combatant.rider_mag, not flat constants."""
    return {r: data.RIDER_SCALE[r][_TEST_RIDER_TIER[r]]
            for r in riders if r in _TEST_RIDER_TIER}


def fighter(**kw):
    base = dict(name='X', hp=30, max_hp=30, atk=6, dfn=5, spd=5,
                passives=frozenset(), stance='fight', level=1)
    base.update(kw)
    if base.get('riders') and 'rider_mag' not in kw:
        base['rider_mag'] = _default_rider_mag(base['riders'])
    return Combatant(**base)


# ── Leveling ─────────────────────────────────────────────────────────────────

def test_xp_curve():
    assert data.xp_to_next(1) == 25
    assert data.xp_to_next(9) == 65


def test_level_up_grants():
    p = {'level': 1, 'xp': 25, 'maxHp': 30, 'hp': 10, 'statPoints': 0,
         'spentThisLevel': {'atk': 1, 'def': 0, 'spd': 0}}
    leveled = apply_level_ups(p)
    assert leveled == 1
    assert p['level'] == 2 and p['xp'] == 0
    assert p['maxHp'] == 33 and p['hp'] == 13
    assert p['statPoints'] == 2
    assert p['spentThisLevel'] == {'atk': 0, 'def': 0, 'spd': 0}


def test_level_cap():
    p = {'level': 12, 'xp': 999, 'maxHp': 63, 'hp': 63, 'statPoints': 0,
         'spentThisLevel': {}}
    assert apply_level_ups(p) == 0
    assert p['level'] == 12


def test_spend_stat_stacks_freely_until_out_of_points():
    p = {'statPoints': 2, 'atk': 6, 'def': 5, 'spd': 5,
         'spentThisLevel': {'atk': 0, 'def': 0, 'spd': 0}}
    assert spend_stat(p, 'atk')
    assert p['atk'] == 7 and p['statPoints'] == 1
    assert spend_stat(p, 'atk')              # second point into same stat now allowed
    assert p['atk'] == 8 and p['statPoints'] == 0
    assert not spend_stat(p, 'def')          # no points left


# ── Movement ─────────────────────────────────────────────────────────────────

def test_exact_count_no_backtrack_on_loop():
    # From city_r0, two steps forward each way round the ring — plus wild_cit1,
    # the Wilderness spoke hanging off city_r9 (a gate-adjacent node) since the
    # tunnels+wilderness pass. See specs/2026-07-20-undercity-tunnels-wilderness-design.md.
    dests = legal_destinations(data.MAP_NODES, 'city_r0', 2)
    assert dests == {'city_r2', 'city_r8', 'wild_cit1'}


def test_fork_gives_multiple_choices():
    # city_r5 is the outward junction where the dungeon ladder (city_lt) leaves.
    dests = legal_destinations(data.MAP_NODES, 'city_r5', 1)
    assert dests == {'city_r4', 'city_r6', 'city_lt'}


def test_boss_approach_loop_lands_on_multiple_rolls():
    # Island chain: warp -> trade -> ossuary -> boss (3 steps to the boss).
    # The boss now sits inside a guardian ring (isl_bg1/isl_bg2 flank it), so
    # both a 3-roll and a 4-roll can land on the boss instead of only an exact
    # count — the whole point of the approach loops. The causeway branch off
    # isl_warp (cw5...) still contributes cw3 at 3 and cw2 at 4. See
    # specs/2026-07-20-undercity-boss-approach-loops-design.md.
    assert legal_destinations(data.MAP_NODES, 'isl_warp', 3) == {'boss', 'isl_bg1', 'isl_bg2', 'cw3'}
    assert legal_destinations(data.MAP_NODES, 'isl_warp', 4) == {'boss', 'isl_bg1', 'isl_bg2', 'cw2'}


def test_can_circle_back_to_start_on_a_loop():
    # A ring of six nodes: rolling exactly 6 walks all the way around and lands
    # back on the space you started from. The no-backtrack rule still forbids a
    # trivial there-and-back, but a genuine loop is a legal exact-count landing.
    ring = {
        'a': {'neighbors': ['b', 'f']},
        'b': {'neighbors': ['a', 'c']},
        'c': {'neighbors': ['b', 'd']},
        'd': {'neighbors': ['c', 'e']},
        'e': {'neighbors': ['d', 'f']},
        'f': {'neighbors': ['e', 'a']},
    }
    assert 'a' in legal_destinations(ring, 'a', 6)      # all the way round → home
    assert legal_destinations(ring, 'a', 3) == {'d'}    # half way is the far node
    assert 'a' not in legal_destinations(ring, 'a', 2)  # no trivial reversal


# ── Walk validation (server-authoritative route check) ───────────────────────

def test_validate_walk_legal_pass_through():
    # city_r1 -> city_r0 (gate) -> city_r9 is a legal 2-hop walk.
    assert validate_walk(data.MAP_NODES, ['city_r1', 'city_r0', 'city_r9'], {2})


def test_validate_walk_rejects_non_adjacent():
    # city_r1's neighbors are city_r0/city_r2 — city_r9 is not adjacent.
    assert not validate_walk(data.MAP_NODES, ['city_r1', 'city_r9'], {1})


def test_validate_walk_rejects_immediate_backtrack():
    assert not validate_walk(data.MAP_NODES, ['city_r1', 'city_r0', 'city_r1'], {2})


def test_validate_walk_rejects_wrong_length():
    assert not validate_walk(data.MAP_NODES, ['city_r1', 'city_r0', 'city_r9'], {3})


def test_validate_walk_rejects_unknown_node():
    assert not validate_walk(data.MAP_NODES, ['city_r1', 'nope'], {1})


def test_validate_walk_bonk_stops_short_at_closed_landing():
    # A synthetic line a-b-c-d where c is sealed: you may bonk and stop at c
    # short of a roll of 3, but never walk THROUGH c to d.
    nodes = {
        'a': {'neighbors': ['b'], 'type': 'loot'},
        'b': {'neighbors': ['a', 'c'], 'type': 'loot'},
        'c': {'neighbors': ['b', 'd'], 'type': 'barrier'},
        'd': {'neighbors': ['c'], 'type': 'loot'},
    }
    closed = frozenset({'c'})
    assert validate_walk(nodes, ['a', 'b', 'c'], {3}, closed)          # bonk stop, hops < roll
    assert not validate_walk(nodes, ['a', 'b', 'c', 'd'], {3}, closed)  # through a seal


def test_validate_walk_rejects_stepping_onto_blocked():
    nodes = {
        'a': {'neighbors': ['b'], 'type': 'loot'},
        'b': {'neighbors': ['a', 'c'], 'type': 'tunnel'},
        'c': {'neighbors': ['b'], 'type': 'loot'},
    }
    assert not validate_walk(nodes, ['a', 'b', 'c'], {2}, frozenset(), frozenset({'b'}))


# ── Barriers (v3) ────────────────────────────────────────────────────────────

def test_closed_barrier_is_a_valid_final_stop():
    # s0 -> bar_s in one step: you can land on the guardian to challenge it.
    dests = legal_destinations(data.MAP_NODES, 's0', 1, closed=frozenset({'bar_s'}))
    assert 'bar_s' in dests


def test_closed_barrier_blocks_passage_through():
    # Two steps from s0 would pass THROUGH bar_s into the vault loop — sealed.
    dests = legal_destinations(data.MAP_NODES, 's0', 2, closed=frozenset({'bar_s'}))
    assert dests & {'s1', 's2', 's3', 'vault'} == set()
    # Once open, the same roll walks through.
    dests_open = legal_destinations(data.MAP_NODES, 's0', 2)
    assert 's1' in dests_open


def test_walk_toward_barrier_stops_at_the_wall():
    # Bonk rule: an over-long roll toward a sealed barrier stops AT it instead
    # of overshooting, so the barrier is reachable without an exact count.
    for roll in (1, 2, 3, 4, 5, 6):
        dests = legal_destinations(data.MAP_NODES, 's0', roll, closed=frozenset({'bar_s'}))
        assert 'bar_s' in dests, f'roll {roll} should still reach the wall'
        # never leaks into the sealed pocket
        assert dests & {'s1', 's2', 's3', 'vault'} == set()


def test_ladder_pair_connects_dungeon():
    # The ladder is a normal graph edge: ring side down into the dungeon pocket.
    dests = legal_destinations(data.MAP_NODES, 'city_r5', 2)
    assert 'city_lb' in dests


# ── Guild Sigils & the island boss (v4) ──────────────────────────────────────

def test_five_biome_dungeon_lairs_grant_sigils():
    from undercity_data import SIGIL_LAIRS, BIOMES, SIGILS_REQUIRED
    assert set(SIGIL_LAIRS.values()) == set(BIOMES)
    assert len(SIGIL_LAIRS) == 5
    assert SIGILS_REQUIRED == 3


# ── Battle ───────────────────────────────────────────────────────────────────

# NOTE: the old per-strike slugfest tests (faster-side ordering, defend stance,
# damage floor/timeout format) were removed with the legacy _strike engine.
# The stance-triangle model is covered by the test_round_*/test_runner_* suite
# below. Flee, clamp, and regrowth tests remain valid via the back-compat path.


def test_flee_success_and_failure():
    a = fighter(name='A', spd=5)
    b = fighter(name='B', spd=5, stance='flee')
    # base 35% — random() = 0.10 → success
    r = resolve_battle(a, b, FakeRng(randoms=[0.10]))
    assert r['outcome'] == 'fled'
    # random() = 0.90 → failure, battle proceeds
    r = resolve_battle(a, b, FakeRng(randoms=[0.90]))
    assert r['outcome'] != 'fled'


def test_flee_chance_clamped():
    from undercity_engine import flee_chance
    assert flee_chance(99, 1) == 90
    assert flee_chance(1, 99) == 10
    assert flee_chance(7, 5) == 45


def test_smoke_spore_saves_failed_flee():
    a = fighter(name='A', spd=5)
    b = fighter(name='B', spd=5, stance='flee', has_smoke_spore=True)
    r = resolve_battle(a, b, FakeRng(randoms=[0.90]))
    assert r['outcome'] == 'fled'
    assert r['smokeSporeUsed']


# NOTE: old strike-format passive tests (swarm extra-strike, deathtouch, drain,
# venom_barb first-strike, rot_breath round-1, scavenge) removed with _strike.
# Replaced by the stance-triangle passive tests further below (test_venom_barb_
# first_win_bonus_once, test_rot_breath_first_win_doubles, test_scavenge_
# retaliates_on_loss, test_deathtouch_aggress_pierces_def, test_swarm_adds_chip_
# each_round, test_drain_life_heals_on_win).


def test_regrowth_heals_survivor_after_battle():
    a = fighter(name='A', atk=10, dfn=0, spd=9, hp=100, max_hp=100,
                passives=frozenset({'regrowth'}))
    b = fighter(name='B', atk=5, dfn=0, spd=1, hp=6, max_hp=100)
    r = resolve_battle(a, b, FakeRng())
    assert r['outcome'] == 'attacker'
    assert r['attackerHp'] == 100  # 20% max heal tops it back up past the chip

def test_rootwall_upgrades_regrowth():
    # Fast kill (b dies by round 3, before the Collapse) isolates the heal: A
    # enters at 60, takes only a couple of chip, and rootwall's 35% regrowth
    # (35, vs plain regrowth's 20) tops it back to ~93. Plain regrowth would
    # land near 80 and fail this bound.
    a = fighter(name='A', atk=10, dfn=0, spd=9, hp=60, max_hp=100,
                passives=frozenset({'regrowth', 'rootwall'}))
    b = fighter(name='B', atk=1, dfn=0, spd=1, hp=25, max_hp=100)
    r = resolve_battle(a, b, FakeRng())
    assert r['outcome'] == 'attacker'
    assert r['attackerHp'] >= 89


# ── Spore theft ──────────────────────────────────────────────────────────────

def test_pvp_spore_steal():
    assert pvp_spore_steal(100, 'fight', frozenset()) == 25
    assert pvp_spore_steal(100, 'defend', frozenset()) == 10
    assert pvp_spore_steal(100, 'fight', frozenset({'deathrite'})) == 37


# ── Regen ────────────────────────────────────────────────────────────────────

def test_no_passive_hp_regen():
    # Passive time-based regen is OFF by design (HP_REGEN_PCT=0): elapsed real
    # time never heals. HP is restored only by a spell, level-up/evolution, a
    # gate stop, or an ability like Regrowth. The clock still advances so the
    # mechanic stays clean if ever re-enabled.
    p = {'hp': 10, 'maxHp': 50, 'hpUpdatedAt': '2026-07-06T20:00:00'}
    regen_hp(p, '2026-07-06T23:00:00')
    assert p['hp'] == 10
    assert p['hpUpdatedAt'] == '2026-07-06T23:00:00'


def test_roll_regen_batch_per_interval_keeps_partial_progress():
    p = {'rolls': 0, 'rollRegenAt': '2026-07-17T20:00:00'}
    regen_rolls(p, '2026-07-17T20:35:00')
    assert p['rolls'] == 3                              # 1 full 30-min tick, +3 rolls
    assert p['rollRegenAt'] == '2026-07-17T20:30:00'    # 5 leftover minutes kept


def test_roll_regen_caps_at_roll_cap():
    p = {'rolls': 5, 'rollRegenAt': '2026-07-17T20:00:00'}
    regen_rolls(p, '2026-07-17T23:00:00')
    assert p['rolls'] == data.ROLL_CAP


def test_roll_regen_seeds_missing_timestamp():
    p = {'rolls': 2}
    regen_rolls(p, '2026-07-17T20:00:00')
    assert p['rolls'] == 2
    assert p['rollRegenAt'] == '2026-07-17T20:00:00'


def test_roll_regen_advances_clock_while_at_cap():
    # No hidden stockpile: the timestamp moves even when nothing is granted.
    p = {'rolls': data.ROLL_CAP, 'rollRegenAt': '2026-07-17T20:00:00'}
    regen_rolls(p, '2026-07-17T21:00:00')
    assert p['rolls'] == data.ROLL_CAP
    assert p['rollRegenAt'] == '2026-07-17T21:00:00'


def test_roll_regen_noop_within_interval():
    p = {'rolls': 1, 'rollRegenAt': '2026-07-17T20:00:00'}
    regen_rolls(p, '2026-07-17T20:09:59')
    assert p['rolls'] == 1
    assert p['rollRegenAt'] == '2026-07-17T20:00:00'


# ── Mystery table ────────────────────────────────────────────────────────────

def test_mystery_drift_rerolls_bad_outcomes():
    res = roll_mystery(FakeRng(randints=[9, 3]), has_drift=True, has_doubling_rot=False)
    assert res['roll'] == 3
    res = roll_mystery(FakeRng(randints=[2]), has_drift=True, has_doubling_rot=False)
    assert res['roll'] == 2  # good outcomes don't reroll


def test_mystery_doubling_rot_doubles_spore_gains():
    plain = roll_mystery(FakeRng(randints=[1]), has_drift=False, has_doubling_rot=False)
    doubled = roll_mystery(FakeRng(randints=[1]), has_drift=False, has_doubling_rot=True)
    assert plain['spores'] == 20 and doubled['spores'] == 40
    # losses are NOT doubled
    lose = roll_mystery(FakeRng(randints=[8]), has_drift=False, has_doubling_rot=True)
    assert lose['spores'] == -10


def test_mystery_roll1_biome_bonus():
    garden = roll_mystery(FakeRng(randints=[1]), has_drift=False, has_doubling_rot=False, biome='garden')
    city = roll_mystery(FakeRng(randints=[1]), has_drift=False, has_doubling_rot=False, biome='city')
    plain = roll_mystery(FakeRng(randints=[1]), has_drift=False, has_doubling_rot=False, biome='bog')
    assert garden['spores'] == 26
    assert city['spores'] == 26
    assert plain['spores'] == 20
    # doubling rot still applies to the bumped amount
    doubled = roll_mystery(FakeRng(randints=[1]), has_drift=False, has_doubling_rot=True, biome='city')
    assert doubled['spores'] == 52


def test_mystery_roll7_biome_buff():
    cavern = roll_mystery(FakeRng(randints=[7]), has_drift=False, has_doubling_rot=False, biome='cavern')
    bog = roll_mystery(FakeRng(randints=[7]), has_drift=False, has_doubling_rot=False, biome='bog')
    bone = roll_mystery(FakeRng(randints=[7]), has_drift=False, has_doubling_rot=False, biome='bone')
    garden = roll_mystery(FakeRng(randints=[7]), has_drift=False, has_doubling_rot=False, biome='garden')
    city = roll_mystery(FakeRng(randints=[7]), has_drift=False, has_doubling_rot=False, biome='city')
    plain = roll_mystery(FakeRng(randints=[7]), has_drift=False, has_doubling_rot=False, biome=None)
    assert cavern['buff'] == 'glowveil'
    assert bog['buff'] == 'harden_shell'
    assert bone['buff'] == 'harden_shell'
    assert bog['text'] != bone['text']  # same buff, different flavor
    assert garden['buff'] == 'rot_surge'
    assert city['buff'] == 'rot_surge'
    assert plain['buff'] == 'rot_surge'


# ── NPCs ─────────────────────────────────────────────────────────────────────

def test_npc_fixed_stats():
    npc = pick_npc(FakeRng())              # FakeRng.choice -> first pool entry
    assert npc == {'id': 'drudge_beetle', 'name': 'Drudge Beetle',
                   'hp': 22, 'atk': 6, 'def': 2, 'spd': 5,
                   'bounty': 6, 'xp': 10, 'itemChance': 0.0}


def test_pick_npc_uses_given_pool():
    npc = pick_npc(FakeRng(), data.ELITE_NPCS)
    assert npc['id'] == 'fetid_imp' and npc['xp'] == 25


# ── Effective stats ──────────────────────────────────────────────────────────

def test_effective_stats_include_gear_and_buffs():
    p = {'atk': 6, 'def': 5, 'spd': 5, 'maxHp': 30,
         'gear': {'fang': 'wurm_tooth', 'carapace': 'troll_hide'},
         'buffs': [{'kind': 'rot_surge'}]}
    eff = effective_stats(p)
    assert eff['atk'] == 6 + 6 + 3
    assert eff['def'] == 5 + 5
    assert eff['spd'] == 5 + 1
    assert eff['maxHp'] == 36


def test_cursed_idol_debuff():
    p = {'atk': 6, 'def': 5, 'spd': 5, 'maxHp': 30, 'gear': {},
         'buffs': [{'kind': 'cursed_idol'}]}
    assert effective_stats(p)['atk'] == 5


# ── Renown ───────────────────────────────────────────────────────────────────

def test_renown_table():
    # Only fights + firsts count: level and spores grant no Renown.
    p = {'level': 8, 'pvpWins': 3, 'wildWins': 7, 'spores': 52, 'bossDamage': 45,
         'poiClaims': ['bar_e', 'lair_titan']}
    assert data.compute_renown(p) == 45 + 21 + 50 + 4  # pvp + wild + 2 firsts + boss


# ── Unique dungeons (v6) ─────────────────────────────────────────────────────

def test_bone_chill_debuff_lowers_atk():
    player = {'atk': 6, 'def': 4, 'spd': 5, 'maxHp': 30,
              'buffs': [{'kind': 'bone_chill'}]}
    assert effective_stats(player)['atk'] == 4


def test_bone_chill_never_below_one():
    player = {'atk': 2, 'def': 4, 'spd': 5, 'maxHp': 30,
              'buffs': [{'kind': 'bone_chill'}]}
    assert effective_stats(player)['atk'] == 1


# ── Tier balance (mean rolls: uniform()=1.0, no passives) ───────────────────

def _ref(level):
    """Reference statline: median starter, even stat spend, tier gear."""
    return {
        1: fighter(hp=30, max_hp=30, atk=6, dfn=5, spd=5),
        3: fighter(hp=36, max_hp=36, atk=8, dfn=7, spd=5),
        5: fighter(hp=48, max_hp=48, atk=12, dfn=10, spd=5),
        6: fighter(hp=51, max_hp=51, atk=14, dfn=11, spd=5),
        7: fighter(hp=54, max_hp=54, atk=15, dfn=12, spd=6),
    }[level]


def _foe(spec):
    return Combatant(name=spec['name'], hp=spec['hp'], max_hp=spec['hp'],
                     atk=spec['atk'], dfn=spec['def'], spd=spec['spd'])


def test_level7_kills_every_lair_boss():
    for lair, spec in data.LAIR_BOSSES.items():
        out = resolve_battle(_ref(7), _foe(spec), FakeRng())
        assert out['outcome'] == 'attacker', lair


def test_guardians_fall_at_their_target_levels():
    east = resolve_battle(_ref(5), _foe(data.BARRIER_GUARDIANS['bar_e']), FakeRng())
    south = resolve_battle(_ref(6), _foe(data.BARRIER_GUARDIANS['bar_s']), FakeRng())
    assert east['outcome'] == 'attacker'
    assert south['outcome'] == 'attacker'


def test_level1_bare_starter_can_lose_to_basic_wilds():
    # Basic wilds are a real threat to an UNGEARED starter (design 2026-07-19):
    # at least one normal wild beats a bare level-1 in a straight fight, so
    # farming fodder is no longer free — you need gear or luck.
    losses = [spec['id'] for spec in data.NPCS
              if resolve_battle(_ref(1), _foe(spec), FakeRng())['outcome'] != 'attacker']
    assert losses, 'a bare L1 should lose to at least one basic wild'


def test_level1_geared_starter_beats_every_wild():
    # One gear piece each (rusted_fang +2 ATK, chitin_scrap +2 DEF) tips every
    # basic wild back in the starter's favour — gear is the intended out.
    for spec in data.NPCS:
        me = _ref(1)
        me.atk += 2
        me.dfn += 2
        out = resolve_battle(me, _foe(spec), FakeRng())
        assert out['outcome'] == 'attacker', spec['id']


def test_level1_loses_to_elites():
    for spec in data.ELITE_NPCS:
        out = resolve_battle(_ref(1), _foe(spec), FakeRng())
        assert out['outcome'] == 'defender', spec['id']


def test_level5_beats_every_elite_and_survives_comfortably():
    # An even elite fight now runs into the Collapse (round 4+), so the winner
    # pays real HP for the drawn-out kill — but a tier-5 creature still wins
    # decisively and walks away above half HP.
    for spec in data.ELITE_NPCS:
        me = _ref(5)
        out = resolve_battle(me, _foe(spec), FakeRng())
        assert out['outcome'] == 'attacker', spec['id']
        assert out['attackerHp'] >= me.max_hp // 2, spec['id']


def test_level3_beats_every_dungeon_wild():
    for biome, spec in data.DUNGEON_NPCS.items():
        out = resolve_battle(_ref(3), _foe(spec), FakeRng())
        assert out['outcome'] == 'attacker', biome


# ── Stance triangle (spec 2026-07-14 §1) ─────────────────────────────────────

from undercity_engine import exchange_winner


def test_exchange_triangle():
    # decisive matchups
    assert exchange_winner('aggress', 'feint') == 'attacker'
    assert exchange_winner('feint', 'aggress') == 'defender'
    assert exchange_winner('feint', 'guard') == 'attacker'
    assert exchange_winner('guard', 'feint') == 'defender'
    assert exchange_winner('guard', 'aggress') == 'attacker'
    assert exchange_winner('aggress', 'guard') == 'defender'
    # mirrors
    assert exchange_winner('aggress', 'aggress') == 'clash'
    assert exchange_winner('guard', 'guard') == 'stall'
    assert exchange_winner('feint', 'feint') == 'whiff'


from undercity_engine import resolve_round, _base_hit


def test_round_aggress_beats_feint_full_punish():
    # uniform=1.0 so hit = round(atk*1.0) - def; atk10 vs def4 => 6, *WIN 1.5 => 9
    a = fighter(atk=10, dfn=5, spd=5)
    d = fighter(atk=10, dfn=4, spd=5, hp=30, max_hp=30)
    rng = FakeRng(uniform=1.0)
    entries = resolve_round(a, d, 'aggress', 'feint', 1, rng)
    assert d.hp == 14   # aggress base 1.5*10=15, -def4=11, *WIN1.5 => round(16.5)=16
    # the caught feinter still pokes back for chip (5 * 0.15 -> 1)
    assert a.hp == 30 - round(5 * data.STANCE_STALL_MULT)
    assert any(e.get('winner') == 'attacker' for e in entries)


def test_round_guard_beats_aggress_mitigate_and_counter():
    a = fighter(atk=10, dfn=5, spd=5, hp=30, max_hp=30)   # aggressor
    d = fighter(atk=10, dfn=5, spd=5, hp=30, max_hp=30)   # guard
    rng = FakeRng(uniform=1.0)
    resolve_round(a, d, 'aggress', 'guard', 1, rng)
    # aggressor base 1.5*10=15, ×(1-5/15)=10, mitigated *0.4 => 4 to guard
    assert d.hp == 26
    # guard counter base 0.5*10 + 1.0*5 = 10, ×(1-5/15)=7, *0.6 => round(4.2)=4
    assert a.hp == 26


def test_round_clash_both_take_full():
    a = fighter(atk=10, dfn=5, hp=30, max_hp=30, spd=6)
    d = fighter(atk=10, dfn=5, hp=30, max_hp=30, spd=5)
    rng = FakeRng(uniform=1.0)
    resolve_round(a, d, 'aggress', 'aggress', 1, rng)
    assert a.hp == 20 and d.hp == 20   # both aggress base 15, -def5=10 full


def test_round_whiff_nobody_hit():
    a = fighter(hp=30, max_hp=30); d = fighter(hp=30, max_hp=30)
    resolve_round(a, d, 'feint', 'feint', 1, FakeRng(uniform=1.0))
    # feint swing 0.5*6+0.6*5=6, ×(1-5/15)=4, chip round(4*0.15)=1 each
    assert a.hp == 29 and d.hp == 29


def test_guard_swing_scales_with_defense():
    lo = fighter(atk=10, dfn=2, spd=5)
    hi = fighter(atk=10, dfn=8, spd=5)
    tgt = fighter(atk=0, dfn=0)
    rng = FakeRng(uniform=1.0)
    lo_hit = _base_hit(lo, tgt, rng, stance='guard')
    hi_hit = _base_hit(hi, tgt, rng, stance='guard')
    assert hi_hit > lo_hit
    # Guard swing = OFFHAND_ATK×atk + SIG×def (DEF is the driver now).
    assert lo_hit == round(data.STANCE_OFFHAND_ATK_WEIGHT * 10 + data.GUARD_SIG_WEIGHT * 2)  # 7
    assert hi_hit == round(data.STANCE_OFFHAND_ATK_WEIGHT * 10 + data.GUARD_SIG_WEIGHT * 8)  # 13


def test_feint_swing_scales_with_speed():
    slow = fighter(atk=10, dfn=5, spd=2)
    fast = fighter(atk=10, dfn=5, spd=8)
    tgt = fighter(atk=0, dfn=0)
    rng = FakeRng(uniform=1.0)
    assert (_base_hit(fast, tgt, rng, stance='feint')
            > _base_hit(slow, tgt, rng, stance='feint'))


def test_def_is_proportional_mitigation():
    # A raw aggress swing of 15 (atk10) against increasing DEF is reduced by a
    # fraction def/(def+10), capped at 0.75. Not a flat subtraction.
    striker = fighter(atk=10, dfn=0, spd=0)
    rng = FakeRng(uniform=1.0)
    assert _base_hit(striker, fighter(atk=0, dfn=0), rng, stance='aggress') == 15   # no DEF
    assert _base_hit(striker, fighter(atk=0, dfn=5), rng, stance='aggress') == 10   # 15×(1−5/15)=10
    assert _base_hit(striker, fighter(atk=0, dfn=10), rng, stance='aggress') == 8   # 15×0.5=7.5→8
    # Cap: even absurd DEF cannot reduce below 25% of the swing.
    big = fighter(atk=100, dfn=0, spd=0)   # aggress swing 150
    assert _base_hit(big, fighter(atk=0, dfn=1000), rng, stance='aggress') == round(150 * 0.25)  # 38
    # pierce eats into the mitigation, not the final damage.
    assert (_base_hit(striker, fighter(atk=0, dfn=10), rng, stance='aggress', pierce=5)
            == _base_hit(striker, fighter(atk=0, dfn=5), rng, stance='aggress'))


def test_aggress_swing_scales_with_strength():
    weak = fighter(atk=6, dfn=5, spd=5)
    strong = fighter(atk=12, dfn=5, spd=5)
    tgt = fighter(atk=0, dfn=0)
    rng = FakeRng(uniform=1.0)
    assert (_base_hit(strong, tgt, rng, stance='aggress')
            > _base_hit(weak, tgt, rng, stance='aggress'))


def test_aggress_swing_ignores_defense_and_speed():
    base = fighter(atk=10, dfn=3, spd=3)
    tanky = fighter(atk=10, dfn=9, spd=9)   # more DEF/SPD, same ATK
    tgt = fighter(atk=0, dfn=0)
    rng = FakeRng(uniform=1.0)
    assert (_base_hit(base, tgt, rng, stance='aggress')
            == _base_hit(tanky, tgt, rng, stance='aggress'))


def test_rebalance_tunables_exist_and_are_sane():
    # SPD de-god: Feint leans less on its signature stat than Guard does.
    assert data.GUARD_SIG_WEIGHT == 1.0
    assert data.FEINT_SIG_WEIGHT == 0.6
    assert data.FEINT_SIG_WEIGHT < data.GUARD_SIG_WEIGHT
    # DEF mitigation curve.
    assert data.MITIGATION_K == 10.0
    assert 0.0 < data.MITIGATION_CAP <= 1.0
    # Reads tamed.
    assert data.READ_SPD_COEFF == 0.008
    assert data.READ_MAX == 0.80
    # The single shared weight is gone (replaced by the two above).
    assert not hasattr(data, 'STANCE_SIG_WEIGHT')


def test_feint_swing_leans_lighter_on_spd_than_guard_on_def():
    # Same magnitude in the signature stat: a Feint (SPD) should now swing for
    # less than a Guard (DEF), because FEINT_SIG_WEIGHT < GUARD_SIG_WEIGHT.
    guarder = fighter(atk=10, dfn=12, spd=0)
    feinter = fighter(atk=10, dfn=0, spd=12)
    tgt = fighter(atk=0, dfn=0)
    rng = FakeRng(uniform=1.0)
    guard_hit = _base_hit(guarder, tgt, rng, stance='guard')
    feint_hit = _base_hit(feinter, tgt, rng, stance='feint')
    assert guard_hit == round(0.5 * 10 + 1.0 * 12)   # 17
    assert feint_hit == round(0.5 * 10 + 0.6 * 12)   # 12
    assert feint_hit < guard_hit


def test_double_guard_deals_no_damage():
    a = fighter(atk=10, dfn=5, hp=30, max_hp=30)
    d = fighter(atk=10, dfn=5, hp=30, max_hp=30)
    resolve_round(a, d, 'guard', 'guard', 1, FakeRng(uniform=1.0))
    assert a.hp == 30 and d.hp == 30   # both fully block


def test_thick_still_chips_in_a_stall():
    a = fighter(atk=10, dfn=5, hp=30, max_hp=30, riders=frozenset({'thick'}))
    d = fighter(atk=10, dfn=5, hp=30, max_hp=30)
    resolve_round(a, d, 'guard', 'guard', 1, FakeRng(uniform=1.0))
    assert d.hp == 30 - round(5 * data.STANCE_STALL_MULT)  # thick chips through
    assert a.hp == 30                                       # plain guard: unscathed


def test_double_feint_both_chip():
    a = fighter(atk=10, dfn=5, hp=30, max_hp=30)
    d = fighter(atk=10, dfn=5, hp=30, max_hp=30)
    resolve_round(a, d, 'feint', 'feint', 1, FakeRng(uniform=1.0))
    chip = round(5 * data.STANCE_STALL_MULT)   # 1
    assert a.hp == 30 - chip and d.hp == 30 - chip


def test_swarm_adds_chip_each_round():
    a = fighter(atk=10, dfn=5, hp=30, max_hp=30, passives=frozenset({'swarm'}))
    d = fighter(atk=10, dfn=5, hp=30, max_hp=30)
    resolve_round(a, d, 'feint', 'feint', 1, FakeRng(uniform=1.0))  # whiff
    # whiff chips each for 1; swarm adds round(5*0.5)=2 onto d (feint base 0.5*10+1.0*5=10, -def5=5)
    assert d.hp == 27 and a.hp == 29


def test_rot_stacks_tick_end_of_round():
    a = fighter(hp=30, max_hp=30); d = fighter(hp=30, max_hp=30)
    d.rot_stacks = 2
    resolve_round(a, d, 'feint', 'feint', 1, FakeRng(uniform=1.0))
    # whiff chip 1 + rot 2*2 = 5 total off d
    assert d.hp == 30 - 1 - 2 * data.ROT_PER_STACK  # 30 - 1 - 4 = 25


def test_venom_barb_first_win_bonus_once():
    a = fighter(atk=10, dfn=5, hp=30, max_hp=30, passives=frozenset({'venom_barb'}))
    d = fighter(atk=10, dfn=4, hp=60, max_hp=60)
    rng = FakeRng(uniform=1.0)
    resolve_round(a, d, 'aggress', 'feint', 1, rng)   # win: (15-4)=11*1.5=16 +3 =19
    assert d.hp == 60 - (16 + data.VENOM_BARB_BONUS)
    assert a.first_win_used
    hp_after_first = d.hp
    resolve_round(a, d, 'aggress', 'feint', 2, rng)   # no bonus second time: 16
    assert d.hp == hp_after_first - 16


def test_rot_breath_first_win_doubles():
    a = fighter(atk=10, dfn=5, hp=30, max_hp=30, passives=frozenset({'rot_breath'}))
    d = fighter(atk=10, dfn=4, hp=60, max_hp=60)
    resolve_round(a, d, 'feint', 'guard', 1, FakeRng(uniform=1.0))  # feint>guard win
    # feint base 0.5*10+1.0*5=10, -def4=6; *WIN1.5*rot_breath2 => 18
    assert d.hp == 60 - 18


def test_scavenge_retaliates_on_loss():
    a = fighter(atk=10, dfn=5, hp=30, max_hp=30)                       # winner
    d = fighter(atk=10, dfn=5, hp=30, max_hp=30, passives=frozenset({'scavenge'}))
    resolve_round(a, d, 'aggress', 'feint', 1, FakeRng(uniform=1.0))   # d loses
    # d retaliates 2 (scavenge) AND pokes 1 (caught feint)
    assert a.hp == 30 - data.SCAVENGE_RETALIATE - round(5 * data.STANCE_STALL_MULT)


def test_drain_life_heals_on_win():
    a = fighter(atk=10, dfn=5, hp=20, max_hp=40, passives=frozenset({'drain_life'}))
    d = fighter(atk=10, dfn=4, hp=60, max_hp=60)
    resolve_round(a, d, 'aggress', 'feint', 1, FakeRng(uniform=1.0))
    dmg = round((round(1.5 * 10) - 4) * data.STANCE_WIN_MULT)   # (15-4=11)*1.5 -> 16
    assert d.hp == 60 - dmg
    # healed 50% of damage dealt (8), minus the feinter's chip-back (1)
    assert a.hp == 20 + round(dmg * 0.5) - 1


def test_force_winner_overrides_triangle():
    a = fighter(atk=10, dfn=5, hp=30, max_hp=30)
    d = fighter(atk=10, dfn=4, hp=30, max_hp=30)
    # both feint => normally a whiff. Force attacker to win: a lands the decisive
    # hit; the caught feinter (d) still pokes a for chip (5 * 0.15 -> 1).
    resolve_round(a, d, 'feint', 'feint', 1, FakeRng(uniform=1.0),
                  force_winner='attacker')
    # forced winner plays feint: base 0.5*10+1.0*5=10, -def4=6, *WIN1.5 => 9
    assert d.hp == 30 - 9
    assert a.hp == 30 - round(5 * data.STANCE_STALL_MULT)  # chip-back still 1


def test_double_win_for_doubles_winner_damage():
    a = fighter(atk=10, dfn=5, hp=30, max_hp=30)
    d = fighter(atk=10, dfn=4, hp=60, max_hp=60)
    resolve_round(a, d, 'aggress', 'feint', 1, FakeRng(uniform=1.0),
                  double_win_for='attacker')
    assert d.hp == 60 - 32   # aggress (15-4=11)*1.5=16, doubled => 32


def test_negate_loss_cancels_punish():
    a = fighter(atk=10, dfn=5, hp=30, max_hp=30)   # winner by triangle
    d = fighter(atk=10, dfn=5, hp=30, max_hp=30)   # loser, negates
    resolve_round(a, d, 'aggress', 'feint', 1, FakeRng(uniform=1.0),
                  negate_loss_for='defender')
    assert d.hp == 30   # punish negated


def test_flyby_dodges_the_punish():
    a = fighter(atk=10, dfn=5, hp=30, max_hp=30)
    d = fighter(atk=10, dfn=5, hp=30, max_hp=30, passives=frozenset({'flyby'}))
    # random() returns 0.10 < 0.25 => dodge
    resolve_round(a, d, 'aggress', 'feint', 1, FakeRng(randoms=[0.10], uniform=1.0))
    assert d.hp == 30   # punish dodged


def test_reach_negates_round1_punish_only():
    a = fighter(atk=10, dfn=5, hp=30, max_hp=30)
    d = fighter(atk=10, dfn=5, hp=30, max_hp=30, passives=frozenset({'reach'}))
    # Round 1: reach keeps the skirmisher out of range — punish finds only air.
    resolve_round(a, d, 'aggress', 'feint', 1, FakeRng(uniform=1.0))
    assert d.hp == 30
    # Round 2: no protection — the punish lands.
    resolve_round(a, d, 'aggress', 'feint', 2, FakeRng(uniform=1.0))
    assert d.hp < 30


def test_deathtouch_aggress_pierces_def():
    a = fighter(atk=10, dfn=5, hp=30, max_hp=30, passives=frozenset({'deathtouch_stomp'}))
    d = fighter(atk=10, dfn=8, hp=60, max_hp=60)
    resolve_round(a, d, 'aggress', 'feint', 1, FakeRng(uniform=1.0))
    # aggress base 15; pierce 3 => eff def 5; hit 15-5=10 *1.5 => 15
    assert d.hp == 60 - 15


def test_first_bite_wins_clash_order():
    a = fighter(atk=10, dfn=0, hp=6, max_hp=6, spd=1, passives=frozenset({'first_bite'}))
    d = fighter(atk=10, dfn=0, hp=30, max_hp=30, spd=9)  # faster, but...
    resolve_round(a, d, 'aggress', 'aggress', 1, FakeRng(uniform=1.0))
    # first_bite makes A strike first; aggress base 1.5*10=15 -> d.hp 30-15=15
    assert d.hp == 15


def test_barbed_aggress_applies_rot_even_on_loss():
    a = fighter(atk=10, dfn=5, hp=30, max_hp=30, riders=frozenset({'barbed'}))
    d = fighter(atk=10, dfn=5, hp=30, max_hp=30)
    resolve_round(a, d, 'aggress', 'guard', 1, FakeRng(uniform=1.0))  # a loses (G>A)
    assert d.rot_stacks == 1   # rot applied despite losing the exchange


def test_deep_biter_boosts_winning_hit():
    a = fighter(atk=10, dfn=5, hp=30, max_hp=30, riders=frozenset({'deep_biter'}))
    d = fighter(atk=10, dfn=4, hp=60, max_hp=60)
    resolve_round(a, d, 'aggress', 'feint', 1, FakeRng(uniform=1.0))
    # aggress (15-4)=11 * (1.5 + deep_biter 0.5 = 2.0) = 22
    assert d.hp == 60 - 22


def test_spiked_boosts_guard_counter():
    a = fighter(atk=10, dfn=5, hp=30, max_hp=30)                        # aggressor
    d = fighter(atk=10, dfn=5, hp=30, max_hp=30, riders=frozenset({'spiked'}))
    resolve_round(a, d, 'aggress', 'guard', 1, FakeRng(uniform=1.0))
    # counter base 0.5*10+1.0*5=10, ×(1-5/15)=7, *0.6*spiked1.5=0.9 => round(6.3)=6
    assert a.hp == 30 - 6


def test_trickster_halves_lost_feint_punish():
    a = fighter(atk=10, dfn=5, hp=30, max_hp=30)                        # aggressor wins
    d = fighter(atk=10, dfn=5, hp=30, max_hp=30, riders=frozenset({'trickster'}))
    resolve_round(a, d, 'aggress', 'feint', 1, FakeRng(uniform=1.0))
    # aggress (15-5)=10*1.5=15, trickster halves => round(15/2)=8
    assert d.hp == 30 - 8


def test_serrated_penalizes_enemy_next_round():
    a = fighter(atk=10, dfn=5, hp=30, max_hp=30, riders=frozenset({'serrated'}))
    d = fighter(atk=10, dfn=5, hp=60, max_hp=60)
    resolve_round(a, d, 'feint', 'guard', 1, FakeRng(uniform=1.0))  # a's feint wins
    assert d.dmg_penalty == 2


def test_glint_sets_reveal():
    a = fighter(hp=30, max_hp=30, riders=frozenset({'glint'}))
    d = fighter(hp=60, max_hp=60)
    resolve_round(a, d, 'feint', 'guard', 1, FakeRng(uniform=1.0))
    assert a.reveal_next is True


def test_rot_surge_buff_applies_rot_on_aggress():
    a = fighter(atk=10, dfn=5, hp=30, max_hp=30, buffs=frozenset({'rot_surge'}))
    d = fighter(atk=10, dfn=5, hp=30, max_hp=30)
    resolve_round(a, d, 'aggress', 'guard', 1, FakeRng(uniform=1.0))
    assert d.rot_stacks == 1


def test_harden_shell_heals_on_guard_win():
    a = fighter(atk=10, dfn=5, hp=30, max_hp=30)                    # aggressor
    d = fighter(atk=10, dfn=5, hp=20, max_hp=30, buffs=frozenset({'harden_shell'}))
    resolve_round(a, d, 'aggress', 'guard', 1, FakeRng(uniform=1.0))
    # d took mitigated (15-5=10)*0.4=4 (->16) then heals 3 (->19)
    assert d.hp == 20 - 4 + 3


from undercity_engine import flee_attempt


def test_flee_attempt_success_and_smoke_fallback():
    # spd 8 vs 5 => chance 35+15=50; random 0.10*100=10 < 50 => escaped
    f = fighter(spd=8, hp=20, max_hp=30)
    e = fighter(spd=5)
    assert flee_attempt(f, e, FakeRng(randoms=[0.10]))['escaped'] is True
    # fail, but smoke spore saves it
    f2 = fighter(spd=1, hp=20, max_hp=30, has_smoke_spore=True)
    e2 = fighter(spd=9)
    r = flee_attempt(f2, e2, FakeRng(randoms=[0.99]))
    assert r['escaped'] is True and r['smokeSporeUsed'] is True
    # fail, no smoke => not escaped, DEF drop applied
    f3 = fighter(spd=1, hp=20, max_hp=30, dfn=5)
    r3 = flee_attempt(f3, fighter(spd=9), FakeRng(randoms=[0.99]))
    assert r3['escaped'] is False and f3.dfn == 4


from undercity_engine import pick_stance, telegraph


def test_pick_stance_uses_weights_via_cumulative_roll():
    # random() picks along the cumulative (aggress, guard, feint) distribution.
    assert pick_stance('brute', FakeRng(randoms=[0.00])) == 'aggress'
    assert pick_stance('brute', FakeRng(randoms=[0.70])) == 'guard'   # 0.60..0.85
    assert pick_stance('brute', FakeRng(randoms=[0.90])) == 'feint'   # 0.85..1.0
    assert pick_stance('turtle', FakeRng(randoms=[0.50])) == 'guard'


def test_telegraph_truthful_when_no_bluff():
    # bluff 0 => always shows the true stance.
    assert telegraph('aggress', bluff=0.0, rng=FakeRng(randoms=[0.00])) == 'aggress'


def test_telegraph_bluffs_to_a_different_stance():
    # random() < bluff => show a DIFFERENT stance (chosen from the other two).
    shown = telegraph('aggress', bluff=0.5, rng=FakeRng(randoms=[0.10]))
    assert shown in ('guard', 'feint') and shown != 'aggress'


from undercity_engine import resolve_battle_rounds


def _always(stance):
    return lambda me, foe, rnd, rng: stance


def test_runner_aggro_beats_feinter_and_regrowth():
    a = fighter(atk=12, dfn=5, hp=40, max_hp=40)
    d = fighter(atk=6, dfn=5, hp=20, max_hp=20, passives=frozenset({'regrowth'}))
    res = resolve_battle_rounds(a, d, FakeRng(uniform=1.0),
                                _always('aggress'), _always('feint'))
    assert res['outcome'] == 'attacker'
    assert res['attackerHp'] > 0 and res['defenderHp'] == 0


def test_pure_stall_resolved_by_the_collapse():
    # atk=1/dfn=99 guards: no stance damage ever lands, so without the Collapse
    # this would run forever. Frenzy is a fraction of each fighter's OWN max HP,
    # so the one who entered lower (d, at 25%) crosses zero first — a real kill,
    # not a timeout.
    a = fighter(atk=1, dfn=99, hp=40, max_hp=40)
    d = fighter(atk=1, dfn=99, hp=10, max_hp=40)
    res = resolve_battle_rounds(a, d, FakeRng(uniform=1.0),
                                _always('guard'), _always('guard'))
    assert res['outcome'] == 'attacker'
    assert res['defenderHp'] == 0


def test_resolve_battle_backcompat_maps_legacy_stance():
    a = fighter(atk=12, dfn=5, hp=40, max_hp=40, stance='fight')
    d = fighter(atk=6, dfn=5, hp=18, max_hp=18, stance='defend')
    res = resolve_battle(a, d, FakeRng(uniform=1.0))
    assert res['outcome'] in ('attacker', 'defender')   # sudden death: always a kill
    assert 'strikes' in res and 'attackerHp' in res


def test_resolve_battle_flee_stance_routes_to_flee_attempt():
    a = fighter(atk=12, dfn=5, hp=40, max_hp=40, stance='fight')
    d = fighter(atk=6, dfn=5, hp=18, max_hp=18, spd=9, stance='flee')
    res = resolve_battle(a, d, FakeRng(randoms=[0.10], uniform=1.0))
    assert res['outcome'] == 'fled'


# ── Combat escalation ramp (no more environmental collapse) ──────────────────
# From FRENZY_START each creature's OWN swings ramp up (+FRENZY_RAMP per tier) so
# a dragging fight resolves — but the arena never deals its own damage: there are
# no `frenzy` entries and nobody loses a flat % of max HP to the environment.

def test_no_environmental_collapse_damage():
    # Guard-vs-guard past the threshold: the only damage is a small ramping chip
    # from the creatures grinding — NOT an 18%-of-max-HP cave-in, and nothing is
    # tagged `frenzy` (the arena no longer hits anyone).
    a = fighter(hp=30, max_hp=30)
    d = fighter(hp=30, max_hp=30)
    entries = resolve_round(a, d, 'guard', 'guard', data.FRENZY_START,
                            FakeRng(uniform=1.0), frenzy_from=data.FRENZY_START)
    assert not any(e.get('frenzy') for e in entries)
    # gentle chip, nowhere near the old 18% (~5 HP) environmental hit.
    assert 0 < (30 - a.hp) <= 2 and 0 < (30 - d.hp) <= 2


def test_ramp_escalates_own_swings_over_rounds():
    # The same decisive exchange (Aggress beats Feint) hits harder later in the
    # fight because the winner's OWN swing is ramped.
    def punish(rnd):
        a = fighter(hp=99, max_hp=99)
        d = fighter(hp=99, max_hp=99)
        resolve_round(a, d, 'aggress', 'feint', rnd, FakeRng(uniform=1.0),
                      frenzy_from=data.FRENZY_START)
        return 99 - d.hp
    assert punish(data.FRENZY_START + 2) > punish(data.FRENZY_START)


def test_no_ramp_before_threshold():
    # Before the ramp window a mutual guard is a true stall — zero damage.
    a = fighter(hp=30, max_hp=30)
    d = fighter(hp=30, max_hp=30)
    entries = resolve_round(a, d, 'guard', 'guard', data.FRENZY_START - 1,
                            FakeRng(uniform=1.0), frenzy_from=data.FRENZY_START)
    assert a.hp == 30 and d.hp == 30
    assert not any(e.get('frenzy') for e in entries)


def test_ramp_disabled_when_no_frenzy_from():
    # boss/lair path: frenzy_from=None means no escalation at all.
    a = fighter(hp=30, max_hp=30)
    d = fighter(hp=30, max_hp=30)
    resolve_round(a, d, 'guard', 'guard', data.FRENZY_START, FakeRng(uniform=1.0))
    assert a.hp == 30 and d.hp == 30


def test_stall_still_reaches_a_real_kill():
    # Two turtles that only ever guard would stall forever with no escalation.
    # The ramping grind must still land a real kill before the hard cap.
    a = fighter(hp=30, max_hp=30)
    d = fighter(hp=30, max_hp=30)
    rng = FakeRng(uniform=1.0)
    for rnd in range(data.FRENZY_START, data.COMBAT_HARD_CAP + 1):
        resolve_round(a, d, 'guard', 'guard', rnd, rng, frenzy_from=data.FRENZY_START)
        if a.hp <= 0 or d.hp <= 0:
            break
    assert a.hp <= 0 or d.hp <= 0


def test_stall_grind_lets_the_healthier_fighter_win():
    # Equal chip to both each round, so the fighter who entered ahead survives.
    a = fighter(hp=30, max_hp=30)   # tank: untouched
    d = fighter(hp=15, max_hp=30)   # foe: half HP
    rng = FakeRng(uniform=1.0)
    dead_round = None
    for rnd in range(data.FRENZY_START, data.COMBAT_HARD_CAP + 1):
        resolve_round(a, d, 'guard', 'guard', rnd, rng, frenzy_from=data.FRENZY_START)
        if d.hp <= 0:
            dead_round = rnd
            break
    assert dead_round is not None
    assert a.hp > 0   # the tank outlasts the foe


# ── Flow loot puzzles ────────────────────────────────────────────────────────

def test_flow_puzzles_pack_is_well_formed():
    assert len(data.FLOW_PUZZLES) >= 12
    ids = [p['id'] for p in data.FLOW_PUZZLES]
    assert len(ids) == len(set(ids)), 'puzzle ids must be unique'
    for p in data.FLOW_PUZZLES:
        w, h = p['w'], p['h']
        cells = {(r, c) for r in range(h) for c in range(w)}
        rocks = {tuple(x) for x in p['rocks']}
        assert rocks <= cells, f"{p['id']}: rock out of bounds"
        assert tuple(p['start']) in cells and tuple(p['start']) not in rocks
        assert tuple(p['end']) in cells and tuple(p['end']) not in rocks
        assert tuple(p['start']) != tuple(p['end'])


def test_flow_puzzle_lookup():
    first = data.FLOW_PUZZLES[0]['id']
    assert data.flow_puzzle(first)['id'] == first
    assert data.flow_puzzle('nope') is None


import undercity_engine as _eng_flow

_P = {'w': 4, 'h': 4, 'start': [0, 0], 'end': [3, 0], 'rocks': []}
_SNAKE = [[0, 0], [0, 1], [0, 2], [0, 3], [1, 3], [1, 2], [1, 1], [1, 0],
          [2, 0], [2, 1], [2, 2], [2, 3], [3, 3], [3, 2], [3, 1], [3, 0]]


def test_validate_flow_accepts_full_solution():
    assert _eng_flow.validate_flow_solution(_P, _SNAKE) is True


def test_validate_flow_rejects_empty():
    assert _eng_flow.validate_flow_solution(_P, []) is False


def test_validate_flow_rejects_wrong_endpoints():
    assert _eng_flow.validate_flow_solution(_P, _SNAKE[::-1]) is False  # starts at end


def test_first_reward_on_path_picks_earliest():
    rewards = [{'kind': 'spores', 'cell': [0, 2]},
               {'kind': 'gear', 'cell': [0, 1]}]
    path = [[0, 0], [0, 1], [0, 2], [0, 3]]
    # gear cell [0,1] is entered before spores cell [0,2]
    assert _eng_flow.first_reward_on_path(rewards, path) == 'gear'


def test_first_reward_on_path_respects_later_order():
    rewards = [{'kind': 'gear', 'cell': [0, 3]},
               {'kind': 'spores', 'cell': [0, 1]}]
    path = [[0, 0], [0, 1], [0, 2], [0, 3]]
    # spores cell [0,1] comes first along the path
    assert _eng_flow.first_reward_on_path(rewards, path) == 'spores'


def test_first_reward_on_path_none_when_no_reward_on_path():
    rewards = [{'kind': 'gear', 'cell': [5, 5]}]
    path = [[0, 0], [0, 1]]
    assert _eng_flow.first_reward_on_path(rewards, path) is None


def test_first_reward_on_path_empty_rewards():
    assert _eng_flow.first_reward_on_path([], [[0, 0], [0, 1]]) is None


def test_validate_flow_rejects_diagonal_step():
    bad = [[0, 0], [1, 1]] + _SNAKE[1:]
    assert _eng_flow.validate_flow_solution(_P, bad) is False


def test_validate_flow_rejects_revisit():
    bad = _SNAKE[:-1] + [_SNAKE[-2]]  # repeats a cell, ends off-target
    assert _eng_flow.validate_flow_solution(_P, bad) is False


def test_validate_flow_rejects_incomplete_coverage():
    assert _eng_flow.validate_flow_solution(_P, [[0, 0], [1, 0], [2, 0], [3, 0]]) is False


def test_validate_flow_rejects_entering_rock():
    p = {'w': 4, 'h': 4, 'start': [0, 0], 'end': [0, 3], 'rocks': [[1, 1], [2, 1]]}
    path = [[0, 0], [1, 1], [0, 3]]  # steps onto a rock
    assert _eng_flow.validate_flow_solution(p, path) is False


def test_flow_puzzles_all_solvable():
    for p in data.FLOW_PUZZLES:
        assert _eng_flow.validate_flow_solution(p, p['solution']) is True, p['id']


# ── Gear expansion (2026-07-20) ──────────────────────────────────────────────

def test_every_gear_rider_is_defined_and_stanced():
    valid = {'aggress', 'guard', 'feint'}
    for gid, g in data.GEAR.items():
        rider = g.get('rider')
        if rider is None:
            continue
        assert rider in data.GEAR_RIDERS, f"{gid} rider {rider} missing from GEAR_RIDERS"
        assert data.GEAR_RIDERS[rider]['stance'] in valid


def test_gear_roster_doubled():
    # Full rarity ladders (gear-rarity Phase 2): every effect family spans
    # Common/Rare/Legendary. 48 combat pieces + 2 illuminating (Torchfang fang,
    # Glowspore charm) = 50.
    assert len(data.GEAR) == 50
    slots = {}
    for g in data.GEAR.values():
        slots[g['slot']] = slots.get(g['slot'], 0) + 1
    assert slots == {'fang': 16, 'carapace': 15, 'charm': 19}


def test_battle_serde_persists_new_fields():
    c = fighter(atk=6, dfn=5)
    c.aggress_ramp = 4
    c.feint_won = True
    c.dfn = 9  # bulwark bumped it mid-fight
    snap = db._bt_snapshot(c)
    back = db._bt_to_combatant(snap)
    assert back.aggress_ramp == 4
    assert back.feint_won is True
    # _bt_store writes the live dfn back into the snapshot each round
    c2 = db._bt_to_combatant(snap)
    c2.dfn = 12
    db._bt_store(c2, snap)
    assert snap['dfn'] == 12


def test_bloodfang_heals_on_aggress_win():
    a = fighter(atk=10, dfn=5, hp=20, max_hp=40, riders=frozenset({'bloodfang'}))
    d = fighter(atk=10, dfn=4, hp=60, max_hp=60)
    resolve_round(a, d, 'aggress', 'feint', 1, FakeRng(uniform=1.0))  # a's Aggress wins
    assert a.hp > 20  # healed off the winning hit


def test_rabid_ramps_aggress_damage_each_win():
    a = fighter(atk=10, dfn=5, hp=30, max_hp=30, riders=frozenset({'rabid'}))
    d = fighter(atk=10, dfn=4, hp=200, max_hp=200)
    resolve_round(a, d, 'aggress', 'feint', 1, FakeRng(uniform=1.0))  # win 1
    hp_after_1 = d.hp
    dmg1 = 200 - hp_after_1
    assert a.aggress_ramp == 2  # one stack gained
    resolve_round(a, d, 'aggress', 'feint', 2, FakeRng(uniform=1.0))  # win 2
    dmg2 = hp_after_1 - d.hp
    assert dmg2 > dmg1  # the ramp made the second win hit harder
    assert a.aggress_ramp == 4


def test_gutcleaver_executes_low_hp_foe():
    # Baseline: full-HP target takes the normal winning hit.
    a1 = fighter(atk=10, dfn=5, riders=frozenset({'gutcleaver'}))
    d_full = fighter(atk=10, dfn=4, hp=100, max_hp=100)
    resolve_round(a1, d_full, 'aggress', 'feint', 1, FakeRng(uniform=1.0))
    base_dmg = 100 - d_full.hp
    # Low-HP target (<30%) takes +50%.
    a2 = fighter(atk=10, dfn=5, riders=frozenset({'gutcleaver'}))
    d_low = fighter(atk=10, dfn=4, hp=20, max_hp=100)  # 20% HP
    resolve_round(a2, d_low, 'aggress', 'feint', 1, FakeRng(uniform=1.0))
    exec_dmg = 20 - d_low.hp
    assert exec_dmg > base_dmg


def test_bramble_reflects_when_struck():
    # Same exchange with vs without a bramble carapace on the struck side —
    # isolates the reflect from any other chip in the matchup.
    a1 = fighter(atk=10, dfn=5, hp=30, max_hp=30)
    d1 = fighter(atk=10, dfn=5, hp=40, max_hp=40)
    resolve_round(a1, d1, 'aggress', 'feint', 1, FakeRng(uniform=1.0))  # a strikes d
    loss_without = 30 - a1.hp
    a2 = fighter(atk=10, dfn=5, hp=30, max_hp=30)
    d2 = fighter(atk=10, dfn=5, hp=40, max_hp=40, riders=frozenset({'bramble'}))
    resolve_round(a2, d2, 'aggress', 'feint', 1, FakeRng(uniform=1.0))
    loss_with = 30 - a2.hp
    assert loss_with == loss_without + data.BRAMBLE_REFLECT


def test_bulwark_fortifies_each_guard_round():
    a = fighter(atk=8, dfn=5, hp=40, max_hp=40, riders=frozenset({'bulwark'}))
    d = fighter(atk=8, dfn=5, hp=40, max_hp=40)
    resolve_round(a, d, 'guard', 'guard', 1, FakeRng(uniform=1.0))  # a ends in Guard
    assert a.dfn == 6   # +1 DEF
    resolve_round(a, d, 'guard', 'feint', 2, FakeRng(uniform=1.0))  # a ends in Guard again
    assert a.dfn == 7
    resolve_round(a, d, 'aggress', 'guard', 3, FakeRng(uniform=1.0))  # a NOT in Guard
    assert a.dfn == 7   # no change


def test_mossback_heals_each_guard_round():
    a = fighter(atk=8, dfn=6, hp=20, max_hp=40, riders=frozenset({'mossback'}))
    d = fighter(atk=8, dfn=6, hp=40, max_hp=40)
    resolve_round(a, d, 'guard', 'guard', 1, FakeRng(uniform=1.0))  # stall, no dmg; a Guards
    assert a.hp == 23   # +3 regen
    a.hp = 39
    resolve_round(a, d, 'guard', 'guard', 2, FakeRng(uniform=1.0))
    assert a.hp == 40   # does not overheal past max


def test_venomtrick_applies_rot_on_feint_win():
    a = fighter(atk=10, dfn=5, hp=30, max_hp=30, riders=frozenset({'venomtrick'}))
    d = fighter(atk=10, dfn=5, hp=60, max_hp=60)
    resolve_round(a, d, 'feint', 'guard', 1, FakeRng(uniform=1.0))  # a's Feint wins
    assert d.rot_stacks == 1


def test_feint_win_sets_feint_won_flag():
    a = fighter(atk=10, dfn=5, hp=30, max_hp=30)
    d = fighter(atk=10, dfn=5, hp=60, max_hp=60)
    resolve_round(a, d, 'feint', 'guard', 1, FakeRng(uniform=1.0))  # a's Feint wins
    assert a.feint_won is True
    assert d.feint_won is False


def test_cutpurse_bonus_only_on_feint_win_and_victory():
    doc = {'gear': {'charm': 'cutpurse_charm'}}
    assert db.cutpurse_bonus(doc, feint_won=True, won=True) == data.CUTPURSE_SPORES
    assert db.cutpurse_bonus(doc, feint_won=False, won=True) == 0   # never landed a Feint
    assert db.cutpurse_bonus(doc, feint_won=True, won=False) == 0   # lost the fight
    assert db.cutpurse_bonus({'gear': {}}, feint_won=True, won=True) == 0  # no charm


# ── Tier-gated movement (tunnels) ─────────────────────────────────────────────

def test_blocked_node_is_never_a_destination_or_pass_through():
    # A---B---C linear; blocking B removes both B and everything beyond it.
    nodes = {
        'A': {'neighbors': ['B']},
        'B': {'neighbors': ['A', 'C']},
        'C': {'neighbors': ['B']},
    }
    assert legal_destinations(nodes, 'A', 1, blocked=frozenset({'B'})) == set()
    assert legal_destinations(nodes, 'A', 2, blocked=frozenset({'B'})) == set()
    # Without the block, B is reachable in 1 and C in 2.
    assert legal_destinations(nodes, 'A', 1) == {'B'}
    assert legal_destinations(nodes, 'A', 2) == {'C'}


def test_blocked_does_not_stop_you_leaving_a_blocked_start():
    # Standing ON a blocked node, you can still walk off it.
    nodes = {
        'A': {'neighbors': ['B']},
        'B': {'neighbors': ['A', 'C']},
        'C': {'neighbors': ['B']},
    }
    assert legal_destinations(nodes, 'B', 1, blocked=frozenset({'B'})) == {'A', 'C'}


def test_board_distance_respects_blocked():
    nodes = {
        'A': {'neighbors': ['B']},
        'B': {'neighbors': ['A', 'C']},
        'C': {'neighbors': ['B']},
    }
    assert board_distance(nodes, 'A', 'C', 5) == 2
    assert board_distance(nodes, 'A', 'C', 5, blocked=frozenset({'B'})) is None


def test_tunnel_nodes_are_the_ten_boundary_spurs():
    assert len(data.TUNNEL_NODES) == 10
    assert all(nid.startswith('t_') for nid in data.TUNNEL_NODES)
    assert all(data.MAP_NODES[nid]['type'] == 'tunnel' for nid in data.TUNNEL_NODES)


def test_tunnel_tier_max_is_one():
    assert data.TUNNEL_TIER_MAX == 1


def test_tunnel_toll_table():
    # Only Tier-2 has a toll entry. A tier absent from the table (Tier-3) is
    # too large to enter a bridge at all — see _blocked_nodes.
    assert data.TUNNEL_TOLL == {2: 50}


def test_tunnel_exits_cover_every_tunnel_with_a_biome_node():
    # Every tunnel node maps to a non-tunnel neighbour of its paired tunnel node.
    assert set(data.TUNNEL_EXITS) == set(data.TUNNEL_NODES)
    for nid, exit_node in data.TUNNEL_EXITS.items():
        assert data.MAP_NODES[exit_node]['type'] != 'tunnel'
        pair = next(x for x in data.MAP_NODES[nid]['neighbors']
                    if data.MAP_NODES[x]['type'] == 'tunnel')
        assert exit_node in data.MAP_NODES[pair]['neighbors']
    # Spot-check one known pair.
    assert data.TUNNEL_EXITS['t_cavern_bog0'] == 'bog_r1'
    assert data.TUNNEL_EXITS['t_cavern_bog1'] == 'cavern_r9'


# ── Balance regression: SPD no longer trivialises, DEF measurably mitigates ────
# (spec 2026-07-21 combat rebalance) — exercises resolve_round with smart-play.
import random as _bal_random

_BAL_CTR = {'guard': 'feint', 'aggress': 'guard', 'feint': 'aggress'}


def _fight_vs_gitrog(atk, dfn, spd, hp, read_chance, seeds=1500):
    """Smart-play a build against the Gitrog Monster (turtle, hp48/def7); return
    (win_rate, median_hp_taken)."""
    taken = []
    wins = 0
    for seed in range(seeds):
        rng = _bal_random.Random(seed)

        class R:
            uniform = staticmethod(lambda a, b: rng.uniform(a, b))
            random = staticmethod(rng.random)
            randint = staticmethod(rng.randint)
            choice = staticmethod(rng.choice)

        p = fighter(name='P', hp=hp, max_hp=hp, atk=atk, dfn=dfn, spd=spd)
        g = fighter(name='G', hp=48, max_hp=48, atk=12, dfn=7, spd=5)
        for rnd in range(1, 25):
            actual = pick_stance('turtle', R)
            shown = telegraph(actual, 0.35, R)
            ps = _BAL_CTR[shown] if R.random() < read_chance else 'feint'
            resolve_round(p, g, ps, actual, rnd, R, frenzy_from=data.FRENZY_START)
            if g.hp <= 0 or p.hp <= 0:
                wins += 1 if (g.hp <= 0 and p.hp > 0) else 0
                taken.append(hp - max(0, p.hp))
                break
        else:
            taken.append(hp - max(0, p.hp))
    taken.sort()
    return wins / seeds, taken[len(taken) // 2]


def test_spd_build_no_longer_trivialises_a_boss():
    rc = min(data.READ_MAX, data.READ_BASE + data.READ_SPD_COEFF * 15)
    _win, taken = _fight_vs_gitrog(8, 6, 15, 40, rc)
    # Used to take ~10 of 40 and win ~89%; now it must actually bleed.
    assert taken >= 16, f'SPD build only took {taken} — still too safe'


def test_def_measurably_reduces_damage_taken():
    rc = min(data.READ_MAX, data.READ_BASE + data.READ_SPD_COEFF * 5)
    _w_low, taken_low = _fight_vs_gitrog(8, 2, 5, 50, rc)
    _w_high, taken_high = _fight_vs_gitrog(8, 15, 5, 50, rc)
    # Same HP pool, same offense — armor must visibly lower HP lost.
    assert taken_high < taken_low, f'DEF did nothing: {taken_high} vs {taken_low}'
