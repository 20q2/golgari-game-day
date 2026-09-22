"""A player-derived foe must be drawn as that player's own creature.

The server builds the sprite descriptor (form/paint/hat/spriteVariant) into the
PvP clone and stores it in npcMeta, but historically never sent it to the
client, so every duel fell through to the `pets` paw-print icon.

Design: specs/2026-09-20-undercity-golgari-throne-design.md
Plan:   specs/2026-09-20-undercity-golgari-throne-plan-1.md
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import undercity_db as db
import undercity_data as data
from test_undercity_db import (  # noqa: F401
    table, act, _sid, _finish_started_battle)


def _duel_pair(table):
    """Two players on the same node, the target wearing a distinctive look."""
    act(table, 'join', starter='kraul', home='cavern')
    act(table, 'join', user='user-sam', name='Sam', starter='saproling',
        home='cavern')
    sid = _sid(table)
    alex = db._get_player(table, sid, 'user-alex')
    sam = db._get_player(table, sid, 'user-sam')
    alex['position'] = sam['position'] = 'city_r2'
    sam['paint'] = {'body': 200, 'belly': 40, 'stripes': 200}
    sam['hat'] = 'top_hat'
    sam['spriteVariant'] = 'saproling_2'
    db._put_player(table, alex)
    db._put_player(table, sam)
    return sid, alex, sam


def test_sprite_descriptor_is_empty_for_an_ordinary_npc():
    """Wild foes have art-folder PNGs, not creature descriptors. Returning {}
    keeps the payload clean rather than shipping four null keys everywhere."""
    assert db._sprite_descriptor(dict(data.ROT_SOVEREIGN)) == {}
    assert db._sprite_descriptor({}) == {}
    assert db._sprite_descriptor(None) == {}


def test_sprite_descriptor_copies_the_four_fields():
    npc = {'form': 'zombie', 'paint': {'body': 10}, 'hat': 'beanie',
           'spriteVariant': 'zombie_2'}
    assert db._sprite_descriptor(npc) == {
        'form': 'zombie', 'paint': {'body': 10}, 'hat': 'beanie',
        'spriteVariant': 'zombie_2'}


def test_sprite_descriptor_defaults_missing_paint_to_empty():
    """paint is indexed directly by the client recolor; None would throw."""
    assert db._sprite_descriptor({'form': 'pest'})['paint'] == {}


def test_battle_start_carries_the_targets_sprite(table):
    sid, _, sam = _duel_pair(table)

    status, resp = act(table, 'battle', targetUserId='user-sam')
    assert status == 200, resp

    npc = resp['spaceEvent']['npc']
    assert npc['form'] == sam['form']
    assert npc['paint'] == {'body': 200, 'belly': 40, 'stripes': 200}
    assert npc['hat'] == 'top_hat'
    assert npc['spriteVariant'] == 'saproling_2'


def test_battle_start_omits_the_descriptor_for_a_wild_foe(table):
    """A wild NPC must not gain empty descriptor keys — the client treats a
    present `form` as 'draw this as a creature'."""
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    npc = {'id': 'kraul_warrior', 'name': 'Kraul Warrior',
           'hp': 20, 'maxHp': 20, 'atk': 5, 'def': 3, 'spd': 4}
    # node=doc['position'] matches how the rest of the suite calls this — a
    # freshly joined player stands on their home gate, not an arbitrary node.
    ev = db._start_battle(table, sid, doc, 'wild', npc, node=doc['position'])
    assert 'form' not in ev['npc']


def test_resumed_duel_still_carries_the_sprite(table):
    """Reloading mid-duel rebuilds the fight from state.battle. That payload
    must carry the descriptor too, or a refresh swaps the opponent's creature
    for the paw print."""
    _duel_pair(table)
    act(table, 'battle', targetUserId='user-sam')

    status, state = db.handle_state(table, {'userId': 'user-alex'})
    assert status == 200, state

    npc = state['battle']['npc']
    assert npc['form'] == 'saproling'
    assert npc['paint'] == {'body': 200, 'belly': 40, 'stripes': 200}
    assert npc['hat'] == 'top_hat'
    assert npc['spriteVariant'] == 'saproling_2'


def test_duel_result_card_carries_the_sprite(table, monkeypatch):
    """The victory card is built from the finisher's out['npc']."""
    sid, _, _ = _duel_pair(table)
    act(table, 'battle', targetUserId='user-sam')

    alex = db._get_player(table, sid, 'user-alex')
    ev = _finish_started_battle(table, monkeypatch, alex, outcome='attacker')

    assert ev['type'] == 'pvp'
    assert ev['npc']['form'] == 'saproling'
    assert ev['npc']['hat'] == 'top_hat'
