"""Unit tests for the pure Undercity rules engine (GDD §5–§8)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import undercity_data as data
from undercity_engine import (
    Combatant, resolve_battle, legal_destinations, roll_mystery,
    apply_level_ups, spend_stat, effective_stats, regen_hp, regen_rolls, pick_npc,
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
    # the caught feinter still pokes back for chip (5 * 0.15 -> 1)
    assert a.hp == 30 - round(5 * data.STANCE_STALL_MULT)
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
    assert a.hp == 30 and d.hp == 30   # atk6-def5 chip rounds to 0


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
    # whiff chips each for round(5*0.15)=1; swarm adds round(5*0.5)=2 onto d
    assert d.hp == 27 and a.hp == 29


def test_rot_stacks_tick_end_of_round():
    a = fighter(hp=30, max_hp=30); d = fighter(hp=30, max_hp=30)
    d.rot_stacks = 2
    resolve_round(a, d, 'feint', 'feint', 1, FakeRng(uniform=1.0))
    assert d.hp == 30 - 2 * data.ROT_PER_STACK  # 30 - 4 = 26


def test_venom_barb_first_win_bonus_once():
    a = fighter(atk=10, dfn=5, hp=30, max_hp=30, passives=frozenset({'venom_barb'}))
    d = fighter(atk=10, dfn=4, hp=60, max_hp=60)
    rng = FakeRng(uniform=1.0)
    resolve_round(a, d, 'aggress', 'feint', 1, rng)   # win: 6*1.5=9 +3 =12
    assert d.hp == 60 - (round(6 * data.STANCE_WIN_MULT) + data.VENOM_BARB_BONUS)
    assert a.first_win_used
    hp_after_first = d.hp
    resolve_round(a, d, 'aggress', 'feint', 2, rng)   # no bonus second time: 9
    assert d.hp == hp_after_first - round(6 * data.STANCE_WIN_MULT)


def test_rot_breath_first_win_doubles():
    a = fighter(atk=10, dfn=5, hp=30, max_hp=30, passives=frozenset({'rot_breath'}))
    d = fighter(atk=10, dfn=4, hp=60, max_hp=60)
    resolve_round(a, d, 'feint', 'guard', 1, FakeRng(uniform=1.0))  # feint>guard win
    # base 6*1.5=9, *2 => 18
    assert d.hp == 60 - round(6 * data.STANCE_WIN_MULT) * data.FIRST_WIN_ROT_BREATH_MULT


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
    dmg = round(6 * data.STANCE_WIN_MULT)   # 9
    assert d.hp == 60 - dmg
    # healed 50% of damage dealt, minus the feinter's chip-back (1)
    assert a.hp == 20 + round(dmg * 0.5) - round(5 * data.STANCE_STALL_MULT)


def test_force_winner_overrides_triangle():
    a = fighter(atk=10, dfn=5, hp=30, max_hp=30)
    d = fighter(atk=10, dfn=4, hp=30, max_hp=30)
    # both feint => normally a whiff. Force attacker to win: a lands the decisive
    # hit; the caught feinter (d) still pokes a for chip (5 * 0.15 -> 1).
    resolve_round(a, d, 'feint', 'feint', 1, FakeRng(uniform=1.0),
                  force_winner='attacker')
    assert d.hp == 30 - round(6 * data.STANCE_WIN_MULT)
    assert a.hp == 30 - round(5 * data.STANCE_STALL_MULT)


def test_double_win_for_doubles_winner_damage():
    a = fighter(atk=10, dfn=5, hp=30, max_hp=30)
    d = fighter(atk=10, dfn=4, hp=60, max_hp=60)
    resolve_round(a, d, 'aggress', 'feint', 1, FakeRng(uniform=1.0),
                  double_win_for='attacker')
    assert d.hp == 60 - round(6 * data.STANCE_WIN_MULT) * 2   # 9 -> 18


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


def test_deathtouch_aggress_pierces_def():
    a = fighter(atk=10, dfn=5, hp=30, max_hp=30, passives=frozenset({'deathtouch_stomp'}))
    d = fighter(atk=10, dfn=8, hp=60, max_hp=60)
    resolve_round(a, d, 'aggress', 'feint', 1, FakeRng(uniform=1.0))
    # pierce 3 => eff def 5; hit 10-5=5 *1.5 => round(7.5)=8
    assert d.hp == 60 - round((10 - (8 - data.DEATHTOUCH_PIERCE)) * data.STANCE_WIN_MULT)


def test_first_bite_wins_clash_order():
    a = fighter(atk=10, dfn=0, hp=6, max_hp=6, spd=1, passives=frozenset({'first_bite'}))
    d = fighter(atk=10, dfn=0, hp=30, max_hp=30, spd=9)  # faster, but...
    resolve_round(a, d, 'aggress', 'aggress', 1, FakeRng(uniform=1.0))
    # first_bite makes A strike first; A deals 10 -> d.hp 20; then d strikes back
    assert d.hp == 20


def test_barbed_aggress_applies_rot_even_on_loss():
    a = fighter(atk=10, dfn=5, hp=30, max_hp=30, riders=frozenset({'barbed'}))
    d = fighter(atk=10, dfn=5, hp=30, max_hp=30)
    resolve_round(a, d, 'aggress', 'guard', 1, FakeRng(uniform=1.0))  # a loses (G>A)
    assert d.rot_stacks == 1   # rot applied despite losing the exchange


def test_deep_biter_boosts_winning_hit():
    a = fighter(atk=10, dfn=5, hp=30, max_hp=30, riders=frozenset({'deep_biter'}))
    d = fighter(atk=10, dfn=4, hp=60, max_hp=60)
    resolve_round(a, d, 'aggress', 'feint', 1, FakeRng(uniform=1.0))
    # 6 * (1.5+0.5) = 12
    assert d.hp == 60 - round(6 * (data.STANCE_WIN_MULT + 0.5))


def test_spiked_boosts_guard_counter():
    a = fighter(atk=10, dfn=5, hp=30, max_hp=30)                        # aggressor
    d = fighter(atk=10, dfn=5, hp=30, max_hp=30, riders=frozenset({'spiked'}))
    resolve_round(a, d, 'aggress', 'guard', 1, FakeRng(uniform=1.0))
    # counter 5*0.6=3, spiked *1.5 => round(4.5)=4
    assert a.hp == 30 - round(5 * data.STANCE_GUARD_COUNTER * 1.5)


def test_trickster_halves_lost_feint_punish():
    a = fighter(atk=10, dfn=5, hp=30, max_hp=30)                        # aggressor wins
    d = fighter(atk=10, dfn=5, hp=30, max_hp=30, riders=frozenset({'trickster'}))
    resolve_round(a, d, 'aggress', 'feint', 1, FakeRng(uniform=1.0))
    # normal punish 5*1.5=8 (round 7.5->8), halved => 4
    assert d.hp == 30 - round(round(5 * data.STANCE_WIN_MULT) / 2)


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
    # d took mitigated 5*0.4=2 (->18) then heals 3 (->21)
    assert d.hp == 20 - round(5 * data.STANCE_GUARD_MITIGATE) + 3


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


def test_runner_timeout_higher_hp_pct_wins():
    a = fighter(atk=1, dfn=99, hp=40, max_hp=40)   # nobody can hurt anybody
    d = fighter(atk=1, dfn=99, hp=10, max_hp=40)
    res = resolve_battle_rounds(a, d, FakeRng(uniform=1.0),
                                _always('guard'), _always('guard'))
    assert res['outcome'] == 'attacker'   # 100% vs 25% HP


def test_resolve_battle_backcompat_maps_legacy_stance():
    a = fighter(atk=12, dfn=5, hp=40, max_hp=40, stance='fight')
    d = fighter(atk=6, dfn=5, hp=18, max_hp=18, stance='defend')
    res = resolve_battle(a, d, FakeRng(uniform=1.0))
    assert res['outcome'] in ('attacker', 'defender', 'timeout')
    assert 'strikes' in res and 'attackerHp' in res


def test_resolve_battle_flee_stance_routes_to_flee_attempt():
    a = fighter(atk=12, dfn=5, hp=40, max_hp=40, stance='fight')
    d = fighter(atk=6, dfn=5, hp=18, max_hp=18, spd=9, stance='flee')
    res = resolve_battle(a, d, FakeRng(randoms=[0.10], uniform=1.0))
    assert res['outcome'] == 'fled'
