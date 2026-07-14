"""
Pure rules engine for The Undercity (GDD §5–§8).

No boto3, no clocks, no global randomness — every function takes its inputs
(including an rng with .uniform/.random/.randint/.choice) so the whole module
is deterministic under test. The DynamoDB layer (undercity_db) translates
player documents to/from these functions.
"""
from dataclasses import dataclass, field
from datetime import datetime, timedelta

import undercity_data as data

MAX_ROUNDS = 6
DEFEND_DEF_MULT = 1.4
DEFEND_DMG_MULT = 0.75
FLYBY_MISS = 0.25


# ── Combatants ───────────────────────────────────────────────────────────────

@dataclass
class Combatant:
    name: str
    hp: int
    max_hp: int
    atk: int
    dfn: int
    spd: int
    passives: frozenset = frozenset()
    stance: str = 'fight'          # legacy pre-battle stance (back-compat only)
    level: int = 1
    has_smoke_spore: bool = False
    flee_bonus: int = 0            # home-biome perk (Glowblessed: +10)
    riders: frozenset = frozenset()   # gear rider tags (barbed, spiked, glint, ...)
    buffs: frozenset = frozenset()    # active stance-modifier buff kinds
    # internal battle state (mutated during a battle)
    rot_stacks: int = field(default=0, repr=False)
    first_win_used: bool = field(default=False, repr=False)
    dmg_penalty: int = field(default=0, repr=False)   # -damage on NEXT round (serrated)
    reveal_next: bool = field(default=False, repr=False)  # glint set a reveal
    struck_yet: bool = field(default=False, repr=False)

    def has(self, passive):
        return passive in self.passives

    def has_rider(self, rider):
        return rider in self.riders

    def has_buff(self, kind):
        return kind in self.buffs


def flee_chance(flee_spd: int, enemy_spd: int) -> int:
    """Escape % for the fleeing side (GDD §7), clamped 10–90."""
    return max(10, min(90, 35 + 5 * (flee_spd - enemy_spd)))


def _effective_def(target: Combatant, striker: Combatant) -> int:
    d = target.dfn
    if target.stance == 'defend':
        d = round(d * DEFEND_DEF_MULT)
    if striker.has('deathtouch_stomp'):
        d = max(0, d - 3)
    return d


def _strike(striker, target, side, rnd, first_of_round_for_striker, rng, strikes):
    """One strike; appends entries to `strikes`; returns True if target died."""
    base = round(striker.atk * rng.uniform(0.85, 1.15))
    if striker.has('venom_barb') and not striker.struck_yet:
        base += 3
    dmg = max(1, base - _effective_def(target, striker))
    if striker.stance == 'defend':
        dmg = max(1, round(dmg * DEFEND_DMG_MULT))
    if striker.has('rot_breath') and rnd == 1 and first_of_round_for_striker:
        dmg *= 2

    entry = {'round': rnd, 'by': side, 'dmg': dmg}

    if target.has('flyby') and rng.random() < FLYBY_MISS:
        entry['dmg'] = 0
        entry['miss'] = True
        strikes.append(entry)
        striker.struck_yet = True
        return False

    target.hp -= dmg
    if striker.has('drain_life'):
        heal = round(dmg * 0.5)
        striker.hp = min(striker.max_hp, striker.hp + heal)
        entry['heal'] = heal
    strikes.append(entry)
    striker.struck_yet = True

    if target.hp <= 0:
        return True

    if target.has('scavenge'):
        striker.hp -= 2
        strikes.append({'round': rnd, 'by': 'defender' if side == 'attacker' else 'attacker',
                        'dmg': 2, 'retaliation': True})
        if striker.hp <= 0:
            return False  # striker died to retaliation; caller checks hp
    return False


def _round_order(attacker: Combatant, defender: Combatant, rnd: int):
    """Yield ('attacker'|'defender') strike order for a round."""
    if rnd == 1 and (attacker.has('first_bite') or defender.has('first_bite')):
        first = 'attacker' if attacker.has('first_bite') else 'defender'
    elif attacker.spd >= defender.spd:
        first = 'attacker'
    else:
        first = 'defender'
    order = [first, 'defender' if first == 'attacker' else 'attacker']
    # Swarm: one extra strike per round, taken immediately after the normal one.
    out = []
    for side in order:
        out.append(side)
        c = attacker if side == 'attacker' else defender
        if c.has('swarm'):
            out.append(side)
    return out


