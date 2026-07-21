"""Combat arena — isolate the fight from the board.

Two jobs the full-game driver can't do cleanly:
  1. Build a creature at a *controlled* power level (exact level + evolution +
     gear) so we can ask "at what power does each enemy tier trivialise?".
  2. Pit it against enemy tiers the wanderer rarely reaches — lair guardians and
     Savra (the boss) — to answer "can build X actually finish the game?".

The fight loop mirrors the shipped interactive combat exactly: each round the
NPC draws a true stance from its personality, shows a (bluffable) telegraph, and
the player gets a READ with probability = their read chance. A read player
COUNTERS what it sees (so a bluff punishes it, as in the real game); an unread
player falls back to its preferred stance.
"""
import random

from sim.harness import GameSim, seed_all, debug_rolls
import undercity_data as data
import undercity_db as db
import undercity_engine as engine
from sim.bots import COUNTER


# ── Enemy registry ───────────────────────────────────────────────────────────

def enemy_registry():
    reg = {}
    for spec in data.NPCS:
        reg[spec['id']] = ('wild', spec)
    for spec in data.ELITE_NPCS:
        reg[spec['id']] = ('elite', spec)
    for spec in data.WILDERNESS_NPCS:
        reg[spec['id']] = ('wild+', spec)
    for spec in data.WILDERNESS_ELITE_NPCS:
        reg[spec['id']] = ('elite+', spec)
    reg['rot_sovereign'] = ('boss', data.ROT_SOVEREIGN)
    return reg


# ── Controlled build construction ─────────────────────────────────────────────

def make_leveled_doc(build, policy, level, seed=0):
    """Return a player doc grown to `level` under `policy` (stat spends +
    evolutions), with `build.gear` equipped and full HP. Uses the real engine
    level-up / evolution logic — no stat maths is re-implemented here."""
    seed_all(seed)
    with debug_rolls(True):
        sim = GameSim(user_id='arena')
        sim.act('join', starter=build.starter, home=build.home)
        while sim.doc()['level'] < level:
            doc = sim.doc()
            doc['xp'] = doc.get('xp', 0) + data.xp_to_next(doc['level'])
            engine.apply_level_ups(doc)
            for stat in policy.spend_stat(doc.get('statPoints', 0), {}):
                engine.spend_stat(doc, stat)
            db._put_player(sim.table, doc)
            doc = sim.doc()
            if doc['tier'] == 1 and doc['level'] >= 5:
                opts = {f: data.TIER2[f] for f in data.tier2_options(doc['species'])}
                sim.raw('evolve', form=policy.choose_evolution(opts))
            elif doc['tier'] == 2 and doc['level'] >= 10:
                opts = {f: data.APEX[f] for f in data.apex_options(doc['form'])}
                if opts:
                    sim.raw('evolve', form=policy.choose_evolution(opts))
        doc = sim.doc()
        if build.gear:
            doc['gear'] = dict(build.gear)
        doc['hp'] = engine.effective_stats(doc)['maxHp']
        db._put_player(sim.table, doc)
        return sim.doc()


# ── One fight ──────────────────────────────────────────────────────────────────

def arena_fight(player_doc, npc_spec, policy, rng, kind='wild'):
    """Run one full interactive fight. Returns dict with won / player_hp_frac /
    dmg_to_npc / rounds. Player enters at full HP."""
    p = db._combatant(player_doc)
    p.hp = p.max_hp
    npc = db._npc_combatant(npc_spec)
    read_chance = db._read_chance(player_doc)
    personality = npc_spec.get('personality', data.NPC_DEFAULT_PERSONALITY)
    bluff = float(npc_spec.get('bluff', data.NPC_DEFAULT_BLUFF))
    npc_start = npc.max_hp

    for rnd in range(1, data.COMBAT_HARD_CAP + 1):
        actual = engine.pick_stance(personality, rng)
        shown = engine.telegraph(actual, bluff, rng)
        telegraph = shown if rng.random() < read_chance else None
        hp_frac = p.hp / p.max_hp if p.max_hp else 0
        stance, _ = policy.combat(kind, telegraph, rnd, hp_frac)
        engine.resolve_round(p, npc, stance, actual, rnd, rng,
                             frenzy_from=data.FRENZY_START)
        if npc.hp <= 0 or p.hp <= 0:
            break

    won = npc.hp <= 0 and p.hp > 0
    return {
        'won': won,
        'player_hp_frac': max(0.0, p.hp) / p.max_hp if p.max_hp else 0,
        'dmg_to_npc': npc_start - max(0, npc.hp),
        'npc_max': npc_start,
        'rounds': rnd,
    }


def winrate(player_doc, npc_spec, policy, trials=400, base_seed=0, kind='wild'):
    """Fraction of `trials` fights the player wins, plus mean survivor HP% and
    mean damage dealt (the boss signal, where wins are rare)."""
    wins = surv = dmg = 0
    for i in range(trials):
        rng = random.Random(base_seed * 100003 + i)
        r = arena_fight(player_doc, npc_spec, policy, rng, kind=kind)
        wins += 1 if r['won'] else 0
        surv += r['player_hp_frac'] if r['won'] else 0
        dmg += r['dmg_to_npc']
    return {
        'winrate': wins / trials,
        'mean_win_hp': (surv / wins) if wins else 0.0,
        'mean_dmg': dmg / trials,
        'npc_max': npc_spec.get('hp'),
    }
