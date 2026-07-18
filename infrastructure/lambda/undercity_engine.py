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


# ── Stance triangle (spec 2026-07-14 §1) ─────────────────────────────────────
# Aggress beats Feint, Feint beats Guard, Guard beats Aggress. Returns the side
# that WINS the exchange ('attacker'|'defender') or the mirror kind.
_BEATS = {('aggress', 'feint'), ('feint', 'guard'), ('guard', 'aggress')}
_MIRROR = {'aggress': 'clash', 'guard': 'stall', 'feint': 'whiff'}


def exchange_winner(a_stance: str, d_stance: str) -> str:
    if a_stance == d_stance:
        return _MIRROR[a_stance]
    if (a_stance, d_stance) in _BEATS:
        return 'attacker'
    return 'defender'


def flee_attempt(fleer: Combatant, enemy: Combatant, rng) -> dict:
    """
    One flee action (replaces the old flee stance). Uses the existing
    SPD-based flee_chance + home-biome bonus; a smoke spore auto-succeeds a
    failed roll. On failure the fleer is caught off guard (-1 DEF).
    """
    chance = min(95, flee_chance(fleer.spd, enemy.spd) + fleer.flee_bonus)
    if rng.random() * 100 < chance:
        return {'escaped': True, 'smokeSporeUsed': False}
    if fleer.has_smoke_spore:
        return {'escaped': True, 'smokeSporeUsed': True}
    fleer.dfn = max(0, fleer.dfn - 1)
    return {'escaped': False, 'smokeSporeUsed': False}


# ── Monster AI (spec §1) ─────────────────────────────────────────────────────

def pick_stance(personality: str, rng) -> str:
    """Draw a monster's true stance from its personality weight triple."""
    weights = data.STANCE_PERSONALITIES.get(
        personality, data.STANCE_PERSONALITIES[data.NPC_DEFAULT_PERSONALITY])
    r = rng.random()
    cum = 0.0
    for stance, w in zip(data.STANCES, weights):
        cum += w
        if r < cum:
            return stance
    return data.STANCES[-1]


def telegraph(actual: str, bluff: float, rng) -> str:
    """What the monster SHOWS for its upcoming stance — the truth, unless it
    bluffs (rng.random() < bluff), in which case it shows one of the other two."""
    if rng.random() < bluff:
        others = [s for s in data.STANCES if s != actual]
        return others[rng.randint(0, len(others) - 1)]
    return actual


def _base_hit(striker: Combatant, target: Combatant, rng, pierce: int = 0) -> int:
    """The raw ATK-vs-DEF hit before stance multipliers. Floors at 1. A pending
    dmg_penalty (from a Serrated feint) is spent here on the striker's next hit."""
    swing = round(striker.atk * rng.uniform(0.85, 1.15))
    hit = max(1, swing - max(0, target.dfn - pierce))
    if striker.dmg_penalty:
        hit = max(1, hit - striker.dmg_penalty)
        striker.dmg_penalty = 0
    return hit


def _deal(striker, target, side, rnd, raw, mult, entries, tag=None):
    """Apply round(raw*mult) damage striker->target; log an entry; drain_life."""
    dmg = max(0, round(raw * mult))
    if dmg <= 0:
        return
    target.hp -= dmg
    entry = {'round': rnd, 'by': side, 'dmg': dmg}
    if tag:
        entry[tag] = True
    if striker.has('drain_life'):
        heal = round(dmg * 0.5)
        striker.hp = min(striker.max_hp, striker.hp + heal)
        entry['heal'] = heal
    entries.append(entry)


def _scavenge(loser, winner, loser_side, rnd, entries):
    """A losing combatant with scavenge retaliates a flat amount."""
    if loser.has('scavenge') and winner.hp > 0:
        winner.hp -= data.SCAVENGE_RETALIATE
        entries.append({'round': rnd, 'by': loser_side, 'dmg': data.SCAVENGE_RETALIATE,
                        'retaliation': True})


