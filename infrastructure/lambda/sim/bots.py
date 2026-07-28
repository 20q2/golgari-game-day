"""Fixed strategy policies for the simulator.

A `Policy` answers the handful of decisions the game asks a player to make. The
four concrete bots are deliberately distinct *play styles* — they double as the
archetype lenses for build comparison (an aggressive glass-cannon player vs. a
cautious tank plays the same build very differently, and the gap between them
tells us how skill/strategy-dependent a build's balance is).

All bots play at a consistent "reasonable" skill in combat: when the engine
grants them a read of the foe's intent they COUNTER it (the stance triangle is
Aggress>Feint>Guard>Aggress); with no read they fall back to a preferred stance.
"""
import random

# What the PLAYER (attacker side) plays to BEAT the npc's shown stance.
# exchange_winner: attacker wins on (aggress,feint),(feint,guard),(guard,aggress).
COUNTER = {'feint': 'aggress', 'guard': 'feint', 'aggress': 'guard'}


class Policy:
    """Base policy. Subclasses tune the knobs; the methods below are the whole
    decision surface the driver consumes."""

    name = 'base'
    pref_stance = 'guard'
    flee_below = 0.0            # flee wilds/elites when hp fraction < this
    stat_priority = ('atk', 'def', 'spd')
    # Node-type appetite for movement: higher = more eager to step onto it.
    seek = {}

    def choose_destination(self, node_types, dests):
        """Pick one of `dests` (node ids). `node_types` maps id -> type."""
        best, pool = None, []
        for d in dests:
            score = self.seek.get(node_types.get(d), 1.0)
            if best is None or score > best:
                best, pool = score, [d]
            elif score == best:
                pool.append(d)
        return random.choice(pool)

    def combat(self, kind, telegraph, rnd, hp_frac):
        """Return (stance, want_flee). A survival floor makes even aggressive
        profiles bail from a recoverable fight they're about to lose — dying
        costs a respawn + backtrack, so a smart player retreats and heals
        (mirrors a careful human: ~2 deaths a night, not ~15)."""
        survival = max(self.flee_below, 0.30)
        want_flee = (kind in ('wild', 'elite', 'lair')
                     and hp_frac < survival and rnd >= 2)
        if telegraph in COUNTER:
            return COUNTER[telegraph], want_flee
        return self.pref_stance, want_flee

    def spend_stat(self, points, spent_so_far):
        """Yield a stat id per banked point, round-robin over stat_priority
        weighted by its order (first stat gets the lion's share)."""
        # Simple deterministic split: cycle priority so the lead stat dominates
        # but the others still tick up (a pure one-stat build is a separate axis).
        order = self.stat_priority
        out = []
        for i in range(points):
            out.append(order[i % len(order)] if len(order) > 1 else order[0])
        return out

    def choose_evolution(self, options_specs):
        """`options_specs` is {form_id: spec}. Pick the form whose bonus best
        serves the lead stat; ties broken by total bonus then name."""
        lead = self.stat_priority[0]
        # map lead stat -> the bonus key that matters (atk/def/spd/maxHp)
        def score(spec):
            b = spec.get('bonus', {})
            return (b.get(lead, 0), sum(b.values()))
        return max(options_specs, key=lambda f: score(options_specs[f]))

    def shop_buys(self, spores, bazaar, owned_slots):
        """Return a list of itemIds to attempt to buy, in priority order. Default:
        buy nothing (only Farmer/Tank actively shop)."""
        return []


class Rusher(Policy):
    name = 'rusher'
    pref_stance = 'aggress'
    flee_below = 0.0                      # never flees — presses the attack
    stat_priority = ('atk',)              # pure glass cannon
    seek = {'wild': 3, 'elite': 4, 'lair': 3, 'loot': 1.5, 'mystery': 1.5,
            'shop': 2, 'gate': 0.5}

    def shop_buys(self, spores, bazaar, owned_slots):
        return [e['item'] for e in bazaar.get('gear', [])
                if e['item'].startswith(('rusted', 'blood', 'kraul_barb',
                                         'rabid', 'gut', 'wurm', 'raven'))]


class Farmer(Policy):
    name = 'farmer'
    pref_stance = 'guard'
    flee_below = 0.35
    stat_priority = ('def', 'atk', 'spd')
    seek = {'wild': 3, 'elite': 3, 'loot': 3, 'mystery': 2.5, 'shop': 3,
            'rest': 2, 'trove': 2, 'cache': 2}

    def shop_buys(self, spores, bazaar, owned_slots):
        # Prioritise a carapace and a heal, then anything affordable.
        picks = [e['item'] for e in bazaar.get('gear', [])
                 if 'carapace' in e['item'] or e['item'] in (
                     'chitin_scrap', 'bramble_hide', 'bark_hide',
                     'bulwark_plate', 'mossback', 'troll_hide', 'ironshell_bulwark')]
        picks += [e['item'] for e in bazaar.get('consumables', [])
                  if e['item'] == 'healing_moss']
        return picks


