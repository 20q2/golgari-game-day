#!/usr/bin/env python3
"""Offline report over a host `export` of a finished Undercity night.

Usage:  python scripts/analyze_undercity_session.py undercity-session-<season>.json

Reads only the export (no AWS, no engine import beyond the renown constants,
which are inlined so the script keeps working against old exports after a
balance change). Everything printed is derived from `players[].metrics`,
the append-only event log, and the shared world rows.
"""
import json
import sys
import collections
import datetime as dt

# Windows consoles default to cp1252, which can't encode the box/arrow glyphs
# this report prints (or the event text, which carries mojibake from the wire).
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

# Inlined so the report over an OLD export isn't silently rescored by today's
# balance table. Update alongside undercity_data.RENOWN* when comparing nights.
RENOWN = {'per_pvp_win': 15, 'per_wild_win': 3, 'per_poi': 25, 'boss_damage_per_point': 10}


def renown(p):
    return (RENOWN['per_pvp_win'] * p.get('pvpRenownWins', p.get('pvpWins', 0))
            + p.get('winRenown', RENOWN['per_wild_win'] * p.get('wildWins', 0))
            + RENOWN['per_poi'] * len(p.get('poiClaims') or [])
            + p.get('bossDamage', 0) // RENOWN['boss_damage_per_point'])


# Gear is persisted as a bare item id per slot; tier lives only in the balance
# table. Best-effort import so the report still runs from a checkout without the
# lambda on the path (or against an export whose items have since been renamed).
try:
    sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parents[1]
                           / 'infrastructure' / 'lambda'))
    import undercity_data as _data
    _GEAR = _data.GEAR
except Exception:
    _GEAR = {}


def gear_label(gid):
    g = _GEAR.get(gid)
    return f'{gid}(T{g["tier"]})' if g else str(gid)


def ts(s):
    return dt.datetime.fromisoformat(s.split('.')[0]) if s else None


def hrs(a, b):
    return (b - a).total_seconds() / 3600 if a and b else 0.0


def rule(title):
    print(f'\n{"=" * 78}\n{title}\n{"=" * 78}')


def pct(n, d):
    return f'{100 * n / d:5.1f}%' if d else '    —'


