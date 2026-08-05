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


def _doc(**kw):
    base = {'atk': 5, 'def': 5, 'spd': 5, 'maxHp': 25, 'hp': 25,
            'gear': {}, 'buffs': [], 'passives': []}
    base.update(kw)
    return base


def test_arsenal_wildcard_piece_counts_once():
    # fang = duelist_fang (+3 atk / +2 spd); wild = warbrand_plate (+3 def / +2 atk).
    gear = {'fang': 'duelist_fang', 'wild': 'warbrand_plate'}

    # Arsenal grants the extra slot but does NOT double it: the wildcard piece
    # contributes its stats exactly once, so the passive never alters the totals.
    plain = engine.effective_stats(_doc(gear=gear))
    armed = engine.effective_stats(_doc(gear=gear, passives=['arsenal']))
    assert armed == plain
    assert armed['atk'] == 5 + 3 + 2      # base + fang.atk + wild.atk (each once)
    assert armed['def'] == 5 + 3          # base + wild.def
    assert armed['spd'] == 5 + 2          # base + fang.spd


def test_arsenal_does_not_alter_stats_without_wildcard():
    gear = {'fang': 'duelist_fang'}
    plain = engine.effective_stats(_doc(gear=gear))
    armed = engine.effective_stats(_doc(gear=gear, passives=['arsenal']))
    assert armed == plain
