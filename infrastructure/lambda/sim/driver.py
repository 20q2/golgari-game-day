"""Play one full Undercity game with a bot policy and record its trajectory.

`play_game(...)` returns a `GameResult`: a per-turn trajectory plus milestone
turns and a terminal outcome. A "turn" is one roll+move. Rolls are free
(data.DEBUG) so the curve is measured per turn, decoupled from roll income.
"""
import random
from dataclasses import dataclass, field

from sim.harness import GameSim, seed_all, debug_rolls, ActionError
import undercity_data as data
import undercity_engine as engine


# ── Build definition ─────────────────────────────────────────────────────────

@dataclass
class Build:
    starter: str = 'pest'
    home: str = 'city'
    gear: dict = field(default_factory=dict)   # slot -> gear_id, injected at spawn
    label: str = ''

    def name(self):
        return self.label or f'{self.starter}/{self.home}'


# ── Flow-puzzle solver (Hamiltonian path over a small grid) ──────────────────

def solve_flow(puzzle):
    """Return a full solution path [[r,c],...] or None. Backtracking DFS over a
    grid small enough (≈5x5 minus rocks) that this is instant."""
    w, h = puzzle['w'], puzzle['h']
    rocks = {tuple(c) for c in puzzle['rocks']}
    start, end = tuple(puzzle['start']), tuple(puzzle['end'])
    target = w * h - len(rocks)
    cells = {(r, c) for r in range(h) for c in range(w)} - rocks

    def neighbors(cell):
        r, c = cell
        for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            n = (r + dr, c + dc)
            if n in cells:
                yield n

    path, seen = [start], {start}

    def dfs(cur):
        if len(path) == target:
            return cur == end
        for n in neighbors(cur):
            if n in seen:
                continue
            # prune: don't step onto `end` before it's the final cell
            if n == end and len(path) + 1 != target:
                continue
            seen.add(n)
            path.append(n)
            if dfs(n):
                return True
            path.pop()
            seen.discard(n)
        return False

    if not dfs(start):
        return None
    return [[r, c] for (r, c) in path]


# ── Result container ─────────────────────────────────────────────────────────

@dataclass
class GameResult:
    build: str
    bot: str
    seed: int
    trajectory: list = field(default_factory=list)   # per-turn snapshots
    fights: list = field(default_factory=list)        # per-fight records
    milestones: dict = field(default_factory=dict)    # metric -> turn#
    outcome: str = 'turn_cap'
    turns: int = 0
    deaths: int = 0


# ── The driver ────────────────────────────────────────────────────────────────

BATTLE_KINDS = {'battle_start'}
_NODE_TYPE = {nid: n['type'] for nid, n in data.MAP_NODES.items()}


