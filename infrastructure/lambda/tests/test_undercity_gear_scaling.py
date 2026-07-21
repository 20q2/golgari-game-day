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


def test_combatant_from_doc_has_scaled_rider_mag():
    import undercity_db as db
    # bark_hide = tier-2 'spiked' carapace; RIDER_SCALE['spiked'][2] == 1.5
    doc = {'username': 'p', 'hp': 40, 'level': 1, 'gear': {'carapace': 'bark_hide'}}
    c = db._combatant(doc)
    assert c.mag('spiked', 1.0) == 1.5


def test_battle_snapshot_roundtrips_rider_mag():
    import undercity_db as db, undercity_engine as engine
    c = engine.Combatant(name='p', hp=40, max_hp=40, atk=8, dfn=4, spd=5,
                         riders=frozenset({'spiked'}), rider_mag={'spiked': 1.5})
    restored = db._bt_to_combatant(db._bt_snapshot(c))
    assert restored.mag('spiked', 1.0) == 1.5


def _duel(rider, mag, my_stance, foe_stance, seed=1):
    """One deterministic round; return total damage dealt to the foe."""
    import undercity_engine as engine, random
    me = engine.Combatant(name='me', hp=100, max_hp=100, atk=10, dfn=5, spd=5,
                          riders=frozenset({rider}), rider_mag={rider: mag})
    foe = engine.Combatant(name='foe', hp=100, max_hp=100, atk=10, dfn=5, spd=5)
    engine.resolve_round(me, foe, my_stance, foe_stance, 1, random.Random(seed))
    return 100 - foe.hp


def test_spiked_counter_scales_with_mag():
    # Guard (me) beats Aggress (foe): my counter is STANCE_GUARD_COUNTER * mag.
    low = _duel('spiked', 1.3, 'guard', 'aggress')
    high = _duel('spiked', 1.8, 'guard', 'aggress')
    assert high > low