def resolve_battle(attacker: Combatant, defender: Combatant, rng) -> dict:
    """
    Resolve a full battle. Returns
      {outcome: 'attacker'|'defender'|'timeout'|'fled', strikes: [...],
       attackerHp, defenderHp, smokeSporeUsed, defenderFleeFailed}
    HP values in the result are final (post-Regrowth). Combatant objects are
    mutated; callers should treat them as consumed.
    """
    strikes = []
    smoke_used = False
    flee_failed = False

    if defender.stance == 'flee':
        chance = min(95, flee_chance(defender.spd, attacker.spd) + defender.flee_bonus)
        if rng.random() * 100 < chance:
            return {'outcome': 'fled', 'strikes': [], 'attackerHp': attacker.hp,
                    'defenderHp': defender.hp, 'smokeSporeUsed': False,
                    'defenderFleeFailed': False}
        if defender.has_smoke_spore:
            return {'outcome': 'fled', 'strikes': [], 'attackerHp': attacker.hp,
                    'defenderHp': defender.hp, 'smokeSporeUsed': True,
                    'defenderFleeFailed': False}
        flee_failed = True
        defender.dfn = max(0, defender.dfn - 1)  # caught off guard

    outcome = 'timeout'
    for rnd in range(1, MAX_ROUNDS + 1):
        first_striker_done = set()
        for side in _round_order(attacker, defender, rnd):
            striker = attacker if side == 'attacker' else defender
            target = defender if side == 'attacker' else attacker
            if striker.hp <= 0:
                continue
            first_of_round = side not in first_striker_done
            first_striker_done.add(side)
            _strike(striker, target, side, rnd, first_of_round, rng, strikes)
            if target.hp <= 0:
                outcome = side
                break
            if striker.hp <= 0:  # died to scavenge retaliation
                outcome = 'defender' if side == 'attacker' else 'attacker'
                break
        if outcome != 'timeout':
            break

    # Regrowth: survivors heal 20% max (35% with Rootwall) after any battle.
    for c in (attacker, defender):
        if c.hp > 0 and c.has('regrowth'):
            pct = 0.35 if c.has('rootwall') else 0.20
            c.hp = min(c.max_hp, c.hp + round(c.max_hp * pct))

    return {'outcome': outcome, 'strikes': strikes,
            'attackerHp': max(0, attacker.hp), 'defenderHp': max(0, defender.hp),
            'smokeSporeUsed': smoke_used, 'defenderFleeFailed': flee_failed}


def pvp_spore_steal(loser_spores: int, loser_stance: str, winner_passives: frozenset) -> int:
    """Spores the PvP winner steals (GDD §7 stakes + Deathrite)."""
    pct = data.PVP_SPORE_STEAL_DEFEND if loser_stance == 'defend' else data.PVP_SPORE_STEAL
    amount = loser_spores * pct
    if 'deathrite' in winner_passives:
        amount *= data.DEATHRITE_STEAL_MULT
    return int(amount)


# ── Movement ─────────────────────────────────────────────────────────────────

def legal_destinations(nodes: dict, start: str, steps: int,
                       closed: frozenset = frozenset()) -> set:
    """
    Dokapon exact-count movement: every node reachable in exactly `steps`
    edges without immediately reversing the previous edge. Dead-end branches
    shorter than the roll simply contribute nothing. `closed` holds sealed
    barrier nodes: a walk that reaches one STOPS at it (spending the rest of
    the roll) so you can always march up to a barrier to challenge its
    guardian — but it never walks THROUGH it into the sealed area beyond.
    """
    results = set()
    stack = [(start, None, steps)]
    seen = set()
    while stack:
        node, prev, remaining = stack.pop()
        if remaining == 0:
            results.add(node)
            continue
        if node in closed and node != start:
            # Bonk: you march up to the sealed wall and STOP there, spending
            # the rest of the roll — so a barrier is always reachable when you
            # walk toward it, not only on an exact-count landing. Never a
            # corridor: we still don't expand through it.
            results.add(node)
            continue
        key = (node, prev, remaining)
        if key in seen:
            continue
        seen.add(key)
        for nb in nodes[node]['neighbors']:
            if nb == prev:
                continue
            stack.append((nb, node, remaining - 1))
    results.discard(start)
    return results


