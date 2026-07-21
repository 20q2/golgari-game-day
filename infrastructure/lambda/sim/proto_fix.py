"""Prototype of the Guard/DEF combat fix — isolated, no edits to the real engine.

Two levers, monkeypatched onto the engine so we can sweep values in the sim:
  guard_chip    : a creature in Guard deals a DEF-scaled chip each round it does
                  NOT already win the exchange (converts DEF -> offense every
                  round, independent of what the enemy telegraphs).
  def_mitigate  : incoming hits are further reduced by round(target.def * m)
                  (raw DEF investment buys unconditional survivability).

`enable(guard_chip=..., def_mitigate=...)` patches; `disable()` restores.
"""
import undercity_engine as engine
import undercity_data as data

_orig_rr = engine.resolve_round
_orig_bh = engine._base_hit
CFG = {'guard_chip': 0.0, 'def_mitigate': 0.0, 'preserve_triangle': False,
       'player_only': False}


def _patched_bh(striker, target, rng, pierce=0, *, stance, ramp=1.0):
    hit = _orig_bh(striker, target, rng, pierce, stance=stance, ramp=ramp)
    m = CFG['def_mitigate']
    if m > 0:
        hit = max(1, hit - round(target.dfn * m))
    return hit


def _patched_rr(att, dfn, a_stance, d_stance, rnd, rng, **kw):
    entries = _orig_rr(att, dfn, a_stance, d_stance, rnd, rng, **kw)
    gc = CFG['guard_chip']
    if gc > 0:
        ff = kw.get('frenzy_from')
        ramp = 1.0
        if ff is not None and rnd >= ff:
            ramp = 1 + data.FRENZY_RAMP * (rnd - ff + 1)
        winner = engine.exchange_winner(a_stance, d_stance)
        for side, s, t, st in (('attacker', att, dfn, a_stance),
                               ('defender', dfn, att, d_stance)):
            if st != 'guard' or s.hp <= 0 or t.hp <= 0:
                continue
            # player-only: in the arena the player is always the attacker, so the
            # chip models a DEF *perk* the creature has and enemies never do.
            if CFG['player_only'] and side != 'attacker':
                continue
            # Guard already lands its counter when it cleanly wins (G>A). The chip
            # fills the other cases. When preserve_triangle, we DON'T chip on a
            # guard-loses-to-Feint (winner is the foe) so Feint>Guard still stings;
            # we only chip on a stall (G-v-G, winner == 'stall').
            if winner == side:
                continue
            if CFG['preserve_triangle'] and winner not in ('stall',):
                continue
            chip = max(1, round(engine._swing_base(s, 'guard') * ramp * gc))
            t.hp -= chip
            entries.append({'round': rnd, 'by': side, 'dmg': chip, 'guardChip': True})
    return entries


def enable(guard_chip=0.0, def_mitigate=0.0, preserve_triangle=False, player_only=False):
    CFG['guard_chip'] = guard_chip
    CFG['def_mitigate'] = def_mitigate
    CFG['preserve_triangle'] = preserve_triangle
    CFG['player_only'] = player_only
    engine.resolve_round = _patched_rr
    engine._base_hit = _patched_bh


def disable():
    CFG.update(guard_chip=0.0, def_mitigate=0.0, preserve_triangle=False, player_only=False)
    engine.resolve_round = _orig_rr
    engine._base_hit = _orig_bh


# ── comparison harness ────────────────────────────────────────────────────────

def _matrix(make, winrate, reg, Build, custom_policy, trials=250):
    """Stat-spread × stance vs boss + one turtle enemy + basic content, plus a
    pure-ATK/Aggress control (must NOT regress)."""
    spreads = [('pure-ATK', ('atk',)), ('pure-DEF', ('def',)), ('pure-SPD', ('spd',))]
    rows = []
    for label, pri in spreads:
        for stance in ('aggress', 'guard', 'feint'):
            pol = custom_policy(pref_stance=stance, stat_priority=pri, name='x')
            doc = make(Build('pest', 'city'), pol, 10, seed=1)
            boss = winrate(doc, reg['rot_sovereign'][1], pol, trials=trials, base_seed=5, kind='boss')
            thorn = winrate(doc, reg['thornclad_revenant'][1], pol, trials=trials, base_seed=5, kind='wild+')
            drudge = winrate(doc, reg['drudge_beetle'][1], pol, trials=trials, base_seed=5, kind='wild')
            rows.append((label, stance, boss['mean_dmg'], boss['winrate'],
                         thorn['winrate'], drudge['winrate']))
    return rows


def run():
    from sim.arena import make_leveled_doc, winrate, enemy_registry
    from sim.driver import Build
    from sim.sweep import custom_policy
    reg = enemy_registry()

    # (name, guard_chip, def_mitigate, preserve_triangle, player_only)
    configs = [('BASELINE (shipped)', 0.0, 0.0, False, False),
               ('DEF perk: player-only guard_chip 0.5', 0.5, 0.0, False, True),
               ('DEF perk: player-only guard_chip 0.7', 0.7, 0.0, False, True),
               ('DEF perk: player-only guard_chip 1.0', 1.0, 0.0, False, True)]
    out = []
    for name, gc, dm, pt, po in configs:
        if gc or dm:
            enable(gc, dm, pt, po)
        else:
            disable()
        rows = _matrix(make_leveled_doc, winrate, reg, Build, custom_policy)
        disable()
        out.append((name, rows))

    # print
    header = f'{"stat":9s} {"stance":7s} | Savra dmg  win% | thorn% | drudge%'
    for name, rows in out:
        print('\n== ' + name + ' ==')
        print(header)
        for (label, stance, bdmg, bwin, twin, dwin) in rows:
            mark = ''
            print(f'{label:9s} {stance:7s} | {bdmg:6.0f}  {bwin*100:4.0f}% | {twin*100:4.0f}% | {dwin*100:4.0f}%{mark}')


def verify_real():
    """Confirm the SHIPPED Carapace Grind perk reproduces the prototype: a
    pure-DEF/Guard build becomes a viable boss path, ATK/SPD unchanged. Runs
    against the real engine (no monkeypatch)."""
    import undercity_engine as engine
    from sim.arena import make_leveled_doc, winrate, enemy_registry
    from sim.driver import Build
    from sim.sweep import custom_policy
    reg = enemy_registry()
    for label, pri, stance in [('pure-DEF', ('def',), 'guard'),
                               ('pure-ATK', ('atk',), 'aggress'),
                               ('pure-SPD', ('spd',), 'feint')]:
        pol = custom_policy(pref_stance=stance, stat_priority=pri, name='x')
        doc = make_leveled_doc(Build('pest', 'city'), pol, 10, seed=1)
        w = winrate(doc, reg['rot_sovereign'][1], pol, trials=300, base_seed=5, kind='boss')
        perks = sorted(engine.attribute_perks(doc))
        print(f'{label}/{stance}: Savra {w["mean_dmg"]:.0f} dmg, {w["winrate"]*100:.0f}%  perks={perks}')


if __name__ == '__main__':
    run()