class Speedster(Policy):
    name = 'speedster'
    pref_stance = 'feint'
    flee_below = 0.55                     # bolts from danger early
    stat_priority = ('spd',)
    seek = {'loot': 3, 'mystery': 3, 'rest': 3, 'trove': 2.5, 'cache': 2.5,
            'wild': 0.4, 'elite': 0.2, 'lair': 0.2, 'shop': 2}

    def shop_buys(self, spores, bazaar, owned_slots):
        return [e['item'] for e in bazaar.get('gear', [])
                if 'charm' in e['item'] or e['item'].endswith('_charm')]


class Tank(Policy):
    name = 'tank'
    pref_stance = 'guard'
    flee_below = 0.15                     # dug in — almost never flees
    stat_priority = ('def', 'spd', 'atk')
    seek = {'wild': 2.5, 'elite': 2.5, 'lair': 2.5, 'loot': 2, 'shop': 3,
            'mystery': 1.5}

    def shop_buys(self, spores, bazaar, owned_slots):
        return [e['item'] for e in bazaar.get('gear', [])
                if e['item'] in ('chitin_scrap', 'bramble_hide', 'bark_hide',
                                 'bulwark_plate', 'mossback', 'troll_hide',
                                 'ironshell_bulwark')]


ALL_BOTS = {b.name: b for b in (Rusher, Farmer, Speedster, Tank)}


# ── Directives: the "what you chase" axis (design 2026-07-26) ─────────────────
# A Directive is composable with any CombatProfile above: the profile decides HOW
# you fight and grow, the directive decides WHERE you go and which interactive
# spaces you play. The driver calls goal() to pick a pathfinding target and the
# *_take / *_play hooks to resolve interactive landings. Base = do-nothing
# (greedy seek, decline every economy detour); subclasses override what they want.
# Hooks make *plausible* choices, not optimal ones (spec §2 non-goal).

import undercity_data as _data


class Directive:
    name = 'balanced'
    seek = {}
    _REWARD_TYPES = {'mystery', 'cache', 'trove', 'vault_lock', 'excavation',
                     'crystal_vein', 'witch'}

    def goal(self, doc, graph, dist_from_pos, avoid):
        """Return a node id to steer toward this turn, or None for greedy seek.
        `dist_from_pos` is {node: hops from the player}; `avoid` is a set of
        recently-visited nodes to skip so the player doesn't orbit one space."""
        return None

    def _nearest(self, graph, dist, types, avoid=()):
        cands = [n for n in graph if graph[n].get('type') in types
                 and n in dist and n not in avoid]
        return min(cands, key=dist.get) if cands else None

    # -- interactive-space hooks (all decline by default) --
    def shop_buys(self, spores, bazaar, gear):
        return []

    def shrine_take(self, doc, hp_frac):
        return 'heal' if hp_frac < 0.6 else None      # everyone mends when hurt

    def gamble_bet(self, spores):
        return None                                    # -> (bet:int, call:'high'|'low')

    def vault_guess(self, doc):
        return None                                    # -> [sigil, sigil, sigil]

    def dig_cells(self, grid):
        return []                                      # -> [(r, c), ...]

    def vein_strikes(self, depth, left):
        return 0                                       # -> how many strikes

    def witch_buy(self, stock, spores):
        return None                                    # -> spellId

    def ladder_take(self, moves_closer):
        return moves_closer                            # cross if it aids navigation

    def warp_take(self, moves_closer):
        return moves_closer


_DIG_COVERED = -2   # mirrors undercity_db._DIG_COVERED (buried cell in a dig view)


def _covered_cells(grid):
    """Every still-buried cell of a dig-site view (greedy dig them all)."""
    cells = grid.get('cells') or []
    return [(r, c) for r, row in enumerate(cells)
            for c, v in enumerate(row) if v == _DIG_COVERED]


class Balanced(Directive):
    """No hard target — mild appetite across everything (≈ the old greedy seek).
    Light economy: mends, digs, buys a little."""
    name = 'balanced'
    seek = {'wild': 2, 'elite': 2, 'lair': 2, 'loot': 2, 'mystery': 2, 'shop': 2,
            'cache': 2, 'trove': 2}

    def dig_cells(self, grid):
        return _covered_cells(grid)

    def shop_buys(self, spores, bazaar, gear):
        return [e['item'] for e in bazaar.get('gear', [])][:1]


