"""Daemogoth (Elf-line apex with Arsenal) + Primeval Warden (izoni rename)."""
import undercity_data as data
import undercity_engine as engine


def test_izoni_is_now_primeval_warden():
    # The shared speedster apex keeps its id + Swarm kit, only the face changes.
    warden = data.ALL_FORMS['izoni']
    assert warden['name'] == 'Primeval Warden'
    assert warden['passive'] == 'swarm'
    assert warden['bonus'] == {'spd': 4}


def test_daemogoth_is_the_elf_apex():
    # New Elf-exclusive apex, fed only by the two Elf tier-2 forms.
    d = data.ALL_FORMS['daemogoth']
    assert d['name'] == 'Daemogoth Titan'
    assert d['passive'] == 'arsenal'
    assert set(d['from']) == {'wood_lurker', 'gorgon'}

    assert 'daemogoth' in data.apex_options('wood_lurker')
    assert 'daemogoth' in data.apex_options('gorgon')
    # The Gorgon no longer funnels into Primeval Warden — Daemogoth took that seat.
    assert 'izoni' not in data.apex_options('gorgon')
    # Non-elf speedsters still reach Primeval Warden.
    assert 'izoni' in data.apex_options('slitherhead')


def test_arsenal_scalar_defined():
    assert data.ARSENAL_EXTRA_COPIES == 1


def _doc(**kw):
    base = {'atk': 5, 'def': 5, 'spd': 5, 'maxHp': 25, 'hp': 25,
            'gear': {}, 'buffs': [], 'passives': []}
    base.update(kw)
    return base


def test_arsenal_doubles_only_the_wildcard_piece():
    # fang = duelist_fang (+3 atk / +2 spd); wild = warbrand_plate (+3 def / +2 atk).
    gear = {'fang': 'duelist_fang', 'wild': 'warbrand_plate'}

    # Without Arsenal: every piece counts once.
    plain = engine.effective_stats(_doc(gear=gear))
    assert plain['atk'] == 5 + 3 + 2      # base + fang + wild
    assert plain['def'] == 5 + 3          # base + wild
    assert plain['spd'] == 5 + 2          # base + fang

    # With Arsenal: the wildcard piece's stats are counted a second time.
    armed = engine.effective_stats(_doc(gear=gear, passives=['arsenal']))
    assert armed['atk'] == plain['atk'] + 2   # +wild atk again
    assert armed['def'] == plain['def'] + 3   # +wild def again
    assert armed['spd'] == plain['spd']       # wild has no spd
    assert armed['maxHp'] == plain['maxHp']


def test_arsenal_no_bonus_when_wildcard_empty():
    gear = {'fang': 'duelist_fang'}
    plain = engine.effective_stats(_doc(gear=gear))
    armed = engine.effective_stats(_doc(gear=gear, passives=['arsenal']))
    assert armed == plain