def resolve_round(attacker, defender, a_stance, d_stance, rnd, rng,
                  force_winner=None, double_win_for=None, negate_loss_for=None) -> list:
    """
    Resolve ONE round given both stances. Mutates both combatants. Returns a
    list of log entries. Damage magnitude comes from _base_hit; the triangle
    picks who lands the amplified hit.

    Optional one-round modifiers (combat consumables map onto these):
      force_winner    'attacker'|'defender' — override the triangle result.
      double_win_for  side — double that side's damage if it wins the exchange.
      negate_loss_for side — cancel the punish that side takes if it loses.
    """
    entries = []
    winner = exchange_winner(a_stance, d_stance)
    if force_winner in ('attacker', 'defender'):
        winner = force_winner
    entries.append({'round': rnd, 'winner': winner,
                    'aStance': a_stance, 'dStance': d_stance})

    if winner in ('attacker', 'defender'):
        win_side = winner
        lose_side = 'defender' if winner == 'attacker' else 'attacker'
        winr, losr = ((attacker, defender) if winner == 'attacker'
                      else (defender, attacker))
        win_stance = a_stance if winner == 'attacker' else d_stance

        if negate_loss_for == lose_side:
            # loser cancels the decisive punish (rot/swarm tail still applies).
            entries.append({'round': rnd, 'by': win_side, 'dmg': 0,
                            'negated': True, 'winner': win_side})
        elif losr.has('flyby') and rng.random() < data.FLYBY_DODGE:
            # loser evades the whole punish.
            entries.append({'round': rnd, 'by': win_side, 'dmg': 0,
                            'miss': True, 'winner': win_side})
        elif win_stance == 'guard':
            # Guard beats Aggress: aggressor's hit is mitigated, guard counters.
            raw_agg = _base_hit(losr, winr, rng)
            _deal(losr, winr, lose_side, rnd, raw_agg,
                  data.STANCE_GUARD_MITIGATE, entries, tag='mitigated')
            ctr_mult = data.STANCE_GUARD_COUNTER * (1.5 if winr.has_rider('spiked') else 1.0)
            if double_win_for == win_side:
                ctr_mult *= 2
            raw_ctr = _base_hit(winr, losr, rng)
            _deal(winr, losr, win_side, rnd, raw_ctr, ctr_mult, entries, tag='counter')
            if winr.has_buff('harden_shell'):
                heal = min(winr.max_hp - winr.hp, 3)
                if heal:
                    winr.hp += heal
                    entries.append({'round': rnd, 'by': win_side, 'heal': heal})
            _scavenge(losr, winr, lose_side, rnd, entries)
        else:
            lose_stance = d_stance if winner == 'attacker' else a_stance
            pierce = (data.DEATHTOUCH_PIERCE
                      if win_stance == 'aggress' and winr.has('deathtouch_stomp') else 0)
            raw = _base_hit(winr, losr, rng, pierce)
            mult = data.STANCE_WIN_MULT
            if winr.has_rider('deep_biter'):
                mult += 0.5
            bonus = 0
            if not winr.first_win_used:
                if winr.has('rot_breath'):
                    mult *= data.FIRST_WIN_ROT_BREATH_MULT
                if winr.has('venom_barb'):
                    bonus += data.VENOM_BARB_BONUS
                winr.first_win_used = True
            dmg = max(0, round(raw * mult) + bonus)
            if double_win_for == win_side:
                dmg *= 2
            # trickster: a lost Feint is not fully punished.
            if lose_stance == 'feint' and losr.has_rider('trickster'):
                dmg = round(dmg / 2)
            if dmg > 0:
                losr.hp -= dmg
                entry = {'round': rnd, 'by': win_side, 'dmg': dmg, 'winner': win_side}
                if winr.has('drain_life'):
                    heal = round(dmg * 0.5)
                    winr.hp = min(winr.max_hp, winr.hp + heal); entry['heal'] = heal
                entries.append(entry)
            # A winning Feint: serrated debuffs enemy next round; glint reveals.
            if win_stance == 'feint':
                if winr.has_rider('serrated'):
                    losr.dmg_penalty += 2
                if winr.has_rider('glint') or winr.has_buff('glowveil'):
                    winr.reveal_next = True
            # Feint into an Aggress still lands a poke: the caught feinter takes
            # the big hit but chips the aggressor back.
            if lose_stance == 'feint' and losr.hp > 0:
                chip_raw = _base_hit(losr, winr, rng)
                _deal(losr, winr, lose_side, rnd, chip_raw, data.STANCE_STALL_MULT,
                      entries, tag='chip')
            _scavenge(losr, winr, lose_side, rnd, entries)
    elif winner == 'clash':
        # A-vs-A: both strike full; SPD-first lands first (matters for a kill).
        # first_bite forces striking first regardless of SPD.
        if attacker.has('first_bite') and not defender.has('first_bite'):
            first = 'attacker'
        elif defender.has('first_bite') and not attacker.has('first_bite'):
            first = 'defender'
        else:
            first = 'attacker' if attacker.spd >= defender.spd else 'defender'
        order = [first, 'defender' if first == 'attacker' else 'attacker']
        for side in order:
            s, t = ((attacker, defender) if side == 'attacker'
                    else (defender, attacker))
            if s.hp <= 0:
                continue
            raw = _base_hit(s, t, rng)
            _deal(s, t, side, rnd, raw, data.STANCE_CLASH_MULT, entries)
    elif winner == 'stall':
        # G-vs-G: both fully block — NO damage, unless a Thick carapace chips
        # through (its whole identity: "Guard chips even in a stall").
        for side, (s, t) in (('attacker', (attacker, defender)),
                             ('defender', (defender, attacker))):
            if s.has_rider('thick'):
                raw = _base_hit(s, t, rng)
                _deal(s, t, side, rnd, raw, data.STANCE_STALL_MULT, entries, tag='chip')
    elif winner == 'whiff':
        # F-vs-F: two tricks cancel, but both still poke — each takes chip.
        for side, (s, t) in (('attacker', (attacker, defender)),
                             ('defender', (defender, attacker))):
            raw = _base_hit(s, t, rng)
            _deal(s, t, side, rnd, raw, data.STANCE_STALL_MULT, entries, tag='chip')

    # Swarm: one extra chip hit per round regardless of stance (min 1).
    for side, (s, t) in (('attacker', (attacker, defender)),
                         ('defender', (defender, attacker))):
        if s.has('swarm') and s.hp > 0 and t.hp > 0:
            chip = max(1, round(_base_hit(s, t, rng) * data.SWARM_CHIP_MULT))
            t.hp -= chip
            entry = {'round': rnd, 'by': side, 'dmg': chip, 'swarm': True}
            if s.has('drain_life'):
                heal = round(chip * 0.5)
                s.hp = min(s.max_hp, s.hp + heal); entry['heal'] = heal
            entries.append(entry)

    # Rot DoT ticks at end of round (stacks present at round start).
    for side, c in (('attacker', attacker), ('defender', defender)):
        if c.rot_stacks > 0 and c.hp > 0:
            tick = c.rot_stacks * data.ROT_PER_STACK
            c.hp -= tick
            entries.append({'round': rnd, 'by': side, 'dmg': tick, 'rot': True})

    # Barbed rider / Rot Surge buff: an Aggress applies +1 rot to the target
    # regardless of win/loss. Applied AFTER the tick so a fresh stack first
    # ticks next round.
    for side, (s, t), st in (('attacker', (attacker, defender), a_stance),
                             ('defender', (defender, attacker), d_stance)):
        if st == 'aggress' and (s.has_rider('barbed') or s.has_buff('rot_surge')) and t.hp > 0:
            t.rot_stacks += 1
            entries.append({'round': rnd, 'by': side, 'rotApplied': 1})

    return entries


