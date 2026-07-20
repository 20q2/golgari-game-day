"""Deep sigil dungeon feature: torch, rest, trove, depths respawn."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import undercity_data as data
import undercity_db as db
import undercity_engine as engine
from tests.test_undercity_db import act, table, _sid  # reuse harness + fixture


def _join(t, **kw):
    kw.setdefault('starter', 'pest')
    act(t, 'join', **kw)
    return db._get_player(t, _sid(t), 'user-alex')


def test_torch_toggle_applies_combat_penalty(table):
    doc = _join(table)
    base = engine.effective_stats(doc)
    status, resp = act(table, 'toggle-torch')
    assert status == 200
    assert resp['you']['torchLit'] is True
    lit = engine.effective_stats(db._get_player(table, _sid(table), 'user-alex'))
    assert lit['atk'] == base['atk'] + data.TORCH['atk']   # atk is negative
    assert lit['def'] == base['def'] + data.TORCH['def']
    # Toggling again douses it, restoring stats.
    status, resp = act(table, 'toggle-torch')
    assert resp['you']['torchLit'] is False
    restored = engine.effective_stats(db._get_player(table, _sid(table), 'user-alex'))
    assert restored['atk'] == base['atk']


def test_torch_penalty_floors_at_one(table):
    doc = _join(table)
    doc['atk'] = 1
    doc['def'] = 1
    db._put_player(table, doc)
    act(table, 'toggle-torch')
    lit = engine.effective_stats(db._get_player(table, _sid(table), 'user-alex'))
    assert lit['atk'] >= 1 and lit['def'] >= 1


def test_rest_heals_once_per_descent(table):
    doc = _join(table)
    eff = engine.effective_stats(doc)
    doc['hp'] = 5
    doc['restsUsed'] = []
    db._put_player(table, doc)
    ev = db._rest(table, _sid(table), doc, 'city_rest')
    assert ev['type'] == 'rest'
    assert doc['hp'] == eff['maxHp']            # healed to full
    assert 'city_rest' in doc['restsUsed']
    # Second visit this descent: no heal.
    doc['hp'] = 5
    ev2 = db._rest(table, _sid(table), doc, 'city_rest')
    assert doc['hp'] == 5
    assert 'already' in ev2['text'].lower()


def test_leaving_depths_resets_rest(table):
    doc = _join(table)
    doc['restsUsed'] = ['city_rest']
    db._put_player(table, doc)
    # Landing on a surface (non-depths) node clears the per-descent record.
    surface = next(n for n, spec in data.MAP_NODES.items()
                   if spec.get('region') == 'city' and spec['type'] == 'loot')
    db._resolve_space(table, _sid(table), doc, surface, None)
    assert doc.get('restsUsed', []) == []
