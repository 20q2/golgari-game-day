"""Spore-economy audit.

Plays full games (real action dispatcher) and attributes every change in a
player's Spore balance to a labelled source, so we can see how much income comes
from "small things" vs. genuine milestones — and rate rewards against the sink
scale (T1 gear ~20-30, T2 ~45-50 / upgrade 40, T3 ~80).

Run from infrastructure/lambda/:
    python -m sim.spore_audit
"""
import collections
import statistics

from sim.harness import GameSim, seed_all, debug_rolls, ActionError
from sim.driver import Driver, solve_flow, play_game
from sim.bots import Rusher, Farmer, Speedster, Tank, ALL_BOTS
from sim.driver import Build
import undercity_data as data
import undercity_engine as engine


class AuditDriver(Driver):
    """A Driver that logs every spore delta with a source label.

    We wrap sim.raw so each action's effect on doc['spores'] is captured and
    tagged by (action, spaceEvent.type/kind). Gains and losses are logged
    separately so shop spending doesn't cancel loot income in the ledger.
    """

    def run_audited(self):
        self.ledger = []          # (source, delta)
        seed_all(self.seed)
        with debug_rolls(True):
            sim = GameSim(user_id=f'sim-{self.seed}')
            self._wrap(sim)
            join_ok = sim.raw('join', starter=self.build.starter, home=self.build.home)
            if join_ok[0] != 200:
                self.res.outcome = 'join_failed'
                return self.res, self.ledger
            # attribute the join's starting spores
            self.ledger.append(('hatch/start', sim.doc().get('spores', 0)))
            self._last_spores = sim.doc().get('spores', 0)

            if self.build.gear:
                doc = sim.doc()
                doc['gear'] = dict(self.build.gear)
                doc['hp'] = engine.effective_stats(doc)['maxHp']
                from sim.driver import engine_put
                engine_put(sim, doc)
                self._last_spores = sim.doc().get('spores', 0)

            for _ in range(self.max_turns):
                self.res.turns += 1
                rr = sim.raw('roll')
                if rr[0] != 200:
                    retry = 0
                    while rr[0] != 200 and retry < 5:
                        rr = sim.raw('roll'); retry += 1
                    if rr[0] != 200:
                        self.res.outcome = 'stuck_no_moves'; break
                dests = rr[1]['roll']['destinations']
                dest = self.policy.choose_destination(self._NODE_TYPE(), dests)
                mv = sim.raw('move', to=dest)
                if mv[0] != 200:
                    self.res.outcome = 'move_failed'; break
                se = mv[1].get('spaceEvent', {}) or {}
                self._cur_tag = se.get('kind') or se.get('type') or 'move'

                if sim.doc().get('battle'):
                    finish, min_frac = self._drive_battle(sim, se)
                    ftype = finish.get('type')
                    battle = finish.get('battle') or {}
                    won = battle.get('outcome') == 'attacker'
                    if won is False:
                        self.res.deaths += 1

                self._cur_tag = 'settle'
                self._settle(sim)
                self._cur_tag = 'levelup'
                self._spend_and_evolve(sim)
                if self._NODE_TYPE().get(sim.doc().get('position')) == 'shop':
                    self._cur_tag = 'shop'
                    self._shop(sim)

                # boss slain?
                if battle_won_boss(se, sim):
                    self._mark('boss_slain', self.res.turns)
                    self.res.outcome = 'boss_slain'; break
        return self.res, self.ledger

    def _NODE_TYPE(self):
        return {nid: n['type'] for nid, n in data.MAP_NODES.items()}

    def _wrap(self, sim):
        raw = sim.raw
        self._cur_tag = 'move'

        def wrapped(action, **kw):
            before = sim.doc().get('spores', 0) if sim.doc() else 0
            res = raw(action, **kw)
            after = sim.doc().get('spores', 0) if sim.doc() else 0
            delta = after - before
            if delta:
                tag = self._tag_for(action, res)
                self.ledger.append((tag, delta))
            return res
        sim.raw = wrapped

    def _tag_for(self, action, res):
        # Prefer the spaceEvent type from the response for precise attribution.
        body = res[1] if isinstance(res, tuple) and len(res) > 1 and isinstance(res[1], dict) else {}
        se = body.get('spaceEvent') or {}
        setype = se.get('type')
        sekind = se.get('kind')
        if action == 'move':
            return f'land:{sekind or setype or "none"}'
        if action in ('combat-round', 'combat-flee'):
            return f'combat:{sekind or setype or self._cur_tag}'
        if action == 'buy':
            return 'shop:buy'
        if action == 'solve-loot-puzzle':
            return 'loot:puzzle'
        if action in ('shrine-bless', 'ossuary-bet', 'excavate', 'rot-bloom'):
            return f'facility:{action}'
        return f'{action}:{setype or sekind or self._cur_tag}'