def resolve_battle_rounds(attacker, defender, rng, pick_a, pick_d) -> dict:
    """
    Drive resolve_round for up to MAX_ROUNDS_COMBAT rounds. pick_a/pick_d are
    callables (me, foe, rnd, rng) -> stance. Applies Regrowth to survivors and
    resolves a timeout by higher HP%. Combatants are mutated/consumed.
    """
    strikes = []
    outcome = 'timeout'
    for rnd in range(1, data.MAX_ROUNDS_COMBAT + 1):
        a_stance = pick_a(attacker, defender, rnd, rng)
        d_stance = pick_d(defender, attacker, rnd, rng)
        strikes.extend(resolve_round(attacker, defender, a_stance, d_stance, rnd, rng))
        if defender.hp <= 0 and attacker.hp <= 0:
            outcome = 'attacker' if attacker.hp >= defender.hp else 'defender'
            break
        if defender.hp <= 0:
            outcome = 'attacker'; break
        if attacker.hp <= 0:
            outcome = 'defender'; break

    if outcome == 'timeout':
        a_pct = attacker.hp / attacker.max_hp if attacker.max_hp else 0
        d_pct = defender.hp / defender.max_hp if defender.max_hp else 0
        if a_pct != d_pct:
            outcome = 'attacker' if a_pct > d_pct else 'defender'

    for c in (attacker, defender):
        if c.hp > 0 and c.has('regrowth'):
            pct = 0.35 if c.has('rootwall') else 0.20
            c.hp = min(c.max_hp, c.hp + round(c.max_hp * pct))

    return {'outcome': outcome, 'strikes': strikes,
            'attackerHp': max(0, attacker.hp), 'defenderHp': max(0, defender.hp),
            'smokeSporeUsed': False, 'defenderFleeFailed': False}