def board_distance(nodes: dict, start: str, goal: str, max_steps: int,
                   closed: frozenset = frozenset()) -> int | None:
    """
    Shortest hop count from start to goal, or None past max_steps. Plain BFS —
    unlike movement there is no exact-count or no-backtrack rule. `closed`
    (sealed barriers) blocks passage but may be the goal itself.
    """
    if start == goal:
        return 0
    frontier = {start}
    seen = {start}
    for dist in range(1, max_steps + 1):
        nxt = set()
        for node in frontier:
            if node != start and node in closed:
                continue  # sealed: never a corridor
            for nb in nodes[node]['neighbors']:
                if nb in seen:
                    continue
                if nb == goal:
                    return dist
                seen.add(nb)
                nxt.add(nb)
        frontier = nxt
        if not frontier:
            break
    return None


def spell_dodge_chance(caster_spd: int, target_spd: int) -> int:
    """Field-spell dodge %, clamped (spec §2.4)."""
    raw = data.SPELL_DODGE_BASE + data.SPELL_DODGE_PER_SPD * (target_spd - caster_spd)
    return max(data.SPELL_DODGE_MIN, min(data.SPELL_DODGE_MAX, raw))


# ── Leveling ─────────────────────────────────────────────────────────────────

def apply_level_ups(player: dict) -> int:
    """Consume banked XP into levels. Returns number of levels gained."""
    gained = 0
    while (player['level'] < data.LEVEL_CAP
           and player['xp'] >= data.xp_to_next(player['level'])):
        player['xp'] -= data.xp_to_next(player['level'])
        player['level'] += 1
        player['maxHp'] += data.HP_PER_LEVEL
        player['hp'] += data.HP_PER_LEVEL
        player['statPoints'] = player.get('statPoints', 0) + data.STAT_POINTS_PER_LEVEL
        player['spentThisLevel'] = {'atk': 0, 'def': 0, 'spd': 0}
        gained += 1
    return gained


def spend_stat(player: dict, stat: str) -> bool:
    """Spend one banked stat point; max +1 per stat per level (GDD §5)."""
    if stat not in ('atk', 'def', 'spd'):
        return False
    if player.get('statPoints', 0) < 1:
        return False
    spent = player.setdefault('spentThisLevel', {'atk': 0, 'def': 0, 'spd': 0})
    if spent.get(stat, 0) >= 1:
        return False
    player[stat] += 1
    player['statPoints'] -= 1
    spent[stat] = spent.get(stat, 0) + 1
    return True


# ── Effective stats (gear + buffs) ──────────────────────────────────────────

def effective_stats(player: dict) -> dict:
    eff = {'atk': player.get('atk', 0), 'def': player.get('def', 0),
           'spd': player.get('spd', 0), 'maxHp': player.get('maxHp', 0)}
    for gear_id in (player.get('gear') or {}).values():
        g = data.GEAR.get(gear_id)
        if not g:
            continue
        for stat in ('atk', 'def', 'spd', 'maxHp'):
            eff[stat] += g.get(stat, 0)
    for buff in (player.get('buffs') or []):
        if buff.get('kind') == 'rot_surge':
            eff['atk'] += 3
        elif buff.get('kind') == 'cursed_idol':
            eff['atk'] = max(1, eff['atk'] - 1)
        elif buff.get('kind') == 'bone_chill':
            eff['atk'] = max(1, eff['atk'] - 2)
        elif buff.get('kind') == 'glowveil':
            eff['spd'] += 2
        elif buff.get('kind') == 'harden_shell':
            eff['def'] += 2
        elif buff.get('kind') == 'weaken_hex':
            eff['atk'] = max(1, eff['atk'] - 3)
    return eff


