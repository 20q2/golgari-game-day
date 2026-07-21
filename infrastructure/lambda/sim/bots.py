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
        """Return (stance, want_flee)."""
        want_flee = (kind in ('wild', 'elite')
                     and hp_frac < self.flee_below and rnd >= 2)
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