def main(path):
    d = json.load(open(path, encoding='utf-8'))
    players = sorted(d['players'], key=renown, reverse=True)
    events = sorted(d.get('events') or [], key=lambda e: e.get('ts', ''))
    first_ev, last_ev = ts(events[0]['ts']), ts(events[-1]['ts'])

    rule(f'SESSION {d["season"]}  —  exported {d.get("exportedAt")}')
    # The first two 'season' events are the lobby seal and the night's start;
    # span-from-hatch is the number that matters for pacing, not lobby time.
    hatches = [ts(e['ts']) for e in events if e.get('type') == 'hatch']
    print(f'events {len(events)} · players {len(players)} · chat {len(d.get("chat") or [])} '
          f'· firsts {len(d.get("firsts") or [])} · fogReveals {len(d.get("fogReveals") or [])}')
    print(f'log span      {first_ev} → {last_ev}  ({hrs(first_ev, last_ev):.1f} h)')
    if hatches:
        print(f'play span     {min(hatches)} → {last_ev}  ({hrs(min(hatches), last_ev):.1f} h from first hatch)')
        print(f'hatch stagger first {min(hatches).strftime("%H:%M")} · last {max(hatches).strftime("%H:%M")} '
              f'({hrs(min(hatches), max(hatches)):.1f} h apart)')

    # ── Roster ───────────────────────────────────────────────────────────────
    rule('ROSTER & OUTCOMES  (sorted by Renown)')
    hdr = (f'{"player":<10}{"species/form":<26}{"T·Lv":<7}{"renown":>7}{"rolls":>7}'
           f'{"wild":>6}{"pvp":>5}{"POI":>5}{"boss":>7}{"deaths":>8}{"spores":>8}{"joined":>8}{"active":>8}')
    print(hdr)
    print('-' * len(hdr))
    for p in players:
        m = p.get('metrics') or {}
        j, la = ts(p.get('joinedAt')), ts(p.get('lastActionAt'))
        print(f'{p.get("username", "?"):<10}'
              f'{(p.get("species", "") + "/" + str(p.get("form", ""))):<26}'
              f'{"T%d·%d" % (p.get("tier", 0), p.get("level", 0)):<7}'
              f'{renown(p):>7}{m.get("rolls", 0):>7}{p.get("wildWins", 0):>6}'
              f'{p.get("pvpWins", 0):>5}{len(p.get("poiClaims") or []):>5}'
              f'{p.get("bossDamage", 0):>7}{m.get("deaths", 0):>8}{p.get("spores", 0):>8}'
              f'{j.strftime("%H:%M") if j else "—":>8}{hrs(j, la):>7.1f}h')

    # Renown composition — the "is the leaderboard just POI claims?" question.
    rule('RENOWN COMPOSITION')
    tot = collections.Counter()
    for p in players:
        parts = {'combat wins': p.get('winRenown', RENOWN['per_wild_win'] * p.get('wildWins', 0)),
                 'POI claims': RENOWN['per_poi'] * len(p.get('poiClaims') or []),
                 'PvP': RENOWN['per_pvp_win'] * p.get('pvpRenownWins', p.get('pvpWins', 0)),
                 'boss dmg': p.get('bossDamage', 0) // RENOWN['boss_damage_per_point']}
        tot.update(parts)
        print(f'  {p.get("username", "?"):<10} ' + '  '.join(f'{k} {v:>4}' for k, v in parts.items()))
    grand = sum(tot.values())
    print(f'\n  {"TOTAL":<10} ' + '  '.join(f'{k} {v:>4} ({pct(v, grand).strip()})' for k, v in tot.items()))

    # ── Combat ───────────────────────────────────────────────────────────────
    rule('COMBAT — win rate by enemy class')
    classes = collections.OrderedDict()
    for p in players:
        for k in (p.get('metrics') or {}):
            if k.startswith('battle.') or k.startswith('depths.'):
                classes.setdefault(k.rsplit('.', 1)[0], None)
    names = sorted(classes)
    print(f'{"player":<10}' + ''.join(f'{n.replace("battle.", "").replace("depths.", "d:"):>16}' for n in names))
    agg = collections.Counter()
    for p in players:
        m = p.get('metrics') or {}
        row = f'{p.get("username", "?"):<10}'
        for n in names:
            w, l = m.get(n + '.win', 0), m.get(n + '.loss', 0)
            agg[n + '.win'] += w
            agg[n + '.loss'] += l
            row += f'{(f"{w}-{l} {pct(w, w + l).strip()}" if w + l else "—"):>16}'
        print(row)
    print(f'{"ALL":<10}' + ''.join(
        f'{(f"{agg[n + chr(46) + chr(119) + chr(105) + chr(110)]}-{agg[n + chr(46) + chr(108) + chr(111) + chr(115) + chr(115)]} " + pct(agg[n + ".win"], agg[n + ".win"] + agg[n + ".loss"]).strip()) if agg[n + ".win"] + agg[n + ".loss"] else "—":>16}'
        for n in names))

    rule('COMBAT — damage ledger')
    print(f'{"player":<10}{"battles":>9}{"dealt":>9}{"taken":>9}{"ratio":>8}{"deaths":>8}{"dealt/battle":>14}')
    for p in players:
        m = p.get('metrics') or {}
        dd, dt_, b = m.get('dmgDealt', 0), m.get('dmgTaken', 0), m.get('battles', 0)
        print(f'{p.get("username", "?"):<10}{b:>9}{dd:>9}{dt_:>9}'
              f'{(dd / dt_ if dt_ else 0):>8.2f}{m.get("deaths", 0):>8}{(dd / b if b else 0):>14.1f}')

    # ── Board / space engagement ─────────────────────────────────────────────
    rule('BOARD — spaces landed on (what the night was actually spent doing)')
    spaces = collections.Counter()
    per = {}
    for p in players:
        m = p.get('metrics') or {}
        c = collections.Counter({k[6:]: v for k, v in m.items() if k.startswith('space.')})
        per[p.get('username')] = c
        spaces.update(c)
    total_spaces = sum(spaces.values())
    for k, v in spaces.most_common():
        who = ' '.join(f'{u}:{c[k]}' for u, c in per.items() if c.get(k))
        print(f'  {k:<16}{v:>5}  {pct(v, total_spaces)}   {who}')
    print(f'  {"TOTAL":<16}{total_spaces:>5}')

    # ── Economy ──────────────────────────────────────────────────────────────
    rule('ECONOMY — held at end of night')
    print(f'{"player":<10}{"spores":>8}{"rested":>8}{"materials":>34}{"bag":>5}{"stash":>7}{"pets":>6}{"gear equipped":>40}')
    unspent = 0
    for p in players:
        unspent += p.get('spores', 0)
        mats = ', '.join(f'{k}:{v}' for k, v in (p.get('materials') or {}).items()) or '—'
        gear = ', '.join(f'{slot}={gear_label(gid)}'
                         for slot, gid in (p.get('gear') or {}).items()) or '—'
        print(f'{p.get("username", "?"):<10}{p.get("spores", 0):>8}{p.get("rested", 0):>8}{mats:>34}'
              f'{len(p.get("bag") or []):>5}{len(p.get("gearStash") or []):>7}{len(p.get("pets") or []):>6}  {gear}')
    print(f'\n  unspent spores across the table: {unspent}')

    rule('GEAR — found vs rarity cap hits')
    gear_m = collections.Counter()
    for p in players:
        for k, v in (p.get('metrics') or {}).items():
            if k.startswith('gear.'):
                gear_m[k] += v
    for k, v in sorted(gear_m.items()):
        print(f'  {k:<24}{v:>5}')

    # ── Progression ──────────────────────────────────────────────────────────
    rule('PROGRESSION — XP & levelling pace')
    print(f'{"player":<10}{"level":>7}{"tier":>6}{"xp(bank)":>10}{"xpGained":>10}{"statPts":>9}{"atk/def/spd":>16}{"evolvedAt":>12}')
    for p in players:
        m = p.get('metrics') or {}
        ev = ts(p.get('evolvedAt'))
        print(f'{p.get("username", "?"):<10}{p.get("level", 0):>7}{p.get("tier", 0):>6}{p.get("xp", 0):>10}'
              f'{m.get("xpGained", 0):>10}{p.get("statPoints", 0):>9}'
              f'{f"{p.get(chr(97)+chr(116)+chr(107), 0)}/{p.get(chr(100)+chr(101)+chr(102), 0)}/{p.get(chr(115)+chr(112)+chr(100), 0)}":>16}'
              f'{ev.strftime("%H:%M") if ev else "—":>12}')

    lvl = [e for e in events if e.get('type') == 'level']
    if lvl:
        print('\n  level-up timeline (first time each player reaches a level):')
        seen = {}
        for e in lvl:
            who = (e.get('actor') or '').replace('user-', '')
            seen.setdefault(who, []).append(ts(e['ts']).strftime('%H:%M'))
        for who, times in seen.items():
            print(f'    {who:<10}{len(times):>3} level-ups: {" ".join(times)}')

    # ── Activity over time ───────────────────────────────────────────────────
    rule('ACTIVITY — events per hour')
    by_hour = collections.Counter(ts(e['ts']).strftime('%m-%d %H:00') for e in events)
    actors_by_hour = collections.defaultdict(set)
    for e in events:
        if e.get('actor'):
            actors_by_hour[ts(e['ts']).strftime('%m-%d %H:00')].add(e['actor'])
    peak = max(by_hour.values())
    for h in sorted(by_hour):
        n = by_hour[h]
        print(f'  {h}  {n:>4}  {"#" * int(28 * n / peak):<28} {len(actors_by_hour[h])} active')

    # ── Event log shape ──────────────────────────────────────────────────────
    rule('EVENT TYPES')
    for k, v in collections.Counter(e.get('type') for e in events).most_common():
        print(f'  {k:<14}{v:>5}  {pct(v, len(events))}')

    # ── Social ───────────────────────────────────────────────────────────────
    rule('SOCIAL')
    for t in ('poke', 'high-five', 'compost', 'chat'):
        sub = [e for e in events if e.get('type') == t]
        by = collections.Counter((e.get('actor') or '?').replace('user-', '') for e in sub)
        print(f'  {t:<11}{len(sub):>4}  ' + ' '.join(f'{k}:{v}' for k, v in by.most_common()))
    print(f'\n  pokes received: ' + ' '.join(
        f'{p.get("username")}:{p.get("pokesReceived", 0)}' for p in players))
    for c in (d.get('chat') or []):
        print(f'  chat  {c.get("ts", "")[:19]}  {c.get("username") or c.get("userId")}: {c.get("text")}')

    # ── World state ──────────────────────────────────────────────────────────
    rule('WORLD STATE at close')
    for key in ('boss', 'finale', 'worldEvent', 'swarm', 'enraged'):
        v = d.get(key)
        if v:
            print(f'  {key}: ' + json.dumps({k: x for k, x in v.items() if k not in ('pk', 'sk')}))
    for lair in (d.get('lairs') or []):
        print(f'  lair: ' + json.dumps({k: x for k, x in lair.items() if k not in ('pk', 'sk')}))

    rule('FIRSTS  (each is 25 renown)')
    for f in sorted(d.get('firsts') or [], key=lambda x: x.get('at') or ''):
        print(f'  {(f.get("at") or "")[:19]}  {f.get("sk", "").replace("FIRST#", ""):<22} '
              f'{(f.get("username") or f.get("userId") or "?")}')

    # Sigils + boss runs are the night's spine; print the raw lines.
    rule('SPINE — sigil / boss / evolve / claim events verbatim')
    for e in events:
        if e.get('type') in ('sigil', 'boss', 'evolve', 'claim', 'season', 'jackpot', 'vault', 'trove'):
            print(f'  {e["ts"][:19]}  {e.get("type"):<8} {e.get("text", "")}')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'undercity-session-20260919-130131.json')
