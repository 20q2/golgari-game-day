"""Smoke tests for the directive sim (design 2026-07-26): every directive plays a
full game without error, the interactive-space hooks actually fire, RushBoss can
reach its sigils, and the legacy (no-directive) path still works."""
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sim.driver import play_game, Build, GameResult
from sim.bots import (Rusher, Tank, ALL_DIRECTIVES, Balanced, RushBoss,
                      FarmMobs, Explorer)


def test_every_directive_completes_a_game():
    for name, D in ALL_DIRECTIVES.items():
        r = play_game(Build('pest', 'city'), Rusher, seed=5, max_turns=60, directive=D)
        assert isinstance(r, GameResult), name
        assert r.turns > 0 and r.directive == name


def test_interactive_hooks_fire():
    """Explorer chases and plays the reward spaces; across a few seeds it should
    dig sites out and hit at least one other interactive space — guards against a
    handler contract silently changing and every dispatch no-op'ing."""
    agg = Counter()
    for s in range(5):
        r = play_game(Build('pest', 'city'), Rusher, s, max_turns=160, directive=Explorer)
        agg.update(r.spaces)
    assert agg.get('dig', 0) > 0, agg
    assert (agg.get('vein', 0) + agg.get('vault', 0) + agg.get('gamble', 0)) > 0, agg


def test_farmmobs_crosses_ladders_and_fights():
    r = play_game(Build('pest', 'city'), Tank, seed=3, max_turns=160, directive=FarmMobs)
    assert len(r.fights) > 5                      # it grinds mobs
    assert r.spaces.get('ladder', 0) >= 1         # and descends via ladders


def test_rushboss_can_earn_a_sigil():
    best = 0
    for s in (7, 11, 15):
        r = play_game(Build('pest', 'city'), Tank, s, max_turns=200, directive=RushBoss)
        last = r.trajectory[-1] if r.trajectory else {}
        best = max(best, last.get('sigils', 0))
    assert best >= 1                              # reaches & clears sigil lairs


def test_legacy_no_directive_still_plays():
    r = play_game(Build('pest', 'city'), Rusher, seed=1, max_turns=40)   # 3-arg legacy call
    assert isinstance(r, GameResult)
    assert r.turns > 0 and r.directive == 'none'
