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


def _doc(passives, tier=3):
    # Treasure Sense is an APEX passive, so these docs are tier 3 by default —
    # which is also what lets them roll the top rarity under the
    # GEAR_RARITY_CAP_BY_TIER ceiling.
    return {'passives': list(passives), 'gear': {}, 'stash': [], 'spores': 0,
            'tier': tier}


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


def test_rarity_is_capped_by_creature_tier(monkeypatch):
    """Treasure tiles floor at Rare and can roll Legendary. Without a ceiling a
    tier-1 creature came out of one early cache in gear that solves the board,
    so the roll is clamped to GEAR_RARITY_CAP_BY_TIER[creature tier]."""
    monkeypatch.setattr(db, '_rng', _FixedRng('fang'))
    for creature_tier, expected in data.GEAR_RARITY_CAP_BY_TIER.items():
        drop = db._roll_gear_drop(_doc(set(), tier=creature_tier), {3: 1.0})
        assert data.WORLD_GEAR[drop['id']]['tier'] == expected, creature_tier
    # An unevolved creature cracking a treasure tile still gets a piece — it's
    # just Common. The reward is never voided by the cap.
    assert db._roll_gear_drop(_doc(set(), tier=1), {2: 0.6, 3: 0.4}) is not None


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
