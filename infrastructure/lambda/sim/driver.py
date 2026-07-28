"""Play one full Undercity game with a bot policy and record its trajectory.

`play_game(...)` returns a `GameResult`: a per-turn trajectory plus milestone
turns and a terminal outcome. A "turn" is one roll+move. Rolls are free
(data.DEBUG) so the curve is measured per turn, decoupled from roll income.
"""
import random
from dataclasses import dataclass, field

from sim.harness import GameSim, seed_all, debug_rolls, ActionError
import undercity_data as data
import undercity_db as db
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
    directive: str = 'none'
    trajectory: list = field(default_factory=list)   # per-turn snapshots
    fights: list = field(default_factory=list)        # per-fight records
    milestones: dict = field(default_factory=dict)    # metric -> turn#
    spaces: dict = field(default_factory=dict)        # interactive action -> count
    outcome: str = 'turn_cap'
    turns: int = 0
    deaths: int = 0
    renown: int = 0                                   # final compute_renown
    ichor: int = 0                                    # final crafting materials
    moltings: int = 0
    spores: int = 0


# ── The driver ────────────────────────────────────────────────────────────────

BATTLE_KINDS = {'battle_start'}
_NODE_TYPE = {nid: n['type'] for nid, n in data.MAP_NODES.items()}