class RushBoss(Directive):
    """Level up, then clear the three sigil lairs and storm the boss. Dives a
    lair only once strong enough to survive it (a careful human doesn't rush the
    deep boss at level 3) — otherwise grinds wild/elite to build up, mending at
    gates on the way (heal-routing is driver-side)."""
    name = 'rush_boss'
    # wild/elite appetite so it levels while travelling toward the lairs.
    seek = {'lair': 6, 'boss': 9, 'gate': 2, 'ladder': 2, 'elite': 4, 'wild': 3}

    def goal(self, doc, graph, dist_from_pos, avoid):
        claims = set(doc.get('poiClaims') or [])
        if sum(1 for c in claims if c in _data.SIGIL_LAIRS) >= _data.SIGILS_REQUIRED:
            return self._nearest(graph, dist_from_pos, {'boss'})   # never avoid the win
        # Aim for the nearest UNcleared sigil lair (three DIFFERENT biomes', so
        # don't re-farm one). Level-relative danger handles timing: it levels on
        # winnable fights near the path, then commits to each dive as it grows in.
        unclaimed = [n for n in graph if n in _data.SIGIL_LAIRS
                     and n not in claims and n in dist_from_pos]
        if unclaimed:
            return min(unclaimed, key=dist_from_pos.get)
        return self._nearest(graph, dist_from_pos, {'lair'}, avoid)


class FarmMobs(Directive):
    """Descend for tougher, better-paying mobs; grind wild/elite; dig for
    materials and buy gear. No gamble/vault/witch detours."""
    name = 'farm_mobs'
    seek = {'wild': 4, 'elite': 4, 'lair': 3, 'ladder': 2, 'shop': 2, 'excavation': 2}

    def goal(self, doc, graph, dist_from_pos, avoid):
        # Head for the deepest reachable depths node (the toughest fauna live there);
        # once deep, roam & fight (no target) rather than thrash back to the bottom.
        here = graph.get(doc.get('position'), {})
        if here.get('region') == 'depths' and here.get('_depth', 0) >= 8:
            return None
        depths = [(graph[n].get('_depth', 0), n) for n in graph
                  if graph[n].get('region') == 'depths' and n in dist_from_pos
                  and n not in avoid]
        return max(depths)[1] if depths else None

    def dig_cells(self, grid):
        return _covered_cells(grid)

    def shop_buys(self, spores, bazaar, gear):
        return [e['item'] for e in bazaar.get('gear', [])
                if 'carapace' in e['item'] or 'fang' in e['item'] or 'barb' in e['item']]


class Shopper(Directive):
    """Beeline shops; spend spores on gear; grow the purse with small gambles."""
    name = 'shopper'
    seek = {'shop': 6, 'loot': 3, 'mystery': 2, 'cache': 3, 'trove': 3}

    def goal(self, doc, graph, dist_from_pos, avoid):
        return self._nearest(graph, dist_from_pos, {'shop'}, avoid)

    def gamble_bet(self, spores):
        return (min(10, _data.OSSUARY_MAX_BET), 'high') if spores > 40 else None

    def dig_cells(self, grid):
        return _covered_cells(grid)

    def shop_buys(self, spores, bazaar, gear):
        return [e['item'] for e in bazaar.get('gear', [])]     # buy what it can


class Explorer(Directive):
    """Chase every reward/interactive space and actually play it — gamble, crack
    the vault, dig, mine the vein, read scrolls."""
    name = 'explorer'
    seek = {'mystery': 5, 'cache': 4, 'trove': 4, 'vault_lock': 4, 'excavation': 4,
            'crystal_vein': 4, 'witch': 3, 'wild': 0.5, 'elite': 0.3}

    def goal(self, doc, graph, dist_from_pos, avoid):
        return self._nearest(graph, dist_from_pos, self._REWARD_TYPES, avoid)

    def gamble_bet(self, spores):
        return (min(8, _data.OSSUARY_MAX_BET), 'high') if spores > 30 else None

    def vault_guess(self, doc):
        return random.sample(_data.VAULT_SIGILS, _data.VAULT_SLOTS)

    def dig_cells(self, grid):
        return _covered_cells(grid)

    def vein_strikes(self, depth, left):
        return left                                    # mine it out

    def witch_buy(self, stock, spores):
        ids = list(stock or [])
        return ids[0] if ids and spores > 40 else None


ALL_DIRECTIVES = {d.name: d for d in (Balanced, RushBoss, FarmMobs, Shopper, Explorer)}
