"""Integration tests for discarding a night — ending it without banking results.

A normal `season-end` banks earned Renown onto permanent profiles, adds a Hall of
Fame entry and bumps lifetime counters. A discarded night must leave the permanent
wallet exactly where it started, including handing back Renown that mid-night
payouts (raid boss, world event) already banked. A night that ever ran with Dev
Night is forced to discard.

Same in-memory FakeTable + `act` dispatcher as the rest of the suite.
"""
import undercity_data as data
import undercity_db as db
from test_undercity_db import FakeTable, act


def _started_table():
    t = FakeTable()
    assert act(t, 'season-start', hostKey='swampking')[0] == 200
    return t


def _sid(table):
    sid, _ = db._active_season(table)
    return sid


def _join(table, user='u_alex', name='Alex'):
    assert act(table, 'join', user=user, name=name,
               starter='saproling', home='cavern')[0] == 200


def _host(table, atype, **payload):
    return db.handle_action(table, {
        'type': atype, 'userId': 'user-host', 'username': 'Host',
        'payload': {'hostKey': 'swampking', **payload}})


def _end(table, **payload):
    return _host(table, 'season-end', **payload)


def _dev_night(table, on):
    status, resp = _host(table, 'admin', cmd='dev-night', on=on)
    assert status == 200, resp
    return resp


def _earn(table, user='u_alex', win_renown=20, pvp_wins=2, tier=3):
    """Give a player something the archive would want to bank: winRenown feeds
    data.compute_renown, pvpWins feeds lifetimePvpWins, tier 3 feeds apexReached.
    Returns the Renown the archive should credit, derived from the real formula so
    these tests never re-implement the scoring."""
    sid = _sid(table)
    doc = db._get_player(table, sid, user)
    doc['winRenown'] = win_renown
    doc['pvpWins'] = pvp_wins
    doc['tier'] = tier
    assert db._put_player(table, doc)
    return data.compute_renown(doc)


def _wallet(table, user='u_alex'):
    return db._get_perm(table, user).get('renown', 0)


def _hof(table):
    return db._hall_of_fame(table)


# ── Baseline: a normal end still banks (regression guard) ────────────────────

def test_normal_end_banks_renown_and_lifetime_stats():
    table = _started_table()
    _join(table)
    before = _wallet(table)
    earned = _earn(table)
    assert earned > 0

    status, resp = _end(table)
    assert status == 200
    assert resp['discarded'] is False
    assert _wallet(table) == before + earned
    perm = db._get_perm(table, 'u_alex')
    assert perm['lifetimePvpWins'] == 2
    assert perm['apexReached'] == 1
    assert len(_hof(table)) == 1


# ── Discard: nothing permanent survives ─────────────────────────────────────

def test_discard_leaves_the_wallet_untouched():
    table = _started_table()
    _join(table)
    before = _wallet(table)
    _earn(table)

    status, resp = _end(table, discard=True)
    assert status == 200
    assert resp['discarded'] is True
    assert _wallet(table) == before


def test_discard_writes_no_hall_of_fame_entry():
    table = _started_table()
    _join(table)
    _earn(table)
    assert _end(table, discard=True)[0] == 200
    assert _hof(table) == []


def test_discard_skips_lifetime_counters():
    table = _started_table()
    _join(table)
    _earn(table)
    assert _end(table, discard=True)[0] == 200
    perm = db._get_perm(table, 'u_alex')
    assert perm.get('lifetimePvpWins', 0) == 0
    assert perm.get('apexReached', 0) == 0


def test_discard_still_reports_standings_for_the_ceremony():
    # The ceremony screen and the host export must still work on a thrown-away
    # night — reviewing a test night's numbers is exactly when you want them.
    table = _started_table()
    _join(table)
    earned = _earn(table)
    status, resp = _end(table, discard=True)
    assert status == 200
    result = resp['result']
    assert result['discarded'] is True
    assert [s['username'] for s in result['standings']] == ['Alex']
    assert result['champion']['renown'] == earned

    _, state = db.handle_state(table, {'userId': 'u_alex'})
    assert state['result']['discarded'] is True


# ── Mid-night grants are handed back ────────────────────────────────────────

