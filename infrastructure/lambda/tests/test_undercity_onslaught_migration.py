import undercity_db as db


def test_rot_breath_migrates_to_onslaught():
    assert db._migrate_passives(['first_bite', 'rot_breath']) == ['first_bite', 'onslaught']


def test_onslaught_is_a_noop_once_migrated():
    assert db._migrate_passives(['onslaught']) == ['onslaught']
