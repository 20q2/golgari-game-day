import undercity_db as db
import undercity_data as data


class _FixedRng:
    """Deterministic: always the given slot, always tier-weight index 0."""
    def __init__(self, slot):
        self._slot = slot

    def choice(self, seq):
        return self._slot if self._slot in seq else seq[0]

    def choices(self, seq, weights=None, k=1):
        return [seq[0]]

    def random(self):
        return 0.0


def _doc(passives):
    return {'passives': list(passives), 'gear': {}, 'stash': [], 'spores': 0}


def test_treasure_sense_bumps_rolled_tier(monkeypatch):
    monkeypatch.setattr(db, '_rng', _FixedRng('fang'))
    # tier weights {1:1.0} -> index-0 tier is 1; treasure_sense bumps to 2.
    drop = db._roll_gear_drop(_doc({'treasure_sense'}), {1: 1.0})
    assert drop is not None
    assert data.WORLD_GEAR[drop['id']]['tier'] == 2


def test_no_passive_keeps_base_tier(monkeypatch):
    monkeypatch.setattr(db, '_rng', _FixedRng('fang'))
    drop = db._roll_gear_drop(_doc(set()), {1: 1.0})
    assert data.WORLD_GEAR[drop['id']]['tier'] == 1


def test_bump_caps_at_max_tier(monkeypatch):
    monkeypatch.setattr(db, '_rng', _FixedRng('fang'))
    # base tier 3 -> bump would be 4, but caps at TREASURE_SENSE_MAX_TIER (3).
    drop = db._roll_gear_drop(_doc({'treasure_sense'}), {3: 1.0})
    assert data.WORLD_GEAR[drop['id']]['tier'] == 3
