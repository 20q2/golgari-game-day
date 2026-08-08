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


class _ProbeRng:
    """Returns a fixed value for every random() comparison."""
    def __init__(self, value):
        self._value = value

    def random(self):
        return self._value


def test_gear_drop_fires_boosts_chance_for_treasure_sense(monkeypatch):
    # 'loot' base chance is 0.10. Without the passive a 0.15 roll fails; with
    # Treasure Sense the effective chance is 0.10*2=0.20, so 0.15 now fires.
    monkeypatch.setattr(db, '_rng', _ProbeRng(0.15))
    assert db._gear_drop_fires(_doc(set()), 'loot') is False
    assert db._gear_drop_fires(_doc({'treasure_sense'}), 'loot') is True


def test_gear_drop_fires_respects_chance_cap(monkeypatch):
    # 'treasure' base 0.50 * 2 = 1.0, capped to 0.95 — a 0.97 roll still fails.
    monkeypatch.setattr(db, '_rng', _ProbeRng(0.97))
    assert db._gear_drop_fires(_doc({'treasure_sense'}), 'treasure') is False
