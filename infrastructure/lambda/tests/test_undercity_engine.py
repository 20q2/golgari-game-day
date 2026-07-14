"""Unit tests for the pure Undercity rules engine (GDD §5–§8)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import undercity_data as data
from undercity_engine import (
    Combatant, resolve_battle, legal_destinations, roll_mystery,
    apply_level_ups, spend_stat, effective_stats, regen_hp, pick_npc,
    pvp_spore_steal,
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


def fighter(**kw):
    base = dict(name='X', hp=30, max_hp=30, atk=6, dfn=5, spd=5,
                passives=frozenset(), stance='fight', level=1)
    base.update(kw)
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


def test_spend_stat_caps_one_per_stat_per_level():
    p = {'statPoints': 2, 'atk': 6, 'def': 5, 'spd': 5,
         'spentThisLevel': {'atk': 0, 'def': 0, 'spd': 0}}
    assert spend_stat(p, 'atk')
    assert p['atk'] == 7 and p['statPoints'] == 1
    assert not spend_stat(p, 'atk')          # second point into same stat blocked
    assert spend_stat(p, 'spd')
    assert not spend_stat(p, 'def')          # no points left


# ── Movement ─────────────────────────────────────────────────────────────────

def test_exact_count_no_backtrack_on_loop():
    # From city_r0, two steps forward each way round the ring.
    dests = legal_destinations(data.MAP_NODES, 'city_r0', 2)
    assert dests == {'city_r2', 'city_r8'}


def test_fork_gives_multiple_choices():
    # city_r5 is the outward junction where the dungeon ladder (city_lt) leaves.
    dests = legal_destinations(data.MAP_NODES, 'city_r5', 1)
    assert dests == {'city_r4', 'city_r6', 'city_lt'}


def test_dead_end_paths_die_out():
    # Island chain: warp -> trade -> ossuary -> boss. Three steps lands on the
    # boss; a fourth dies out because boss is a dead end with no backtracking.
    assert legal_destinations(data.MAP_NODES, 'isl_warp', 3) == {'boss'}
    assert legal_destinations(data.MAP_NODES, 'isl_warp', 4) == set()


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

def test_faster_side_strikes_first():
    a = fighter(name='A', spd=3, atk=10, dfn=0, hp=8, max_hp=8)
    b = fighter(name='B', spd=9, atk=10, dfn=0, hp=8, max_hp=8)
    r = resolve_battle(a, b, FakeRng())
    # B is faster: kills A before A ever swings.
    assert r['outcome'] == 'defender'
    assert r['strikes'][0]['by'] == 'defender'
    assert len([s for s in r['strikes'] if s['by'] == 'attacker']) == 0


def test_first_bite_overrides_round_one():
    a = fighter(name='A', spd=3, atk=10, dfn=0, hp=8, max_hp=8,
                passives=frozenset({'first_bite'}))
    b = fighter(name='B', spd=9, atk=10, dfn=0, hp=8, max_hp=8)
    r = resolve_battle(a, b, FakeRng())
    assert r['strikes'][0]['by'] == 'attacker'
    assert r['outcome'] == 'attacker'


def test_damage_floor_and_timeout():
    a = fighter(name='A', atk=3, dfn=50, hp=40, max_hp=40)
    b = fighter(name='B', atk=3, dfn=50, hp=40, max_hp=40)
    r = resolve_battle(a, b, FakeRng())
    assert all(s['dmg'] == 1 for s in r['strikes'] if not s.get('miss'))
    assert r['outcome'] == 'timeout'
    assert len({s['round'] for s in r['strikes']}) == 6


def test_defend_stance_reduces_damage_both_ways():
    # Attacker atk 10 vs def 5: normally 5 dmg; defend => def 7 (5*1.4) → 3 dmg.
    a = fighter(name='A', atk=10, dfn=0, spd=9, hp=100, max_hp=100)
    b = fighter(name='B', atk=10, dfn=5, spd=1, hp=100, max_hp=100, stance='defend')
    r = resolve_battle(a, b, FakeRng())
    first_a = next(s for s in r['strikes'] if s['by'] == 'attacker')
    assert first_a['dmg'] == 3
    # Defender deals -25%: atk 10 vs def 0 = 10 → 8 (round 7.5).
    first_b = next(s for s in r['strikes'] if s['by'] == 'defender')
    assert first_b['dmg'] == 8


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


def test_swarm_grants_extra_strike():
    a = fighter(name='A', atk=3, dfn=50, hp=40, max_hp=40,
                passives=frozenset({'swarm'}))
    b = fighter(name='B', atk=3, dfn=50, hp=40, max_hp=40)
    r = resolve_battle(a, b, FakeRng())
    round1 = [s for s in r['strikes'] if s['round'] == 1]
    assert len([s for s in round1 if s['by'] == 'attacker']) == 2
    assert len([s for s in round1 if s['by'] == 'defender']) == 1


def test_deathtouch_stomp_ignores_def():
    a = fighter(name='A', atk=6, dfn=0, spd=9, hp=100, max_hp=100,
                passives=frozenset({'deathtouch_stomp'}))
    b = fighter(name='B', atk=1, dfn=5, spd=1, hp=100, max_hp=100)
    r = resolve_battle(a, b, FakeRng())
    first = next(s for s in r['strikes'] if s['by'] == 'attacker')
    assert first['dmg'] == 4  # 6 - (5-3)


def test_drain_life_heals():
    a = fighter(name='A', atk=10, dfn=0, spd=9, hp=50, max_hp=100,
                passives=frozenset({'drain_life'}))
    b = fighter(name='B', atk=1, dfn=0, spd=1, hp=100, max_hp=100)
    r = resolve_battle(a, b, FakeRng())
    # A dealt 10 per strike, healing 5 each time; ended above starting HP.
    assert r['attackerHp'] > 50 - 6  # took chip damage but healed more
    heals = [s for s in r['strikes'] if s['by'] == 'attacker' and s.get('heal')]
    assert heals and heals[0]['heal'] == 5


def test_venom_barb_first_strike_bonus():
    a = fighter(name='A', atk=6, dfn=0, spd=9, hp=100, max_hp=100,
                passives=frozenset({'venom_barb'}))
    b = fighter(name='B', atk=1, dfn=0, spd=1, hp=100, max_hp=100)
    r = resolve_battle(a, b, FakeRng())
    a_strikes = [s for s in r['strikes'] if s['by'] == 'attacker']
    assert a_strikes[0]['dmg'] == 9  # 6 + 3
    assert a_strikes[1]['dmg'] == 6


def test_rot_breath_doubles_round_one():
    a = fighter(name='A', atk=6, dfn=0, spd=9, hp=100, max_hp=100,
                passives=frozenset({'rot_breath'}))
    b = fighter(name='B', atk=1, dfn=0, spd=1, hp=100, max_hp=100)
    r = resolve_battle(a, b, FakeRng())
    a_strikes = [s for s in r['strikes'] if s['by'] == 'attacker']
    assert a_strikes[0]['dmg'] == 12
    assert a_strikes[1]['dmg'] == 6


def test_scavenge_retaliates():
    a = fighter(name='A', atk=10, dfn=0, spd=9, hp=100, max_hp=100)
    b = fighter(name='B', atk=1, dfn=0, spd=1, hp=100, max_hp=100,
                passives=frozenset({'scavenge'}))
    r = resolve_battle(a, b, FakeRng())
    retaliations = [s for s in r['strikes'] if s.get('retaliation')]
    assert retaliations and retaliations[0]['dmg'] == 2
    assert retaliations[0]['by'] == 'defender'


def test_regrowth_heals_survivor_after_battle():
    a = fighter(name='A', atk=10, dfn=0, spd=9, hp=100, max_hp=100,
                passives=frozenset({'regrowth'}))
    b = fighter(name='B', atk=5, dfn=0, spd=1, hp=6, max_hp=100)
    r = resolve_battle(a, b, FakeRng())
    assert r['outcome'] == 'attacker'
    assert r['attackerHp'] == 100  # 20% max heal tops it back up past the chip

def test_rootwall_upgrades_regrowth():
    a = fighter(name='A', atk=10, dfn=0, spd=9, hp=60, max_hp=100,
                passives=frozenset({'regrowth', 'rootwall'}))
    b = fighter(name='B', atk=1, dfn=50, spd=1, hp=6, max_hp=100)
    r = resolve_battle(a, b, FakeRng())
    # never damaged (def 50 → min 1... actually b atk 1 vs a def 0 = 1/round)
    # a took ≤6 chip; heal is 35 → capped at 100
    assert r['attackerHp'] >= 89


# ── Spore theft ──────────────────────────────────────────────────────────────

def test_pvp_spore_steal():
    assert pvp_spore_steal(100, 'fight', frozenset()) == 25
    assert pvp_spore_steal(100, 'defend', frozenset()) == 10
    assert pvp_spore_steal(100, 'fight', frozenset({'deathrite'})) == 37


# ── Regen ────────────────────────────────────────────────────────────────────

def test_regen_ten_percent_per_ten_minutes():
    p = {'hp': 10, 'maxHp': 50, 'hpUpdatedAt': '2026-07-06T20:00:00'}
    regen_hp(p, '2026-07-06T20:25:00')
    assert p['hp'] == 20  # two full intervals × 5 HP
    assert p['hpUpdatedAt'] == '2026-07-06T20:20:00'


def test_regen_caps_at_max():
    p = {'hp': 49, 'maxHp': 50, 'hpUpdatedAt': '2026-07-06T20:00:00'}
    regen_hp(p, '2026-07-06T23:00:00')
    assert p['hp'] == 50


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


# ── NPCs ─────────────────────────────────────────────────────────────────────

def test_npc_fixed_stats():
    npc = pick_npc(FakeRng())              # FakeRng.choice -> first pool entry
    assert npc == {'id': 'drudge_beetle', 'name': 'Drudge Beetle',
                   'hp': 16, 'atk': 4, 'def': 1, 'spd': 4,
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
    p = {'level': 8, 'pvpWins': 3, 'wildWins': 7, 'spores': 52, 'bossDamage': 45}
    assert data.compute_renown(p) == 80 + 45 + 21 + 10 + 4


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


def test_level7_kills_every_lair_boss_within_the_cap():
    for lair, spec in data.LAIR_BOSSES.items():
        out = resolve_battle(_ref(7), _foe(spec), FakeRng())
        assert out['outcome'] == 'attacker', lair


def test_guardians_fall_at_their_target_levels():
    east = resolve_battle(_ref(5), _foe(data.BARRIER_GUARDIANS['bar_e']), FakeRng())
    south = resolve_battle(_ref(6), _foe(data.BARRIER_GUARDIANS['bar_s']), FakeRng())
    assert east['outcome'] == 'attacker'
    assert south['outcome'] == 'attacker'


def test_level1_beats_every_normal_wild():
    for spec in data.NPCS:
        out = resolve_battle(_ref(1), _foe(spec), FakeRng())
        assert out['outcome'] == 'attacker', spec['id']


def test_level1_loses_to_elites():
    for spec in data.ELITE_NPCS:
        out = resolve_battle(_ref(1), _foe(spec), FakeRng())
        assert out['outcome'] == 'defender', spec['id']


def test_level5_beats_every_elite_taking_chip_damage():
    for spec in data.ELITE_NPCS:
        me = _ref(5)
        out = resolve_battle(me, _foe(spec), FakeRng())
        assert out['outcome'] == 'attacker', spec['id']
        assert out['attackerHp'] >= me.max_hp - 8, spec['id']


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


from undercity_engine import resolve_round


def test_round_aggress_beats_feint_full_punish():
    # uniform=1.0 so hit = round(atk*1.0) - def; atk10 vs def4 => 6, *WIN 1.5 => 9
    a = fighter(atk=10, dfn=5, spd=5)
    d = fighter(atk=10, dfn=4, spd=5, hp=30, max_hp=30)
    rng = FakeRng(uniform=1.0)
    entries = resolve_round(a, d, 'aggress', 'feint', 1, rng)
    assert d.hp == 30 - round(6 * data.STANCE_WIN_MULT)   # 30 - 9 = 21
    assert a.hp == 30                                       # feinter dealt nothing
    assert any(e.get('winner') == 'attacker' for e in entries)


def test_round_guard_beats_aggress_mitigate_and_counter():
    a = fighter(atk=10, dfn=5, spd=5, hp=30, max_hp=30)   # aggressor
    d = fighter(atk=10, dfn=5, spd=5, hp=30, max_hp=30)   # guard
    rng = FakeRng(uniform=1.0)
    resolve_round(a, d, 'aggress', 'guard', 1, rng)
    # aggressor hit 10-5=5, mitigated *0.4 => 2 to guard
    assert d.hp == 30 - round(5 * data.STANCE_GUARD_MITIGATE)  # 30 - 2 = 28
    # guard counters 10-5=5 *0.6 => 3 to aggressor
    assert a.hp == 30 - round(5 * data.STANCE_GUARD_COUNTER)   # 30 - 3 = 27


def test_round_clash_both_take_full():
    a = fighter(atk=10, dfn=5, hp=30, max_hp=30, spd=6)
    d = fighter(atk=10, dfn=5, hp=30, max_hp=30, spd=5)
    rng = FakeRng(uniform=1.0)
    resolve_round(a, d, 'aggress', 'aggress', 1, rng)
    assert a.hp == 25 and d.hp == 25   # both 10-5=5 full


def test_round_whiff_nobody_hit():
    a = fighter(hp=30, max_hp=30); d = fighter(hp=30, max_hp=30)
    resolve_round(a, d, 'feint', 'feint', 1, FakeRng(uniform=1.0))
    assert a.hp == 30 and d.hp == 30


def test_swarm_adds_chip_each_round():
    a = fighter(atk=10, dfn=5, hp=30, max_hp=30, passives=frozenset({'swarm'}))
    d = fighter(atk=10, dfn=5, hp=30, max_hp=30)
    resolve_round(a, d, 'feint', 'feint', 1, FakeRng(uniform=1.0))  # whiff
    # whiff deals nothing, but swarm chips: round(5*0.5)=2
    assert d.hp == 28


def test_rot_stacks_tick_end_of_round():
    a = fighter(hp=30, max_hp=30); d = fighter(hp=30, max_hp=30)
    d.rot_stacks = 2
    resolve_round(a, d, 'feint', 'feint', 1, FakeRng(uniform=1.0))
    assert d.hp == 30 - 2 * data.ROT_PER_STACK  # 30 - 4 = 26
