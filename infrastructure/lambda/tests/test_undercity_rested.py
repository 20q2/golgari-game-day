"""Rested-rolls mechanic — unit tests over engine.regen_rolls (no table needed)."""
from datetime import datetime, timedelta

import undercity_data as data
import undercity_engine as engine


def _player(rolls, rested=0, base='2020-01-01T00:00:00'):
    return {'rolls': rolls, 'rested': rested, 'rollRegenAt': base}


def _later(base, ticks):
    """ISO string `ticks` full regen intervals after `base`."""
    t = datetime.fromisoformat(base) + timedelta(
        minutes=ticks * data.ROLL_REGEN_MINUTES)
    return t.strftime('%Y-%m-%dT%H:%M:%S')


def test_at_cap_banks_rested_instead_of_discarding():
    p = _player(rolls=data.ROLL_CAP, rested=0)
    engine.regen_rolls(p, _later(p['rollRegenAt'], 2))
    assert p['rolls'] == data.ROLL_CAP
    assert p['rested'] == 2 * data.ROLLS_PER_REGEN


def test_below_cap_with_rested_pays_double_and_draws_rested():
    # One tick below cap with rested available delivers 2x and burns a tick's worth.
    p = _player(rolls=1, rested=data.ROLLS_PER_REGEN)
    engine.regen_rolls(p, _later(p['rollRegenAt'], 1))
    assert p['rolls'] == 1 + 2 * data.ROLLS_PER_REGEN
    assert p['rested'] == 0


def test_doubled_tick_overshoot_pushes_back_into_rested():
    # rolls one below cap, rested available: gain would overshoot; the excess is
    # banked back to rested, never lost.
    p = _player(rolls=data.ROLL_CAP - 1, rested=data.ROLLS_PER_REGEN)
    before_total = p['rolls'] + p['rested']
    engine.regen_rolls(p, _later(p['rollRegenAt'], 1))
    assert p['rolls'] == data.ROLL_CAP
    # net gain over the tick is exactly one tick's regen — nothing evaporated
    assert p['rolls'] + p['rested'] == before_total + data.ROLLS_PER_REGEN


def test_rested_clamps_at_cap():
    # Very long absence: rolls fill, then rested fills, then everything is pinned.
    p = _player(rolls=0, rested=0)
    engine.regen_rolls(p, _later(p['rollRegenAt'], 999))
    assert p['rolls'] == data.ROLL_CAP
    assert p['rested'] == data.RESTED_CAP


def test_net_neutral_over_spend_then_refill():
    # Bank some rested at cap, spend rolls down, then regen the same number of
    # ticks: total rolls delivered equals plain regen (no gain, no loss).
    p = _player(rolls=data.ROLL_CAP, rested=0)
    engine.regen_rolls(p, _later(p['rollRegenAt'], 3))      # bank 3 ticks of rested
    assert p['rested'] == 3 * data.ROLLS_PER_REGEN
    spent = 3 * data.ROLLS_PER_REGEN
    p['rolls'] -= spent                                     # simulate spending
    base2 = p['rollRegenAt']
    engine.regen_rolls(p, _later(base2, 3))                 # refill 3 ticks
    # back to exactly where we were before spending — net-neutral
    assert p['rolls'] == data.ROLL_CAP
    assert p['rested'] == 3 * data.ROLLS_PER_REGEN


def test_timestamp_advances_by_whole_intervals_only():
    base = '2020-01-01T00:00:00'
    p = _player(rolls=0, rested=0, base=base)
    # 2.5 intervals elapse; only 2 whole ticks apply and the stamp advances by 2.
    almost = datetime.fromisoformat(base) + timedelta(
        minutes=int(2.5 * data.ROLL_REGEN_MINUTES))
    engine.regen_rolls(p, almost.strftime('%Y-%m-%dT%H:%M:%S'))
    assert p['rollRegenAt'] == _later(base, 2)


def test_bank_rested_false_restores_cap_and_discard():
    # The join-seed path opts out: overflow past the cap is discarded, no rested.
    p = _player(rolls=0, rested=0)
    engine.regen_rolls(p, _later(p['rollRegenAt'], 999), bank_rested=False)
    assert p['rolls'] == data.ROLL_CAP
    assert p['rested'] == 0


from tests.test_undercity_db import table, act, _sid  # noqa: E402,F401
import undercity_db as db  # noqa: E402


def test_late_joiner_fills_bank_but_gets_no_rested(table):
    # Backdate the season so a joiner would have accrued well past both ceilings.
    cfg = db._get(table, db._season_pk(_sid(table)), 'CONFIG')
    old = datetime.fromisoformat(cfg['startedAt']) - timedelta(hours=12)
    cfg['startedAt'] = old.strftime('%Y-%m-%dT%H:%M:%S')
    table.put_item(Item=cfg)

    _, resp = act(table, 'join', starter='pest')
    you = resp['you']
    assert you['rolls'] == data.ROLL_CAP
    assert you.get('rested', 0) == 0        # seeding must NOT stockpile rested


def test_roll_meta_shows_countdown_while_rested_still_filling():
    # Full bank, rested below its cap, regen anchored → countdown should appear.
    doc = {'rolls': data.ROLL_CAP, 'rested': 0,
           'rollRegenAt': '2020-01-01T00:00:00'}
    meta = db._roll_meta(doc)
    assert 'nextRollAt' in meta

    # Full bank AND rested maxed → nothing left to accrue, no countdown.
    doc2 = {'rolls': data.ROLL_CAP, 'rested': data.RESTED_CAP,
            'rollRegenAt': '2020-01-01T00:00:00'}
    assert 'nextRollAt' not in db._roll_meta(doc2)


def test_roll_meta_flags_boost_only_below_cap_with_rested():
    base = '2020-01-01T00:00:00'
    # Below cap with rested banked → next tick doubles → boost flag set.
    below = {'rolls': 0, 'rested': data.ROLLS_PER_REGEN, 'rollRegenAt': base}
    assert db._roll_meta(below).get('nextRollBoosted') is True
    # At cap: the tick banks rested rather than doubling rolls → no boost.
    at_cap = {'rolls': data.ROLL_CAP, 'rested': data.ROLLS_PER_REGEN, 'rollRegenAt': base}
    assert 'nextRollBoosted' not in db._roll_meta(at_cap)
    # No rested → ordinary tick → no boost.
    plain = {'rolls': 0, 'rested': 0, 'rollRegenAt': base}
    assert 'nextRollBoosted' not in db._roll_meta(plain)
