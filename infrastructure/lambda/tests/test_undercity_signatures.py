"""Evolution-graph invariants for the line-signature design (2026-08-07)."""
import undercity_data as d


def _line_forms(line):
    return [fid for fid, f in d.TIER2.items() if f['line'] == line]


def test_every_line_signature_reachable_by_all_its_tier2_forms():
    for line, sig in d.LINE_SIGNATURE.items():
        for fid in _line_forms(line):
            assert sig in d.apex_options(fid), (line, fid, sig, d.apex_options(fid))


def test_siblings_have_distinct_apex_option_sets():
    for line in d.LINE_SIGNATURE:
        forms = _line_forms(line)
        sets = [frozenset(d.apex_options(fid)) for fid in forms]
        assert len(sets) == len(set(sets)), (line, dict(zip(forms, sets)))


def test_every_tier2_form_has_two_or_three_options():
    for fid in d.TIER2:
        assert 2 <= len(d.apex_options(fid)) <= 3, (fid, d.apex_options(fid))


def test_every_apex_has_at_least_two_sources():
    for aid, a in d.APEX.items():
        assert len(a['from']) >= 2, (aid, a['from'])


def test_signature_targets_are_real_apexes():
    for line, sig in d.LINE_SIGNATURE.items():
        assert sig in d.APEX, (line, sig)