def _always_policy(stance):
    return lambda me, foe, rnd, rng: stance


_LEGACY_STANCE = {'fight': 'aggress', 'defend': 'guard'}


def resolve_battle(attacker: Combatant, defender: Combatant, rng) -> dict:
    """
    Back-compat wrapper for existing call sites. Legacy `.stance` values map to
    fixed triangle policies (fight->aggress, defend->guard). A defender set to
    `flee` attempts to flee first (as before). This path is a transitional
    stopgap; interactive PvE and monster AI arrive in Plan 2.
    """
    if defender.stance == 'flee':
        r = flee_attempt(defender, attacker, rng)
        if r['escaped']:
            return {'outcome': 'fled', 'strikes': [], 'attackerHp': attacker.hp,
                    'defenderHp': defender.hp,
                    'smokeSporeUsed': r['smokeSporeUsed'], 'defenderFleeFailed': False}
        flee_failed = True
    else:
        flee_failed = False

    a_pol = _always_policy(_LEGACY_STANCE.get(attacker.stance, 'aggress'))
    d_pol = _always_policy(_LEGACY_STANCE.get(defender.stance, 'aggress'))
    res = resolve_battle_rounds(attacker, defender, rng, a_pol, d_pol)
    res['defenderFleeFailed'] = flee_failed
    return res


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
    """Spend one banked stat point on any core stat (GDD §5).

    Points can be stacked freely — multiple into a single stat is allowed;
    the only limit is how many banked points you have."""
    if stat not in ('atk', 'def', 'spd'):
        return False
    if player.get('statPoints', 0) < 1:
        return False
    player[stat] += 1
    player['statPoints'] -= 1
    spent = player.setdefault('spentThisLevel', {'atk': 0, 'def': 0, 'spd': 0})
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


def regen_rolls(player: dict, now_iso: str) -> None:
    """Bank +1 roll per full ROLL_REGEN_MINUTES since rollRegenAt, lazily,
    capped at ROLL_CAP. The timestamp advances by whole intervals only, so
    partial progress toward the next roll is never lost — and it advances
    even at cap, so a full bank doesn't stockpile hidden progress."""
    last = player.get('rollRegenAt')
    if not last:
        player['rollRegenAt'] = now_iso
        return
    minutes = (_parse_iso(now_iso) - _parse_iso(last)).total_seconds() / 60
    intervals = int(minutes // data.ROLL_REGEN_MINUTES)
    if intervals <= 0:
        return
    player['rolls'] = min(data.ROLL_CAP, player.get('rolls', 0) + intervals)
    advanced = _parse_iso(last) + timedelta(minutes=intervals * data.ROLL_REGEN_MINUTES)
    player['rollRegenAt'] = advanced.strftime(_ISO)


# ── Mystery table (GDD §6, d12) ──────────────────────────────────────────────

def roll_mystery(rng, has_drift: bool, has_doubling_rot: bool, biome: str = None) -> dict:
    """
    Roll the d12 mystery table. Returns a description of what happened; the db
    layer applies it. Spore gains double with Doubling Rot; losses never do.
    Drift rerolls a bad outcome (8–11) once. `biome` is the region of the node
    the player currently occupies (a key of data.BIOMES, or None outside the
    home rings) and reflavors rolls 1 and 7 for a few of the five biomes.
    """
    roll = rng.randint(1, 12)
    if has_drift and 8 <= roll <= 11:
        roll = rng.randint(1, 12)

    mult = 2 if has_doubling_rot else 1
    out = {'roll': roll, 'spores': 0, 'xp': 0, 'hpPct': 0, 'item': None,
           'paint': False, 'hat': False, 'heal': False, 'buff': None,
           'teleport': False, 'curse': False}
    if roll == 1:
        if biome == 'garden':
            out.update(text='Composting spores overflow the mulch pile. +{} Spores.'.format(26 * mult),
                        spores=26 * mult)
        elif biome == 'city':
            out.update(text='A storm-drain stash, rat-picked and ready. +{} Spores.'.format(26 * mult),
                        spores=26 * mult)
        else:
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
        if biome == 'cavern':
            out.update(text='Glowcap mist swirls, quick and hard to pin down. +2 SPD next battle.',
                        buff='glowveil')
        elif biome == 'bog':
            out.update(text='Mire mud sets like armor. +2 DEF next battle.', buff='harden_shell')
        elif biome == 'bone':
            out.update(text='Marrow stiffens under your skin. +2 DEF next battle.', buff='harden_shell')
        else:
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
