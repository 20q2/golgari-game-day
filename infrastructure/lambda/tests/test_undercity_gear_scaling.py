import undercity_data as data


def test_rider_scale_covers_every_geared_rider():
    """Every rider referenced by a GEAR piece must have a scale row."""
    geared = {g['rider'] for g in data.GEAR.values() if g.get('rider')}
    read_only = {'seer', 'glint'}  # scale via per-piece readBonus, not RIDER_SCALE
    missing = geared - read_only - set(data.RIDER_SCALE)
    assert not missing, f"riders with no RIDER_SCALE row: {missing}"


def test_rider_scale_is_monotonic_non_decreasing():
    for rider, rungs in data.RIDER_SCALE.items():
        assert set(rungs) == {1, 2, 3}, f"{rider} must define tiers 1,2,3"
        assert rungs[1] <= rungs[2] <= rungs[3], f"{rider} ladder not monotonic: {rungs}"


def test_combatant_mag_reads_rider_mag_with_default():
    import undercity_engine as engine
    c = engine.Combatant(name='x', hp=30, max_hp=30, atk=8, dfn=3, spd=5,
                         riders=frozenset({'bramble'}), rider_mag={'bramble': 3})
    assert c.mag('bramble') == 3          # equipped -> scaled value
    assert c.mag('spiked', 1.0) == 1.0    # not equipped -> caller's default
    assert c.mag('spiked') == 0           # not equipped -> default 0