def battle_won_boss(se, sim):
    return se.get('kind') == 'boss' and not sim.doc().get('battle')


def audit(builds, bots, seeds, max_turns=45):
    """Aggregate spore ledgers across many games.

    max_turns=45 ≈ an aggressive 4-hour game night (per FINDINGS economy overlay).
    """
    by_source = collections.defaultdict(list)   # source -> list of per-event deltas
    totals = []                                  # net spores held at end, per game
    gross_income = []                            # total positive income per game
    per_source_game = collections.defaultdict(list)  # source -> per-GAME summed income

    for build in builds:
        for bot in bots:
            for seed in seeds:
                d = AuditDriver(build, bot(), seed, max_turns=max_turns)
                res, ledger = d.run_audited()
                game_income = collections.defaultdict(float)
                gi = 0
                for source, delta in ledger:
                    by_source[source].append(delta)
                    if delta > 0:
                        gi += delta
                    game_income[source] += delta
                gross_income.append(gi)
                for s, v in game_income.items():
                    per_source_game[s].append(v)
                totals.append(res.trajectory[-1]['spores'] if res.trajectory else 0)
    return by_source, totals, gross_income, per_source_game


def fmt_table(by_source):
    rows = []
    for source, deltas in by_source.items():
        gains = [d for d in deltas if d > 0]
        losses = [d for d in deltas if d < 0]
        n = len(deltas)
        total = sum(deltas)
        avg_gain = statistics.mean(gains) if gains else 0
        rows.append((source, n, len(gains), total, avg_gain,
                     max(gains) if gains else 0, min(losses) if losses else 0))
    rows.sort(key=lambda r: -sum(d for d in by_source[r[0]] if d > 0))
    print(f'{"source":28} {"#events":>7} {"#gains":>6} {"net":>8} '
          f'{"avg/gain":>9} {"maxgain":>8} {"minloss":>8}')
    print('-' * 82)
    for source, n, ng, total, avg_gain, mx, mn in rows:
        print(f'{source:28} {n:7d} {ng:6d} {total:8.0f} {avg_gain:9.1f} '
              f'{mx:8.0f} {mn:8.0f}')


if __name__ == '__main__':
    BUILDS = [Build('kraul', 'city', label='kraul/city'),
              Build('saproling', 'garden', label='sap/garden'),
              Build('pest', 'city', label='pest/city')]
    BOTS = [Rusher, Farmer, Tank]
    SEEDS = list(range(1, 13))

    for horizon, label in ((45, '≈4h aggressive night'), (90, 'long/marathon')):
        by_source, totals, gross, per_game = audit(BUILDS, BOTS, SEEDS, max_turns=horizon)
        print(f'\n{"="*82}\n{horizon} turns ({label}) — '
              f'{len(BUILDS)*len(BOTS)*len(SEEDS)} games\n{"="*82}')
        print(f'Gross spore income / game: median {statistics.median(gross):.0f}, '
              f'mean {statistics.mean(gross):.0f}, '
              f'range {min(gross):.0f}-{max(gross):.0f}')
        print(f'Spores held at end:        median {statistics.median(totals):.0f}, '
              f'range {min(totals):.0f}-{max(totals):.0f}\n')
        fmt_table(by_source)