# ── HP regen (the swamp heals its own) ───────────────────────────────────────

_ISO = '%Y-%m-%dT%H:%M:%S'


def _parse_iso(ts: str) -> datetime:
    return datetime.fromisoformat(ts.split('+')[0].split('Z')[0])


def regen_hp(player: dict, now_iso: str) -> None:
    """Apply 10% max HP per full 10 minutes since hpUpdatedAt, lazily."""
    last = player.get('hpUpdatedAt')
    if not last:
        player['hpUpdatedAt'] = now_iso
        return
    max_hp = effective_stats(player)['maxHp']
    minutes = (_parse_iso(now_iso) - _parse_iso(last)).total_seconds() / 60
    intervals = int(minutes // data.HP_REGEN_INTERVAL_MIN)
    if intervals <= 0:
        return
    if player['hp'] < max_hp:
        heal = intervals * round(max_hp * data.HP_REGEN_PCT)
        player['hp'] = min(max_hp, player['hp'] + heal)
    advanced = _parse_iso(last) + timedelta(minutes=intervals * data.HP_REGEN_INTERVAL_MIN)
    player['hpUpdatedAt'] = advanced.strftime(_ISO)


# ── Mystery table (GDD §6, d12) ──────────────────────────────────────────────

def roll_mystery(rng, has_drift: bool, has_doubling_rot: bool) -> dict:
    """
    Roll the d12 mystery table. Returns a description of what happened; the db
    layer applies it. Spore gains double with Doubling Rot; losses never do.
    Drift rerolls a bad outcome (8–11) once.
    """
    roll = rng.randint(1, 12)
    if has_drift and 8 <= roll <= 11:
        roll = rng.randint(1, 12)

    mult = 2 if has_doubling_rot else 1
    out = {'roll': roll, 'spores': 0, 'xp': 0, 'hpPct': 0, 'item': None,
           'paint': False, 'hat': False, 'heal': False, 'buff': None,
           'teleport': False, 'curse': False}
    if roll == 1:
        out.update(text='Spore stash! +{} Spores.'.format(20 * mult), spores=20 * mult)
    elif roll == 2:
        out.update(text='A corpse blooms with insight. +10 XP.', xp=10)
    elif roll == 3:
        out.update(text='A lost wardrobe crate! A paint drops.', paint=True)
    elif roll == 4:
        out.update(text='The hat hermit takes a liking to you.', hat=True)
    elif roll == 5:
        out.update(text='A kindly witch mends you fully and cleanses hazards.', heal=True)
    elif roll == 6:
        out.update(text='A free consumable lies discarded.', item='random')
    elif roll == 7:
        out.update(text='Rot surges through you: +3 ATK next battle.', buff='rot_surge')
    elif roll == 8:
        out.update(text='A pickpocket imp! -10 Spores.', spores=-10)
    elif roll == 9:
        out.update(text='Bad mushrooms. Lose 20% of your current HP.', hpPct=-0.20)
    elif roll == 10:
        out.update(text='Cave-in! You are swept to a random tunnel.', teleport=True)
    elif roll == 11:
        out.update(text='A cursed idol whispers: -1 ATK for 20 minutes.', curse=True)
    else:
        out.update(text='JACKPOT BLOOM! +{} Spores, +10 XP, and an item!'.format(30 * mult),
                   spores=30 * mult, xp=10, item='random')
    return out


# ── Wild NPCs ────────────────────────────────────────────────────────────────

def npc_from_spec(spec: dict) -> dict:
    """Instantiate a battle NPC dict from a fixed-stat spec."""
    return {k: spec[k] for k in
            ('id', 'name', 'hp', 'atk', 'def', 'spd', 'bounty', 'xp',
             'itemChance')}


def pick_npc(rng, pool=None) -> dict:
    """Random NPC from a tier pool (defaults to the overworld normal pool)."""
    return npc_from_spec(rng.choice(pool if pool is not None else data.NPCS))
