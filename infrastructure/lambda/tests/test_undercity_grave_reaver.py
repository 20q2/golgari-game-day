import undercity_data as d


def test_grave_reaver_reachable_from_pest_line_and_deathrite():
    assert 'grave_reaver' in d.apex_options('brackish_trudge')
    assert 'grave_reaver' in d.apex_options('vexing_pest')
    assert 'grave_reaver' in d.apex_options('deathrite_shaman')


def test_grave_reaver_uses_dragon_stats_and_passive():
    gr = d.APEX['grave_reaver']
    assert gr['passive'] == 'treasure_sense'
    assert gr['name'] == 'Colossal Grave-Reaver'


def test_calamity_no_longer_from_deathrite():
    assert 'calamity_beast' not in d.apex_options('deathrite_shaman')


def test_every_tier2_form_has_two_or_three_apex_options():
    for fid in d.TIER2:
        assert 2 <= len(d.apex_options(fid)) <= 3, (fid, d.apex_options(fid))