def test_discard_reverses_midnight_world_event_renown():
    table = _started_table()
    _join(table, 'u_top', 'Top')
    _join(table, 'u_minor', 'Minor')
    sid = _sid(table)
    top_before, minor_before = _wallet(table, 'u_top'), _wallet(table, 'u_minor')

    db._set_world_event(table, sid, {
        'spawned': True, 'node': 'x', 'nodes': ['a', 'x', 'b'],
        'endsAt': db._iso_in_minutes(60), 'dead': False,
        'dmg': {'u_top': 200, 'u_minor': 80}})
    top = db._get_player(table, sid, 'u_top')
    assert db._world_event_payout(table, sid, top)
    assert db._put_player(table, top)

    # The payout banked Renown straight onto the permanent wallets…
    vanquisher = data.WORLD_EVENT_REWARDS['vanquisher']['renown']
    assert _wallet(table, 'u_top') == top_before + vanquisher

    # …and discarding the night hands every point of it back.
    assert _end(table, discard=True)[0] == 200
    assert _wallet(table, 'u_top') == top_before
    assert _wallet(table, 'u_minor') == minor_before


def test_normal_end_keeps_midnight_world_event_renown():
    table = _started_table()
    _join(table, 'u_top', 'Top')
    sid = _sid(table)
    before = _wallet(table, 'u_top')

    db._set_world_event(table, sid, {
        'spawned': True, 'node': 'x', 'nodes': ['a', 'x', 'b'],
        'endsAt': db._iso_in_minutes(60), 'dead': False,
        'dmg': {'u_top': 200}})
    top = db._get_player(table, sid, 'u_top')
    assert db._world_event_payout(table, sid, top)
    assert db._put_player(table, top)
    earned = _wallet(table, 'u_top') - before
    assert earned > 0

    assert _end(table)[0] == 200
    assert _wallet(table, 'u_top') >= before + earned   # kept, plus any banked


def test_discard_refund_clamps_at_zero():
    # Earned mid-night, then spent it (the pre-spawn shop spends the wallet, and a
    # discard deliberately does not refund purchases). The refund must floor at 0
    # rather than driving the wallet negative.
    table = _started_table()
    _join(table)
    sid = _sid(table)
    db._bank_perm_renown(table, sid, 'u_alex', 30)
    perm = db._get_perm(table, 'u_alex')
    perm['renown'] = 5          # spent most of it
    table.put_item(Item=perm)

    assert _end(table, discard=True)[0] == 200
    assert _wallet(table) == 0


def test_bank_perm_renown_tallies_and_ignores_zero():
    table = _started_table()
    _join(table)
    sid = _sid(table)
    before = _wallet(table)

    db._bank_perm_renown(table, sid, 'u_alex', 7)
    db._bank_perm_renown(table, sid, 'u_alex', 5)
    db._bank_perm_renown(table, sid, 'u_alex', 0)     # no-op, no ledger row churn
    assert _wallet(table) == before + 12

    assert _end(table, discard=True)[0] == 200
    assert _wallet(table) == before


# ── Dev Night interlock ─────────────────────────────────────────────────────

def test_dev_night_forces_discard_even_when_asked_to_bank():
    table = _started_table()
    _join(table)
    before = _wallet(table)
    _dev_night(table, True)
    _earn(table)

    status, resp = _end(table)                 # host asks for a normal end…
    assert status == 200
    assert resp['discarded'] is True           # …but a cheat night can't bank
    assert _wallet(table) == before
    assert _hof(table) == []


def test_dev_ever_on_is_sticky_after_turning_dev_night_off():
    table = _started_table()
    _join(table)
    before = _wallet(table)
    _dev_night(table, True)
    _dev_night(table, False)                   # host tidies up before ending
    _earn(table)

    _, state = db.handle_state(table, {'userId': 'u_alex'})
    assert state['season']['devMode'] is False
    assert state['season']['devEverOn'] is True

    status, resp = _end(table)
    assert resp['discarded'] is True
    assert _wallet(table) == before


def test_new_night_over_a_dev_night_does_not_bank():
    # season-start archives the running night on its way out; that path must
    # honour the interlock too, or "New Night" silently banks the cheat night.
    table = _started_table()
    _join(table)
    before = _wallet(table)
    _dev_night(table, True)
    _earn(table)

    assert _host(table, 'season-start')[0] == 200
    assert _wallet(table) == before
    assert _hof(table) == []


def test_state_exposes_dev_ever_on():
    table = _started_table()
    _, state = db.handle_state(table, {'userId': 'u_alex'})
    assert state['season']['devEverOn'] is False
    _dev_night(table, True)
    _, state = db.handle_state(table, {'userId': 'u_alex'})
    assert state['season']['devEverOn'] is True