class Driver:
    def __init__(self, build, policy, seed, max_turns=250, directive=None):
        self.build = build
        self.policy = policy               # CombatProfile: how you fight & grow
        self.directive = directive         # Directive: where you go & economy (or None)
        self.seed = seed
        self.max_turns = max_turns
        self.res = GameResult(build.name(), policy.name, seed)
        if directive is not None:
            self.res.directive = directive.name
        self._graph = None                 # night's node dict, enriched with _depth
        self._recent = []                  # recently-visited nodes (anti-orbit memory)
        self._cur_target = None

    def _mark(self, key, turn):
        self.res.milestones.setdefault(key, turn)

    # -- board graph + pathfinding ----------------------------------------------
    def _build_graph(self, sim):
        """The night's real node graph (incl. procedural depths), each node tagged
        with its depth from the biome mouth. Built once per game."""
        nodes = db._season_map(sim.table, sim.sid)
        depth = db._season_depth_map(sim.table, sim.sid)
        graph = {}
        for nid, n in nodes.items():
            graph[nid] = {'type': n.get('type'), 'region': n.get('region'),
                          'neighbors': n.get('neighbors', []), '_depth': depth.get(nid, 0)}
        self._graph = graph
        return graph

    def _bfs(self, source):
        """Hop-distance from `source` to every reachable node (undirected)."""
        if source not in self._graph:
            return {}
        dist = {source: 0}
        queue, i = [source], 0
        while i < len(queue):
            cur = queue[i]
            i += 1
            for nb in self._graph[cur]['neighbors']:
                if nb in self._graph and nb not in dist:
                    dist[nb] = dist[cur] + 1
                    queue.append(nb)
        return dist

    def _choose_destination(self, sim, dests):
        """Directive pathfinding when a target exists (pick the dest closest to it,
        ties by seek); else greedy seek over the directive's — or the combat
        profile's (back-compat) — appetite."""
        if not dests:
            return None
        node_types = {n: self._graph.get(n, {}).get('type') for n in dests}
        if self.directive is not None:
            doc = sim.doc()
            pos = doc.get('position')
            dist = self._bfs(pos)
            eff = engine.effective_stats(doc)
            hp_frac = doc.get('hp', 0) / max(1, eff['maxHp'])
            level = doc.get('level', 1)
            hurt = hp_frac < 0.5
            # Survival override: badly hurt → make for the nearest gate (full heal).
            target = None
            if hp_frac < 0.45:
                target = self.directive._nearest(self._graph, dist, {'gate'})
            if target is None:
                target = self.directive.goal(doc, self._graph, dist, set(self._recent))
            self._cur_target = target
            to_t = self._bfs(target) if target is not None else {}

            # Danger is RELATIVE to level: fight fights you can win (they pay the
            # most XP), dodge the ones above your weight — but never dodge the
            # objective itself (the target tile), so the bot commits to a lair
            # once it's grown into it (progressive clears, like a real rusher).
            def score(d):
                prox = to_t.get(d, 99) if target is not None else 0
                danger = 0 if d == target else self._danger(d, level, hurt)
                return (prox + danger, -self.directive.seek.get(node_types.get(d), 1.0))
            return min(dests, key=score)
        # back-compat: the combat profile still carries the old seek map
        return self.policy.choose_destination(node_types, dests)

    def _danger(self, nid, level, hurt):
        """Penalty for stepping onto `nid` given the creature's readiness. A tile
        carries a 'recommended level'; below it (or hurt) the fight is a bad bet.
        Thresholds are deliberately permissive on shallow/dungeon content (real
        engaged players grind those aggressively and hit L12 in ~50 rolls) and
        strict on the wilderness/deep abyss tiles that actually kill a low level."""
        n = self._graph.get(nid, {})
        t = n.get('type')
        dep = n.get('_depth', 0)
        deadly = n.get('region') == 'wilderness' or dep >= 12   # wilderness / abyss
        if t == 'wild':
            need = 8 if deadly else 4 if dep >= 6 else 1
        elif t == 'elite':
            need = 8 if deadly else 4
        elif t in ('lair', 'barrier'):
            need = 6
        elif t == 'boss':
            need = 11
        else:
            return 0                       # non-combat tiles are always safe
        short = max(0, need - level)
        return short + (2 if hurt else 0)

    @staticmethod
    def _seek_pick(dests, node_types, seek):
        best, pool = None, []
        for d in dests:
            score = seek.get(node_types.get(d), 1.0)
            if best is None or score > best:
                best, pool = score, [d]
            elif score == best:
                pool.append(d)
        return random.choice(pool)

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

    def _shop(self, sim, source):
        st = sim.state()
        node = sim.doc().get('position')
        bazaar = (st.get('bazaars') or {}).get(node)
        if not bazaar:
            return
        for item in source.shop_buys(sim.doc().get('spores', 0), bazaar,
                                     sim.doc().get('gear', {})):
            sim.raw('buy', itemId=item)

    # -- interactive space resolution (directive-driven) ------------------------
    def _bump(self, key):
        self.res.spaces[key] = self.res.spaces.get(key, 0) + 1

    def _moves_closer(self, sim, to, target):
        if not target:
            return False
        tt = self._bfs(target)
        return tt.get(to, 1e9) < tt.get(sim.doc().get('position'), 1e9)

    def _nav_pick(self, options, target):
        if not options:
            return None
        if not target:
            return random.choice(options)
        tt = self._bfs(target)
        return min(options, key=lambda o: tt.get(o, 1e9))

    def _resolve_space(self, sim, event):
        """Drive the interactive spaces the base loop skips, via directive hooks.
        Every dispatch is best-effort — a declined/failed action just moves on."""
        d = self.directive
        if d is None:
            if _NODE_TYPE.get(sim.doc().get('position')) == 'shop':
                self._shop(sim, self.policy)     # legacy: combat profile shops
            return
        et = event.get('type')
        target = getattr(self, '_cur_target', None)
        try:
            if et == 'shop':
                self._shop(sim, d)
                self._bump('shop')
            elif et == 'shrine':
                eff = engine.effective_stats(sim.doc())
                hp_frac = sim.doc().get('hp', 0) / max(1, eff['maxHp'])
                choice = d.shrine_take(sim.doc(), hp_frac)
                if choice and sim.raw('shrine', choice=choice)[0] == 200:
                    self._bump('shrine')
            elif et == 'ossuary':
                for _ in range(6):
                    if sim.doc().get('ossuaryRollsLeft', 0) <= 0:
                        break
                    bc = d.gamble_bet(sim.doc().get('spores', 0))
                    if not bc or sim.raw('gamble', bet=bc[0], call=bc[1])[0] != 200:
                        break
                    self._bump('gamble')
            elif et == 'vault_lock':
                for _ in range(6):
                    if sim.doc().get('vaultPicksLeft', 0) <= 0:
                        break
                    g = d.vault_guess(sim.doc())
                    if not g or sim.raw('vault-guess', guess=g)[0] != 200:
                        break
                    self._bump('vault')
            elif et == 'excavation':
                for (r, c) in d.dig_cells(event.get('grid', {})):
                    if sim.doc().get('excavationDigsLeft', 0) <= 0:
                        break
                    if sim.raw('dig', r=r, c=c)[0] == 200:
                        self._bump('dig')
            elif et == 'crystal_vein':
                n = d.vein_strikes(event.get('depth', 0), sim.doc().get('veinStrikesLeft', 0))
                for _ in range(n):
                    if sim.doc().get('veinStrikesLeft', 0) <= 0:
                        break
                    if sim.raw('strike')[0] != 200:
                        break
                    self._bump('vein')
            elif et == 'witch':
                spell = d.witch_buy(list(data.WITCH_SCROLL_STOCK), sim.doc().get('spores', 0))
                if spell and sim.raw('witch-buy-scroll', spellId=spell)[0] == 200:
                    self._bump('witch')
            elif et == 'warp':
                to = self._nav_pick(event.get('options', []), target)
                if to and d.warp_take(self._moves_closer(sim, to, target)):
                    if sim.raw('warp', to=to)[0] == 200:
                        self._bump('warp')
            elif et == 'ladder':
                to = event.get('to')
                if to and d.ladder_take(self._moves_closer(sim, to, target)):
                    if sim.raw('ladder-cross')[0] == 200:
                        self._bump('ladder')
        except (ActionError, KeyError, TypeError, IndexError):
            pass

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
            'sigils': db._sigil_count(doc),
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
            self._build_graph(sim)     # night's graph for directive pathfinding

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
                dest = self._choose_destination(sim, dests)
                mv = sim.raw('move', to=dest)
                if mv[0] != 200:
                    self.res.outcome = 'move_failed'
                    break
                se = mv[1].get('spaceEvent', {}) or {}
                event_type = se.get('type', 'none')
                self._recent.append(sim.doc().get('position'))
                self._recent = self._recent[-8:]     # anti-orbit memory window

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
                if not (fight_result):        # interactive spaces never coincide with a fight
                    self._resolve_space(sim, se)

                self._snap(sim, event_type, fight_result, min_frac)

                # boss slain?  (finish event type 'boss' with a win)
                if fight_result and fight_result['kind'] == 'boss' and fight_result['won']:
                    self._mark('boss_slain', self.res.turns)
                    self.res.outcome = 'boss_slain'
                    break

            final = sim.doc()
            self.res.renown = data.compute_renown(final)
            mats = db._materials(final)
            self.res.ichor, self.res.moltings = mats['ichor'], mats['moltings']
            self.res.spores = final.get('spores', 0)

        return self.res


def engine_put(sim, doc):
    """Persist an out-of-band doc mutation (build injection) through the table."""
    import undercity_db as db
    db._put_player(sim.table, doc)


def play_game(build, policy_cls, seed, max_turns=250, directive=None):
    """Play one full game. `policy_cls` is a CombatProfile (how you fight/grow);
    `directive` is an optional Directive (where you go / economy). With no
    directive the driver falls back to the profile's own `seek` (legacy behavior)."""
    policy = policy_cls() if isinstance(policy_cls, type) else policy_cls
    directive = directive() if isinstance(directive, type) else directive
    return Driver(build, policy, seed, max_turns, directive=directive).run()
