"""The Queen's Awakening finale — Savra as a personal trial.

Design: specs/2026-08-11-undercity-queens-awakening-design.md
Plan:   specs/2026-08-11-undercity-queens-awakening-plan-1.md
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import undercity_db as db
import undercity_data as data
import undercity_config as config
from test_undercity_db import (  # noqa: F401
    table, act, _sid, _finish_started_battle)


def _at_boss(table, sid, user='user-alex'):
    """A player standing on the boss node with the gate already open."""
    doc = db._get_player(table, sid, user)
    doc['position'] = 'boss'
    return doc


def test_every_challenger_faces_a_full_hp_queen(table, monkeypatch):
    """Personal trial: damage never persists between attempts or between
    players. One fight decides it."""
    act(table, 'join', starter='pest')
    act(table, 'boss-awaken', hostKey='swampking')
    sid, _ = db._active_season(table)
    full = data.ROT_SOVEREIGN['hp']

    # First attempt: the player dies, leaving her badly wounded.
    doc = _at_boss(table, sid)
    ev = db._boss(table, sid, doc, 'boss', 'isl_ossuary')
    assert ev['npc']['hp'] == full
    _finish_started_battle(table, monkeypatch, doc, 'defender', defender_hp=12)

    # Second attempt by the SAME player: she is whole again.
    doc = _at_boss(table, sid)
    ev2 = db._boss(table, sid, doc, 'boss', 'isl_ossuary')
    assert ev2['npc']['hp'] == full, 'damage must not carry between attempts'

    # And for a different player.
    act(table, 'join', user='user-bea', name='Bea', starter='kraul')
    doc_b = _at_boss(table, sid, 'user-bea')
    ev3 = db._boss(table, sid, doc_b, 'boss', 'isl_ossuary')
    assert ev3['npc']['hp'] == full, 'damage must not carry between players'


def test_the_queen_cannot_be_struck_from_afar(table):
    """One fight decides it, so ranged chipping and the lethal snipe are both
    refused for Savra. Lair pools are unaffected — they are still shared."""
    act(table, 'join', starter='pest')
    sid, _ = db._active_season(table)
    doc = db._get_player(table, sid, 'user-alex')

    ordinary = {'name': 'Ember Fleck', 'dmg': 8}
    status, body = db._cast_boss_strike(table, sid, doc, ordinary, 'boss')
    assert status == 409, body
    assert doc.get('bossDamage', 0) == 0

    lethal = {'name': 'Sear the Throne', 'dmg': 9999, 'lethal': True}
    status, body = db._cast_boss_strike(table, sid, doc, lethal, 'boss')
    assert status == 409, body
    assert 'boss' not in (doc.get('poiClaims') or []), 'no sniping the crown'


def test_curses_still_land_on_the_queen(table):
    """Ranged DAMAGE is refused, but a field curse still settles on her and is
    read at her next battle — so softening her for a challenger still works."""
    act(table, 'join', starter='pest')
    act(table, 'boss-awaken', hostKey='swampking')
    sid, _ = db._active_season(table)
    db._set_boss_buffs(table, sid, [{'kind': 'bone_chill'}])
    assert db._boss_buffs(table, sid) == [{'kind': 'bone_chill'}]

    doc = _at_boss(table, sid)
    ev = db._boss(table, sid, doc, 'boss', 'isl_ossuary')
    assert ev['npc']['hp'] == data.ROT_SOVEREIGN['hp']   # still whole...
    assert db._boss_buffs(table, sid) == []              # ...and the curse was spent


def _slay(table, sid, monkeypatch, user='user-alex', name='Alex'):
    doc = db._get_player(table, sid, user)
    doc['position'] = 'boss'
    db._boss(table, sid, doc, 'boss', 'isl_ossuary')
    return _finish_started_battle(table, monkeypatch, doc, 'attacker',
                                  user=user, name=name)


def test_first_kill_takes_the_crown_and_only_the_first(table, monkeypatch):
    """Exactly one Queenslayer per season. Later winners still get the kill."""
    act(table, 'join', starter='pest')
    act(table, 'join', user='user-bea', name='Bea', starter='kraul')
    act(table, 'boss-awaken', hostKey='swampking')
    sid, _ = db._active_season(table)

    first = _slay(table, sid, monkeypatch, 'user-alex', 'Alex')
    assert first['queenslayer'] is True
    assert db._finale(table, sid)['slayer'] == 'user-alex'
    perm = db._get_perm(table, 'user-alex')
    assert perm['renown'] >= config.QUEENSLAYER_RENOWN

    second = _slay(table, sid, monkeypatch, 'user-bea', 'Bea')
    assert second.get('queenslayer') is not True, 'the crown is claimed once'
    assert db._finale(table, sid)['slayer'] == 'user-alex', 'and never reassigned'
    assert second.get('spores'), 'a later kill is still a real reward'


def test_the_crown_fires_a_world_xp_buff_for_everyone(table, monkeypatch):
    """Identical buff for every player, no scaling. It self-targets because a
    capped creature has nothing to spend XP on."""
    act(table, 'join', starter='pest')
    act(table, 'join', user='user-bea', name='Bea', starter='kraul')
    act(table, 'boss-awaken', hostKey='swampking')
    sid, _ = db._active_season(table)

    assert db._xp_multiplier(table, sid) == 1.0
    _slay(table, sid, monkeypatch, 'user-alex', 'Alex')
    assert db._xp_multiplier(table, sid) == 1 + config.AWAKENING_XP_BUFF

    # A bystander who never touched the Queen earns the boosted rate. Measured
    # on metrics.xpGained: raw `xp` is drained by level-ups as it is awarded.
    bea = db._get_player(table, sid, 'user-bea')
    before = (bea.get('metrics') or {}).get('xpGained', 0)
    db._grant_xp(table, sid, bea, 100)
    gained = bea['metrics']['xpGained'] - before
    assert gained == round(100 * (1 + config.AWAKENING_XP_BUFF))


def test_the_buff_is_worthless_at_the_level_cap(table, monkeypatch):
    """The self-targeting property: it must give a capped creature nothing,
    which is what makes it a leg-up rather than a handicap on the leader."""
    act(table, 'join', starter='pest')
    act(table, 'boss-awaken', hostKey='swampking')
    sid, _ = db._active_season(table)
    _slay(table, sid, monkeypatch, 'user-alex', 'Alex')

    doc = db._get_player(table, sid, 'user-alex')
    doc['level'] = data.LEVEL_CAP
    before_level = doc['level']
    db._grant_xp(table, sid, doc, 500)
    assert doc['level'] == before_level, 'a capped creature gains nothing usable'


def test_finale_state_is_visible_and_exported(table, monkeypatch):
    """The client needs to show the buff; the host export must record who took
    the crown, or the next session cannot measure any of this."""
    act(table, 'join', starter='pest')
    act(table, 'boss-awaken', hostKey='swampking')
    sid, _ = db._active_season(table)

    status, state = db.handle_state(table, {'userId': 'user-alex'})
    assert state['finale'] == {'slayer': None, 'slayerName': None, 'xpBonus': 0.0}

    _slay(table, sid, monkeypatch, 'user-alex', 'Alex')
    status, state = db.handle_state(table, {'userId': 'user-alex'})
    assert state['finale']['slayerName'] == 'Alex'
    assert state['finale']['xpBonus'] == config.AWAKENING_XP_BUFF

    _, out = act(table, 'admin', hostKey='swampking', cmd='export')
    assert out['finale']['slayer'] == 'user-alex'


# ── The Awakening: release + the Scouring Swarm ──────────────────────────────

def test_third_sigil_fires_the_awakening_and_opens_the_gates_for_all(table):
    """The first player to hold SIGILS_REQUIRED sigils starts the endgame for
    EVERYONE — sigils stop being a personal turnstile. One-way for the night."""
    act(table, 'join', starter='pest')
    act(table, 'join', user='user-bea', name='Bea', starter='kraul')
    sid, _ = db._active_season(table)
    assert db._awakened(table, sid) is False

    alex = db._get_player(table, sid, 'user-alex')
    alex['poiClaims'] = sorted(data.SIGIL_LAIRS)[:data.SIGILS_REQUIRED]
    db._maybe_awaken(table, sid, alex)
    assert db._awakened(table, sid) is True

    # Bea has no sigils at all, yet the island admits her.
    bea = db._get_player(table, sid, 'user-bea')
    bea['position'] = 'boss'
    ev = db._boss(table, sid, bea, 'boss', 'isl_ossuary')
    assert ev['type'] == 'battle_start', 'the rot-wards fell for everyone'


def test_the_release_seeds_a_swarm_within_reach_of_every_player(table):
    """The load-bearing rule: nobody is too far behind to join the finale."""
    act(table, 'join', starter='pest')
    act(table, 'join', user='user-bea', name='Bea', starter='kraul')
    sid, _ = db._active_season(table)
    nodes = db._season_map(table, sid)

    alex = db._get_player(table, sid, 'user-alex')
    alex['poiClaims'] = sorted(data.SIGIL_LAIRS)[:data.SIGILS_REQUIRED]
    db._maybe_awaken(table, sid, alex)

    swarms = db._swarm_nodes(table, sid)
    assert swarms, 'the brood is released with the Awakening'
    for user in ('user-alex', 'user-bea'):
        doc = db._get_player(table, sid, user)
        near = [n for n in swarms
                if db.engine.board_distance(nodes, doc['position'], n,
                                            data.SWARM_SEED_RADIUS, set()) is not None]
        assert near, f'{user} has no swarm in reach'


def test_the_swarm_copies_itself_but_respects_its_ceiling(table):
    """It multiplies on its window — that is the pressure to go finish the
    Queen — but never saturates the board."""
    act(table, 'join', starter='pest')
    sid, _ = db._active_season(table)
    alex = db._get_player(table, sid, 'user-alex')
    alex['poiClaims'] = sorted(data.SIGIL_LAIRS)[:data.SIGILS_REQUIRED]
    db._maybe_awaken(table, sid, alex)

    before = len(db._swarm_nodes(table, sid))
    db._split_swarm(table, sid)
    assert len(db._swarm_nodes(table, sid)) > before, 'the brood copies itself'

    for _ in range(40):
        db._split_swarm(table, sid)
    assert len(db._swarm_nodes(table, sid)) <= data.SWARM_MAX_NODES


def test_landing_on_a_swarm_fights_it_and_the_kill_clears_the_node(table, monkeypatch):
    """A swarm overrides the tile's normal event. Felling it consumes that node —
    the brood only grows back through its split window."""
    act(table, 'join', starter='pest')
    sid, _ = db._active_season(table)
    alex = db._get_player(table, sid, 'user-alex')
    alex['poiClaims'] = sorted(data.SIGIL_LAIRS)[:data.SIGILS_REQUIRED]
    db._maybe_awaken(table, sid, alex)

    node = db._swarm_nodes(table, sid)[0]
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = node
    ev = db._resolve_space(table, sid, doc, node, prev=None)
    assert ev['type'] == 'battle_start' and ev['kind'] == 'swarm'
    assert ev['npc']['name'] == data.SCOURING_SWARM['name']

    out = _finish_started_battle(table, monkeypatch, doc, 'attacker')
    assert node not in db._swarm_nodes(table, sid), 'the kill clears the node'
    assert out.get('jelly') == data.SWARM_JELLY_DROP, 'a swarm drops Royal Jelly'
    fresh = db._get_player(table, sid, 'user-alex')
    assert fresh['royalJelly'] == data.SWARM_JELLY_DROP


def test_the_back_room_opens_for_jelly_and_sells_legendaries(table):
    """The keeper craves the Queen's jelly and opens the good stuff from the
    back — Legendary kit, bought with a currency you earned fighting the
    Awakening. Mythic stays craft-only."""
    act(table, 'join', starter='pest')
    sid, _ = db._active_season(table)
    shop = next(n for n, v in data.MAP_NODES.items() if v['type'] == 'shop')

    # Before the Awakening the keeper has nothing to whisper about.
    assert db._back_room(table, sid) == []

    alex = db._get_player(table, sid, 'user-alex')
    alex['poiClaims'] = sorted(data.SIGIL_LAIRS)[:data.SIGILS_REQUIRED]
    db._maybe_awaken(table, sid, alex)

    stock = db._back_room(table, sid)
    assert stock, 'the back room opens with the Awakening'
    assert all(data.GEAR[e['item']]['tier'] == 3 for e in stock), 'Legendary only'
    assert all(e['jelly'] == data.BACKROOM_JELLY_COST for e in stock)

    # Jelly is the only currency that opens it.
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = shop
    doc['spores'] = 9999
    doc['royalJelly'] = 0
    db._put_player(table, doc)
    status, body = act(table, 'back-room-buy', item=stock[0]['item'])
    assert status == 409, body

    doc = db._get_player(table, sid, 'user-alex')
    doc['royalJelly'] = data.BACKROOM_JELLY_COST
    db._put_player(table, doc)
    status, body = act(table, 'back-room-buy', item=stock[0]['item'])
    assert status == 200, body
    you = body['you']
    assert you['royalJelly'] == 0
    owned = list((you.get('gear') or {}).values()) + (you.get('gearStash') or [])
    assert stock[0]['item'] in owned