class Driver:
    def __init__(self, build, policy, seed, max_turns=250):
        self.build = build
        self.policy = policy
        self.seed = seed
        self.max_turns = max_turns
        self.res = GameResult(build.name(), policy.name, seed)

    def _mark(self, key, turn):
        self.res.milestones.setdefault(key, turn)

    # -- combat -----------------------------------------------------------------
    def _drive_battle(self, sim, start_event):
        """Resolve a started battle to completion. Returns (finish_event,
        min_hp_frac). finish_event is the spaceEvent with the outcome, or a
        {'type':'flee'} marker."""
        kind = start_event.get('kind')
        telegraph = start_event.get('telegraph')
        rnd = start_event.get('round', 1)
        min_frac = 1.0
        guard = 0
        while True:
            guard += 1
            if guard > 60:                        # safety net; should never hit
                return {'type': 'stuck'}, min_frac
            rec = sim.doc().get('battle')
            if not rec:
                return {'type': 'gone'}, min_frac
            p = rec['player']
            max_hp = p.get('maxHp') or p.get('hp') or 1
            min_frac = min(min_frac, max(0, p.get('hp', 0)) / max_hp)
            hp_frac = max(0, p.get('hp', 0)) / max_hp
            stance, want_flee = self.policy.combat(kind, telegraph, rnd, hp_frac)
            if want_flee:
                st, resp = sim.raw('combat-flee')
                if st == 200 and resp.get('combat', {}).get('fled'):
                    return {'type': 'flee'}, min_frac
                # failed/again — fall through to a normal round
            st, resp = sim.raw('combat-round', stance=stance)
            if st != 200:
                return {'type': 'error', 'resp': resp}, min_frac
            if 'spaceEvent' in resp:
                return resp['spaceEvent'], min_frac
            combat = resp.get('combat', {})
            telegraph = combat.get('telegraph')
            rnd = combat.get('round', rnd + 1)

    # -- post-move housekeeping -------------------------------------------------
    def _settle(self, sim):
        """Resolve pending loot puzzles and respawns after a move/battle."""
        doc = sim.doc()
        if doc.get('pendingLoot'):
            pid = doc['pendingLoot']['puzzleId']
            puzzle = data.flow_puzzle(pid)
            path = solve_flow(puzzle) if puzzle else None
            if path:
                try:
                    sim.act('solve-loot-puzzle', path=path)
                except ActionError:
                    sim.raw('cancel-loot-puzzle')
            else:
                sim.raw('cancel-loot-puzzle')
        doc = sim.doc()
        if doc.get('pendingRespawn'):
            opts = doc['pendingRespawn'].get('options', [])
            if opts:
                sim.raw('respawn', gate=opts[0]['gate'])

    def _spend_and_evolve(self, sim):
        doc = sim.doc()
        # spend banked stat points
        pts = doc.get('statPoints', 0)
        if pts:
            for stat in self.policy.spend_stat(pts, doc.get('spentThisLevel', {})):
                sim.raw('spend-stat', stat=stat)
        # evolve if eligible
        doc = sim.doc()
        tier, level = doc.get('tier', 1), doc.get('level', 1)
        if tier == 1 and level >= 5:
            opts = {f: data.TIER2[f] for f in data.tier2_options(doc['species'])}
            form = self.policy.choose_evolution(opts)
            r = sim.raw('evolve', form=form)
            if r[0] == 200:
                self._mark('evolve_t2', self.res.turns)
        elif tier == 2 and level >= 10:
            opts = {f: data.APEX[f] for f in data.apex_options(doc['form'])}
            if opts:
                form = self.policy.choose_evolution(opts)
                r = sim.raw('evolve', form=form)
                if r[0] == 200:
                    self._mark('evolve_t3', self.res.turns)

    def _shop(self, sim):
        st = sim.state()
        node = sim.doc().get('position')
        bazaar = (st.get('bazaars') or {}).get(node)
        if not bazaar:
            return
        for item in self.policy.shop_buys(sim.doc().get('spores', 0), bazaar,
                                           sim.doc().get('gear', {})):
            sim.raw('buy', itemId=item)

    # -- snapshot ---------------------------------------------------------------
    def _snap(self, sim, event_type, fight_result=None, min_frac=None):
        doc = sim.doc()
        eff = engine.effective_stats(doc)
        row = {
            'turn': self.res.turns,
            'pos': doc.get('position'),
            'region': data.MAP_NODES.get(doc.get('position'), {}).get('region'),
            'level': doc.get('level', 1),
            'tier': doc.get('tier', 1),
            'form': doc.get('form'),
            'hp': doc.get('hp', 0),
            'maxHp': eff['maxHp'],
            'atk': eff['atk'], 'def': eff['def'], 'spd': eff['spd'],
            'power': eff['atk'] + eff['def'] + eff['spd'] + eff['maxHp'],
            'spores': doc.get('spores', 0),
            'xp': doc.get('xp', 0),
            'sigils': len(doc.get('sigils', []) or []),
            'gear': dict(doc.get('gear') or {}),
            'event': event_type,
        }
        self.res.trajectory.append(row)
        # milestones
        lvl = doc.get('level', 1)
        for L in (2, 3, 5, 8, 10, 12):
            if lvl >= L:
                self._mark(f'level{L}', self.res.turns)
        if fight_result is not None:
            self.res.fights.append({
                'turn': self.res.turns, 'kind': fight_result['kind'],
                'npc': fight_result.get('npc'), 'won': fight_result['won'],
                'min_hp_frac': min_frac, 'level': lvl,
                'region': row['region'],
            })

    # -- main loop --------------------------------------------------------------
    def run(self):
        seed_all(self.seed)
        with debug_rolls(True):
            sim = GameSim(user_id=f'sim-{self.seed}')
            # inject the build
            join_ok = sim.raw('join', starter=self.build.starter, home=self.build.home)
            if join_ok[0] != 200:
                self.res.outcome = 'join_failed'
                return self.res
            if self.build.gear:
                doc = sim.doc()
                doc['gear'] = dict(self.build.gear)
                doc['hp'] = engine.effective_stats(doc)['maxHp']
                engine_put(sim, doc)

            for _ in range(self.max_turns):
                self.res.turns += 1
                # roll
                rr = sim.raw('roll')
                if rr[0] != 200:
                    # no legal path this roll; try again a few times
                    retry = 0
                    while rr[0] != 200 and retry < 5:
                        rr = sim.raw('roll')
                        retry += 1
                    if rr[0] != 200:
                        self.res.outcome = 'stuck_no_moves'
                        break
                dests = rr[1]['roll']['destinations']
                dest = self.policy.choose_destination(_NODE_TYPE, dests)
                mv = sim.raw('move', to=dest)
                if mv[0] != 200:
                    self.res.outcome = 'move_failed'
                    break
                se = mv[1].get('spaceEvent', {}) or {}
                event_type = se.get('type', 'none')

                fight_result = min_frac = None
                # a landing that started a battle
                if sim.doc().get('battle'):
                    finish, min_frac = self._drive_battle(sim, se)
                    ftype = finish.get('type')
                    battle = finish.get('battle') or {}
                    won = battle.get('outcome') == 'attacker'
                    if ftype == 'flee':
                        won = None
                    fight_result = {'kind': se.get('kind', ftype),
                                    'npc': (se.get('npc') or {}).get('name'),
                                    'won': won}
                    event_type = ftype
                    if won is False:
                        self.res.deaths += 1

                self._settle(sim)
                self._spend_and_evolve(sim)
                if _NODE_TYPE.get(sim.doc().get('position')) == 'shop':
                    self._shop(sim)

                self._snap(sim, event_type, fight_result, min_frac)

                # boss slain?  (finish event type 'boss' with a win)
                if fight_result and fight_result['kind'] == 'boss' and fight_result['won']:
                    self._mark('boss_slain', self.res.turns)
                    self.res.outcome = 'boss_slain'
                    break

        return self.res


def engine_put(sim, doc):
    """Persist an out-of-band doc mutation (build injection) through the table."""
    import undercity_db as db
    db._put_player(sim.table, doc)


def play_game(build, policy_cls, seed, max_turns=250):
    from sim.bots import Policy
    policy = policy_cls() if isinstance(policy_cls, type) else policy_cls
    return Driver(build, policy, seed, max_turns).run()
