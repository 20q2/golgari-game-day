"""
DynamoDB orchestration for The Undercity.

Owns all persistence and the /game/state + /game/action dispatchers. Game
rules live in undercity_engine (pure); this module reads player documents,
calls the engine, and writes results back with optimistic-concurrency guards
(a `ver` counter checked via ConditionExpression — adequate at ≤15 players).

Item layout (existing single table, pk/sk strings):
  UNDERCITY#META            / CURRENT        active season pointer
  UNDERCITY#{sid}           / CONFIG         status, hostKey, bossPhase
  UNDERCITY#{sid}           / PLAYER#{uid}   season player doc
  UNDERCITY#{sid}           / SPACE#{node}   snare / spore-pile state
  UNDERCITY#{sid}           / EVENT#{ts}#{x} Grapevine log entries
  UNDERCITY#{sid}           / RESULT         final scoreboard
  UNDERCITY#HALLOFFAME      / NIGHT#{sid}    per-night archive
  UNDERCITYUSER#{uid}       / META           permanent wardrobe/seals/lifetime
"""
import json
import random
import uuid
import zlib
from datetime import datetime, timedelta
from decimal import Decimal

from botocore.exceptions import ClientError

import undercity_data as data
import undercity_engine as engine
import undercity_mapgen as mapgen

_rng = random.Random()

META_PK = 'UNDERCITY#META'
HOF_PK = 'UNDERCITY#HALLOFFAME'


# ── Small helpers ────────────────────────────────────────────────────────────

def _now():
    return datetime.utcnow().isoformat(timespec='seconds')


def _now_ms():
    return datetime.utcnow().isoformat(timespec='milliseconds')


_EPOCH = datetime(1970, 1, 1)


def _shop_window(now=None):
    """Which fixed wall-clock window the bazaar stock belongs to (shared by all
    players). Advancing a window rerolls the selection and resets quantities."""
    now = now or datetime.utcnow()
    secs = int((now - _EPOCH).total_seconds())
    return secs // (data.SHOP_REFRESH_MIN * 60)


def _shop_window_end(window):
    """ISO timestamp of the next window boundary — the client's restock clock."""
    end = _EPOCH + timedelta(seconds=(window + 1) * data.SHOP_REFRESH_MIN * 60)
    return end.isoformat(timespec='seconds')


def _umori_window(now=None):
    """Which 2-hour window Umori's location/stock belong to. Pure function of the
    wall clock — every client computes the same value (no server tick)."""
    now = now or datetime.utcnow()
    secs = int((now - _EPOCH).total_seconds())
    return secs // (data.UMORI_DWELL_MIN * 60)


def _umori_window_end(window):
    """ISO timestamp Umori next hops (the client's countdown target)."""
    end = _EPOCH + timedelta(seconds=(window + 1) * data.UMORI_DWELL_MIN * 60)
    return end.isoformat(timespec='seconds')


def _umori_node(window):
    """Deterministic wilderness node Umori occupies this window (stable hash)."""
    rng = random.Random(zlib.crc32(f'umori:{window}'.encode()))
    return rng.choice(data.UMORI_NODES)


def _umori_stock(window):
    """Fresh T3 barter seed for a window: one T3 gear per slot (fixed order) +
    UMORI_STOCK_SPEC['grimoire'] T3 grimoires. Deterministic per window."""
    rng = random.Random(zlib.crc32(f'umori-stock:{window}'.encode()))
    by_slot = {}
    for gid, g in data.GEAR.items():
        if g['tier'] == 3:
            by_slot.setdefault(g['slot'], []).append(gid)
    picks = []
    for slot in data.UMORI_GEAR_SLOTS:
        pool = sorted(by_slot.get(slot, []))
        if pool:
            picks.append(rng.choice(pool))
    tomes = sorted(gid for gid, gr in data.GRIMOIRES.items() if gr['tier'] == 3)
    rng.shuffle(tomes)
    picks += tomes[:data.UMORI_STOCK_SPEC['grimoire']]
    return [{'item': i, 'foundBy': 'the Swarm'} for i in picks]


def _weighted_tier(rng, weights):
    """Deterministic weighted pick from {tier: weight}. Sorted for stability."""
    total = sum(weights.values())
    roll = rng.random() * total
    for tier in sorted(weights):
        roll -= weights[tier]
        if roll < 0:
            return tier
    return max(weights)


def _gen_shop_stock(node, window):
    """Deterministic per (node, window) so every player computes the identical
    stock with no coordinated write. MUST use a stable hash — Python's builtin
    hash() is per-process salted (PYTHONHASHSEED) and would desync players."""
    rng = random.Random(zlib.crc32(f'{node}:{window}'.encode()))

    # Gear: one piece per distinct slot. Tier is chosen per bazaar class —
    # biome bazaars stock T1/T2 (BAZAAR_GEAR_TIERS) with a rare black-market T3;
    # island bazaars pick by weight (ISLAND_BAZAAR_GEAR_TIERS: mostly T2/some T3).
    by_slot = {}
    for gid, g in data.GEAR.items():
        by_slot.setdefault(g['slot'], []).append(gid)
    slots = list(by_slot)
    rng.shuffle(slots)
    chosen = slots[:data.SHOP_GEAR_SLOTS]

    is_island = node in data.ISLAND_BAZAAR_NODES

    # Biome bazaars: a rare window forces ONE chosen slot to a "black-market" T3.
    black_slot = None
    if not is_island and rng.random() < data.BAZAAR_BLACKMARKET_CHANCE:
        black_slot = rng.choice(chosen)

    gear = []
    for s in chosen:
        by_tier = {}
        for gid in by_slot[s]:
            by_tier.setdefault(data.GEAR[gid]['tier'], []).append(gid)
        if is_island:
            weights = {t: w for t, w in data.ISLAND_BAZAAR_GEAR_TIERS.items() if t in by_tier}
            gid = rng.choice(by_tier[_weighted_tier(rng, weights)])
            gear.append({'item': gid, 'qty': data.SHOP_GEAR_QTY})
        elif s == black_slot and 3 in by_tier:
            gid = rng.choice(by_tier[3])
            gear.append({'item': gid, 'qty': data.SHOP_GEAR_QTY, 'blackMarket': True})
        else:
            pool = [gid for gid in by_slot[s] if data.GEAR[gid]['tier'] in data.BAZAAR_GEAR_TIERS]
            gid = rng.choice(pool)
            gear.append({'item': gid, 'qty': data.SHOP_GEAR_QTY})

    # Consumables: guarantee >=1 in-battle ('combat') item, no duplicates.
    combat = [cid for cid, c in data.CONSUMABLES.items() if c.get('combat')]
    first = rng.choice(combat)
    pool = [cid for cid in data.CONSUMABLES if cid != first]
    rng.shuffle(pool)
    picks = [first] + pool[:data.SHOP_CONSUMABLE_SLOTS - 1]
    consumables = [{'item': cid, 'qty': data.SHOP_CONSUMABLE_QTY} for cid in picks]

    # Grimoires: distinct tier-1 tomes, no qty (never deplete).
    tier1 = [gid for gid, g in data.GRIMOIRES.items() if g['tier'] == 1]
    rng.shuffle(tier1)
    grimoires = tier1[:data.SHOP_GRIMOIRE_SLOTS]

    return {'window': window, 'gear': gear,
            'consumables': consumables, 'grimoires': grimoires}


def _shop_stock(table, sid, node):
    """Current-window stock for a bazaar node: the persisted record if it exists
    AND belongs to the current window (possibly depleted), else a freshly
    generated full-quantity stock — NO write on read. A stale-window record is
    ignored, which is how the 30-minute reset happens."""
    window = _shop_window()
    rec = _get(table, _season_pk(sid), f'SHOP#{node}')
    if rec and rec.get('window') == window:
        return rec
    return _gen_shop_stock(node, window)


def _clean(obj):
    """Convert DynamoDB Decimals to ints/floats recursively."""
    if isinstance(obj, Decimal):
        return int(obj) if obj % 1 == 0 else float(obj)
    if isinstance(obj, dict):
        return {k: _clean(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_clean(v) for v in obj]
    return obj


def _err(msg, code=400):
    return code, {'error': msg}


def _season_pk(sid):
    return f'UNDERCITY#{sid}'


def _event(table, sid, etype, text, actor=None, extra=None):
    item = {
        'pk': _season_pk(sid),
        'sk': f'EVENT#{_now_ms()}#{uuid.uuid4().hex[:6]}',
        'type': etype,
        'text': text,
        'ts': _now_ms(),
    }
    if actor:
        item['actor'] = actor
    if extra:
        item['data'] = extra
    table.put_item(Item=item)


def _claim_first(table, sid, node, kind, doc):
    """Idempotently stamp the season-global first conqueror of a landmark.
    Returns True iff THIS call won the race (this player is the global first).
    Race-safe: the conditional put lets exactly one concurrent writer win."""
    try:
        table.put_item(
            Item={'pk': _season_pk(sid), 'sk': f'FIRST#{node}',
                  'by': doc['username'], 'uid': doc['userId'],
                  'at': _now(), 'kind': kind},
            ConditionExpression='attribute_not_exists(pk)')
        return True
    except ClientError as e:
        if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
            return False
        raise


def _get(table, pk, sk):
    resp = table.get_item(Key={'pk': pk, 'sk': sk})
    return _clean(resp.get('Item')) if resp.get('Item') else None


_season_map_cache = {}   # sid -> merged node dict for the night (built once)


def _load_season_depths(table, sid):
    """This night's depths pockets. Reads the SEASON#<sid>/MAP record; falls back
    to the committed depths when absent (a legacy season, or generation disabled)."""
    rec = _get(table, _season_pk(sid), 'MAP')
    if rec and rec.get('depths'):
        return {n['id']: n for n in rec['depths']}
    return data.COMMITTED_DEPTHS


def _season_map(table, sid):
    """The full node graph for the night: fixed surface + this season's depths,
    cached per sid. With PROCEDURAL_DUNGEONS off, returns the committed board
    unchanged (same object) so behaviour is exactly as before."""
    if not data.PROCEDURAL_DUNGEONS:
        return data.MAP_NODES
    cached = _season_map_cache.get(sid)
    if cached is None:
        cached = data.merge_map(_load_season_depths(table, sid))
        _season_map_cache[sid] = cached
    return cached


def _active_season(table):
    meta = _get(table, META_PK, 'CURRENT')
    if not meta:
        return None, None
    sid = meta['seasonId']
    config = _get(table, _season_pk(sid), 'CONFIG')
    return sid, config


def get_active_season(table):
    """Public lookup for other Lambda modules (e.g. queue_db) that need to
    key their own data off whichever Undercity night is currently running."""
    return _active_season(table)


def _get_player(table, sid, user_id):
    doc = _get(table, _season_pk(sid), f'PLAYER#{user_id}')
    if doc:
        # Backward-compat: the fourth species was renamed spore -> zombie.
        if doc.get('species') == 'spore':
            doc['species'] = 'zombie'
        if doc.get('form') == 'spore':
            doc['form'] = 'zombie'
        # Backward-compat: the pest T2 was renamed stinkweed_imp -> vexing_pest.
        if doc.get('form') == 'stinkweed_imp':
            doc['form'] = 'vexing_pest'
        # Backward-compat: the pest T2 passive was renamed flyby -> vexing.
        passives = doc.get('passives')
        if passives and 'flyby' in passives:
            doc['passives'] = ['vexing' if p == 'flyby' else p for p in passives]
    return doc


def _open_barriers(table, sid):
    """Barrier ids broken open this season — shared by every player."""
    item = _get(table, _season_pk(sid), 'BARRIERS')
    return set((item or {}).get('open') or [])


def _closed_barriers(table, sid):
    """The engine `closed` set: nodes you march up to and STOP on (bonk),
    never corridor through. Sealed barrier guardians, plus the post-boss escape
    ladders — degree-1 dead-end spurs off each sigil lair. Without the bonk rule
    an escape spur is only reachable on the rare exact-count roll that lands on
    it; treating it as closed lets a claimed player step onto the stairwell
    whatever they roll. Unclaimed escape ladders are gated out separately by
    `_blocked_nodes` (blocked wins over closed), so listing them all is safe."""
    return frozenset((set(data.BARRIER_GUARDIANS) - _open_barriers(table, sid))
                     | set(data.ESCAPE_LADDERS))


def _stop_nodes(table, sid, doc):
    """The engine `closed` set for THIS mover: the shared sealed-barrier /
    escape-ladder stops from _closed_barriers, plus — for evolved units
    (tier > TUNNEL_TIER_MAX) — every bridge (tunnel) node. An evolved unit must
    STOP on a bridge mouth and pay the toll on landing; it can never corridor
    through a bridge for free. Tier-1 units pass/warp through bridges freely, so
    bridges are not added for them. (Bridges a unit can't afford / is too large
    for are already removed by _blocked_nodes, which wins over closed.)"""
    closed = _closed_barriers(table, sid)
    if doc.get('tier', 1) > data.TUNNEL_TIER_MAX:
        closed = closed | data.TUNNEL_NODES
    return closed


def _wild_warp_dest(nodes, node):
    """A random legal node to be flung to — never into a POI, past a barrier, or
    onto a post-boss escape ladder (those are earned, per-player exits)."""
    no_go = {'boss', 'barrier', 'lair', 'vault'}
    options = [n for n, nd in nodes.items()
               if n != node and nd['type'] not in no_go
               and nd.get('region') != 'ruin'
               and n not in data.ESCAPE_LADDERS]
    return _rng.choice(options)


def _set_wild_warp_node(table, sid, node):
    table.put_item(Item={'pk': _season_pk(sid), 'sk': 'WILDWARP', 'node': node})


def _wild_warp_node(table, sid):
    """The one warp mushroom that always wild-warps. Lazily seeded to a random
    warp and reassigned each time it fires, so no biome owns it forever."""
    node = (_get(table, _season_pk(sid), 'WILDWARP') or {}).get('node')
    if node not in data.WARP_NODES:
        node = _rng.choice(data.WARP_NODES)
        _set_wild_warp_node(table, sid, node)
    return node


def _rotate_wild_warp(table, sid, current):
    """Hop the wild designation to a different warp mushroom."""
    others = [w for w in data.WARP_NODES if w != current]
    if others:
        _set_wild_warp_node(table, sid, _rng.choice(others))


def _open_barrier(table, sid, barrier_id):
    opened = _open_barriers(table, sid)
    opened.add(barrier_id)
    table.put_item(Item={'pk': _season_pk(sid), 'sk': 'BARRIERS',
                         'open': sorted(opened)})


def _to_decimal(obj):
    """DynamoDB rejects Python float — convert floats to Decimal recursively
    (the write-side mirror of _clean's Decimal->number on read). Ints, strings,
    bools, and existing Decimals pass through unchanged."""
    if isinstance(obj, bool):
        return obj
    if isinstance(obj, float):
        return Decimal(str(obj))
    if isinstance(obj, dict):
        return {k: _to_decimal(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_to_decimal(v) for v in obj]
    return obj


def _put_player(table, doc):
    """Optimistic write: bumps ver, fails (409) if someone wrote in between."""
    expected = doc.get('ver', 0)
    doc = _to_decimal(dict(doc))
    doc['ver'] = expected + 1
    try:
        if expected == 0:
            table.put_item(Item=doc, ConditionExpression='attribute_not_exists(pk)')
        else:
            table.put_item(Item=doc,
                           ConditionExpression='ver = :v',
                           ExpressionAttributeValues={':v': expected})
    except ClientError as e:
        if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
            return False
        raise
    return True


def _get_perm(table, user_id):
    doc = _get(table, f'UNDERCITYUSER#{user_id}', 'META')
    if not doc:
        doc = {'pk': f'UNDERCITYUSER#{user_id}', 'sk': 'META',
               'seals': 0, 'hats': [], 'paints': list(data.DEFAULT_PAINTS),
               'effects': [],
               'nights': 0, 'lifetimePvpWins': 0, 'apexReached': 0,
               'renown': data.SHOP_START_RENOWN}
    doc.setdefault('renown', data.SHOP_START_RENOWN)  # backfill existing perm docs
    doc.setdefault('effects', [])                     # backfill existing perm docs
    for p in data.DEFAULT_PAINTS:
        if p not in doc['paints']:
            doc['paints'].append(p)
    return doc


def _passives(doc):
    return frozenset(doc.get('passives') or [])


def _blocked_nodes(doc):
    """Nodes this unit may not step onto. Tier-1 units are barred from no
    bridges. Evolved units pay a tier toll (charged on landing in
    _resolve_space): a Tier-2 that cannot afford it is barred from bridges
    entirely, and an apex unit whose tier has no toll entry is too large to fit
    and is barred outright. Post-boss escape ladders stay barred until you have
    personally cleared the matching sigil lair (its node in poiClaims) — that
    per-player gate is what makes the ladder 'appear' only for a player who beat
    the boss."""
    blocked = set()
    tier = doc.get('tier', 1)
    if tier > data.TUNNEL_TIER_MAX:
        toll = data.TUNNEL_TOLL.get(tier)   # None => too large to fit a bridge
        if toll is None or doc.get('spores', 0) < toll:
            blocked |= data.TUNNEL_NODES
    claims = doc.get('poiClaims') or []
    for esc, lair in data.ESCAPE_LADDERS.items():
        if lair not in claims:
            blocked.add(esc)
    return frozenset(blocked)


def _riders(doc):
    """Gear rider tags across all equipped slots (fang/carapace/charm)."""
    out = set()
    for gid in (doc.get('gear') or {}).values():
        rider = data.GEAR.get(gid, {}).get('rider')
        if rider:
            out.add(rider)
    return frozenset(out)


def _rider_mags(doc):
    """Map each equipped gear rider -> its magnitude at that piece's tier."""
    out = {}
    for gid in (doc.get('gear') or {}).values():
        g = data.GEAR.get(gid)
        if not g:
            continue
        rider = g.get('rider')
        if rider and rider in data.RIDER_SCALE:
            out[rider] = data.RIDER_SCALE[rider][g['tier']]
    return out


def _active_buff_kinds(doc):
    return frozenset(b.get('kind') for b in (doc.get('buffs') or []) if b.get('kind'))


def _shielded(doc):
    su = doc.get('shieldUntil')
    return bool(su) and su > _now()


def _combatant(doc):
    eff = engine.effective_stats(doc)
    return engine.Combatant(
        name=doc.get('username', '?'), hp=doc['hp'], max_hp=eff['maxHp'],
        atk=eff['atk'], dfn=eff['def'], spd=eff['spd'],
        passives=_passives(doc), stance=doc.get('stance', 'fight'),
        level=doc.get('level', 1),
        riders=_riders(doc), rider_mag=_rider_mags(doc), buffs=_active_buff_kinds(doc),
        perks=engine.attribute_perks(doc),
        has_smoke_spore='smoke_spore' in (doc.get('bag') or []),
        flee_bonus=(15 if any(b.get('kind') == 'glowveil'
                              for b in (doc.get('buffs') or [])) else 0))


# ── Battle-record serde (Plan 2 interactive combat) ──────────────────────────

def _bt_snapshot(c):
    """Serialize a Combatant to a DynamoDB-safe dict (sets -> sorted lists)."""
    return {
        'name': c.name, 'hp': int(c.hp), 'maxHp': int(c.max_hp),
        'atk': int(c.atk), 'dfn': int(c.dfn), 'spd': int(c.spd),
        'passives': sorted(c.passives), 'riders': sorted(c.riders),
        'rider_mag': dict(c.rider_mag),
        'buffs': sorted(c.buffs), 'perks': sorted(c.perks),
        'flee_bonus': int(c.flee_bonus),
        'has_smoke_spore': bool(c.has_smoke_spore),
        'rot_stacks': int(c.rot_stacks), 'first_win_used': bool(c.first_win_used),
        'dmg_penalty': int(c.dmg_penalty), 'reveal_next': bool(c.reveal_next),
        'aggress_ramp': int(c.aggress_ramp), 'feint_won': bool(c.feint_won),
    }


def _bt_to_combatant(s):
    c = engine.Combatant(
        name=s['name'], hp=int(s['hp']), max_hp=int(s['maxHp']),
        atk=int(s['atk']), dfn=int(s['dfn']), spd=int(s['spd']),
        passives=frozenset(s.get('passives') or []),
        riders=frozenset(s.get('riders') or []),
        rider_mag={k: float(v) for k, v in (s.get('rider_mag') or {}).items()},
        buffs=frozenset(s.get('buffs') or []),
        perks=frozenset(s.get('perks') or []),
        flee_bonus=int(s.get('flee_bonus', 0)),
        has_smoke_spore=bool(s.get('has_smoke_spore', False)))
    c.rot_stacks = int(s.get('rot_stacks', 0))
    c.first_win_used = bool(s.get('first_win_used', False))
    c.dmg_penalty = int(s.get('dmg_penalty', 0))
    c.reveal_next = bool(s.get('reveal_next', False))
    c.aggress_ramp = int(s.get('aggress_ramp', 0))
    c.feint_won = bool(s.get('feint_won', False))
    return c


def _bt_store(c, rec_side):
    """Write a resolved Combatant's mutable state back into a snapshot dict."""
    rec_side['hp'] = int(max(0, c.hp))
    rec_side['rot_stacks'] = int(c.rot_stacks)
    rec_side['dmg_penalty'] = int(c.dmg_penalty)
    rec_side['first_win_used'] = bool(c.first_win_used)
    rec_side['reveal_next'] = bool(c.reveal_next)
    rec_side['dfn'] = int(c.dfn)
    rec_side['aggress_ramp'] = int(c.aggress_ramp)
    rec_side['feint_won'] = bool(c.feint_won)


def _battle_status(side):
    """Client-facing standing status for one combatant snapshot: the rot stack
    count (drives the DoT) and the list of active buff/debuff effect kinds."""
    return {'rot': int(side.get('rot_stacks', 0)),
            'buffs': list(side.get('buffs') or [])}


def _npc_combatant(npc):
    return engine.Combatant(
        name=npc['name'], hp=npc['hp'], max_hp=npc.get('maxHp', npc['hp']),
        atk=npc['atk'], dfn=npc['def'], spd=npc['spd'],
        passives=frozenset(npc.get('passives') or []))


def _read_chance(doc):
    """How often the player gets an on-screen read of the foe's intent —
    snapshotted once per battle. Base + SPD + reader passives + reader gear."""
    eff = engine.effective_stats(doc)
    chance = data.READ_BASE + data.READ_SPD_COEFF * eff.get('spd', 0)
    for p in _passives(doc):
        chance += data.READ_PASSIVE_BONUS.get(p, 0)
    for gid in (doc.get('gear') or {}).values():
        chance += data.GEAR.get(gid, {}).get('readBonus', 0)
    return max(0.0, min(data.READ_MAX, chance))


def _shown_telegraph(rec):
    """The intent to display this round: None when no read procced, the true
    intent when the read is guaranteed-true (scry/glint), else the (bluffable)
    telegraph."""
    if not rec.get('read'):
        return None
    return rec['npcActual'] if rec.get('readTrue') else rec['npcShown']


def _telegraph_next(rec):
    """Pick the npc's next true stance + telegraph, and roll whether the player
    gets a READ of it this round. A pending reveal_next (Glint feint-win)
    guarantees a true read. Returns the intent to show (None if no read)."""
    personality = rec['npc'].get('personality', data.NPC_DEFAULT_PERSONALITY)
    bluff = float(rec['npc'].get('bluff', data.NPC_DEFAULT_BLUFF))
    # Menace (ATK-10 perk): the foe bluffs you less often.
    if 'menace' in (rec.get('player', {}).get('perks') or []):
        bluff *= data.MENACE_FACTOR
    rec['npcActual'] = engine.pick_stance(personality, _rng)
    rec['npcShown'] = engine.telegraph(rec['npcActual'], bluff, _rng)
    if rec['player'].get('reveal_next'):
        rec['read'], rec['readTrue'] = True, True   # Glint: guaranteed true read
        rec['player']['reveal_next'] = False
    else:
        rec['read'] = _rng.random() < rec.get('readChance', data.READ_BASE)
        rec['readTrue'] = False
    rec['peeked'] = False
    return _shown_telegraph(rec)


def _flee_pct(rec):
    """Display-only escape chance for the flee button. Purely SPD-based (frozen
    at battle start, so constant for the whole fight) + the glowveil bonus,
    capped like the engine; a held Smoke Spore auto-succeeds a failed roll, so
    the odds read 100%. Mirrors engine.flee_attempt."""
    p, n = rec['player'], rec['npc']
    if p.get('has_smoke_spore'):
        return 100
    return min(95, engine.flee_chance(int(p['spd']), int(n['spd']))
               + int(p.get('flee_bonus', 0)))


def _round_cap(kind):
    """Rounds after which a battle auto-ends. World-event skirmishes are bounded
    (a chip, not a fight-to-KO); everything else uses the global safety cap."""
    if kind == 'world':
        return data.WORLD_EVENT_ROUND_CAP
    return data.COMBAT_HARD_CAP


def _frenzy_from(kind):
    """Round the Collapse begins for this battle kind. On for EVERY kind so no
    fight can stalemate (sudden death) — persistent-pool foes (lair/boss) just
    linger at their chipped HP when the player is the one who dies. See the
    combat-collapse spec."""
    return data.FRENZY_START


def _start_battle(table, sid, doc, kind, npc, node=None, ctx=None):
    """Snapshot combatants into doc['battle'], telegraph round 1, return the
    battle_start space event. Player buffs/stats freeze here; rewards resolve
    in _finish_battle when the fight ends."""
    player_c = _combatant(doc)
    npc_snap = _bt_snapshot(_npc_combatant(npc))
    npc_snap['personality'] = npc.get('personality', data.NPC_DEFAULT_PERSONALITY)
    npc_snap['bluff'] = float(npc.get('bluff', data.NPC_DEFAULT_BLUFF))
    rec = {
        'kind': kind, 'node': node, 'round': 1,
        'player': _bt_snapshot(player_c),
        'npc': npc_snap,
        'npcMeta': npc,          # full spec for reward resolution
        'ctx': ctx or {},        # kind-specific (lair slain flag, boss hp pool, ...)
        'strikes': [],
        'readChance': _read_chance(doc),  # frozen for the fight
    }
    doc['battle'] = rec
    shown = _telegraph_next(rec)
    return {'type': 'battle_start', 'kind': kind,
            'npc': {'name': npc['name'], 'id': npc.get('id'),
                    'hp': npc_snap['hp'], 'maxHp': npc_snap['maxHp'],
                    'atk': npc_snap['atk'], 'def': npc_snap['dfn'],
                    'spd': npc_snap['spd'],
                    'level': data.enemy_level(npc_snap['atk'], npc_snap['dfn'],
                                              npc_snap['spd'], npc_snap['maxHp'])},
            'telegraph': shown, 'round': 1,
            'frenzyFrom': _frenzy_from(kind),
            'fleeChance': _flee_pct(rec),
            'playerStatus': _battle_status(rec['player']),
            'npcStatus': _battle_status(rec['npc']),
            'text': f'A {npc["name"]} bars your path!'}


def _form_name(doc):
    return data.ALL_FORMS.get(doc.get('form', ''), {}).get('name', 'creature')


def _creature_label(doc):
    """Player-facing creature name: the hatch-chosen name, else the form name."""
    return doc.get('creatureName') or _form_name(doc)


ONE_BATTLE_BUFFS = ('rot_surge', 'bone_chill', 'glowveil', 'harden_shell', 'weaken_hex',
                    'savage_roar', 'iron_hide', 'fleetfoot', 'warding_dance',
                    'sap_vigor', 'rust_curse')


def _consume_one_battle_buffs(doc):
    doc['buffs'] = [b for b in (doc.get('buffs') or [])
                    if b.get('kind') not in ONE_BATTLE_BUFFS]


def _expire_buffs(doc):
    now = _now()
    doc['buffs'] = [b for b in (doc.get('buffs') or [])
                    if not (b.get('until') and b['until'] < now)]


def _prune_cooldowns(doc):
    now = _now()
    cds = doc.get('spellCooldowns') or {}
    doc['spellCooldowns'] = {k: v for k, v in cds.items() if v > now}
    pcds = doc.get('pokeCooldowns') or {}
    doc['pokeCooldowns'] = {k: v for k, v in pcds.items() if v > now}


def _add_rolls(doc, n):
    """Add rolls up to the cap; returns (granted, lost)."""
    before = doc.get('rolls', 0)
    after = min(data.ROLL_CAP, before + n)
    doc['rolls'] = after
    return after - before, n - (after - before)


def _grant_xp(table, sid, doc, amount):
    doc['xp'] = doc.get('xp', 0) + amount
    gained = engine.apply_level_ups(doc)
    if gained:
        _event(table, sid, 'level', f"{doc['username']}'s {_creature_label(doc)} reached level {doc['level']}!",
               actor=doc['userId'])
    return gained


def _give_consumable(doc):
    """Random consumable into the bag; falls back to Spores when full."""
    if len(doc.get('bag') or []) >= data.BAG_SIZE:
        doc['spores'] = doc.get('spores', 0) + 5
        return None
    item = _rng.choice(list(data.CONSUMABLES.keys()))
    doc.setdefault('bag', []).append(item)
    return item


def _materials(doc):
    """The player's crafting-material counters, defaulted + backfilled in place."""
    m = doc.setdefault('materials', {})
    m.setdefault('moltings', 0)
    m.setdefault('ichor', 0)
    return m


def _grind_materials(doc, gid):
    """Grind a gear piece into crafting materials by its rarity (tier). Mutates
    the player's material counters; returns the amounts gained."""
    tier = data.GEAR[gid]['tier']
    gained = {'moltings': data.SALVAGE_MOLTINGS.get(tier, 1),
              'ichor': data.SALVAGE_ICHOR if tier >= 3 else 0}
    m = _materials(doc)
    m['moltings'] += gained['moltings']
    m['ichor'] += gained['ichor']
    return gained


def _drop_phrase(drop):
    """Past-tense phrase for how a fresh gear drop was disposed of."""
    return 'stashed' if drop['outcome'] == 'stashed' else 'ground into materials'


def _roll_scroll_drop(doc, source):
    """Maybe drop a spell scroll from a reward `source`. The tier is fixed by the
    source (SCROLL_DROP_TIER); the spell is an equal-weight roll within that tier.
    Appends to the scroll satchel, or converts to Spores when the satchel is full.
    Returns the spell id dropped (for the caller to surface as `scroll=`), or None."""
    if _rng.random() >= data.SCROLL_DROP_CHANCE.get(source, 0.0):
        return None
    pool = data.SCROLLABLE_BY_TIER.get(data.SCROLL_DROP_TIER.get(source, 1)) or []
    if not pool:
        return None
    spell_id = pool[_rng.randrange(len(pool))]
    if len(doc.get('scrolls') or []) >= data.SCROLL_SATCHEL_CAP:
        doc['spores'] = doc.get('spores', 0) + data.SCROLL_OVERFLOW_SPORES
    else:
        doc.setdefault('scrolls', []).append(spell_id)
    return spell_id


def _roll_gear_drop(doc, tier_weights):
    """Roll a gear piece per the tier profile and route it to the gear stash —
    found gear is decided later at the Plaza (equip / salvage), no auto-equip or
    auto-mulch. If the stash is full the piece is auto-ground into materials so
    the find is never lost.
    Returns {'id','slot','tier','outcome',...} or None. outcome is 'stashed' or
    'stash-full' (the latter carries the 'materials' it was ground into)."""
    slot = _rng.choice(data.GEAR_SLOTS)
    tiers = list(tier_weights)
    tier = _rng.choices(tiers, weights=[tier_weights[t] for t in tiers])[0]
    pool = [gid for gid, g in data.GEAR.items()
            if g['slot'] == slot and g['tier'] == tier]
    if not pool:
        return None
    gid = _rng.choice(pool)
    stash = doc.setdefault('gearStash', [])
    if len(stash) < data.GEAR_STASH_SIZE:
        stash.append(gid)
        return {'id': gid, 'slot': slot, 'tier': tier, 'outcome': 'stashed'}
    gained = _grind_materials(doc, gid)
    return {'id': gid, 'slot': slot, 'tier': tier,
            'outcome': 'stash-full', 'materials': gained}


def _salvage_gear(table, sid, doc, payload):
    """Salvage Yard: convert a stashed gear piece into materials (mode 'grind')
    or sell it for Spores (mode 'sell' — the 50% sell-back). Plaza service; not
    gated on board position."""
    stash = doc.get('gearStash') or []
    try:
        index = int(payload.get('index'))
    except (TypeError, ValueError):
        return _err('Pick a stash slot to salvage.')
    if index < 0 or index >= len(stash):
        return _err('That stash slot is empty.', 409)
    mode = payload.get('mode', 'grind')
    if mode not in ('grind', 'sell'):
        return _err('Unknown salvage mode.')
    gid = stash.pop(index)
    doc['gearStash'] = stash
    g = data.GEAR[gid]
    if mode == 'sell':
        spores = int(g['cost'] * data.GEAR_SELL_BACK)
        doc['spores'] = doc.get('spores', 0) + spores
        text = f"Sold {g['name']} for {spores} Spores."
        result = {'id': gid, 'mode': 'sell', 'soldSpores': spores}
    else:
        gained = _grind_materials(doc, gid)
        parts = []
        if gained['moltings']:
            parts.append(f"{gained['moltings']} Moltings")
        if gained['ichor']:
            parts.append(f"{gained['ichor']} Chrysalis Ichor")
        text = f"Ground {g['name']} into " + ' + '.join(parts) + '.'
        result = {'id': gid, 'mode': 'grind', 'materials': gained}
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    return _ok(doc, text=text, salvage=result)


def _equip_gear(table, sid, doc, payload):
    """Equip a stashed gear piece into its slot; the displaced piece (if any)
    swaps back into the stash so build experiments are non-destructive."""
    stash = doc.get('gearStash') or []
    try:
        index = int(payload.get('index'))
    except (TypeError, ValueError):
        return _err('Pick a stash piece to equip.')
    if index < 0 or index >= len(stash):
        return _err('That stash slot is empty.', 409)
    gid = stash[index]
    g = data.GEAR.get(gid)
    if not g:
        return _err('Unknown gear.', 409)
    slot = g['slot']
    gear = doc.setdefault('gear', {})
    old = gear.get(slot)
    gear[slot] = gid
    if old:
        stash[index] = old      # worn piece returns to the freed stash slot
    else:
        stash.pop(index)
    doc['gearStash'] = stash
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    return _ok(doc, text=f"Equipped {g['name']}.")


def _upgrade_gear(table, sid, doc, payload):
    """Blacksmith: upgrade an owned piece (equipped slot or stash index) to the
    next rung of its rarity family, spending Spores + materials. Plaza service."""
    target = payload.get('target') or {}
    where = target.get('where')
    if where == 'equipped':
        slot = target.get('slot')
        gid = (doc.get('gear') or {}).get(slot)
        if not gid:
            return _err('No gear in that slot.', 409)
    elif where == 'stash':
        try:
            index = int(target.get('index'))
        except (TypeError, ValueError):
            return _err('Pick a stash piece to upgrade.')
        stash = doc.get('gearStash') or []
        if index < 0 or index >= len(stash):
            return _err('That stash slot is empty.', 409)
        gid = stash[index]
    else:
        return _err('Pick a piece to upgrade.')

    g = data.GEAR.get(gid)
    rider = g.get('rider') if g else None
    if not rider or rider not in data.GEAR_FAMILY:
        return _err('That piece cannot be upgraded.', 409)
    next_tier = g['tier'] + 1
    next_gid = data.GEAR_FAMILY[rider].get(next_tier)
    if not next_gid:
        return _err('That piece is already Legendary.', 409)

    spores_cost = data.UPGRADE_SPORES.get(next_tier, 0)
    moltings_cost = data.UPGRADE_MOLTINGS.get(next_tier, 0)
    ichor_cost = data.UPGRADE_ICHOR.get(next_tier, 0)
    m = _materials(doc)
    if doc.get('spores', 0) < spores_cost:
        return _err('Not enough Spores.', 409)
    if m['moltings'] < moltings_cost:
        return _err('Not enough Moltings.', 409)
    if m['ichor'] < ichor_cost:
        return _err('Not enough Chrysalis Ichor.', 409)
    doc['spores'] = doc.get('spores', 0) - spores_cost
    m['moltings'] -= moltings_cost
    m['ichor'] -= ichor_cost
    if where == 'equipped':
        doc['gear'][slot] = next_gid
    else:
        doc['gearStash'][index] = next_gid
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    return _ok(doc,
               text=f"Forged {g['name']} into {data.GEAR[next_gid]['name']}!",
               upgrade={'from': gid, 'to': next_gid})


# ── Player Market (Plaza, priced) ────────────────────────────────────────────

def _market_price_band(gid):
    """(min, max) Spore price allowed for a gear id, bounded around base cost."""
    cost = data.GEAR[gid]['cost']
    lo = max(1, int(cost * data.MARKET_PRICE_MIN_PCT))
    hi = max(lo, int(cost * data.MARKET_PRICE_MAX_PCT))
    return lo, hi


def _credit_market_seller(table, sid, seller_id, amount, entry):
    """Add sale proceeds to a (possibly offline) seller's doc + notify them,
    retrying past the optimistic-lock conflict. Returns True if credited."""
    for _ in range(5):
        seller = _get_player(table, sid, seller_id)
        if not seller:
            return False
        seller['spores'] = seller.get('spores', 0) + amount
        _push_away_event(seller, entry)
        if _put_player(table, seller):
            return True
    return False


def _market_list(table, sid, doc, payload):
    """List a stashed gear piece on the Player Market at a bounded Spore price."""
    stash = doc.get('gearStash') or []
    try:
        index = int(payload.get('index'))
        price = int(payload.get('price'))
    except (TypeError, ValueError):
        return _err('Pick a stash piece and a price.')
    if index < 0 or index >= len(stash):
        return _err('That stash slot is empty.', 409)
    gid = stash[index]
    lo, hi = _market_price_band(gid)
    if price < lo or price > hi:
        return _err(f'Price must be {lo}–{hi} Spores for that piece.', 409)
    pk = _season_pk(sid)
    active = table.query(
        KeyConditionExpression='pk = :pk AND begins_with(sk, :sk)',
        ExpressionAttributeValues={':pk': pk, ':sk': 'MARKET#'})['Items']
    if sum(1 for m in active if m.get('sellerId') == doc['userId']) >= data.MARKET_MAX_LISTINGS:
        return _err(f'You already have {data.MARKET_MAX_LISTINGS} listings — cancel one first.', 409)
    listing_id = '%08x' % _rng.getrandbits(32)
    stash.pop(index)
    doc['gearStash'] = stash
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    table.put_item(Item={
        'pk': pk, 'sk': f'MARKET#{listing_id}', 'id': listing_id,
        'sellerId': doc['userId'], 'sellerName': doc.get('username', '?'),
        'gearId': gid, 'price': price, 'createdAt': _now()})
    return _ok(doc, text=f"Listed {data.GEAR[gid]['name']} for {price} Spores.",
               listingId=listing_id)


def _market_buy(table, sid, doc, payload):
    """Buy a listing: claim it (conditional delete so two buyers can't both take
    it), pay the seller, and receive the gear into your stash."""
    listing_id = payload.get('listingId')
    pk = _season_pk(sid)
    listing = _get(table, pk, f'MARKET#{listing_id}')
    if not listing:
        return _err('That listing is gone.', 409)
    if listing['sellerId'] == doc['userId']:
        return _err('That is your own listing — cancel it instead.', 409)
    price = int(listing['price'])
    gid = listing['gearId']
    if doc.get('spores', 0) < price:
        return _err('Not enough Spores.', 409)
    if len(doc.get('gearStash') or []) >= data.GEAR_STASH_SIZE:
        return _err('Your stash is full — make room first.', 409)
    try:
        table.delete_item(Key={'pk': pk, 'sk': f'MARKET#{listing_id}'},
                          ConditionExpression='attribute_exists(sk)')
    except ClientError as e:
        if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
            return _err('That listing just sold.', 409)
        raise
    doc['spores'] = doc.get('spores', 0) - price
    doc.setdefault('gearStash', []).append(gid)
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    _credit_market_seller(table, sid, listing['sellerId'], price, {
        'kind': 'market', 'at': _now(),
        'text': f"{doc.get('username', 'Someone')} bought your "
                f"{data.GEAR[gid]['name']} for {price} Spores."})
    return _ok(doc, text=f"Bought {data.GEAR[gid]['name']} for {price} Spores.")


def _market_cancel(table, sid, doc, payload):
    """Reclaim your own listing back into your stash."""
    listing_id = payload.get('listingId')
    pk = _season_pk(sid)
    listing = _get(table, pk, f'MARKET#{listing_id}')
    if not listing:
        return _err('That listing is gone.', 409)
    if listing['sellerId'] != doc['userId']:
        return _err('That is not your listing.', 409)
    if len(doc.get('gearStash') or []) >= data.GEAR_STASH_SIZE:
        return _err('Your stash is full — make room first.', 409)
    try:
        table.delete_item(Key={'pk': pk, 'sk': f'MARKET#{listing_id}'},
                          ConditionExpression='attribute_exists(sk)')
    except ClientError as e:
        if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
            return _err('That listing just sold.', 409)
        raise
    doc.setdefault('gearStash', []).append(listing['gearId'])
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    return _ok(doc, text=f"Reclaimed {data.GEAR[listing['gearId']]['name']}.")


def cutpurse_bonus(doc, feint_won, won):
    """Flat Spores a Cutpurse charm pays after a won fight in which the player
    landed a winning Feint. Static per fight (does not stack with the number of
    Feints); the amount scales with the charm's rarity via RIDER_SCALE."""
    if not (won and feint_won):
        return 0
    return _rider_mags(doc).get('cutpurse', 0)


def _book_spells(doc, gid):
    """A grimoire's CURRENT spells for this player. Contents are mutable
    per-player state in doc['grimoireSpells'] (inscribed at the Sedgemoor Witch);
    falls back to the static bundle for older docs / unseen books."""
    per = (doc.get('grimoireSpells') or {}).get(gid)
    if per is not None:
        return per
    return list(data.GRIMOIRES.get(gid, {}).get('spells') or [])


def _grant_grimoire(doc, gid):
    """Add a book to the permanent collection; the first one auto-opens.
    Duplicates convert to Spores. Returns True when the book was new."""
    owned = doc.setdefault('grimoires', [])
    if gid in owned:
        doc['spores'] = doc.get('spores', 0) + data.GRIMOIRE_DUPLICATE_SPORES
        return False
    owned.append(gid)
    # Seed the mutable per-player contents from the static bundle.
    doc.setdefault('grimoireSpells', {})[gid] = list(
        data.GRIMOIRES.get(gid, {}).get('spells') or [])
    if not doc.get('equippedGrimoire'):
        doc['equippedGrimoire'] = gid
    return True


def _apply_hp_loss(doc, amount, floor=1):
    """Apply an environmental HP loss (hazard / bad mystery), halved by the Thick
    Hide perk (DEF-5). Floors at `floor` (hazards never compost, so 1). Returns
    the amount actually deducted."""
    if amount <= 0:
        return 0
    if 'thick_hide' in engine.attribute_perks(doc):
        amount = max(1, round(amount * data.THICK_HIDE_MULT))
    doc['hp'] = max(floor, doc.get('hp', 0) - amount)
    return amount


def _compost(table, sid, doc, cause_text):
    """Handle death: Undying check, else respawn at the gate with a shield."""
    now = datetime.utcnow()
    if 'undying' in _passives(doc):
        last = doc.get('lastUndying')
        if not last or (now - datetime.fromisoformat(last)) > timedelta(hours=1):
            doc['lastUndying'] = _now()
            doc['hp'] = max(1, round(engine.effective_stats(doc)['maxHp'] * 0.5))
            _event(table, sid, 'undying',
                   f"{doc['username']}'s {_creature_label(doc)} refuses to die! (Undying)",
                   actor=doc['userId'])
            return False
    died_at = doc.get('position')
    died_biome = data.dungeon_biome(died_at)
    home_biome = doc.get('homeBiome')
    home_gate = data.HOME_GATES.get(home_biome, data.GATE_NODE)
    doc['position'] = home_gate  # provisional; a respawn choice may relocate
    doc['hp'] = max(1, round(engine.effective_stats(doc)['maxHp'] * data.COMPOST_RESPAWN_PCT))
    doc['shieldUntil'] = (now + timedelta(minutes=data.COMPOST_SHIELD_MIN)).isoformat(timespec='seconds')
    doc['composts'] = doc.get('composts', 0) + 1
    doc['pendingMove'] = None

    if died_biome:
        # Died in the dark: offer where to crawl back up — home, this biome's
        # surface, or the dungeon mouth. Provisional position stays at the mouth
        # so rolling without choosing keeps you in the dark (the old behavior).
        entrance = data.dungeon_entrance(died_biome)
        if entrance:
            doc['position'] = entrance
        # Dedup by node: home may sit in the dungeon's own biome, collapsing the
        # home and surface gates into one option.
        candidates = [
            (home_gate, f"{data.BIOMES[home_biome]['name']} (home)"),
            (data.HOME_GATES.get(died_biome),
             f"{data.BIOMES[died_biome]['name']} (surface)"),
            (entrance, f"{data.DUNGEONS[died_biome]['name']} (mouth)"),
        ]
        options, seen = [], set()
        for gate, label in candidates:
            if gate and gate not in seen:
                seen.add(gate)
                options.append({'gate': gate, 'label': label})
        if len(options) > 1:
            doc['pendingRespawn'] = {'options': options}
        else:
            doc.pop('pendingRespawn', None)
    else:
        # Offer a respawn choice when the last biome you stood in differs from
        # home, else just wake at the home gate. Labels for the UI.
        last_biome = doc.get('lastBiome')
        if last_biome and last_biome != home_biome and last_biome in data.HOME_GATES:
            doc['pendingRespawn'] = {'options': [
                {'gate': home_gate, 'label': f"{data.BIOMES[home_biome]['name']} (home)"},
                {'gate': data.HOME_GATES[last_biome], 'label': data.BIOMES[last_biome]['name']},
            ]}
        else:
            doc.pop('pendingRespawn', None)

    _event(table, sid, 'compost', cause_text, actor=doc['userId'])
    return True


# ── GET /game/state ──────────────────────────────────────────────────────────

def handle_map(table, query_params):
    """GET /game/map — the night's board: fixed surface + this season's depths,
    in the BoardMap shape the client renders. `?sample=<seed>` instead returns a
    preview: the surface plus freshly generated depths for that seed, ignoring the
    flag and the active season (the map editor uses this to browse generator
    output). Falls back to the committed board when no season is active."""
    doc = dict(data._MAP_DOC)     # worldW/H, gate, boss, regions, decals, labels
    sample = (query_params or {}).get('sample')
    if sample:
        depths = {n['id']: n for n in mapgen.generate_all_depths(sample)}
        nodes = data.merge_map(depths)
    else:
        sid, config = _active_season(table)
        # _season_map handles a None sid (no active season) by returning the
        # committed board, so no direct read of the global is needed here.
        nodes = _season_map(table, sid)
    doc['nodes'] = list(nodes.values())
    return 200, doc


def handle_state(table, query_params):
    user_id = (query_params or {}).get('userId') or ''
    sid, config = _active_season(table)

    if not sid or not config:
        return 200, {'season': None, 'you': None, 'players': [], 'snares': [],
                     'events': [], 'result': None, 'hallOfFame': _hall_of_fame(table)}

    nodes = _season_map(table, sid)
    pk = _season_pk(sid)
    resp = table.query(
        KeyConditionExpression='pk = :pk AND sk >= :sk',
        ExpressionAttributeValues={':pk': pk, ':sk': 'PLAYER#'})
    items = [_clean(i) for i in resp['Items']]

    ev = table.query(
        KeyConditionExpression='pk = :pk AND begins_with(sk, :sk)',
        ExpressionAttributeValues={':pk': pk, ':sk': 'EVENT#'},
        ScanIndexForward=False, Limit=150)
    events = [_clean(i) for i in ev['Items']]

    mk = table.query(
        KeyConditionExpression='pk = :pk AND begins_with(sk, :sk)',
        ExpressionAttributeValues={':pk': pk, ':sk': 'MARKET#'})
    market = [{'id': m['id'], 'sellerId': m['sellerId'],
               'sellerName': m.get('sellerName', ''),
               'gearId': m['gearId'], 'price': int(m['price'])}
              for m in (_clean(i) for i in mk['Items'])]

    # Season-global first-conqueror records. FIRST# sorts before PLAYER#, so it
    # is NOT covered by the sk >= 'PLAYER#' range query above — it needs its own.
    fr = table.query(
        KeyConditionExpression='pk = :pk AND begins_with(sk, :sk)',
        ExpressionAttributeValues={':pk': pk, ':sk': 'FIRST#'})
    firsts = {i['sk'].replace('FIRST#', ''):
              {'by': i.get('by'), 'at': i.get('at'), 'kind': i.get('kind')}
              for i in (_clean(x) for x in fr['Items'])}

    players, you, snares, result, posts, sites = [], None, [], None, {}, {}
    veins, vaults, shops = {}, {}, {}
    now = _now()
    for item in items:
        if item['sk'].startswith('PLAYER#'):
            engine.regen_hp(item, now)  # display-only; persisted on next action
            engine.regen_rolls(item, now)
            _expire_buffs(item)
            _prune_cooldowns(item)
            players.append(_public_player(item))
            if item['userId'] == user_id:
                you = {k: v for k, v in item.items() if k not in ('pk', 'sk')}
                you.update(_roll_meta(item))
                you['perks'] = sorted(engine.attribute_perks(item))
        elif item['sk'].startswith('SPACE#'):
            snares.append(item['sk'].replace('SPACE#', ''))
        elif item['sk'].startswith('POST#'):
            posts[item['sk'].replace('POST#', '')] = item.get('stock') or []
        elif item['sk'].startswith('SITE#'):
            sites[item['sk'].replace('SITE#', '')] = item
        elif item['sk'].startswith('VEIN#'):
            veins[item['sk'].replace('VEIN#', '')] = {'depth': item.get('depth', 0)}
        elif item['sk'].startswith('VAULT#'):
            vaults[item['sk'].replace('VAULT#', '')] = _vault_view(item)
        elif item['sk'].startswith('SHOP#'):
            shops[item['sk'].replace('SHOP#', '')] = item
        elif item['sk'] == 'RESULT':
            result = {k: v for k, v in item.items() if k not in ('pk', 'sk')}

    # A pending interactive battle: hand the client a SANITIZED resume so a
    # refresh can reopen the fight (otherwise the server's battle-guard soft-
    # locks the player). Never expose the raw record — it holds npcActual, the
    # hidden true intent — except the shown telegraph, or the true intent only
    # if the player already scried it this round.
    battle_resume = None
    if you is not None and you.get('battle'):
        battle_resume = _battle_resume(you.pop('battle'), you.get('hp', 0))

    # Show a display-seeded stock for any post nobody has traded at yet, so the
    # exchange renders from turn one without a write on read.
    for nid, n in nodes.items():
        if n['type'] == 'trading_post' and nid not in posts:
            posts[nid] = _seed_stock()

    # Umori the wandering post: its current node + display-seeded T3 stock so the
    # board can render it anywhere and the exchange opens from turn one.
    umori_win = _umori_window()
    umori_node = _umori_node(umori_win)
    posts[umori_node] = _umori_barter_stock(table, sid, umori_win)

    # Masked dig-site views for every excavation node (empty/covered until dug).
    excavations = {nid: _dig_view(sites.get(nid))
                   for nid, n in nodes.items() if n['type'] == 'excavation'}

    # Display-seed untouched veins/vaults so the map renders their facilities
    # from turn one without a write on read.
    for n in nodes.values():
        if n['type'] == 'crystal_vein':
            veins.setdefault(n['region'], {'depth': 0})
        elif n['type'] == 'vault_lock':
            vaults.setdefault(n['region'], _vault_view(None))

    # Bazaar stock per shop node — the current-window persisted record (possibly
    # depleted) or a freshly generated full stock. Display-seeded like posts.
    shop_win = _shop_window()
    refreshes_at = _shop_window_end(shop_win)
    bazaars = {}
    for nid, n in nodes.items():
        if n['type'] != 'shop':
            continue
        rec = shops.get(nid)
        st = rec if rec and rec.get('window') == shop_win else _gen_shop_stock(nid, shop_win)
        bazaars[nid] = {'gear': st['gear'], 'consumables': st['consumables'],
                        'grimoires': st['grimoires'], 'refreshesAt': refreshes_at}

    out = {
        'season': {'seasonId': sid, 'status': config.get('status'),
                   'startedAt': config.get('startedAt'),
                   'bossPhase': bool(config.get('bossPhase'))},
        'you': you,
        'players': players,
        'snares': snares,
        'tradingPosts': posts,
        'umori': {'node': umori_node, 'movesAt': _umori_window_end(umori_win),
                  'traded': bool(you and you.get('umoriTradedWindow') == umori_win)},
        'bazaars': bazaars,
        'market': market,
        'excavations': excavations,
        'veins': veins,
        'vaults': vaults,
        'barriersOpen': sorted(_open_barriers(table, sid)),
        'boss': {'hp': _boss_hp(table, sid), 'maxHp': data.ROT_SOVEREIGN['hp']},
        'firsts': firsts,
        'worldEvent': _world_event_public(table, sid),
        'guardians': _guardian_pools(table, sid),
        'events': [{k: v for k, v in e.items() if k not in ('pk', 'sk')} for e in events],
        'result': result if config.get('status') == 'ended' else None,
        'battle': battle_resume,
    }
    if user_id:
        perm = _get_perm(table, user_id)
        out['wardrobe'] = {'hats': perm['hats'], 'paints': perm['paints'],
                           'effects': perm['effects'],
                           'seals': perm['seals'], 'nights': perm.get('nights', 0),
                           'renown': perm.get('renown', 0)}
    if config.get('status') == 'ended':
        out['hallOfFame'] = _hall_of_fame(table)
    return 200, out


def _public_player(p):
    # Effective stats (gear + buffs) are surfaced publicly so the spectator/TV
    # broadcast can show each creature's build on its hero card.
    eff = engine.effective_stats(p)
    return {
        'userId': p['userId'], 'username': p.get('username', '?'),
        'species': p.get('species'), 'form': p.get('form'), 'tier': p.get('tier', 1),
        'formName': _form_name(p),
        'creatureName': p.get('creatureName') or _form_name(p),
        'level': p.get('level', 1), 'hp': p.get('hp', 0),
        'maxHp': eff['maxHp'],
        'atk': eff['atk'], 'def': eff['def'], 'spd': eff['spd'],
        'gear': p.get('gear') or {},
        'position': p.get('position'), 'stance': p.get('stance', 'fight'),
        'shieldUntil': p.get('shieldUntil'),
        'spores': p.get('spores', 0), 'rolls': p.get('rolls', 0),
        'pvpWins': p.get('pvpWins', 0), 'wildWins': p.get('wildWins', 0),
        'composts': p.get('composts', 0), 'sigils': _sigil_count(p),
        'paint': p.get('paint'), 'hat': p.get('hat'), 'effect': p.get('effect'),
        'spriteVariant': p.get('spriteVariant'),
        'shiny': p.get('shiny', False),
        'isBot': p.get('isBot', False),
        'status': p.get('status', ''),
        'renown': data.compute_renown(p),
        'perks': sorted(engine.attribute_perks(p)),
    }


def _hall_of_fame(table):
    resp = table.query(
        KeyConditionExpression='pk = :pk',
        ExpressionAttributeValues={':pk': HOF_PK},
        ScanIndexForward=False, Limit=20)
    return [{k: v for k, v in _clean(i).items() if k not in ('pk', 'sk')}
            for i in resp['Items']]


# ── POST /game/action ────────────────────────────────────────────────────────

def handle_action(table, body):
    try:
        req = json.loads(body) if isinstance(body, str) else body
    except (json.JSONDecodeError, TypeError):
        return _err('Invalid JSON')
    atype = req.get('type')
    user_id = req.get('userId')
    username = req.get('username', '')
    payload = req.get('payload') or {}
    if not atype or not user_id:
        return _err('type and userId are required')

    if atype == 'season-start':
        return _season_start(table, payload)

    sid, config = _active_season(table)
    if not sid or not config or config.get('status') != 'active':
        return _err('No active season. Ask the host to start the night.', 409)

    if atype == 'season-end':
        return _season_end(table, sid, config, payload)
    if atype == 'boss-awaken':
        return _boss_awaken(table, sid, config, payload)
    if atype == 'admin':
        return _admin(table, sid, config, payload)

    if atype == 'join':
        return _join(table, sid, user_id, username, payload)

    doc = _get_player(table, sid, user_id)
    if not doc:
        return _err('Join the season first.', 409)
    engine.regen_hp(doc, _now())
    engine.regen_rolls(doc, _now())
    _expire_buffs(doc)
    _prune_cooldowns(doc)

    handlers = {
        'claim': _claim, 'roll': _roll, 'move': _move, 'battle': _battle,
        'combat-round': _combat_round, 'combat-peek': _combat_peek,
        'combat-flee': _combat_flee,
        'set-stance': _set_stance, 'spend-stat': _spend_stat, 'evolve': _evolve,
        'buy': _buy, 'use-item': _use_item, 'shrine': _shrine, 'warp': _warp,
        'gamble': _gamble, 'poke': _poke, 'customize': _customize,
        'set-status': _set_status,
        'drop-item': _drop_item,
        'attack-boss': _attack_boss, 'world-engage': _world_engage,
        'trade': _trade, 'dig': _dig, 'strike': _strike,
        'vault-guess': _vault_guess, 'respawn': _respawn,
        'cast': _cast,
        'witch-inscribe': _witch_inscribe, 'witch-buy-scroll': _witch_buy_scroll,
        'equip-grimoire': _equip_grimoire, 'ack-events': _ack_events,
        'solve-loot-puzzle': _solve_loot_puzzle,
        'cancel-loot-puzzle': _cancel_loot_puzzle,
        'equip-gear': _equip_gear,
        'salvage-gear': _salvage_gear, 'upgrade-gear': _upgrade_gear,
        'market-list': _market_list, 'market-buy': _market_buy,
        'market-cancel': _market_cancel,
    }
    handler = handlers.get(atype)
    if not handler:
        return _err(f'Unknown action: {atype}')
    # A pending interactive battle blocks turn actions until it resolves; only
    # the combat actions and read-only/meta actions are allowed mid-fight.
    if doc.get('battle') and atype not in _BATTLE_ALLOWED_ACTIONS:
        return _err('Finish your fight first.', 409)
    return handler(table, sid, doc, payload)


# Actions permitted while a battle is in progress (combat + read-only/meta).
_BATTLE_ALLOWED_ACTIONS = frozenset({
    'combat-round', 'combat-peek', 'combat-flee',
    'set-stance', 'spend-stat', 'customize', 'set-status', 'ack-events',
})


# Max length of a player's status-bubble text (mirror: STATUS_MAX in
# src/app/undercity/tabs/*.component.ts). Trim + collapse whitespace, then cap.
STATUS_MAX_LEN = 24


def _normalize_status(raw):
    """Coerce to a clean single-line status: trim, collapse any whitespace runs
    (spaces/tabs/newlines) to single spaces, and cap at STATUS_MAX_LEN. Non-str
    or empty input yields ''."""
    if not isinstance(raw, str):
        return ''
    return ' '.join(raw.split())[:STATUS_MAX_LEN]


def _roll_meta(doc):
    """Debug flag + next regen tick, injected into every `you` view so the
    client can gate its dev tools and show a next-roll countdown."""
    meta = {'debug': data.DEBUG}
    if doc.get('rolls', 0) < data.ROLL_CAP and doc.get('rollRegenAt'):
        nxt = engine._parse_iso(doc['rollRegenAt']) + timedelta(minutes=data.ROLL_REGEN_MINUTES)
        meta['nextRollAt'] = nxt.strftime('%Y-%m-%dT%H:%M:%S')
    return meta


def _ok(doc, **extra):
    you = {k: v for k, v in doc.items() if k not in ('pk', 'sk')}
    you.update(_roll_meta(doc))
    you['perks'] = sorted(engine.attribute_perks(doc))
    # Report the EFFECTIVE max HP (base + gear + perks), not the raw base. hp is
    # always healed/clamped to the effective max, so echoing base maxHp made a
    # full-HP creature read as "hp over max" on the client. Match _public_player.
    you['maxHp'] = engine.effective_stats(doc)['maxHp']
    return 200, {'ok': True, 'you': you, **extra}


def _save_or_conflict(table, doc):
    if not _put_player(table, doc):
        return _err('Someone moved your creature first — refreshing.', 409)
    return None


# ── Board-game session rewards (called by queue_db) ──────────────────────────

def _reward_pk(sid):
    return f'QUEUEREWARD#{sid}'


def _reward_sk(user_id):
    return f'USER#{user_id}'


def _grant_to_player(table, sid, user_id, is_winner, game_name=None):
    """Apply a board-game reward to a live player doc, retrying on the optimistic
    version guard (the player might be mid-action). Best-effort: returns True if
    applied, False if the doc vanished or every retry lost the race. Leaves a
    welcome-back note so a returning player learns what the game earned them."""
    rolls = data.CLAIM_FINISHED_ROLLS + (data.CLAIM_WON_BONUS_ROLLS if is_winner else 0)
    for _ in range(4):
        doc = _get_player(table, sid, user_id)
        if not doc:
            return False
        _add_rolls(doc, data.CLAIM_FINISHED_ROLLS)
        items = 0
        if is_winner:
            _add_rolls(doc, data.CLAIM_WON_BONUS_ROLLS)
            if _give_consumable(doc):
                items = 1
        _push_away_event(doc, {'kind': 'reward', 'game': game_name,
                               'rolls': rolls, 'items': items, 'at': _now()})
        if _put_player(table, doc):
            return True
    return False


def _bank_reward(table, sid, user_id, is_winner, game_name=None):
    """Store a reward for a user who has no creature yet; merged on repeats."""
    rec = _get(table, _reward_pk(sid), _reward_sk(user_id)) or {
        'pk': _reward_pk(sid), 'sk': _reward_sk(user_id),
        'userId': user_id, 'rolls': 0, 'items': [],
    }
    rec['rolls'] = rec.get('rolls', 0) + data.CLAIM_FINISHED_ROLLS + (
        data.CLAIM_WON_BONUS_ROLLS if is_winner else 0)
    if is_winner:
        rec.setdefault('items', []).append(_rng.choice(list(data.CONSUMABLES.keys())))
    if game_name:
        rec['game'] = game_name   # names the most recent game if several bank
    table.put_item(Item=rec)


def grant_board_game_rewards(table, sid, participant_ids, winner_ids, game_name=None):
    """Public entry point for queue_db. Grants participation rolls to every
    participant and a bonus roll + item to each winner; banks the reward for
    anyone who hasn't hatched a creature this night. Returns a summary."""
    winners = set(winner_ids)
    granted, banked = [], []
    for uid in participant_ids:
        is_winner = uid in winners
        if _grant_to_player(table, sid, uid, is_winner, game_name):
            granted.append(uid)
        else:
            _bank_reward(table, sid, uid, is_winner, game_name)
            banked.append(uid)
    return {'granted': granted, 'banked': banked}


def apply_banked_rewards(table, sid, user_id, doc):
    """Apply any banked board-game rewards onto a freshly hatched doc (mutates
    it in place), then delete the bank record and announce it. No-op if none."""
    rec = _get(table, _reward_pk(sid), _reward_sk(user_id))
    if not rec:
        return
    rolls = int(rec.get('rolls', 0))
    if rolls:
        _add_rolls(doc, rolls)
    items = rec.get('items') or []
    for item in items:
        if len(doc.get('bag') or []) >= data.BAG_SIZE:
            doc['spores'] = doc.get('spores', 0) + 5
        else:
            doc.setdefault('bag', []).append(item)
    table.delete_item(Key={'pk': _reward_pk(sid), 'sk': _reward_sk(user_id)})
    _push_away_event(doc, {'kind': 'reward', 'game': rec.get('game'),
                           'rolls': rolls, 'items': len(items), 'at': _now()})
    extra = f", {len(items)} item(s)" if items else ''
    _event(table, sid, 'claim',
           f"{doc['username']} collected banked rewards from tonight's games "
           f"(+{rolls} rolls{extra})", actor=user_id)


def post_event(table, sid, etype, text):
    """Public wrapper so queue_db can post to the Grapevine feed."""
    _event(table, sid, etype, text)


# ── Season lifecycle ─────────────────────────────────────────────────────────

def _season_start(table, payload):
    host_key = (payload.get('hostKey') or '').strip()
    if not host_key:
        return _err('hostKey required')
    sid_old, config_old = _active_season(table)
    if config_old and config_old.get('hostKey') != host_key:
        return _err('Wrong host passphrase.', 403)
    if config_old and config_old.get('status') == 'active':
        # Archive the running night without ceremony before starting fresh.
        _archive_season(table, sid_old, config_old)

    sid = datetime.utcnow().strftime('%Y%m%d-%H%M%S')
    table.put_item(Item={'pk': _season_pk(sid), 'sk': 'CONFIG',
                         'status': 'active', 'hostKey': host_key,
                         'startedAt': _now(), 'bossPhase': False})
    table.put_item(Item={'pk': META_PK, 'sk': 'CURRENT', 'seasonId': sid})
    if data.PROCEDURAL_DUNGEONS:
        # Fresh mazes for the night; _season_map reads this record all night.
        table.put_item(Item={'pk': _season_pk(sid), 'sk': 'MAP',
                             'depths': mapgen.generate_all_depths(sid)})
    _event(table, sid, 'season',
           'A new night falls on the Undercity. The swarm stirs…')
    return 200, {'ok': True, 'seasonId': sid}


def _season_end(table, sid, config, payload):
    host_key = (payload.get('hostKey') or '').strip()
    if config.get('hostKey') != host_key:
        return _err('Wrong host passphrase.', 403)
    result = _archive_season(table, sid, config)
    return 200, {'ok': True, 'result': result}


def _boss_awaken(table, sid, config, payload):
    """
    Host finale trigger (GDD "Awaken the Behemoth"): the rot-wards fall and
    Savra unseals for every creature, sigils or not. One-way for the night.
    """
    host_key = (payload.get('hostKey') or '').strip()
    if config.get('hostKey') != host_key:
        return _err('Wrong host passphrase.', 403)
    if config.get('bossPhase'):
        return _err('The Queen is already awake.', 409)
    table.put_item(Item=dict(config, bossPhase=True))
    _event(table, sid, 'boss',
           'THE ROT-WARDS FALL! Savra, Queen of the Golgari, stirs atop the '
           'floating island — every creature may now storm her lair.')
    return 200, {'ok': True}


# ── Host admin (passphrase-gated) ────────────────────────────────────────────

def _admin(table, sid, config, payload):
    """Single gated entry point for host tooling. Verifies the passphrase once,
    then routes on `cmd`. Handlers return plain {'ok': True, ...} envelopes
    (never a `you` doc) — the admin client refreshes state rather than patching
    its own creature."""
    host_key = (payload.get('hostKey') or '').strip()
    if config.get('hostKey') != host_key:
        return _err('Wrong host passphrase.', 403)
    cmd = payload.get('cmd')
    handler = _ADMIN_CMDS.get(cmd)
    if not handler:
        return _err(f'Unknown admin cmd: {cmd}')
    return handler(table, sid, payload)


def _admin_broadcast(table, sid, payload):
    text = str(payload.get('text') or '').strip()[:280]
    if not text:
        return _err('Broadcast text required.')
    _event(table, sid, 'host', text)
    return 200, {'ok': True}


def _admin_bot_add(table, sid, payload):
    species = payload.get('species')
    if species in (None, '', 'random'):
        species = random.choice(list(data.STARTERS))
    if species not in data.STARTERS:
        return _err('Unknown species: ' + str(species))
    home = payload.get('home')
    if home in (None, '', 'random'):
        home = random.choice(list(data.BIOMES))
    if home not in data.BIOMES:
        return _err('Unknown home biome: ' + str(home))
    name = str(payload.get('name') or '').strip()[:16]
    bot_id = 'BOT#' + uuid.uuid4().hex[:8]
    username = name or ('Bot ' + bot_id[4:8])
    doc = _new_player_doc(sid, bot_id, username, species, home,
                          creature_name=name, is_bot=True)
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    _event(table, sid, 'hatch',
           f"A {data.STARTERS[species]['name']} named {doc['creatureName']} "
           f"skitters into the Undercity.", actor=bot_id)
    return 200, {'ok': True, 'bot': _public_player(doc)}


def _admin_target(table, sid, payload):
    """Resolve payload.target to a live player doc. Returns (doc, None) or
    (None, error_tuple)."""
    target = payload.get('target')
    if not target:
        return None, _err('target userId required.')
    doc = _get_player(table, sid, target)
    if not doc:
        return None, _err('No such player this season.')
    return doc, None


def _admin_grant(table, sid, payload):
    doc, err = _admin_target(table, sid, payload)
    if err:
        return err
    rolls = int(payload.get('rolls') or 0)
    spores = int(payload.get('spores') or 0)
    xp = int(payload.get('xp') or 0)
    if rolls:
        doc['rolls'] = doc.get('rolls', 0) + rolls
    if spores:
        doc['spores'] = doc.get('spores', 0) + spores
    if xp:
        _grant_xp(table, sid, doc, xp)  # mutates doc; fires level events
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    return 200, {'ok': True}


def _admin_heal(table, sid, payload):
    doc, err = _admin_target(table, sid, payload)
    if err:
        return err
    doc['hp'] = engine.effective_stats(doc)['maxHp']
    doc['hpUpdatedAt'] = _now()
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    return 200, {'ok': True}


def _admin_teleport(table, sid, payload):
    nodes = _season_map(table, sid)
    doc, err = _admin_target(table, sid, payload)
    if err:
        return err
    node = payload.get('node')
    if node not in nodes:
        return _err('Unknown node: ' + str(node))
    doc['position'] = node
    doc['pendingMove'] = None
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    return 200, {'ok': True}


def _admin_bot_step(table, sid, payload):
    """Take a bot's turn: a short random wander (1–4 hops by the real movement
    rules, respecting sealed barriers) with NO landing effects. Bots are
    non-combat puppets, so we can't run roll→move (a wild landing would trap the
    bot in a battle nothing drives); this just shifts them off their gate."""
    nodes = _season_map(table, sid)
    doc, err = _admin_target(table, sid, payload)
    if err:
        return err
    if not doc.get('isBot'):
        return _err('bot-step moves bots only.')
    closed = _stop_nodes(table, sid, doc)
    blocked = _blocked_nodes(doc)
    dests = set()
    for steps in range(random.randint(1, 4), 0, -1):
        dests = engine.legal_destinations(nodes, doc['position'], steps,
                                          closed, blocked)
        if dests:
            break
    if not dests:
        return _err('This bot has nowhere to step.')
    doc['position'] = random.choice(sorted(dests))
    doc['pendingMove'] = None
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    return 200, {'ok': True}


def _admin_kick(table, sid, payload):
    target = payload.get('target')
    if not target:
        return _err('target userId required.')
    doc = _get_player(table, sid, target)
    if not doc:
        return _err('No such player this season.')
    table.delete_item(Key={'pk': _season_pk(sid), 'sk': f'PLAYER#{target}'})
    _event(table, sid, 'host',
           f"{doc.get('username', 'A creature')} left the Undercity.")
    return 200, {'ok': True, 'removed': target}


_ADMIN_CMDS = {
    'broadcast': _admin_broadcast,
    'bot-add': _admin_bot_add,
    'grant': _admin_grant,
    'heal': _admin_heal,
    'teleport': _admin_teleport,
    'bot-step': _admin_bot_step,
    'kick': _admin_kick,
}


def _archive_season(table, sid, config):
    pk = _season_pk(sid)
    resp = table.query(
        KeyConditionExpression='pk = :pk AND begins_with(sk, :sk)',
        ExpressionAttributeValues={':pk': pk, ':sk': 'PLAYER#'})
    standings = []
    for raw in resp['Items']:
        p = _clean(raw)
        standings.append({
            'userId': p['userId'], 'username': p.get('username', '?'),
            'renown': data.compute_renown(p), 'level': p.get('level', 1),
            'form': p.get('form'), 'formName': _form_name(p),
            'creatureName': p.get('creatureName') or _form_name(p),
            'species': p.get('species'),
            'pvpWins': p.get('pvpWins', 0), 'wildWins': p.get('wildWins', 0),
            'spores': p.get('spores', 0), 'paint': p.get('paint'),
            'hat': p.get('hat'), 'effect': p.get('effect'),
            'spriteVariant': p.get('spriteVariant'),
        })
        # Lifetime stats onto the permanent doc.
        perm = _get_perm(table, p['userId'])
        perm['lifetimePvpWins'] = perm.get('lifetimePvpWins', 0) + p.get('pvpWins', 0)
        if p.get('tier') == 3:
            perm['apexReached'] = perm.get('apexReached', 0) + 1
        # Bank this night's earned Renown for the pre-spawn shop.
        perm['renown'] = perm.get('renown', 0) + data.compute_renown(p)
        table.put_item(Item=perm)
    standings.sort(key=lambda s: -s['renown'])

    result = {'standings': standings, 'endedAt': _now(),
              'champion': standings[0] if standings else None}
    table.put_item(Item={'pk': pk, 'sk': 'RESULT', **result})
    table.put_item(Item={'pk': pk, 'sk': 'CONFIG', **config,
                         'status': 'ended', 'endedAt': _now()})
    if standings:
        table.put_item(Item={'pk': HOF_PK, 'sk': f'NIGHT#{sid}',
                             'seasonId': sid, 'endedAt': _now(),
                             'champion': standings[0],
                             'podium': standings[:3]})
        _event(table, sid, 'season',
               f"The night ends. {standings[0]['username']} is champion of the Undercity "
               f"with {standings[0]['renown']} Renown!")
    return result


# ── Join / hatch ─────────────────────────────────────────────────────────────

def _new_player_doc(sid, user_id, username, starter, home, *,
                    seals_before=0, egg_hue=None, creature_name='',
                    sprite_variant=None, is_bot=False):
    """Build a fresh, fully-valid season player doc. Shared by human `join`
    and admin `bot-add` so the two can never drift. Perm-record bookkeeping
    (seals/nights) stays in `_join`; bots skip it (they have no account)."""
    s = data.STARTERS[starter]
    body_hue = 130
    if seals_before >= 1 and isinstance(egg_hue, (int, float)):
        body_hue = int(egg_hue) % 360
    doc = {
        'pk': _season_pk(sid), 'sk': f'PLAYER#{user_id}',
        'userId': user_id, 'username': username or user_id,
        'species': starter, 'form': starter, 'tier': 1,
        'creatureName': creature_name or s['name'],
        'passives': [s['passive']],
        'level': 1, 'xp': 0, 'statPoints': 0,
        'spentThisLevel': {'atk': 0, 'def': 0, 'spd': 0},
        'hp': s['hp'], 'maxHp': s['hp'],
        'atk': s['atk'], 'def': s['def'], 'spd': s['spd'],
        'hpUpdatedAt': _now(),
        'rollRegenAt': _now(),
        'position': data.HOME_GATES[home],
        'homeBiome': home,
        'rolls': data.JOIN_ROLLS,
        'spores': 0,
        'bag': [], 'gear': {}, 'gearStash': [], 'materials': {'moltings': 0, 'ichor': 0},
        'stance': 'fight',
        'pendingMove': None, 'buffs': [],
        'grimoires': [], 'equippedGrimoire': None,
        'scrolls': [], 'grimoireSpells': {},
        'spellCooldowns': {}, 'pokeCooldowns': {}, 'awayEvents': [],
        'lastFinishedClaim': None, 'taughtClaims': 0, 'pokesReceived': 0,
        'pvpWins': 0, 'wildWins': 0, 'composts': 0, 'bossDamage': 0,
        'paint': {'body': body_hue, 'belly': 50, 'stripes': body_hue},
        'hat': None, 'effect': None, 'joinedAt': _now(), 'ver': 0,
        # Cosmetic-only shiny, rolled once at hatch; rides through evolutions
        # (same doc). Client draws a gold sparkle over shiny sprites.
        'shiny': _rng.random() < data.SHINY_HATCH_CHANCE,
    }
    # ── Home-biome hatch perks ──────────────────────────────────────────────
    if home == 'bone':
        # Marrowborn: flat +Max HP, hatched at full so the bonus is felt at once.
        doc['maxHp'] += data.MARROWBORN_MAXHP
        doc['hp'] += data.MARROWBORN_MAXHP
    elif home == 'city':
        # City Rat: hatch with a random Tier-1 piece of gear in the stash — no
        # auto-equip; the player equips it at the Plaza. Seeded on the player id
        # so the pick is stable (varies per player, but deterministic — no test
        # flakiness, no re-roll on recompute).
        t1 = sorted(gid for gid, g in data.GEAR.items() if g.get('tier') == 1)
        if t1:
            gid = random.Random(zlib.crc32(f'cityrat:{user_id}'.encode())).choice(t1)
            doc.setdefault('gearStash', []).append(gid)
    # Cosmetic starter look; only stored when a non-base alt was chosen so the
    # base look leaves no field (see STARTER_VARIANTS).
    if sprite_variant:
        doc['spriteVariant'] = sprite_variant
    if is_bot:
        doc['isBot'] = True
    return doc


def _seed_night_rolls(table, sid, doc):
    """Anchor a first-time joiner's roll bank to the NIGHT, not the moment they
    hatched: they start with what they'd have accrued had they been here since
    the season began — JOIN_ROLLS plus regen from the season's startedAt, capped
    at ROLL_CAP. So a latecomer isn't punished for showing up an hour in. No-op
    (leaving the now-anchored JOIN_ROLLS) if the season has no recorded start."""
    config = _get(table, _season_pk(sid), 'CONFIG') or {}
    started = config.get('startedAt')
    if started:
        doc['rollRegenAt'] = started
        engine.regen_rolls(doc, _now())


def _apply_shop_purchases(perm, doc, payload):
    """Spend banked Renown at the pre-spawn shop, then equip chosen cosmetics.
    Validates the FULL cart before mutating anything, so a bad request leaves
    `perm` and `doc` untouched and costs the player nothing. Mutates both in
    place on success; returns an (status, body) error tuple on failure, else None."""
    buy_hats = list(dict.fromkeys(payload.get('buyHats') or []))
    buy_paints = list(dict.fromkeys(payload.get('buyPaints') or []))
    buy_items = list(payload.get('buyItems') or [])
    buy_effects = list(dict.fromkeys(payload.get('buyEffects') or []))
    equip_hat = payload.get('equipHat') or None
    equip_paint = payload.get('equipPaint') or None
    equip_effect = payload.get('equipEffect') or None

    total = 0
    for hid in buy_hats:
        h = data.HAT_MAP.get(hid)
        if not h:
            return _err(f'Unknown hat: {hid}')
        if hid in perm['hats']:
            return _err('You already own that hat.')
        total += data.HAT_PRICES[h['rarity']]
    for pid in buy_paints:
        if pid not in data.PAINT_MAP:
            return _err(f'Unknown color: {pid}')
        if pid in perm['paints']:
            return _err('You already own that color.')
        total += data.PAINT_PRICE
    for eid in buy_effects:
        if eid not in data.SPECIAL_PAINT_MAP:
            return _err(f'Unknown special paint: {eid}')
        if eid in perm['effects']:
            return _err('You already own that special paint.')
        total += data.SPECIAL_PAINT_PRICE
    grants = []
    for iid in buy_items:
        it = data.RENOWN_SHOP_ITEMS_MAP.get(iid)
        if not it:
            return _err(f'Unknown item: {iid}')
        total += it['cost']
        grants.append(it)

    if total > perm.get('renown', 0):
        return _err('Not enough Renown for that.', 409)

    n_bag = sum(1 for it in grants if it['kind'] == 'consumable')
    if len(doc.get('bag') or []) + n_bag > data.BAG_SIZE:
        return _err('Your bag can’t hold that many starter items.', 409)

    owned_hats = set(perm['hats']) | set(buy_hats)
    owned_paints = set(perm['paints']) | set(buy_paints)
    owned_effects = set(perm['effects']) | set(buy_effects)
    if equip_hat and equip_hat not in owned_hats:
        return _err('You do not own that hat.', 409)
    if equip_paint and equip_paint not in owned_paints:
        return _err('You do not own that color.', 409)
    if equip_effect and equip_effect not in owned_effects:
        return _err('You do not own that special paint.', 409)

    # ── All validated — commit. ──────────────────────────────────────────────
    perm['renown'] = perm.get('renown', 0) - total
    perm['hats'] = perm['hats'] + buy_hats
    perm['paints'] = perm['paints'] + buy_paints
    perm['effects'] = perm['effects'] + buy_effects
    for it in grants:
        if it['kind'] == 'consumable':
            doc['bag'].append(it['id'])
        elif it['kind'] == 'gear':
            # No auto-equip: starter gear goes to the stash to equip at the Plaza.
            doc.setdefault('gearStash', []).append(it['id'])
        elif it['kind'] == 'spores':
            doc['spores'] = doc.get('spores', 0) + it['amount']
    if equip_hat:
        doc['hat'] = equip_hat
    if equip_paint:
        hue = data.PAINT_MAP[equip_paint]['hue']
        doc['paint'] = {'body': hue, 'belly': doc['paint'].get('belly', 50), 'stripes': hue}
    if equip_effect:
        doc['effect'] = equip_effect
    return None


def _join(table, sid, user_id, username, payload):
    existing = _get_player(table, sid, user_id)
    if existing:
        return _ok(existing)
    starter = payload.get('starter')
    if starter not in data.STARTERS:
        return _err('Pick a starter: pest, kraul, saproling, or zombie.')
    home = payload.get('home', data.DEFAULT_BIOME)
    if home not in data.BIOMES:
        return _err('Pick a home biome: ' + ', '.join(data.BIOMES) + '.')
    creature_name = str(payload.get('creatureName') or '').strip()[:16]
    sprite_variant = payload.get('spriteVariant')
    if sprite_variant not in data.STARTER_VARIANTS.get(starter, []):
        sprite_variant = None

    perm = _get_perm(table, user_id)
    seals_before = perm.get('seals', 0)
    perm['seals'] = seals_before + 1
    perm['nights'] = perm.get('nights', 0) + 1

    s = data.STARTERS[starter]
    doc = _new_player_doc(
        sid, user_id, username, starter, home,
        seals_before=seals_before, egg_hue=payload.get('eggHue'),
        creature_name=creature_name, sprite_variant=sprite_variant,
    )
    # Start their bank where the night is, not at zero-hour — a latecomer gets
    # the rolls they'd have regenerated so far (capped), before any bonuses.
    _seed_night_rolls(table, sid, doc)
    # Bravery: the player let fate pick their creature, so they spawn with a
    # bonus roll for their nerve (capped, like every other roll grant).
    bravery = bool(payload.get('bravery'))
    if bravery:
        doc['rolls'] = min(data.ROLL_CAP, doc['rolls'] + data.BRAVERY_BONUS_ROLLS)
    # Spend banked Renown at the pre-spawn shop before we write anything: on any
    # validation failure this returns an error and no doc/perm is persisted.
    err = _apply_shop_purchases(perm, doc, payload)
    if err:
        return err
    table.put_item(Item=perm)

    # Deliver any board-game rewards banked while this player hadn't hatched yet
    # (mutates doc's rolls/bag, deletes the bank record, posts an event).
    apply_banked_rewards(table, sid, user_id, doc)
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    biome = data.BIOMES[home]
    named = f" named {doc['creatureName']}" if doc['creatureName'] != s['name'] else ''
    brave = f" Bravery earns +{data.BRAVERY_BONUS_ROLLS} roll!" if bravery else ''
    shiny = " ✨ It hatched SHINY!" if doc.get('shiny') else ''
    _event(table, sid, 'hatch',
           f"{doc['username']}'s egg cracks open in {biome['name']} — "
           f"a {s['name']}{named} skitters out! ({biome['perkName']}: {biome['perkBlurb']})"
           f"{brave}{shiny}",
           actor=user_id)
    return _ok(doc)


# ── Claims (roll economy) ────────────────────────────────────────────────────

def _claim(table, sid, doc, payload):
    kind = payload.get('kind')
    now = datetime.utcnow()
    if kind in ('finished', 'finished_won'):
        last = doc.get('lastFinishedClaim')
        if last and (now - datetime.fromisoformat(last)) < timedelta(minutes=data.CLAIM_FINISHED_COOLDOWN_MIN):
            wait = data.CLAIM_FINISHED_COOLDOWN_MIN - int((now - datetime.fromisoformat(last)).total_seconds() // 60)
            return _err(f'Game-finished claim on cooldown ({wait} min left).', 429)
        rolls = data.CLAIM_FINISHED_ROLLS + (data.CLAIM_WON_BONUS_ROLLS if kind == 'finished_won' else 0)
        granted, lost = _add_rolls(doc, rolls)
        doc['lastFinishedClaim'] = _now()
        text = f"{doc['username']} finished a game at the table"
        if kind == 'finished_won':
            doc['spores'] = doc.get('spores', 0) + data.CLAIM_WON_SPORES
            text += ' — and WON!'
        _event(table, sid, 'claim', text + f' (+{granted} rolls)', actor=doc['userId'])
    elif kind == 'taught':
        if doc.get('taughtClaims', 0) >= data.CLAIM_TAUGHT_MAX:
            return _err('You already taught two games tonight.', 429)
        doc['taughtClaims'] = doc.get('taughtClaims', 0) + 1
        granted, lost = _add_rolls(doc, data.CLAIM_TAUGHT_ROLLS)
        _grant_xp(table, sid, doc, data.XP_REWARDS['taught_claim'])
        _event(table, sid, 'claim',
               f"{doc['username']} taught someone a new game (+{granted} roll, +5 XP)",
               actor=doc['userId'])
    else:
        return _err('Unknown claim kind.')
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    return _ok(doc, granted=granted, lostToCap=lost)


# ── Roll & move ──────────────────────────────────────────────────────────────

def _roll(table, sid, doc, payload):
    nodes = _season_map(table, sid)
    # Fleetfoot (SPD-5 perk): the player MAY reroll a die that came up 1. A reroll
    # discards the pending 1 and rolls fresh WITHOUT spending another banked roll,
    # and is offered only once (the fresh face stands).
    reroll = bool(payload.get('reroll')) if payload else False
    _pm = doc.get('pendingMove')
    is_reroll = False
    # A 1 can sit on either die under Pathfinder's advantage roll, so check the
    # whole pending face set, not just the primary value.
    _pm_showed_one = bool(_pm) and (
        _pm.get('value') == 1 or 1 in (_pm.get('values') or []))
    if (reroll and _pm and _pm_showed_one and not _pm.get('rerolled')
            and 'fleetfoot' in engine.attribute_perks(doc)):
        doc['pendingMove'] = None
        is_reroll = True
    if not data.DEBUG and not is_reroll and doc.get('rolls', 0) < 1:
        return _err('No rolls banked. Finish a board game to earn more!', 409)
    if doc.get('pendingMove'):
        return _err('You already rolled — pick a destination.', 409)
    # Rolling without choosing a respawn gate accepts the provisional home gate.
    doc.pop('pendingRespawn', None)

    # Dev convenience (DEBUG only): the client may name the face it wants
    # instead of rolling randomly. Skips loaded-die / vines so the picked
    # number is exactly what moves you.
    picked = payload.get('value') if payload else None
    picked = int(picked) if isinstance(picked, (int, float)) and 1 <= picked <= 6 else None

    # Blink (SPD-15 perk): choose your die value. Works in production (unlike the
    # DEBUG pick), gated on the perk. It paces itself — after a blink you owe
    # data.BLINK_COOLDOWN_ROLLS ordinary rolls before you can blink again.
    perks = engine.attribute_perks(doc)
    blink = bool(payload.get('blink')) if payload else False
    blink_cd = int(doc.get('blinkCooldown', 0) or 0)
    used_blink = False
    if blink and 'blink' in perks and picked is not None and blink_cd > 0:
        return _err('Blink is still recharging — take an ordinary roll first.', 409)

    value = None
    random_roll = False
    if data.DEBUG and picked is not None:
        value = picked
    elif blink and 'blink' in perks and picked is not None:
        value = picked
        used_blink = True
    elif doc.get('pendingLoadedDie'):
        value = int(doc.pop('pendingLoadedDie'))
    else:
        value = _rng.randint(1, 6)
        random_roll = True

    vines = [b for b in (doc.get('buffs') or []) if b.get('kind') == 'vines']
    if vines and picked is None:
        value = (value + 1) // 2
        doc['buffs'] = [b for b in doc['buffs'] if b.get('kind') != 'vines']

    def _legal(v):
        return engine.legal_destinations(nodes, doc['position'], v,
                                         _stop_nodes(table, sid, doc),
                                         _blocked_nodes(doc))

    # Pathfinder (SPD-10 perk): roll a second die and keep either — destinations
    # are the union of both faces. Only on an ordinary random roll (a chosen
    # value via Blink/loaded die is already deliberate).
    values = None
    if random_roll and 'pathfinder' in perks:
        value2 = _rng.randint(1, 6)
        values = sorted([value, value2])
        dests = sorted(set(_legal(value)) | set(_legal(value2)))
    else:
        dests = sorted(_legal(value))

    # Post-boss escape climb: standing on an escape spur you've earned, offer the
    # biome's surface mouth as a tap-to-climb destination (alongside walking back
    # into the maze). _move relocates you there one-way; no graph edge exists.
    pos = doc['position']
    if pos in data.ESCAPE_LADDERS and data.ESCAPE_LADDERS[pos] in (doc.get('poiClaims') or []):
        dests = sorted(set(dests) | {data.ESCAPE_EXITS[pos]})

    if not dests:
        # Dead-end corner case: refund the roll, let them try again.
        return _err('The tunnels shift — no path fits that roll. Try again.', 409)
    if not data.DEBUG and not is_reroll:
        doc['rolls'] -= 1
    # Advance the Blink cooldown: a blink arms it, an ordinary roll pays it down.
    # Rerolls are the same turn's die, so they don't count as an ordinary roll.
    if used_blink:
        doc['blinkCooldown'] = data.BLINK_COOLDOWN_ROLLS
    elif not is_reroll and blink_cd > 0:
        doc['blinkCooldown'] = blink_cd - 1
    pm = {'value': value, 'dests': dests}
    if values:
        pm['values'] = values
    if is_reroll:
        pm['rerolled'] = True    # Fleetfoot spent — the fresh face stands
    doc['pendingMove'] = pm
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    roll = {'value': value, 'destinations': dests}
    if values:
        roll['values'] = values
    if used_blink:
        roll['blink'] = True
    # Offer a one-time Fleetfoot reroll on a fresh, randomly-rolled 1 (not one
    # chosen via Blink). Under Pathfinder a 1 on either die still qualifies, so
    # the two perks stack instead of the higher one masking the lower.
    showed_one = (1 in values) if values else (value == 1)
    if (showed_one and random_roll and not is_reroll
            and 'fleetfoot' in perks):
        roll['canReroll'] = True
    return _ok(doc, roll=roll)


def _move(table, sid, doc, payload):
    pm = doc.get('pendingMove')
    to = payload.get('to')
    if not pm:
        return _err('Roll first.', 409)
    if to not in pm['dests']:
        return _err('That space is not reachable with this roll.', 409)

    prev = doc['position']
    nodes = _season_map(table, sid)
    heal = None

    # Post-boss escape climb: standing on an escape spur, spending the roll to
    # haul one-way up to the biome's surface mouth. No graph edge exists between
    # them, so this bypasses walk validation and does not chain-resolve the
    # surface landing (matching the old teleport). _roll only offers this target
    # when the lair is claimed, so reaching here already implies the earned exit.
    if prev in data.ESCAPE_LADDERS and to == data.ESCAPE_EXITS[prev]:
        doc['pendingMove'] = None
        doc['position'] = to
        doc['restsUsed'] = []                # you're on the surface now
        conflict = _save_or_conflict(table, doc)
        if conflict:
            return conflict
        occupants = _occupants(table, sid, doc['position'], doc['userId'])
        return _ok(doc, spaceEvent={
            'type': 'ladder',
            'text': 'You haul yourself up the rusty escape ladder and out of '
                    'the depths, back to the surface.'}, occupants=occupants)

    # Server-authoritative route: the client walks node-by-node and sends the
    # path it took. Validate it, then heal for passing THROUGH a gate (landing
    # on one still full-heals in _resolve_space below). A stale client that
    # omits `path` keeps the old destination-only behavior — no pass-heal.
    path = payload.get('path')
    if path is not None:
        allowed = set(pm.get('values') or [pm['value']])
        # Mirror _roll's destination pass: _stop_nodes (not the bare shared
        # barrier set) so an evolved unit's bridge mouths count as legal bonk
        # stops here too — otherwise a T2 that rolls past a mouth is offered it
        # as a destination but then rejected on commit ("not a legal walk").
        closed = _stop_nodes(table, sid, doc)
        blocked = _blocked_nodes(doc)
        if (not path or path[0] != prev or path[-1] != to
                or not engine.validate_walk(nodes, path, allowed, closed, blocked)):
            return _err('That route is not a legal walk.', 409)
        passed_gate = any(nodes[n]['type'] == 'gate' for n in path[1:-1])
        if passed_gate and nodes[to]['type'] != 'gate':
            max_hp = engine.effective_stats(doc)['maxHp']
            amount = min(round(data.GATE_PASS_HEAL_FRACTION * max_hp),
                         max_hp - int(doc['hp']))
            if amount > 0:
                doc['hp'] = int(doc['hp']) + amount
                doc['hpUpdatedAt'] = _now()
                heal = {'amount': amount, 'hp': doc['hp'], 'kind': 'gate_pass'}

    doc['pendingMove'] = None
    doc['position'] = to

    space_event = _resolve_space(table, sid, doc, to, prev)

    # Landing on a gate full-heals inside _resolve_space; surface the amount so
    # the client floats heal numbers for it too (supersedes any pass-heal).
    if space_event.get('type') == 'gate':
        healed = space_event.get('healed', 0)
        heal = {'amount': healed, 'hp': doc['hp'], 'kind': 'gate_land'} if healed else None

    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict

    # _resolve_space may relocate the unit (tunnel crossing, wild warp) — report
    # occupants of where it actually ended up, not the pre-resolution target.
    occupants = _occupants(table, sid, doc['position'], doc['userId'])
    return _ok(doc, spaceEvent=space_event, occupants=occupants, heal=heal)


def _respawn(table, sid, doc, payload):
    """Wake at a chosen gate after a compost (home gate or last-biome gate)."""
    pr = doc.get('pendingRespawn')
    if not pr:
        return _err('You have no respawn to choose.', 409)
    gate = payload.get('gate')
    valid = {o['gate'] for o in pr.get('options', [])}
    if gate not in valid:
        return _err('That gate is not on offer.', 409)
    doc['position'] = gate
    doc.pop('pendingRespawn', None)
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    return _ok(doc, text='You crawl up from the compost, whole again.')


def _occupants(table, sid, node, except_user):
    resp = table.query(
        KeyConditionExpression='pk = :pk AND begins_with(sk, :sk)',
        ExpressionAttributeValues={':pk': _season_pk(sid), ':sk': 'PLAYER#'})
    out = []
    for raw in resp['Items']:
        p = _clean(raw)
        if p['userId'] == except_user or p.get('position') != node:
            continue
        out.append({'userId': p['userId'], 'username': p.get('username'),
                    'formName': _form_name(p),
                    'creatureName': p.get('creatureName') or _form_name(p),
                    'level': p.get('level', 1),
                    'shielded': _shielded(p), 'stance': p.get('stance', 'fight')})
    return out


def _flow_puzzle_view(pid):
    """Masked puzzle for the client — layout only, never the solution path."""
    p = data.flow_puzzle(pid)
    return {'id': p['id'], 'w': p['w'], 'h': p['h'],
            'start': p['start'], 'end': p['end'], 'rocks': p['rocks']}


def _place_loot_rewards(puzzle, kinds, rng):
    """Place one reward per kind on a distinct non-rock, non-start, non-end cell.
    The gear cell is never orthogonally adjacent to the start (no step-one grabs).
    Returns [{'kind': str, 'cell': [r, c]}, ...] in the order of `kinds`. Placement
    is a cosmetic overlay — it never blocks a cell, so the puzzle stays solvable."""
    w, h = puzzle['w'], puzzle['h']
    rocks = {tuple(c) for c in puzzle['rocks']}
    start, end = tuple(puzzle['start']), tuple(puzzle['end'])
    cells = [[r, c] for r in range(h) for c in range(w)
             if (r, c) not in rocks and (r, c) != start and (r, c) != end]
    rng.shuffle(cells)

    def adjacent_to_start(cell):
        return abs(cell[0] - start[0]) + abs(cell[1] - start[1]) == 1

    rewards, used = [], set()
    for kind in kinds:
        for cell in cells:
            t = (cell[0], cell[1])
            if t in used:
                continue
            if kind == 'gear' and adjacent_to_start(cell):
                continue
            rewards.append({'kind': kind, 'cell': [cell[0], cell[1]]})
            used.add(t)
            break
    return rewards


def _scrounge(doc, amount):
    """Pest's Scrounger passive: scale a positive loot/bounty reward by
    SCROUNGER_MULT (rounded). Non-positive amounts (penalties) pass through so
    the pest is never punished harder. Applied at every repeatable Spore source
    the pest 'gathers' — forage, digs, mystery finds, and combat bounties."""
    if amount > 0 and 'scrounger' in _passives(doc):
        return round(amount * data.SCROUNGER_MULT)
    return amount


def _scrounge_consolation(doc, rec):
    """Pest's Scrounger picks the bones even on a lost / fled / stalemated wild or
    elite fight: a fraction of the bounty it would have won. This makes the pest's
    income survival-independent — its earnings aren't gutted by dying, which is
    what lets a fragile balanced statline still be the economy specialist over a
    long, swingy day. Returns the Spores awarded (0 if not a scrounger, or not a
    grind fight)."""
    if rec.get('kind') not in ('wild', 'elite') or 'scrounger' not in _passives(doc):
        return 0
    amount = round((rec.get('npcMeta') or {}).get('bounty', 0) * data.SCROUNGER_LOSS_FRACTION)
    if amount > 0:
        doc['spores'] = doc.get('spores', 0) + amount
    return amount


def _award_spores(doc):
    """Forage-spore loot reward (the always-present floor)."""
    amount = _scrounge(doc, _rng.choice([8, 8, 9, 9, 10, 10, 11, 12, 13, 15]))
    if doc.get('homeBiome') == 'garden':
        amount += 2  # Composter hatch perk
    doc['spores'] = doc.get('spores', 0) + amount
    return {'type': 'loot', 'text': f'You forage {amount} Spores from the rot.',
            'spores': amount}


def _award_item(doc):
    """Consumable loot reward; a full bag salvages to Spores (via _give_consumable)."""
    item = _give_consumable(doc)
    if item:
        return {'type': 'loot',
                'text': f'You unearth a {data.CONSUMABLES[item]["name"]}!',
                'item': item}
    # Bag was full — _give_consumable already credited 5 Spores.
    return {'type': 'loot', 'text': 'Your bag was full — you salvage 5 Spores.',
            'spores': 5}


def _award_gear(doc):
    """Gear loot reward; falls back to Spores if a drop somehow fails to roll."""
    drop = _roll_gear_drop(doc, data.GEAR_DROP['loot'][1])
    if drop:
        return {'type': 'loot',
                'text': f'You unearth a piece of gear — {_drop_phrase(drop)}!',
                'gear': drop}
    return _award_spores(doc)


_LOOT_AWARDERS = {'spores': _award_spores, 'item': _award_item, 'gear': _award_gear}


def _resolve_space(table, sid, doc, node, prev):
    """Apply the landing event for `node`, mutating doc. Returns event dict."""
    nodes = _season_map(table, sid)
    ntype = nodes[node]['type']

    # Remember the last home-biome you stood in — a death here (or later, on the
    # isle/in the depths) offers this biome's gate as a respawn option. Set
    # before any battle/compost resolves so it reflects where you actually died.
    region = nodes[node].get('region')
    if region in data.BIOMES:
        doc['lastBiome'] = region

    # Per-descent rest tracking resets the moment you stand on the surface.
    if region != 'depths' and doc.get('restsUsed'):
        doc['restsUsed'] = []
    # Last Stand recharges on surfacing (once-per-descent).
    if region != 'depths' and doc.get('lastStandUsed'):
        doc.pop('lastStandUsed', None)

    # Snare check first — a triggered snare skips the space event.
    space = _get(table, _season_pk(sid), f'SPACE#{node}')
    if space and space.get('ownerId') and space['ownerId'] != doc['userId']:
        return _trigger_snare(table, sid, doc, node, space)
    if space and not space.get('ownerId') and space.get('pile', 0) > 0:
        # Leftover spore pile from an earlier snare.
        pile = space['pile']
        doc['spores'] = doc.get('spores', 0) + pile
        table.delete_item(Key={'pk': _season_pk(sid), 'sk': f'SPACE#{node}'})
        return {'type': 'pile', 'text': f'You scoop up {pile} spilled Spores!', 'spores': pile}

    # World Event overlay: a live Great Beast squats on 3 wilderness nodes and
    # overrides their normal event — including Umori's wandering stall, since the
    # beast physically occupies the tile. Runs after snare/pile (player traps
    # still fire) but before Umori and the node's own type dispatch.
    we = _world_event(table, sid)
    if we and we.get('spawned') and not we.get('dead') and node in we.get('nodes', []):
        return {'type': 'world_event', 'node': node, 'center': we['node'],
                'nodes': we['nodes'], 'hp': we['hp'], 'maxHp': we['maxHp'],
                'name': data.WORLD_EVENT['name'], 'spriteId': data.WORLD_EVENT['spriteId'],
                'text': f"The {data.WORLD_EVENT['name']} looms over the mire. "
                        'Wade in and strike — every blow is tallied.'}

    # Umori the wandering ooze pacifies whatever wilderness space it sits on this
    # window and opens a T3 barter (overrides the node's normal event). Runs after
    # snare/pile so player traps still fire, before the normal type dispatch.
    _uwin = _umori_window()
    if node == _umori_node(_uwin):
        return {'type': 'trading_post', 'node': node, 'umori': True,
                'movesAt': _umori_window_end(_uwin),
                'text': 'Umori the ooze has oozed up a crooked stall here. Leave one, take one.',
                'stock': _umori_barter_stock(table, sid, _uwin)}

    if ntype == 'loot':
        # Gate the reward behind a Flow puzzle and scatter reward symbols on it:
        # roll each category's PRESENCE now (spores always, item ~10%, gear rare),
        # place them, and stash the placement. The VALUE of whichever reward the
        # player traces to first is rolled later in _solve_loot_puzzle. Only pick
        # puzzles with at least one rock — a clear board traces trivially.
        pid = _rng.choice([p['id'] for p in data.FLOW_PUZZLES if p['rocks']])
        puzzle = data.flow_puzzle(pid)
        kinds = ['spores']
        if _rng.random() < 0.10:
            kinds.append('item')
        if _rng.random() < data.GEAR_DROP['loot'][0]:
            kinds.append('gear')
        rewards = _place_loot_rewards(puzzle, kinds, _rng)
        view = _flow_puzzle_view(pid)
        view['rewards'] = rewards
        doc['pendingLoot'] = {'puzzleId': pid, 'view': view, 'rewards': rewards}
        return {'type': 'loot_puzzle', 'node': node, 'puzzle': view}

    if ntype == 'wild':
        return _wild_battle(table, sid, doc, region=region)

    if ntype == 'elite':
        return _wild_battle(table, sid, doc, elite=True, region=region)

    if ntype == 'mystery':
        return _mystery(table, sid, doc)

    if ntype == 'hazard':
        return _hazard(table, sid, doc, node)

    if ntype == 'warp':
        # One roaming warp is always wild: no picker, always a random fling.
        if node == _wild_warp_node(table, sid):
            dest = _wild_warp_dest(nodes, node)
            doc['position'] = dest
            _rotate_wild_warp(table, sid, node)   # move the wildness elsewhere
            return {'type': 'wild_warp',
                    'text': 'Something went wrong… WILD WARP!!! The spores '
                            'misfire and hurl you across the Undercity.',
                    'to': dest}
        if _rng.random() < 0.20:
            dest = _wild_warp_dest(nodes, node)
            doc['position'] = dest
            return {'type': 'wild_warp', 'text': 'The mushroom convulses — a WILD warp!',
                    'to': dest}
        options = [w for w in data.WARP_NODES if w != node]
        return {'type': 'warp', 'text': 'The warp mushroom hums. Step through?',
                'options': options}

    if ntype == 'gate':
        max_hp = engine.effective_stats(doc)['maxHp']
        healed = max(0, max_hp - int(doc['hp']))
        doc['hp'] = max_hp
        doc['hpUpdatedAt'] = _now()
        return {'type': 'gate', 'text': 'The Gate of the Swarm mends you fully.',
                'healed': healed}

    if ntype == 'boss':
        return _boss(table, sid, doc, node, prev)

    if ntype == 'shop':
        return {'type': 'shop', 'text': 'The Rot-Farm Bazaar creaks open.'}

    if ntype == 'excavation':
        doc['excavationDigsLeft'] = data.EXCAVATION_DIGS_PER_VISIT
        # Materialize the shared site on arrival so the buried finds show through
        # the dirt right away — no blind first dig.
        rec = _dig_site(table, sid, node)
        return {'type': 'excavation', 'node': node,
                'text': 'A patch of disturbed earth — you can make out finds buried in the grid. Dig them out.',
                'grid': _dig_view(rec), 'digsLeft': data.EXCAVATION_DIGS_PER_VISIT}

    if ntype == 'crystal_vein':
        # Landing just opens the shaft — every swing is a deliberate Strike so
        # the player keeps full agency (no auto-swing, no arrival cave-in).
        doc['veinStrikesLeft'] = data.VEIN_STRIKES_PER_VISIT
        region = nodes[node]['region']
        depth = _vein_rec(table, sid, region)['depth']
        return {'type': 'crystal_vein', 'node': node,
                'strikesLeft': data.VEIN_STRIKES_PER_VISIT, 'depth': depth,
                'text': 'You reach the crystal vein — ready your pick.'}

    if ntype == 'vault_lock':
        doc['vaultPicksLeft'] = data.VAULT_PICKS_PER_VISIT
        region = nodes[node]['region']
        rec = _get(table, _season_pk(sid), f'VAULT#{region}')
        return {'type': 'vault_lock', 'node': node,
                'text': 'The Guildvault: six sigils, three tumblers, one fat '
                        'pot. Every botched pick is chalked on the wall for '
                        'all to read.',
                'vault': _vault_view(rec),
                'picksLeft': data.VAULT_PICKS_PER_VISIT}

    if ntype == 'shrine':
        return {'type': 'shrine', 'text': 'A shrine of candles and bone. The swarm listens.'}

    if ntype == 'witch':
        return {'type': 'witch',
                'text': 'The Sedgemoor Witch stirs her cauldron. She reads scrolls '
                        'into books — for a price — and sells a few of her own.'}

    if ntype == 'ossuary':
        # Fresh landing refills the visit's dice — three rolls, then the
        # bouncer waves you off until you land here again.
        doc['ossuaryRollsLeft'] = data.OSSUARY_ROLLS_PER_VISIT
        return {'type': 'ossuary', 'text': 'The Casino. Dice clatter in the dark.'}

    if ntype == 'barrier':
        return _barrier(table, sid, doc, node)

    if ntype == 'lair':
        return _lair(table, sid, doc, node)

    if ntype == 'vault':
        return _vault(table, sid, doc, node)

    if ntype == 'cache':
        return _cache(table, sid, doc, node)

    if ntype == 'rest':
        return _rest(table, sid, doc, node)

    if ntype == 'trove':
        return _trove(table, sid, doc, node)

    if ntype == 'ladder':
        if node in data.ESCAPE_LADDERS:
            # Post-boss shortcut, two-step climb: landing here STOPS you on the
            # spur (bonk) — no teleport. You climb out on a later roll by tapping
            # the ladder, which offers the surface mouth as a move destination
            # (see _roll / _move). Keeps it feeling like any other rusted ladder.
            return {'type': 'ladder',
                    'text': 'A rusty escape ladder bolts up out of the depths. '
                            'Your next roll can carry you up and out.'}
        biome = data.dungeon_biome(node)
        if biome:
            where = 'back up to the surface'
        else:
            b = node.split('_')[0]
            dname = data.DUNGEONS.get(b, {}).get('name', 'the depths')
            where = f'down into {dname}'
        return {'type': 'ladder',
                'text': f'A rusted ladder bolted into the rock leads {where}. '
                        'Your next roll can carry you through.'}

    if ntype == 'tunnel':
        # Fast path between biomes. Tier-1 crosses free; evolved units pay a
        # tier toll (the movement gate already guaranteed they can afford it).
        # Landing carries you fully across to the far biome node for FREE and
        # is CONSEQUENCE-FREE — the far node's landing effect does not resolve.
        exit_node = data.TUNNEL_EXITS[node]
        tier = doc.get('tier', 1)
        toll = 0
        if tier > data.TUNNEL_TIER_MAX:
            toll = data.TUNNEL_TOLL.get(tier, 0)
            doc['spores'] = doc.get('spores', 0) - toll
        doc['position'] = exit_node
        return {'type': 'tunnel', 'to': exit_node, 'toll': toll,
                'text': "You skitter across the Nyx Weaver's silk threads to "
                        'the far side.'}

    return {'type': ntype, 'text': '…'}


def _trigger_snare(table, sid, doc, node, space):
    spill = int(doc.get('spores', 0) * data.SNARE_SPILL_PCT)
    grab_back = spill // 2
    pile = spill - grab_back
    doc['spores'] = doc.get('spores', 0) - spill + grab_back

    owner_id = space['ownerId']
    if pile > 0:
        table.put_item(Item={'pk': _season_pk(sid), 'sk': f'SPACE#{node}', 'pile': pile})
    else:
        table.delete_item(Key={'pk': _season_pk(sid), 'sk': f'SPACE#{node}'})

    # Dredge: the planter gets the snare back in their bag.
    owner = _get_player(table, sid, owner_id)
    if owner:
        if 'dredge' in _passives(owner) and len(owner.get('bag') or []) < data.BAG_SIZE:
            owner.setdefault('bag', []).append('snare')
        _put_player(table, owner)

    _event(table, sid, 'snare',
           f"{doc['username']} stumbled into {space.get('ownerName', 'someone')}'s snare! "
           f'{spill} Spores go flying.', actor=doc['userId'])
    return {'type': 'snare', 'text': f"A snare! You spill {spill} Spores and scramble to grab {grab_back} back. "
                                     'The trap ate your turn here.',
            'sporesLost': spill - grab_back}


def _mystery(table, sid, doc):
    nodes = _season_map(table, sid)
    biome = nodes.get(doc['position'], {}).get('region')
    if biome not in data.BIOMES:
        biome = None
    res = engine.roll_mystery(_rng, 'drift' in _passives(doc),
                              'doubling_rot' in _passives(doc), biome)
    eff = engine.effective_stats(doc)
    if res['spores']:
        doc['spores'] = max(0, doc.get('spores', 0) + _scrounge(doc, res['spores']))
    if res['xp']:
        _grant_xp(table, sid, doc, res['xp'])
    if res['hpPct']:
        raw = round(doc['hp'] * res['hpPct'])
        if raw < 0:
            _apply_hp_loss(doc, -raw)      # Thick Hide halves bad-mystery HP loss
        else:
            doc['hp'] = max(1, doc['hp'] + raw)
    if res['heal']:
        doc['hp'] = eff['maxHp']
        doc['buffs'] = [b for b in (doc.get('buffs') or [])
                        if b.get('kind') not in ('vines', 'cursed_idol')]
    if res['buff']:
        doc.setdefault('buffs', []).append({'kind': res['buff']})
    if res['curse']:
        until = (datetime.utcnow() + timedelta(minutes=20)).isoformat(timespec='seconds')
        doc.setdefault('buffs', []).append({'kind': 'cursed_idol', 'until': until})
    if res['teleport']:
        dest = _rng.choice([n for n in nodes if n != data.BOSS_NODE])
        doc['position'] = dest
        res['to'] = dest
    out = {'type': 'mystery', 'roll': res['roll'], 'text': res['text']}
    if res['item']:
        chance, tiers = data.GEAR_DROP['mystery']
        drop = _roll_gear_drop(doc, tiers) if _rng.random() < chance else None
        if drop:
            out['gear'] = drop
            out['text'] += f" It's a piece of gear — {_drop_phrase(drop)}!"
        else:
            unowned = [g for g, spec in data.GRIMOIRES.items()
                       if spec['tier'] == 1 and g not in (doc.get('grimoires') or [])]
            if unowned and _rng.random() < data.MYSTERY_GRIMOIRE_CHANCE:
                gid = _rng.choice(unowned)
                _grant_grimoire(doc, gid)
                out['grimoire'] = gid
                out['text'] += f" It's a grimoire — the {data.GRIMOIRES[gid]['name']}!"
            else:
                item = _give_consumable(doc)
                if item:
                    out['item'] = item
    if res['roll'] == 12:
        _event(table, sid, 'jackpot',
               f"{doc['username']} hit a JACKPOT BLOOM in the tunnels!", actor=doc['userId'])
    if res['teleport']:
        out['to'] = res['to']
    _append_scroll(doc, out, 'mystery')
    return out


def _hazard(table, sid, doc, node):
    # Mirefoot hatch perk: bog natives shrug off half of any hazard's cost.
    mire = doc.get('homeBiome') == 'bog'
    biome = data.dungeon_biome(node)
    if biome:
        return _dungeon_hazard(table, sid, doc, node, biome, mire)
    kind = _rng.choice(['swamp_gas', 'vines', 'spore_cloud'])
    if kind == 'swamp_gas':
        lost = min(doc.get('spores', 0), _rng.randint(1, 10))
        if mire:
            lost //= 2
        doc['spores'] = doc.get('spores', 0) - lost
        return {'type': 'hazard', 'text': f'Swamp gas! You drop {lost} Spores in the scramble.',
                'spores': -lost}
    if kind == 'vines':
        if mire:
            return {'type': 'hazard',
                    'text': 'Grasping vines slide off your mire-slick hide. (Mirefoot)'}
        doc.setdefault('buffs', []).append({'kind': 'vines'})
        return {'type': 'hazard', 'text': 'Grasping vines coil around you — your next roll is halved.'}
    dmg = _apply_hp_loss(doc, round(doc['hp'] * (0.075 if mire else 0.15)))
    return {'type': 'hazard', 'text': f'A choking spore cloud! You lose {dmg} HP.', 'hp': -dmg}


def _dungeon_hazard(table, sid, doc, node, biome, mire):
    """v6 signature hazards — one per dungeon, themed to its pocket."""
    nodes = _season_map(table, sid)
    h = data.DUNGEON_HAZARDS[biome]
    out = {'type': 'hazard', 'hazardId': h['id'], 'text': h['text']}
    if h['id'] == 'webbing':
        # Reuses the vines mechanic: _roll halves and consumes it.
        doc.setdefault('buffs', []).append({'kind': 'vines'})
    elif h['id'] == 'spore_cloud':
        pocket = [nid for nid, n in nodes.items()
                  if n.get('region') == 'depths' and nid.startswith(biome + '_')
                  and nid != node and n['type'] not in ('lair',)]
        dest = _rng.choice(pocket)
        doc['position'] = dest
        out['to'] = dest
    elif h['id'] == 'sinkwater':
        lost = -(-doc.get('spores', 0) * 15 // 100)   # ceil(spores * 0.15)
        if mire:
            lost //= 2
        lost = min(doc.get('spores', 0), lost)
        doc['spores'] = doc.get('spores', 0) - lost
        out['spores'] = -lost
        out['text'] = f"{h['text']} You lose {lost} Spores to the murk."
    elif h['id'] == 'bone_chill':
        doc.setdefault('buffs', []).append({'kind': 'bone_chill'})
    elif h['id'] == 'rot_bloom':
        dmg = _apply_hp_loss(doc, 1 if mire else 3)
        doc['spores'] = doc.get('spores', 0) + 4
        out['hp'] = -dmg
        out['spores'] = 4
    return out


# ── Battles ──────────────────────────────────────────────────────────────────

def _wild_battle(table, sid, doc, elite=False, region=None):
    """Landing on a wild/elite space STARTS an interactive battle (Plan 2).
    In the 'wilderness' region both wild AND elite spaces pull from the tougher
    T2+ wilderness pools."""
    biome = data.dungeon_biome(doc.get('position', ''))
    if biome:
        spec = data.DUNGEON_NPCS[biome]          # dungeon fauna, themed per pocket
    elif region == 'wilderness':
        spec = _rng.choice(data.WILDERNESS_ELITE_NPCS if elite else data.WILDERNESS_NPCS)
    else:
        spec = _rng.choice(data.ELITE_NPCS if elite else data.NPCS)
    npc = engine.npc_from_spec(spec)
    npc['personality'] = spec.get('personality', data.NPC_DEFAULT_PERSONALITY)
    npc['bluff'] = spec.get('bluff', data.NPC_DEFAULT_BLUFF)
    return _start_battle(table, sid, doc, 'elite' if elite else 'wild', npc,
                         node=doc.get('position'))


def _barrier(table, sid, doc, node):
    if node in _open_barriers(table, sid):
        return {'type': 'barrier_open',
                'text': 'The shattered barricade lies in rubble. The way stands open.'}
    g = data.BARRIER_GUARDIANS[node]
    hp_pool, buffs = _barrier_state(table, sid, node)
    npc = dict(g, hp=hp_pool, maxHp=g['hp'],
               personality=g.get('personality', 'turtle'), bluff=g.get('bluff', 0.15))
    _apply_guardian_debuffs(npc, buffs)
    if buffs:
        _set_barrier_state(table, sid, node, hp_pool, [])   # consumed on engagement
    return _start_battle(table, sid, doc, 'barrier', npc, node=node)


def _barrier_state(table, sid, node):
    """Barrier guardian's lingering pool: current HP + persisted curse buffs."""
    rec = _get(table, _season_pk(sid), f'BARRIER#{node}') or {}
    full = data.BARRIER_GUARDIANS[node]['hp']
    return int(rec.get('hp', full)), list(rec.get('buffs') or [])


def _set_barrier_state(table, sid, node, hp, buffs=None):
    """Write the pool. buffs=None preserves whatever curses are already stored
    (so a post-battle HP write never clobbers a fresh curse); pass [] to clear."""
    if buffs is None:
        buffs = (_get(table, _season_pk(sid), f'BARRIER#{node}') or {}).get('buffs') or []
    item = {'pk': _season_pk(sid), 'sk': f'BARRIER#{node}', 'hp': int(hp)}
    if buffs:
        item['buffs'] = buffs
    table.put_item(Item=item)


def _guardian_pools(table, sid):
    """Live HP + curse state for every rooted target a field spell can reach:
    unbroken barrier guardians and lair bosses. Savra stays under `boss`."""
    open_bars = _open_barriers(table, sid)
    out = {}
    for node, g in data.BARRIER_GUARDIANS.items():
        if node in open_bars:
            continue
        hp, buffs = _barrier_state(table, sid, node)
        out[node] = {'kind': 'barrier', 'name': g['name'], 'npcId': g['id'],
                     'hp': hp, 'maxHp': g['hp'], 'buffs': [b['kind'] for b in buffs]}
    for node, b in data.LAIR_BOSSES.items():
        hp, slain, buffs = _lair_state(table, sid, node)
        out[node] = {'kind': 'lair', 'npcId': b['id'],
                     'name': f"Vestige of {b['name']}" if slain else b['name'],
                     'hp': hp, 'maxHp': (b['hp'] // 2) if slain else b['hp'],
                     'buffs': [x['kind'] for x in buffs]}
    return out


def _lair_state(table, sid, node):
    """Season-shared lair pool: current HP, whether the true boss has fallen,
    and any persisted curse buffs."""
    rec = _get(table, _season_pk(sid), f'LAIR#{node}') or {}
    full = data.LAIR_BOSSES[node]['hp']
    return int(rec.get('hp', full)), bool(rec.get('slain', False)), list(rec.get('buffs') or [])


def _set_lair_state(table, sid, node, hp, slain, buffs=None):
    """buffs=None preserves stored curses; pass [] to clear."""
    if buffs is None:
        buffs = (_get(table, _season_pk(sid), f'LAIR#{node}') or {}).get('buffs') or []
    item = {'pk': _season_pk(sid), 'sk': f'LAIR#{node}', 'hp': int(hp), 'slain': bool(slain)}
    if buffs:
        item['buffs'] = buffs
    table.put_item(Item=item)


# ── World Event ("The Great Beast") shared state ─────────────────────────────

def _world_event(table, sid):
    """The live world-event record, or None if it never spawned."""
    return _get(table, _season_pk(sid), 'WORLDEVENT')


def _set_world_event(table, sid, rec):
    item = dict(rec)
    item['pk'] = _season_pk(sid)
    item['sk'] = 'WORLDEVENT'
    table.put_item(Item=item)


def _world_event_public(table, sid):
    """Client-facing world-event block, or None if it never spawned."""
    we = _world_event(table, sid)
    if not we:
        return None
    return {'nodes': we['nodes'], 'center': we['node'],
            'hp': we['hp'], 'maxHp': we['maxHp'],
            'name': data.WORLD_EVENT['name'], 'spriteId': data.WORLD_EVENT['spriteId'],
            'dead': bool(we.get('dead'))}


def _pick_world_event_run(nodes):
    """A length-3 connected chain of wilderness nodes: [flank, center, flank].
    Picks a center that has >=2 wilderness neighbours. Returns None if the map
    has no such run (shouldn't happen on the real board)."""
    centers = []
    for nid, n in nodes.items():
        if n.get('region') != 'wilderness':
            continue
        wnb = [m for m in n.get('neighbors', [])
               if nodes.get(m, {}).get('region') == 'wilderness']
        if len(wnb) >= 2:
            centers.append((nid, wnb))
    if not centers:
        return None
    center, wnb = _rng.choice(centers)
    return [wnb[0], center, wnb[1]]


def _spawn_world_event(table, sid, actor_id=None):
    """Idempotently spawn the season's one World Event. No-op if it already
    exists (spawned or dead). Picks a 3-node wilderness footprint, seeds the
    shared HP pool, and announces it to everyone. `actor_id` is excluded from the
    away-event fan-out so a mid-action spawn never clobbers the actor's own doc
    (they learn of it inline / via the news feed)."""
    if _world_event(table, sid) is not None:
        return
    nodes = _season_map(table, sid)
    run = _pick_world_event_run(nodes)
    if not run:
        return
    rec = {'spawned': True, 'node': run[1], 'nodes': run,
           'hp': data.WORLD_EVENT_HP, 'maxHp': data.WORLD_EVENT_HP,
           'dmg': {}, 'dead': False}
    _set_world_event(table, sid, rec)
    _event(table, sid, 'boss',
           f"A {data.WORLD_EVENT['name']} has emerged in the wilderness — "
           'rally and bring it down together!')
    _broadcast_away(table, sid,
                    {'kind': 'world_spawn', 'name': data.WORLD_EVENT['name'],
                     'at': _now()}, actor_id)


def _lair(table, sid, doc, node):
    """
    Lair bosses share one persistent HP pool per season (like Savra): wounds
    linger between challengers. The global first kill slays the TRUE boss and
    pays the major reward; it then reforms at HALF strength as the "Vestige
    of <boss>", whose kills pay the minor reward. Guild Sigils stay
    per-player — a Vestige kill still claims yours.
    """
    b = data.LAIR_BOSSES[node]
    hp_pool, slain, buffs = _lair_state(table, sid, node)
    vest_max = b['hp'] // 2
    display = f"Vestige of {b['name']}" if slain else b['name']
    npc = dict(b, hp=hp_pool, name=display, maxHp=(vest_max if slain else b['hp']),
               personality=b.get('personality', 'balanced'), bluff=b.get('bluff', 0.20))
    _apply_guardian_debuffs(npc, buffs)
    if buffs:
        _set_lair_state(table, sid, node, hp_pool, slain, [])   # consumed on engagement
    return _start_battle(table, sid, doc, 'lair', npc, node=node,
                         ctx={'slain': slain, 'vestMax': vest_max})


def _sigil_count(doc):
    return len([c for c in (doc.get('poiClaims') or []) if c in data.SIGIL_LAIRS])


def _boss_hp(table, sid):
    item = _get(table, _season_pk(sid), 'BOSS')
    return int((item or {}).get('hp', data.ROT_SOVEREIGN['hp']))


def _boss_buffs(table, sid):
    return list((_get(table, _season_pk(sid), 'BOSS') or {}).get('buffs') or [])


def _set_boss_hp(table, sid, hp, buffs=None):
    """buffs=None preserves stored curses; pass [] to clear."""
    if buffs is None:
        buffs = (_get(table, _season_pk(sid), 'BOSS') or {}).get('buffs') or []
    item = {'pk': _season_pk(sid), 'sk': 'BOSS', 'hp': int(hp)}
    if buffs:
        item['buffs'] = buffs
    table.put_item(Item=item)


# ── Interactive combat state machine (Plan 2) ────────────────────────────────

# combat consumable id -> engine round-modifier kind
_COMBAT_ITEM = {
    'ambush_musk': 'auto_win', 'rot_bomb': 'double_punish', 'chitin_ward': 'negate',
}


def _combat_peek(table, sid, doc, payload):
    rec = doc.get('battle')
    if not rec:
        return _err('No battle in progress.', 409)
    bag = doc.get('bag') or []
    if 'scrying_spore' not in bag:
        return _err('You have no Scrying Spore.', 409)
    if rec.get('peeked'):
        return _err('You already scried this round.', 409)
    bag.remove('scrying_spore')
    rec['peeked'] = True
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    return _ok(doc, peek={'trueIntent': rec['npcActual'], 'round': rec['round']})


def _combat_round(table, sid, doc, payload):
    rec = doc.get('battle')
    if not rec:
        return _err('No battle in progress.', 409)
    stance = (payload or {}).get('stance')
    if stance not in data.STANCES:
        return _err('Pick a stance.', 400)

    force_winner = double_win_for = negate_loss_for = None
    item = (payload or {}).get('item')
    if item:
        effect = _COMBAT_ITEM.get(item)
        if not effect or item not in (doc.get('bag') or []):
            return _err('You cannot use that here.', 409)
        doc['bag'].remove(item)
        if effect == 'auto_win':
            force_winner = 'attacker'
        elif effect == 'double_punish':
            double_win_for = 'attacker'
        elif effect == 'negate':
            negate_loss_for = 'attacker'

    player_c = _bt_to_combatant(rec['player'])
    npc_c = _bt_to_combatant(rec['npc'])
    rnd = rec['round']
    frenzy_from = _frenzy_from(rec['kind'])
    entries = engine.resolve_round(
        player_c, npc_c, stance, rec['npcActual'], rnd, _rng,
        force_winner=force_winner, double_win_for=double_win_for,
        negate_loss_for=negate_loss_for, frenzy_from=frenzy_from)
    return _conclude_round(table, sid, doc, rec, player_c, npc_c, entries,
                           frenzy_from)


def _conclude_round(table, sid, doc, rec, player_c, npc_c, entries, frenzy_from,
                    extra=None):
    """Shared tail for a resolved combat round (a stance exchange OR a failed
    flee): store both combatants, end the battle if someone dropped, otherwise
    advance the round + re-telegraph and return the ongoing-combat payload.
    `extra` merges into the combat payload (e.g. the failed-flee flag)."""
    rnd = rec['round']
    rec['strikes'].extend(entries)
    _bt_store(player_c, rec['player'])
    _bt_store(npc_c, rec['npc'])

    over = player_c.hp <= 0 or npc_c.hp <= 0 or rnd >= _round_cap(rec['kind'])
    if over:
        if npc_c.hp <= 0 and player_c.hp <= 0:
            outcome = 'attacker' if player_c.hp >= npc_c.hp else 'defender'
        elif npc_c.hp <= 0:
            outcome = 'attacker'
        elif player_c.hp <= 0:
            outcome = 'defender'
        else:
            # Unreachable safety: the Collapse forces a death by ~round 6, long
            # before COMBAT_HARD_CAP. If both somehow survive to the cap we resolve
            # it as a non-kill timeout — a persistent-pool foe (lair/boss) then
            # lingers at its current HP rather than awarding a slay/sigil.
            outcome = 'timeout'
        for c in (player_c, npc_c):  # Regrowth on survivors
            if c.hp > 0 and c.has('regrowth'):
                pct = 0.35 if c.has('rootwall') else 0.20
                c.hp = min(c.max_hp, c.hp + round(c.max_hp * pct))
        result = {'outcome': outcome, 'strikes': rec['strikes'],
                  'attackerHp': max(0, player_c.hp), 'defenderHp': max(0, npc_c.hp),
                  'smokeSporeUsed': False, 'defenderFleeFailed': False}
        return _finish_battle(table, sid, doc, rec, result)

    rec['round'] = rnd + 1
    shown = _telegraph_next(rec)
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    combat = {'round': rec['round'], 'entries': entries,
              'telegraph': shown,
              'frenzyFrom': frenzy_from,
              'playerHp': rec['player']['hp'],
              'npcHp': rec['npc']['hp'],
              'playerStatus': _battle_status(rec['player']),
              'npcStatus': _battle_status(rec['npc']),
              'revealNext': rec['player']['reveal_next']}
    if extra:
        combat.update(extra)
    return _ok(doc, combat=combat)


def _combat_flee(table, sid, doc, payload):
    rec = doc.get('battle')
    if not rec:
        return _err('No battle in progress.', 409)
    if rec['kind'] in ('barrier', 'boss'):
        return _err('There is no fleeing this fight.', 409)
    if rec.get('round', 1) < 2:  # must trade at least one blow before bolting
        return _err('You must make a move before fleeing.', 409)
    player_c = _bt_to_combatant(rec['player'])
    npc_c = _bt_to_combatant(rec['npc'])
    r = engine.flee_attempt(player_c, npc_c, _rng)
    if r['escaped']:
        if r['smokeSporeUsed'] and 'smoke_spore' in (doc.get('bag') or []):
            doc['bag'].remove('smoke_spore')
        doc['hp'] = player_c.hp
        doc['hpUpdatedAt'] = _now()
        salvage = _scrounge_consolation(doc, rec)
        doc.pop('battle', None)
        _consume_one_battle_buffs(doc)
        conflict = _save_or_conflict(table, doc)
        if conflict:
            return conflict
        return _ok(doc, combat={'fled': True, 'smokeSporeUsed': r['smokeSporeUsed'],
                                'scrounged': salvage or None})
    # Failed flee: caught off guard (-1 DEF from flee_attempt), and the enemy
    # takes its telegraphed action for free — resolving as a round the fleer
    # loses. It can be lethal, ending the fight in defeat.
    frenzy_from = _frenzy_from(rec['kind'])
    entries = engine.flee_punish(player_c, npc_c, rec['npcActual'], rec['round'],
                                 _rng, frenzy_from=frenzy_from)
    return _conclude_round(table, sid, doc, rec, player_c, npc_c, entries,
                           frenzy_from, extra={'fled': False})


def _battle_resume(rec, player_hp):
    """A client-safe view of a pending battle so a refreshed player can reopen
    it. Excludes npcActual (the hidden intent) — only the shown telegraph, plus
    the true intent iff the player already scried this round."""
    npc = rec.get('npc', {})
    peeked = bool(rec.get('peeked'))
    return {
        'kind': rec.get('kind'),
        'round': rec.get('round', 1),
        'telegraph': _shown_telegraph(rec),
        'frenzyFrom': _frenzy_from(rec.get('kind')),
        'fleeChance': _flee_pct(rec),
        'playerHp': player_hp,
        'playerStatus': _battle_status(rec.get('player', {})),
        'npcStatus': _battle_status(rec.get('npc', {})),
        'revealed': rec.get('npcActual') if peeked else None,
        'npc': {
            'id': (rec.get('npcMeta') or {}).get('id'),
            'name': npc.get('name'),
            'hp': npc.get('hp'),
            'maxHp': npc.get('maxHp', npc.get('hp')),
            'atk': npc.get('atk'),
            'def': npc.get('dfn'),
            'spd': npc.get('spd'),
            'level': data.enemy_level(npc.get('atk', 0), npc.get('dfn', 0),
                                      npc.get('spd', 0),
                                      npc.get('maxHp', npc.get('hp', 0))),
            'personality': npc.get('personality'),
        },
    }


def _finish_battle(table, sid, doc, rec, result):
    """Apply final HP, consume buffs, dispatch to the per-kind reward finisher,
    persist, and return the space-event response."""
    # Last Stand (DEF-15 perk): once per descent, survive an otherwise-lethal
    # blow at 1 HP. It doesn't turn a loss into a win — the outcome drops to a
    # 'timeout' (no compost, no reward; a persistent-pool foe lingers).
    if (result['attackerHp'] <= 0 and not doc.get('lastStandUsed')
            and 'last_stand' in engine.attribute_perks(doc)):
        doc['lastStandUsed'] = True
        result['attackerHp'] = 1
        if result['outcome'] == 'defender':
            result['outcome'] = 'timeout'
        result['lastStand'] = True
    doc['hp'] = result['attackerHp']
    doc['hpUpdatedAt'] = _now()
    _consume_one_battle_buffs(doc)
    kind = rec['kind']
    doc.pop('battle', None)
    if kind in ('wild', 'elite'):
        out = _finish_wild(table, sid, doc, rec, result)
    elif kind == 'barrier':
        out = _finish_barrier(table, sid, doc, rec, result)
    elif kind == 'lair':
        out = _finish_lair(table, sid, doc, rec, result)
    elif kind == 'world':
        out = _finish_world(table, sid, doc, rec, result)
    else:
        out = _finish_boss(table, sid, doc, rec, result)
    bonus = cutpurse_bonus(doc, rec['player'].get('feint_won', False),
                           result['outcome'] == 'attacker')
    if bonus:
        doc['spores'] = doc.get('spores', 0) + bonus
        out['spores'] = out.get('spores', 0) + bonus
        out['cutpurse'] = bonus
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    return _ok(doc, spaceEvent=out)


def _finish_wild(table, sid, doc, rec, result):
    npc = rec['npcMeta']
    elite = rec['kind'] == 'elite'
    out = {'type': 'elite' if elite else 'wild',
           'npc': {'name': npc['name'], 'id': npc.get('id'), 'maxHp': npc['hp']},
           'battle': result}
    if result['outcome'] == 'attacker':
        bounty = _scrounge(doc, npc['bounty'])
        if 'soul_harvest' in _passives(doc):
            bounty = round(bounty * data.SOUL_HARVEST_MULT)
        doc['spores'] = doc.get('spores', 0) + bounty
        doc['wildWins'] = doc.get('wildWins', 0) + 1
        levels = _grant_xp(table, sid, doc, npc['xp'])
        out['spores'] = bounty
        out['xp'] = npc['xp']
        if levels:
            out['levels'] = levels
        source = 'elite' if elite else 'wild'
        chance, tiers = data.GEAR_DROP[source]
        if _rng.random() < chance:
            drop = _roll_gear_drop(doc, tiers)
            if drop:
                out['gear'] = drop
        elif npc['itemChance'] and _rng.random() < npc['itemChance']:
            item = _give_consumable(doc)
            if item:
                out['item'] = item
        out['text'] = f"You compost the {npc['name']}! +{bounty} Spores."
    elif result['outcome'] == 'defender':
        _grant_xp(table, sid, doc, data.XP_REWARDS['wild_loss'])
        salvage = _scrounge_consolation(doc, rec)
        _compost(table, sid, doc,
                 f"{doc['username']}'s {_creature_label(doc)} was composted by a "
                 f"{npc['name']}. The swarm remembers.")
        out['text'] = f"The {npc['name']} grinds you into the mulch. Back to the Gate…"
        if salvage:
            out['spores'] = salvage
            out['text'] += f" (You scrounge {salvage} Spores from the muck on the way down.)"
    else:
        _grant_xp(table, sid, doc, data.XP_REWARDS['timeout'])
        salvage = _scrounge_consolation(doc, rec)
        out['text'] = f"You and the {npc['name']} circle each other and part ways."
        if salvage:
            out['spores'] = salvage
            out['text'] += f" You scrounge {salvage} Spores as you back off."
    return out


def _finish_barrier(table, sid, doc, rec, result):
    node = rec['node']
    g = rec['npcMeta']
    out = {'type': 'barrier', 'npc': {'name': g['name'], 'id': g.get('id')},
           'battle': result}
    if result['outcome'] == 'attacker':
        _open_barrier(table, sid, node)
        doc['spores'] = doc.get('spores', 0) + g['bounty']
        claims = doc.setdefault('poiClaims', [])
        if node not in claims:
            claims.append(node)
        levels = _grant_xp(table, sid, doc, g['xp'])
        out['spores'] = g['bounty']
        out['xp'] = g['xp']
        if levels:
            out['levels'] = levels
        out['barrierOpened'] = node
        out['text'] = (f"The {g['name']} crumbles! +{g['bounty']} Spores — "
                       'the way beyond is open for everyone.')
        _event(table, sid, 'barrier',
               f"{doc['username']} shattered the {g['name']} — a new route is open to all!",
               actor=doc['userId'])
        _broadcast_away(table, sid, {'kind': 'boss', 'by': doc['username'],
                                     'name': g['name'], 'at': _now()}, doc['userId'])
    elif result['outcome'] == 'defender':
        _set_barrier_state(table, sid, node, max(1, result['defenderHp']))
        _grant_xp(table, sid, doc, data.XP_REWARDS['wild_loss'])
        _compost(table, sid, doc,
                 f"{doc['username']} was crushed by the {g['name']}. The barrier holds.")
        out['text'] = f"The {g['name']} hurls you back. The barrier holds…"
    else:
        _set_barrier_state(table, sid, node, max(1, result['defenderHp']))
        _grant_xp(table, sid, doc, data.XP_REWARDS['timeout'])
        out['text'] = f"You trade blows with the {g['name']}, but the barrier holds."
    return out


def _finish_lair(table, sid, doc, rec, result):
    node = rec['node']
    b = data.LAIR_BOSSES[node]
    slain = rec['ctx'].get('slain', False)
    vest_max = rec['ctx'].get('vestMax', b['hp'] // 2)
    display = rec['npcMeta']['name']
    npc_max = rec['npc']['maxHp']
    out = {'type': 'lair', 'npc': {'name': display, 'maxHp': npc_max}, 'battle': result}
    if result['outcome'] == 'attacker':
        _set_lair_state(table, sid, node, vest_max, True)
        if not slain:
            # Season-global first kill of ANY lair — wake the wilderness beast.
            # Spawn is idempotent, so only the very first lair actually spawns it.
            _spawn_world_event(table, sid, actor_id=doc['userId'])
            # Season-global first kill of THIS lair — stamp the gate name-plate.
            _claim_first(table, sid, node, 'lair', doc)
        claims = doc.setdefault('poiClaims', [])
        personal_first = node not in claims
        if personal_first:
            claims.append(node)
        reward = b['repeat'] if slain else b['first']
        doc['spores'] = doc.get('spores', 0) + reward['spores']
        doc['wildWins'] = doc.get('wildWins', 0) + 1
        levels = _grant_xp(table, sid, doc, reward['xp'])
        out['spores'] = reward['spores']
        out['xp'] = reward['xp']
        if levels:
            out['levels'] = levels
        chance, tiers = data.GEAR_DROP['lair']
        if _rng.random() < chance:
            drop = _roll_gear_drop(doc, tiers)
            if drop:
                out['gear'] = drop
        sigil_biome = data.SIGIL_LAIRS.get(node)
        if personal_first and sigil_biome:
            have = len([c for c in claims if c in data.SIGIL_LAIRS])
            biome_name = data.BIOMES[sigil_biome]['name']
            out['sigil'] = sigil_biome
            out['text'] = (f"The {display} falls! +{reward['spores']} Spores — "
                           f"you claim the {biome_name} Guild Sigil! "
                           f"({have}/{data.SIGILS_REQUIRED} unlocks the island)")
            _event(table, sid, 'sigil',
                   f"{doc['username']} cleared the {biome_name} dungeon and claimed "
                   f"its Guild Sigil ({have}/{data.SIGILS_REQUIRED})!",
                   actor=doc['userId'])
            _broadcast_away(table, sid, {'kind': 'boss', 'by': doc['username'],
                                         'name': display, 'at': _now()}, doc['userId'])
        else:
            out['text'] = (f"The {display} falls! +{reward['spores']} Spores."
                           + ('' if slain else ' A legendary first kill!'))
            if not slain:
                _event(table, sid, 'lair',
                       f"{doc['username']} slew the {b['name']} — "
                       'its Vestige stirs in the lair!', actor=doc['userId'])
                _broadcast_away(table, sid, {'kind': 'boss', 'by': doc['username'],
                                             'name': b['name'], 'at': _now()}, doc['userId'])
        _append_scroll(doc, out, 'lair')
    elif result['outcome'] == 'defender':
        _set_lair_state(table, sid, node, max(1, result['defenderHp']), slain)
        _grant_xp(table, sid, doc, data.XP_REWARDS['wild_loss'])
        _compost(table, sid, doc,
                 f"{doc['username']} was devoured by the {display} "
                 f'(it lingers at {max(1, result["defenderHp"])} HP).')
        out['text'] = f"The {display} is too much. Back to the Gate…"
    else:
        _set_lair_state(table, sid, node, max(1, result['defenderHp']), slain)
        _grant_xp(table, sid, doc, data.XP_REWARDS['timeout'])
        out['text'] = (f"The {display} withdraws, wounded — "
                       f'{max(1, result["defenderHp"])}/{npc_max} HP. It will be waiting.')
    return out


def _finish_world(table, sid, doc, rec, result):
    """Bank this skirmish's damage into the shared pool + the contributor map.
    Re-reads the live pool (concurrent skirmishes may have chipped it) and applies
    the delta, so no write clobbers another player's contribution. If the pool
    hits 0, resolve the tiered payout to everyone."""
    spec = data.WORLD_EVENT
    dealt = max(0, int(rec['ctx'].get('poolStart', 0)) - int(result['defenderHp']))
    uid = doc['userId']
    _grant_xp(table, sid, doc, data.XP_REWARDS['timeout'])  # participation XP
    out = {'type': 'world_event',
           'npc': {'name': spec['name'], 'id': spec['id'], 'maxHp': rec['npc']['maxHp']},
           'battle': result, 'dealt': dealt}

    we = _world_event(table, sid)
    if not we or we.get('dead'):
        # Beast already fell (a concurrent killer). Damage is moot; no double pay.
        out['text'] = f"You land your blows, but the {spec['name']} has already fallen."
        return out

    new_hp = max(0, int(we['hp']) - dealt)
    we['hp'] = new_hp
    we['dmg'][uid] = int(we['dmg'].get(uid, 0)) + dealt
    _set_world_event(table, sid, we)

    if result['outcome'] == 'defender':
        _compost(table, sid, doc,
                 f"{doc['username']} was flung down by the {spec['name']} "
                 f"(it lingers at {new_hp} HP).")
        out['text'] = (f"The {spec['name']} hurls you off — but your blows landed "
                       f"({dealt} dmg). Back to the Gate…")
    else:
        out['text'] = (f"You rake the {spec['name']} for {dealt} damage. "
                       'It shrugs and settles back in.')

    if new_hp <= 0:
        results = _world_event_payout(table, sid, doc)
        out['worldKill'] = True
        mine = next((r for r in results if r['userId'] == uid), None)
        if mine:
            out['reward'] = {'bracket': mine['bracket'], 'spores': mine['spores'],
                             'renown': mine['renown']}
            out['spores'] = mine['spores']   # display echo; credited in payout
        out['text'] = (f"Your blow fells the {spec['name']}! It collapses into the mire — "
                       'the spoils are shared out by who bled it most.')
    return out


def _world_event_payout(table, sid, killer_doc):
    """Deplete-triggered payout. Marks the event dead (idempotent guard), then
    pays every contributor by damage bracket: spores to their season doc, renown
    to their perm doc, and an awayEvent line so absent players learn of it. The
    killer's season doc is mutated in place (the caller persists it) to avoid an
    optimistic-lock clobber. Returns a list of {userId, bracket, spores, renown}."""
    we = _world_event(table, sid)
    if not we or we.get('dead'):
        return []
    we['dead'] = True
    we['hp'] = 0
    _set_world_event(table, sid, we)

    max_hp = max(1, int(we['maxHp']))
    dmg = {u: int(v) for u, v in (we.get('dmg') or {}).items() if int(v) > 0}
    killer_uid = killer_doc['userId']
    if not dmg:
        _event(table, sid, 'boss', f"The {data.WORLD_EVENT['name']} has fallen!")
        return []
    top_uid = max(dmg, key=lambda u: (dmg[u], u))  # deterministic tiebreak

    results = []
    for uid, dealt in dmg.items():
        share = dealt / max_hp
        bracket, reward = data.world_event_reward(share, uid == top_uid)
        if uid == killer_uid:
            killer_doc['spores'] = killer_doc.get('spores', 0) + reward['spores']
        else:
            p = _get_player(table, sid, uid)
            if p:
                p['spores'] = p.get('spores', 0) + reward['spores']
                _push_away_event(p, {
                    'kind': 'world_kill', 'name': data.WORLD_EVENT['name'],
                    'bracket': bracket, 'spores': reward['spores'],
                    'renown': reward['renown'], 'at': _now()})
                for _ in range(3):
                    if _put_player(table, p):
                        break
                    p = _get_player(table, sid, uid)
                    if not p:
                        break
        if reward['renown']:
            perm = _get_perm(table, uid)
            perm['renown'] = perm.get('renown', 0) + reward['renown']
            table.put_item(Item=perm)
        results.append({'userId': uid, 'bracket': bracket,
                        'spores': reward['spores'], 'renown': reward['renown']})

    _event(table, sid, 'boss',
           f"The {data.WORLD_EVENT['name']} has fallen! The wilderness quiets.")
    _broadcast_away(table, sid, {'kind': 'world_fallen',
                                 'name': data.WORLD_EVENT['name'], 'at': _now()},
                    killer_uid)
    return results


def _finish_boss(table, sid, doc, rec, result):
    node = rec['node']
    boss = data.ROT_SOVEREIGN
    hp_before = rec['ctx'].get('hpBefore', boss['hp'])
    out = {'type': 'boss', 'npc': {'name': boss['name'], 'maxHp': boss['hp']},
           'battle': result}
    dealt = max(0, hp_before - result['defenderHp'])
    doc['bossDamage'] = doc.get('bossDamage', 0) + dealt
    if result['outcome'] == 'attacker':
        _set_boss_hp(table, sid, boss['hp'])
        _claim_first(table, sid, node, 'boss', doc)
        claims = doc.setdefault('poiClaims', [])
        first = 'boss' not in claims
        reward = boss['first'] if first else boss['repeat']
        if first:
            claims.append('boss')
        doc['spores'] = doc.get('spores', 0) + reward['spores']
        levels = _grant_xp(table, sid, doc, reward['xp'])
        out['spores'] = reward['spores']
        out['xp'] = reward['xp']
        if levels:
            out['levels'] = levels
        chance, tiers = data.GEAR_DROP['boss']
        if _rng.random() < chance:
            drop = _roll_gear_drop(doc, tiers)
            if drop:
                out['gear'] = drop
        out['text'] = (f'SAVRA, QUEEN OF THE GOLGARI FALLS! +{reward["spores"]} Spores. '
                       'Her husk collapses — and already the rot begins to knit anew…')
        _append_scroll(doc, out, 'boss')
        _event(table, sid, 'boss',
               f"{doc['username']} struck down SAVRA, QUEEN OF THE GOLGARI! "
               'The island trembles as she reforms.', actor=doc['userId'])
        _broadcast_away(table, sid, {'kind': 'boss', 'by': doc['username'],
                                     'name': boss['name'], 'at': _now()}, doc['userId'])
    elif result['outcome'] == 'defender':
        _set_boss_hp(table, sid, result['defenderHp'])
        _grant_xp(table, sid, doc, data.XP_REWARDS['wild_loss'])
        _compost(table, sid, doc,
                 f"{doc['username']} fell to Savra "
                 f'(she lingers at {result["defenderHp"]} HP — finish her!)')
        out['text'] = (f'The Queen grinds you into the mulch — but your blows told: '
                       f'she lingers at {result["defenderHp"]}/{boss["hp"]} HP.')
    else:
        _set_boss_hp(table, sid, result['defenderHp'])
        _grant_xp(table, sid, doc, data.XP_REWARDS['timeout'])
        out['text'] = (f'You withdraw, bleeding. The Queen seethes at '
                       f'{result["defenderHp"]}/{boss["hp"]} HP.')
        if dealt > 0:
            _event(table, sid, 'boss',
                   f"{doc['username']} wounded Savra, Queen of the Golgari — "
                   f'{result["defenderHp"]}/{boss["hp"]} HP remains!', actor=doc['userId'])
    return out


def _boss(table, sid, doc, node, prev):
    """
    Savra, Queen of the Golgari: unsealed per-player at SIGILS_REQUIRED Guild
    Sigils — or for everyone once the host awakens her (bossPhase) — with one
    persistent HP pool for the season. Anyone qualified can chip at it across
    fights; whoever lands the killing blow takes the kill, then the Queen
    reforms at full strength.
    """
    nodes = _season_map(table, sid)
    sigils = _sigil_count(doc)
    config = _get(table, _season_pk(sid), 'CONFIG') or {}
    if sigils < data.SIGILS_REQUIRED and not config.get('bossPhase'):
        doc['position'] = prev if prev in nodes[node]['neighbors'] else 'isl_ossuary'
        missing = data.SIGILS_REQUIRED - sigils
        return {'type': 'boss_sealed',
                'text': f'The rot-wards hurl you back. The Queen demands tribute: '
                        f'{missing} more Guild Sigil{"s" if missing != 1 else ""}. '
                        f'({sigils}/{data.SIGILS_REQUIRED})'}

    boss = data.ROT_SOVEREIGN
    hp_before = _boss_hp(table, sid)
    buffs = _boss_buffs(table, sid)
    npc = dict(boss, hp=hp_before, maxHp=boss['hp'])
    _apply_guardian_debuffs(npc, buffs)
    if buffs:
        _set_boss_hp(table, sid, hp_before, [])   # consumed on engagement
    return _start_battle(table, sid, doc, 'boss', npc, node=node,
                         ctx={'hpBefore': hp_before})


def _vault(table, sid, doc, node):
    claims = doc.setdefault('poiClaims', [])
    if 'vault' in claims:
        return {'type': 'vault',
                'text': 'The vault stands looted bare — by you, last time.'}
    claims.append('vault')
    is_first = _claim_first(table, sid, node, 'vault', doc)
    mult = 1.0 if is_first else data.PLUNDERED_LOOT_MULT
    r = data.VAULT_REWARD
    spores = int(r['spores'] * mult)
    doc['spores'] = doc.get('spores', 0) + spores
    _grant_xp(table, sid, doc, int(r['xp'] * mult))
    if is_first:
        _event(table, sid, 'vault',
               f"{doc['username']} was first to plunder the Sunken Vault!",
               actor=doc['userId'])
        text = f"The hoard of the Erstwhile! +{spores} Spores."
    else:
        text = f"You glean the dregs of the Sunken Vault — +{spores} Spores."
    out = {'type': 'vault', 'spores': spores, 'text': text}
    _append_treasure_gear(doc, out, mult)
    _append_scroll(doc, out, 'vault')
    return out


def _trove(table, sid, doc, node):
    """Hidden dungeon strongroom: fat spores + XP + a guaranteed gear drop,
    first visit per player (poiClaims 'trove:<node>')."""
    claims = doc.setdefault('poiClaims', [])
    key = f'trove:{node}'
    if key in claims:
        return {'type': 'trove',
                'text': 'The strongroom hangs open and empty — your work, last time.'}
    claims.append(key)
    is_first = _claim_first(table, sid, node, 'trove', doc)
    mult = 1.0 if is_first else data.PLUNDERED_LOOT_MULT
    r = data.TROVE_REWARD
    spores = int(r['spores'] * mult)
    doc['spores'] = doc.get('spores', 0) + spores
    _grant_xp(table, sid, doc, int(r['xp'] * mult))
    if is_first:
        text = f"A sealed strongroom cracks open — +{spores} Spores!"
    else:
        text = f"You pick through a plundered strongroom — +{spores} Spores."
    out = {'type': 'trove', 'spores': spores, 'text': text}
    # First conqueror: guaranteed relic. Later players: a coin-flip at the mult.
    if is_first or _rng.random() < data.PLUNDERED_LOOT_MULT:
        drop = _roll_gear_drop(doc, data.TROVE_GEAR_TIERS)
        if drop:
            out['gear'] = drop
            out['text'] += f" A glimmering relic within — {_drop_phrase(drop)}!"
    if is_first:
        _event(table, sid, 'trove',
               f"{doc['username']} was first to crack a hidden trove in the deep dark!",
               actor=doc['userId'])
    return out


def _rest(table, sid, doc, node):
    """Hidden rest alcove: full heal + clear hazard debuffs, once per descent.
    Per-descent tracking lives in doc['restsUsed'], cleared on the surface."""
    used = doc.setdefault('restsUsed', [])
    if node in used:
        return {'type': 'rest',
                'text': 'The embers here are cold — you already rested this descent.'}
    used.append(node)
    doc['hp'] = engine.effective_stats(doc)['maxHp']
    doc['hpUpdatedAt'] = _now()
    doc['buffs'] = [b for b in (doc.get('buffs') or [])
                    if b.get('kind') not in data.REST_CURES]
    return {'type': 'rest',
            'text': 'A dry alcove, warm with old spores. You rest — wounds close, '
                    'curses lift.'}


def _cache(table, sid, doc, node):
    """One treasure per dungeon, first visit per player (mini-vault)."""
    claims = doc.setdefault('poiClaims', [])
    key = f'cache:{node}'
    if key in claims:
        return {'type': 'cache', 'text': 'The hollow stands empty — you plundered it already.'}
    claims.append(key)
    is_first = _claim_first(table, sid, node, 'cache', doc)
    mult = 1.0 if is_first else data.PLUNDERED_LOOT_MULT
    r = data.CACHE_REWARD
    spores = int(r['spores'] * mult)
    doc['spores'] = doc.get('spores', 0) + spores
    _grant_xp(table, sid, doc, int(r['xp'] * mult))
    biome = data.dungeon_biome(node)
    dname = data.DUNGEONS[biome]['name'] if biome else 'the depths'
    if is_first:
        _event(table, sid, 'cache',
               f"{doc['username']} was first to plunder the treasure of {dname}!",
               actor=doc['userId'])
        text = f"A hidden trove! +{spores} Spores."
    else:
        text = f"Picked-over spoils remain — +{spores} Spores."
    out = {'type': 'cache', 'spores': spores, 'text': text}
    _append_treasure_gear(doc, out, mult)
    _append_scroll(doc, out, 'cache')
    return out


def _append_scroll(doc, out, source):
    """Roll a tiered scroll drop for a reward space/finish and surface it on the
    payload as `scroll` (see _roll_scroll_drop)."""
    sc = _roll_scroll_drop(doc, source)
    if sc:
        out['scroll'] = sc
        out['text'] = out.get('text', '') + f" A scroll of {data.SPELLS[sc]['name']} tumbles loose!"
    return out


def _append_treasure_gear(doc, out, chance_mult=1.0):
    """Big-ticket treasure spaces roll for a high-tier gear drop.
    `chance_mult` thins the roll for already-plundered tiles."""
    chance, tiers = data.GEAR_DROP['treasure']
    if _rng.random() < chance * chance_mult:
        drop = _roll_gear_drop(doc, tiers)
        if drop:
            out['gear'] = drop
            out['text'] += (' A piece of gear gleams among the hoard — '
                            + _drop_phrase(drop) + '.')


def _world_engage(table, sid, doc, payload):
    """Start a bounded skirmish against the live World Event. The player must be
    standing on one of its nodes. Loads the current shared pool as the NPC's HP;
    the 6-round cap + damage banking are handled in _conclude_round /
    _finish_battle (kind 'world')."""
    we = _world_event(table, sid)
    if not we or not we.get('spawned') or we.get('dead'):
        return _err('There is no World Event to fight right now.', 409)
    if doc.get('position') not in we.get('nodes', []):
        return _err('You must be standing on the beast to strike it.', 409)
    if doc.get('battle'):
        return _err('You are already in a fight.', 409)
    spec = data.WORLD_EVENT
    npc = dict(spec, hp=we['hp'], maxHp=we['maxHp'], name=spec['name'])
    event = _start_battle(table, sid, doc, 'world', npc, node=doc['position'],
                          ctx={'poolStart': we['hp']})
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    return _ok(doc, spaceEvent=event)


def _battle(table, sid, doc, payload):
    target_id = payload.get('targetUserId')
    if not target_id or target_id == doc['userId']:
        return _err('Pick a target.')
    target = _get_player(table, sid, target_id)
    if not target:
        return _err('Target not found.', 404)
    if target.get('position') != doc.get('position'):
        return _err('They slipped away — not on your space anymore.', 409)
    if _shielded(target):
        return _err('They are protected by a Compost Shield.', 409)
    engine.regen_hp(target, _now())
    _expire_buffs(target)
    doc['shieldUntil'] = None  # attacking drops your own shield

    atk_c = _combatant(doc)
    atk_c.stance = 'fight'
    def_c = _combatant(target)
    # PvP stays one-shot (auto stances via the back-compat resolver) — the
    # interactive round-by-round machine is PvE-only this iteration (spec §7).
    result = engine.resolve_battle(atk_c, def_c, _rng)

    doc['hp'] = result['attackerHp']
    target['hp'] = result['defenderHp']
    doc['hpUpdatedAt'] = _now()
    target['hpUpdatedAt'] = _now()
    _consume_one_battle_buffs(doc)
    _consume_one_battle_buffs(target)
    if result['smokeSporeUsed'] and 'smoke_spore' in (target.get('bag') or []):
        target['bag'].remove('smoke_spore')

    out = {'ok': True, 'battle': result,
           'target': {'userId': target_id, 'username': target.get('username'),
                      'formName': _form_name(target),
                      'creatureName': target.get('creatureName') or _form_name(target)}}

    if result['outcome'] == 'fled':
        _event(table, sid, 'pvp',
               f"{target['username']}'s {_creature_label(target)} slipped away from "
               f"{doc['username']} in the dark.", actor=doc['userId'])
        out['text'] = 'They vanish into the fungus before you can strike.'
    elif result['outcome'] == 'timeout':
        _grant_xp(table, sid, doc, data.XP_REWARDS['timeout'])
        _grant_xp(table, sid, target, data.XP_REWARDS['timeout'])
        _event(table, sid, 'pvp',
               f"{doc['username']} and {target['username']} brawl to a standstill.",
               actor=doc['userId'])
        out['text'] = 'Six rounds of scrabbling — no compost today.'
    else:
        winner, loser = (doc, target) if result['outcome'] == 'attacker' else (target, doc)
        stolen = engine.pvp_spore_steal(loser.get('spores', 0),
                                        loser.get('stance', 'fight') if loser is target else 'fight',
                                        _passives(winner))
        loser['spores'] = max(0, loser.get('spores', 0) - stolen)
        winner['spores'] = winner.get('spores', 0) + stolen
        winner['pvpWins'] = winner.get('pvpWins', 0) + 1
        win_levels = _grant_xp(table, sid, winner, data.XP_REWARDS['pvp_win'])
        lose_levels = _grant_xp(table, sid, loser, data.XP_REWARDS['pvp_loss'])
        _compost(table, sid, loser,
                 f"{loser['username']}'s {_creature_label(loser)} was composted by "
                 f"{winner['username']}'s {_creature_label(winner)}. The swarm remembers.")
        out['stolen'] = stolen
        out['winner'] = winner['userId']
        # Reward deltas for the acting player's victory popup.
        out['xp'] = data.XP_REWARDS['pvp_win'] if winner is doc else data.XP_REWARDS['pvp_loss']
        doc_levels = win_levels if winner is doc else lose_levels
        if doc_levels:
            out['levels'] = doc_levels
        if winner is doc:
            out['spores'] = stolen
        out['text'] = (f"You compost {target['username']} and loot {stolen} Spores!"
                       if winner is doc else
                       f"{target['username']} composts you and shakes {stolen} Spores loose…")

    # Notify the victim: any PvP initiated on them shows on their next return.
    victim_outcome = {'attacker': 'composted', 'defender': 'defended',
                      'fled': 'fled', 'timeout': 'timeout'}[result['outcome']]
    away = {'kind': 'pvp', 'from': doc.get('username', '?'),
            'outcome': victim_outcome, 'at': _now()}
    if victim_outcome == 'composted':
        away['spores'] = stolen
    _push_away_event(target, away)

    if not _put_player(table, target):
        return _err('They moved mid-fight — try again.', 409)
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    you = {k: v for k, v in doc.items() if k not in ('pk', 'sk')}
    return 200, {**out, 'you': you}


def _attack_boss(table, sid, doc, payload):
    return _err('The Behemoth still slumbers. (Boss finale is deferred.)')


# ── Spells ───────────────────────────────────────────────────────────────────

def _spell_err(msg, code, status=409):
    """Cast failures carry a machine-readable `code` beside the toast text."""
    return status, {'error': msg, 'code': code}


def _spell_cd_ready(doc, spell_id):
    ready_at = (doc.get('spellCooldowns') or {}).get(spell_id)
    return not ready_at or ready_at <= _now()


def _start_spell_cooldown(doc, spell_id):
    minutes = data.SPELLS[spell_id]['cooldownMin']
    # Squirrel Spell Haste: cooldowns are halved (cast twice as often).
    if 'spell_haste' in (doc.get('passives') or []):
        minutes *= data.SPELL_HASTE_MULT
    until = datetime.utcnow() + timedelta(minutes=minutes)
    doc.setdefault('spellCooldowns', {})[spell_id] = until.isoformat(timespec='seconds')


def _spell_damage(spell, doc):
    """Level-scaled spell damage, ×1.5 for a Squirrel Mage (spell_mage)."""
    dmg = engine.spell_power(spell, doc)
    if 'spell_mage' in (doc.get('passives') or []):
        dmg = round(dmg * data.SPELL_MAGE_DAMAGE_MULT)
    return dmg


def _spell_dodge_pct(caster_doc, target_doc):
    """Dodge % against a caster's field spell; halved for a Squirrel Mage."""
    chance = engine.spell_dodge_chance(engine.effective_stats(caster_doc)['spd'],
                                       engine.effective_stats(target_doc)['spd'])
    if 'spell_mage' in (caster_doc.get('passives') or []):
        chance *= data.SPELL_MAGE_DODGE_MULT
    return chance


def _apply_buff(doc, kind, until=None, mult=1):
    """Refresh-don't-stack: strip any same-kind buff, then append. `mult` scales
    a beneficial self-buff's magnitude (Squirrel Warrior doubles self-casts;
    read in engine.effective_stats)."""
    doc['buffs'] = [b for b in (doc.get('buffs') or []) if b.get('kind') != kind]
    entry = {'kind': kind}
    if until:
        entry['until'] = until
    if mult != 1:
        entry['mult'] = mult
    doc['buffs'].append(entry)


def _apply_guardian_debuffs(npc, buffs):
    """Translate persisted field-curse buffs into flat NPC stat penalties for
    this one battle (each stat floored at 1). Guardians are rooted, so a
    roll-halving curse becomes a speed penalty (see data.GUARDIAN_DEBUFF)."""
    for b in buffs or []:
        delta = data.GUARDIAN_DEBUFF.get(b.get('kind'))
        if not delta:
            continue
        for stat, d in delta.items():
            npc[stat] = max(1, npc.get(stat, 0) + d)


def _push_away_event(target, entry):
    events = target.setdefault('awayEvents', [])
    events.append(entry)
    if len(events) > data.AWAY_EVENTS_CAP:
        del events[:len(events) - data.AWAY_EVENTS_CAP]


def _season_players(table, sid):
    """Every creature doc in the running season."""
    resp = table.query(
        KeyConditionExpression='pk = :pk AND begins_with(sk, :sk)',
        ExpressionAttributeValues={':pk': _season_pk(sid), ':sk': 'PLAYER#'})
    return [_clean(i) for i in resp['Items']]


def _broadcast_away(table, sid, entry, exclude_user_id=None):
    """Fan a news away-event out to every season player except the actor, so a
    returning player learns what fell while they were gone. Best-effort: a lost
    optimistic-lock race just drops that one player's line."""
    for p in _season_players(table, sid):
        uid = p.get('userId')
        if not uid or uid == exclude_user_id:
            continue
        for _ in range(3):
            _push_away_event(p, dict(entry))
            if _put_player(table, p):
                break
            p = _get_player(table, sid, uid)
            if not p:
                break


def _resolve_spell_effect(table, sid, doc, spell_id, spell, payload):
    """Resolve one spell's effect against the caster `doc`. Returns
    (result_dict, extra_dict) on success, or an error tuple (status:int, payload).
    Shared by normal casts and by Wish (which delegates the chosen spell here).
    Squirrel Warrior doubles the caster's self-buffs/self-heals."""
    effect = spell['effect']
    extra = {}
    warrior = 'spell_warrior' in (doc.get('passives') or [])
    if effect == 'self_buff':
        _apply_buff(doc, spell['buffKind'],
                    mult=(data.SPELL_WARRIOR_MULT if warrior else 1))
        result = {'text': f"{spell['name']} takes hold. {spell['blurb']}"}
    elif effect == 'self_heal':
        eff = engine.effective_stats(doc)
        amount = engine.spell_power(spell, doc) * (data.SPELL_WARRIOR_MULT if warrior else 1)
        heal = max(0, min(amount, eff['maxHp'] - doc['hp']))
        doc['hp'] += heal
        result = {'text': f'Torn flesh knits closed (+{heal} HP).', 'hp': heal}
    elif effect in ('field_damage', 'field_curse'):
        out = _cast_field(table, sid, doc, spell_id, spell, payload.get('target'))
        if isinstance(out, tuple):
            return out
        result = out
    elif effect == 'teleport':
        out = _cast_teleport(table, sid, doc, spell, payload.get('target'))
        if isinstance(out[0], int):   # error tuple is (status, payload)
            return out
        result, extra = out           # success is (cast-result, extra-fields)
    elif effect == 'recall':
        gate = data.HOME_GATES.get(doc.get('homeBiome'), data.GATE_NODE)
        doc['position'] = gate
        doc['pendingMove'] = None
        doc.pop('pendingRespawn', None)
        result = {'text': 'Mycelial threads drag you home through the dark.', 'to': gate}
    elif effect == 'fate_die':
        hi = spell.get('maxValue', 6)
        value = payload.get('value')
        if not isinstance(value, int) or not 1 <= value <= hi:
            return _err(f'Pick a value 1–{hi}.')
        if doc.get('pendingMove'):
            return _err('Resolve your current move first.', 409)
        doc['pendingLoadedDie'] = value
        result = {'text': f'Fate bends. Your next roll will be a {value}.'}
    elif effect == 'boss_strike':
        out = _cast_boss_strike(table, sid, doc, spell, payload.get('target'))
        if isinstance(out, tuple):
            return out
        result = out
    else:
        return _err('Unknown spell effect.')
    return result, extra


def _cast(table, sid, doc, payload):
    spell_id = payload.get('spellId')
    source = payload.get('source', 'grimoire')
    spell = data.SPELLS.get(spell_id)
    if not spell:
        return _spell_err('Unknown spell.', 'unknown_spell', 400)
    if source == 'innate':
        if data.BIOME_SPELLS.get(doc.get('homeBiome')) != spell_id:
            return _spell_err("That is not your biome's gift.", 'not_castable')
    elif source == 'grimoire':
        gid = doc.get('equippedGrimoire') or ''
        if gid not in (doc.get('grimoires') or []) or spell_id not in _book_spells(doc, gid):
            return _spell_err('That spell is not in your open grimoire.', 'not_castable')
    elif source == 'wish':
        # Only the Calamity Beast (wish passive) may cast Wish.
        if spell_id != 'wish' or 'wish' not in (doc.get('passives') or []):
            return _spell_err('You have not learned Wish.', 'not_castable')
    elif source == 'scroll':
        # A one-shot scroll: no book needed, no cooldown, consumed on success.
        if spell_id not in (doc.get('scrolls') or []):
            return _spell_err('You have no such scroll.', 'not_castable', 400)
    else:
        return _spell_err('Cast from your grimoire, an innate gift, or a scroll.',
                          'not_castable', 400)
    if source != 'scroll' and not _spell_cd_ready(doc, spell_id):
        return _spell_err(f"{spell['name']} is still recharging.",
                          'spell_on_cooldown', 429)

    extra = {}
    if spell['effect'] == 'wish':
        # Wish selects ANY spell and casts it; the cooldown started is Wish's,
        # not the chosen spell's. Caster passives still apply to the wished spell.
        wish_id = payload.get('wishSpellId')
        wished = data.SPELLS.get(wish_id)
        if not wished or wish_id == 'wish':
            return _spell_err('Choose a spell to Wish for.', 'invalid_target', 400)
        out = _resolve_spell_effect(table, sid, doc, wish_id, wished, payload)
        if isinstance(out[0], int):
            return out
        result, extra = out
        result = {**result, 'wished': wish_id}
        effect = 'wish'
    else:
        out = _resolve_spell_effect(table, sid, doc, spell_id, spell, payload)
        if isinstance(out[0], int):
            return out
        result, extra = out
        effect = spell['effect']

    if source == 'scroll':
        doc['scrolls'].remove(spell_id)   # scrolls are one-shot, no cooldown
    else:
        _start_spell_cooldown(doc, spell_id)
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    return _ok(doc, cast={'spellId': spell_id, 'effect': effect, **result}, **extra)


def _cast_field(table, sid, doc, spell_id, spell, target_id):
    """Route a field spell to a guardian/boss target, else a rival player."""
    if target_id == 'boss' or target_id in data.BARRIER_GUARDIANS or target_id in data.LAIR_BOSSES:
        return _cast_at_guardian(table, sid, doc, spell, target_id)
    return _cast_at_player(table, sid, doc, spell_id, spell, target_id)


def _cast_at_guardian(table, sid, doc, spell, target_id):
    """Field damage/curse at a rooted guardian/boss within range. Chips its
    persistent pool (floored at 1 — no remote kill/open) or persists a curse
    read at its next battle. No dodge, no bounty. An error tuple leaves the
    caster's cooldown unstarted."""
    nodes = _season_map(table, sid)
    if target_id == 'boss':
        node = data.BOSS_NODE
        name = data.ROT_SOVEREIGN['name']
        hp = _boss_hp(table, sid)
        maxhp = data.ROT_SOVEREIGN['hp']
        buffs = _boss_buffs(table, sid)

        def save(new_hp, new_buffs):
            _set_boss_hp(table, sid, new_hp, new_buffs)
    elif target_id in data.BARRIER_GUARDIANS:
        if target_id in _open_barriers(table, sid):
            return _spell_err('That barrier already lies in rubble.', 'invalid_target', 409)
        node = target_id
        name = data.BARRIER_GUARDIANS[target_id]['name']
        maxhp = data.BARRIER_GUARDIANS[target_id]['hp']
        hp, buffs = _barrier_state(table, sid, target_id)

        def save(new_hp, new_buffs):
            _set_barrier_state(table, sid, target_id, new_hp, new_buffs)
    else:  # lair boss
        node = target_id
        b = data.LAIR_BOSSES[target_id]
        hp, slain, buffs = _lair_state(table, sid, target_id)
        name = f"Vestige of {b['name']}" if slain else b['name']
        maxhp = (b['hp'] // 2) if slain else b['hp']

        def save(new_hp, new_buffs):
            _set_lair_state(table, sid, target_id, new_hp, slain, new_buffs)

    dist = engine.board_distance(nodes, doc['position'], node,
                                 spell['range'], _closed_barriers(table, sid))
    if dist is None:
        return _spell_err(f"It is beyond the spell's reach ({spell['range']} spaces).",
                          'out_of_range')

    if spell['effect'] == 'field_damage':
        new_hp = max(1, hp - _spell_damage(spell, doc))
        dealt = hp - new_hp
        save(new_hp, buffs)
        if dealt:
            _event(table, sid, 'spell',
                   f"{doc['username']}'s {spell['name']} wounds {name} from afar "
                   f'({new_hp}/{maxhp} HP)!', actor=doc['userId'])
            text = f'{spell["name"]} wounds {name} for {dealt}! ({new_hp}/{maxhp} HP)'
        else:
            text = f'{name} is already at the brink — finish it in person.'
        return {'dmg': dealt, 'targetName': name, 'text': text}

    # field_curse: refresh-don't-stack, then persist.
    buffs = [x for x in buffs if x.get('kind') != spell['buffKind']]
    buffs.append({'kind': spell['buffKind']})
    save(hp, buffs)
    _event(table, sid, 'spell',
           f"{doc['username']} cursed {name} with {spell['name']}!", actor=doc['userId'])
    return {'targetName': name,
            'text': f'{spell["name"]} settles over {name} — it will fester in its next fight.'}


def _cast_at_player(table, sid, doc, spell_id, spell, target_id):
    """Field damage/curse at a rival. Returns a cast-result dict, or an error
    tuple (in which case the caster's cooldown never starts)."""
    nodes = _season_map(table, sid)
    if not target_id or target_id == doc['userId']:
        return _spell_err('Pick a target.', 'invalid_target', 400)
    target = _get_player(table, sid, target_id)
    if not target:
        return _spell_err('Target not found.', 'invalid_target', 404)
    if _shielded(target):
        return _spell_err('They are protected by a Compost Shield.', 'target_shielded')
    dist = engine.board_distance(nodes, doc['position'],
                                 target['position'], spell['range'],
                                 _closed_barriers(table, sid))
    if dist is None:
        return _spell_err(f"They are beyond the spell's reach "
                          f"({spell['range']} spaces).", 'out_of_range')

    def apply(t):
        engine.regen_hp(t, _now())
        _expire_buffs(t)
        chance = _spell_dodge_pct(doc, t)
        dodged = _rng.random() * 100 < chance
        dmg = 0
        if not dodged:
            if spell['effect'] == 'field_damage':
                dmg = _spell_damage(spell, doc)
                t['hp'] = max(1, t['hp'] - dmg)   # never composts (spec §2.2)
                t['hpUpdatedAt'] = _now()
            else:
                _apply_buff(t, spell['buffKind'])
        entry = {'kind': 'spell_dodged' if dodged else 'spell_hit',
                 'from': doc.get('username', '?'), 'spell': spell_id, 'at': _now()}
        if dmg:
            entry['dmg'] = dmg
        _push_away_event(t, entry)
        return dodged, dmg

    dodged, dmg = apply(target)
    if not _put_player(table, target):
        # Someone wrote the victim doc mid-cast — retry once on a fresh read.
        target = _get_player(table, sid, target_id)
        if not target or _shielded(target):
            return _err('They slipped from your grasp — try again.', 409)
        dodged, dmg = apply(target)
        if not _put_player(table, target):
            return _err('They slipped from your grasp — try again.', 409)

    tname = target.get('username', '?')
    if dodged:
        text = f'{tname} slips aside — {spell["name"]} fizzles!'
        _event(table, sid, 'spell',
               f"{doc['username']}'s {spell['name']} fizzled against {tname}.",
               actor=doc['userId'])
    elif spell['effect'] == 'field_damage':
        text = f'{spell["name"]} strikes {tname} for {dmg}!'
        _event(table, sid, 'spell',
               f"{doc['username']} blasted {tname} with {spell['name']} ({dmg} damage)!",
               actor=doc['userId'])
    else:
        text = f'{spell["name"]} takes hold of {tname}.'
        _event(table, sid, 'spell',
               f"{doc['username']} cursed {tname} with {spell['name']}!",
               actor=doc['userId'])
    return {'dodged': dodged, 'dmg': dmg, 'targetName': tname, 'text': text}


def _cast_teleport(table, sid, doc, spell, to):
    """Blink to a nearby node and resolve it like a normal landing. Returns
    (cast-result, extra-response-fields) or an error tuple."""
    nodes = _season_map(table, sid)
    if to not in nodes or to == doc['position']:
        return _spell_err('No such tunnel to blink to.', 'invalid_target', 400)
    blocked = _blocked_nodes(doc)
    if to in blocked:
        return _spell_err('Evolved units cannot squeeze into a tunnel.',
                          'invalid_target')
    dist = engine.board_distance(nodes, doc['position'], to,
                                 spell['range'], _closed_barriers(table, sid),
                                 blocked)
    if dist is None:
        return _spell_err(f'Too far — {spell["name"]} reaches '
                          f'{spell["range"]} spaces.', 'out_of_range')
    prev = doc['position']
    doc['pendingMove'] = None
    doc['position'] = to
    space_event = _resolve_space(table, sid, doc, to, prev)
    # _resolve_space may relocate again (wild warp, spore cloud) — report where
    # the dust actually settled.
    occupants = _occupants(table, sid, doc['position'], doc['userId'])
    result = {'to': doc['position'],
              'text': f'Space folds — you re-form {dist} space'
                      f'{"s" if dist != 1 else ""} away.'}
    return result, {'spaceEvent': space_event, 'occupants': occupants}


def _cast_boss_strike(table, sid, doc, spell, target):
    """Chip a persistent HP pool (Savra or a lair) from anywhere. Pools floor
    at 1 — the killing blow must be landed in person."""
    if target == 'boss':
        hp = _boss_hp(table, sid)
        new_hp = max(1, hp - _spell_damage(spell, doc))
        dealt = hp - new_hp
        _set_boss_hp(table, sid, new_hp)
        doc['bossDamage'] = doc.get('bossDamage', 0) + dealt
        name = data.ROT_SOVEREIGN['name']
        if dealt:
            _event(table, sid, 'spell',
                   f"{doc['username']}'s {spell['name']} sears {name} from afar "
                   f'({new_hp}/{data.ROT_SOVEREIGN["hp"]} HP)!', actor=doc['userId'])
            text = f'{spell["name"]} sears the Queen for {dealt}! ({new_hp} HP remains)'
        else:
            text = 'The Queen is already at the brink — finish her in person.'
        return {'dmg': dealt, 'targetName': name, 'text': text}
    if target in data.LAIR_BOSSES:
        hp, slain, _ = _lair_state(table, sid, target)
        new_hp = max(1, hp - _spell_damage(spell, doc))
        dealt = hp - new_hp
        _set_lair_state(table, sid, target, new_hp, slain)
        name = data.LAIR_BOSSES[target]['name']
        display = f'Vestige of {name}' if slain else name
        if dealt:
            _event(table, sid, 'spell',
                   f"{doc['username']}'s {spell['name']} wounds the {display} from afar!",
                   actor=doc['userId'])
            text = f'{spell["name"]} wounds the {display} for {dealt}!'
        else:
            text = f'The {display} is already at the brink — finish it in person.'
        return {'dmg': dealt, 'targetName': display, 'text': text}
    return _spell_err('Aim at the Queen (boss) or a lair.', 'invalid_target', 400)


# ── The Sedgemoor Witch (design 2026-07-23 bog-witch-scrolls) ────────────────

def _witch_inscribe(table, sid, doc, payload):
    """Inscribe a held scroll into a grimoire the player owns. Capacity is by the
    book's tier (GRIMOIRE_CAPACITY); a full book burns out a chosen spell to make
    room. Consumes the scroll and a tier-scaled Spore fee."""
    nodes = _season_map(table, sid)
    if nodes.get(doc.get('position'), {}).get('type') != 'witch':
        return _err('You are not at the witch.', 409)
    scroll = (payload or {}).get('scrollSpellId')
    gid = (payload or {}).get('grimoireId')
    if scroll not in (doc.get('scrolls') or []):
        return _err('You have no such scroll.', 400)
    if gid not in (doc.get('grimoires') or []):
        return _err('You do not own that grimoire.', 400)
    cap = data.GRIMOIRE_CAPACITY[data.GRIMOIRES[gid]['tier']]
    spells = list(_book_spells(doc, gid))
    if scroll in spells:
        return _err('That book already holds that spell.', 409)
    cost = data.INSCRIBE_COST[data.SPELLS[scroll]['tier']]
    if doc.get('spores', 0) < cost:
        return _err(f'The witch wants {cost} Spores.', 409)
    if len(spells) >= cap:
        ow = (payload or {}).get('overwriteSpellId')
        if ow not in spells:
            return _err('That book is full — choose a spell to burn out.', 409)
        spells.remove(ow)
    spells.append(scroll)
    doc.setdefault('grimoireSpells', {})[gid] = spells
    doc['scrolls'].remove(scroll)
    doc['spores'] -= cost
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    return _ok(doc, text=f"The witch inscribes {data.SPELLS[scroll]['name']} "
                         f"into {data.GRIMOIRES[gid]['name']}.")


def _witch_buy_scroll(table, sid, doc, payload):
    """Buy a tier-I scroll from the witch's stock into the satchel for Spores."""
    nodes = _season_map(table, sid)
    if nodes.get(doc.get('position'), {}).get('type') != 'witch':
        return _err('You are not at the witch.', 409)
    spell_id = (payload or {}).get('spellId')
    if spell_id not in data.WITCH_SCROLL_STOCK:
        return _err("The witch isn't brewing that one.", 409)
    price = round(data.INSCRIBE_COST[data.SPELLS[spell_id]['tier']] * data.WITCH_SCROLL_MARKUP)
    if doc.get('spores', 0) < price:
        return _err(f'That scroll costs {price} Spores.', 409)
    if len(doc.get('scrolls') or []) >= data.SCROLL_SATCHEL_CAP:
        return _err('Your scroll satchel is full.', 409)
    doc['spores'] -= price
    doc.setdefault('scrolls', []).append(spell_id)
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    return _ok(doc, text=f"You buy a {data.SPELLS[spell_id]['name']} scroll.")


def _equip_grimoire(table, sid, doc, payload):
    gid = payload.get('grimoireId') or None
    if gid and gid not in (doc.get('grimoires') or []):
        return _err('You do not own that grimoire.', 409)
    # Opening a *different* grimoire is gated by a cooldown so a player can't
    # hot-swap spell loadouts on demand. Stowing (gid=None) is always free, and
    # re-opening after a stow is still gated — so it can't be used to bypass.
    if gid and gid != doc.get('equippedGrimoire'):
        last = doc.get('lastGrimoireSwap')
        if last:
            elapsed = datetime.utcnow() - datetime.fromisoformat(last)
            if elapsed < timedelta(minutes=data.GRIMOIRE_SWAP_COOLDOWN_MIN):
                wait = data.GRIMOIRE_SWAP_COOLDOWN_MIN - int(elapsed.total_seconds() // 60)
                return _err(f'Grimoire swap on cooldown ({wait} min left).', 429)
        doc['lastGrimoireSwap'] = _now()
    doc['equippedGrimoire'] = gid
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    if gid:
        return _ok(doc, text=f"You crack open the {data.GRIMOIRES[gid]['name']}.")
    return _ok(doc, text='You stow your grimoire.')


def _ack_events(table, sid, doc, payload):
    doc['awayEvents'] = []
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    return _ok(doc)


# ── Creature management ──────────────────────────────────────────────────────

def _set_stance(table, sid, doc, payload):
    stance = payload.get('stance')
    if stance not in ('fight', 'defend', 'flee'):
        return _err('Stance must be fight, defend, or flee.')
    doc['stance'] = stance
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    return _ok(doc)


def _spend_stat(table, sid, doc, payload):
    stat = payload.get('stat')
    if not engine.spend_stat(doc, stat):
        return _err('No stat points to spend.', 409)
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    return _ok(doc)


def _evolve(table, sid, doc, payload):
    form = payload.get('form')
    tier = doc.get('tier', 1)
    if tier == 1:
        if doc.get('level', 1) < 5:
            return _err('Evolution unlocks at level 5.', 409)
        options = data.tier2_options(doc['species'])
        spec = data.TIER2.get(form)
    elif tier == 2:
        if doc.get('level', 1) < 10:
            return _err('Apex forms unlock at level 10.', 409)
        options = data.apex_options(doc['form'])
        spec = data.APEX.get(form)
    else:
        return _err('You are already an apex of the Undercity.', 409)
    if form not in options or not spec:
        return _err('That path is closed to your line.')

    for stat, amt in spec['bonus'].items():
        doc[stat] = doc.get(stat, 0) + amt
    doc['form'] = form
    doc['tier'] = tier + 1
    doc.setdefault('passives', []).append(spec['passive'])
    doc['hp'] = engine.effective_stats(doc)['maxHp']  # evolution fully heals
    doc['hpUpdatedAt'] = _now()
    doc['evolvedAt'] = _now()
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    _event(table, sid, 'evolve',
           f"{doc['username']}'s creature evolves into {spec['name']}!"
           + (' An APEX rises!' if doc['tier'] == 3 else ''),
           actor=doc['userId'])
    return _ok(doc)


# ── Economy ──────────────────────────────────────────────────────────────────

def _buy(table, sid, doc, payload):
    nodes = _season_map(table, sid)
    node = doc.get('position')
    if nodes.get(node, {}).get('type') != 'shop':
        return _err('You are not at a shop.', 409)
    item_id = payload.get('itemId')
    stock = _shop_stock(table, sid, node)
    deplete = None  # the stock line to decrement on a successful gear/consumable buy

    if item_id in data.GEAR:
        line = next((e for e in stock['gear'] if e['item'] == item_id), None)
        if not line:
            return _err("The bazaar isn't stocking that right now.", 409)
        if line['qty'] <= 0:
            return _err('Sold out — check back after the restock.', 409)
        g = data.GEAR[item_id]
        cost = g['cost']
        if doc.get('spores', 0) < cost:
            return _err('Not enough Spores.', 409)
        # No auto-equip: purchased gear lands in the stash; equip it at the Plaza.
        # If the stash is full we stall the sale rather than grinding the piece —
        # the player clears room by salvaging at the Plaza first.
        stash = doc.setdefault('gearStash', [])
        if len(stash) >= data.GEAR_STASH_SIZE:
            return _err('Your gear stash is full — salvage a piece at the Plaza first.', 409)
        doc['spores'] = doc.get('spores', 0) - cost
        stash.append(item_id)
        deplete = line
        text = f"Bought {g['name']} — stashed. Equip it at the Plaza."
    elif item_id in data.CONSUMABLES:
        line = next((e for e in stock['consumables'] if e['item'] == item_id), None)
        if not line:
            return _err("The bazaar isn't stocking that right now.", 409)
        if line['qty'] <= 0:
            return _err('Sold out — check back after the restock.', 409)
        c = data.CONSUMABLES[item_id]
        if len(doc.get('bag') or []) >= data.BAG_SIZE:
            return _err('Your bag is full (3 slots).', 409)
        if doc.get('spores', 0) < c['cost']:
            return _err('Not enough Spores.', 409)
        doc['spores'] -= c['cost']
        doc.setdefault('bag', []).append(item_id)
        deplete = line
        text = f"Bought {c['name']}"
    elif item_id in data.GRIMOIRES:
        g = data.GRIMOIRES[item_id]
        if g['tier'] != 1:
            return _err('The bazaar does not stock that tome.', 409)
        if item_id not in stock['grimoires']:
            return _err("The bazaar isn't stocking that tome right now.", 409)
        if item_id in (doc.get('grimoires') or []):
            return _err('You already own that grimoire.', 409)
        if doc.get('spores', 0) < g['cost']:
            return _err('Not enough Spores.', 409)
        doc['spores'] -= g['cost']
        _grant_grimoire(doc, item_id)
        text = f"Bought {g['name']}"
    else:
        return _err('Unknown item.')

    conflict = _save_or_conflict(table, doc)  # guard the player write first
    if conflict:
        return conflict
    if deplete is not None:                    # then the shared stock (last-writer-wins)
        deplete['qty'] -= 1
        table.put_item(Item={
            'pk': _season_pk(sid), 'sk': f'SHOP#{node}',
            'window': stock['window'], 'gear': stock['gear'],
            'consumables': stock['consumables'], 'grimoires': stock['grimoires']})
    return _ok(doc, text=text)


# ── Trading post ─────────────────────────────────────────────────────────────

def _seed_stock():
    """House stock a post opens with, tagged so it reads as the game's own."""
    return [{'item': i, 'foundBy': 'the Swarm'} for i in data.TRADING_POST_SEED]


def _trading_post_stock(table, sid, node):
    rec = _get(table, _season_pk(sid), f'POST#{node}')
    if rec and rec.get('stock'):
        return rec['stock']
    return _seed_stock()


def _umori_barter_stock(table, sid, window):
    """Intra-window barter state for Umori (POST#UMORI#<window>); a fresh T3 seed
    when nobody has traded yet this window. A stale window is ignored → reset."""
    rec = _get(table, _season_pk(sid), f'POST#UMORI#{window}')
    if rec and rec.get('stock'):
        return rec['stock']
    return _umori_stock(window)


def _save_trading_post(table, sid, node, stock):
    table.put_item(Item={'pk': _season_pk(sid), 'sk': f'POST#{node}', 'stock': stock})


def _item_kind(item_id):
    if item_id in data.CONSUMABLES:
        return 'consumable'
    if item_id in data.GEAR:
        return 'gear'
    if item_id in data.GRIMOIRES:
        return 'grimoire'
    return None


def _item_name(item_id):
    kind = _item_kind(item_id)
    if kind == 'consumable':
        return data.CONSUMABLES[item_id]['name']
    if kind == 'gear':
        return data.GEAR[item_id]['name']
    if kind == 'grimoire':
        return data.GRIMOIRES[item_id]['name']
    return item_id


def _trade(table, sid, doc, payload):
    """Barter one owned item for one of Umori's stock lines. Match rule: a gear
    line wants a gear piece of the *same slot* (equipped or stashed); the grimoire
    line wants a grimoire. One barter per rotation. The item you leave fills that
    stock slot for the rest of the window; the taken gear lands in your stash."""
    node = doc.get('position')
    win = _umori_window()
    if node != _umori_node(win):
        return _err('Umori is not here.', 409)
    if doc.get('umoriTradedWindow') == win:
        return _err("You've already bartered with Umori this stop — "
                    'catch it after it wanders on.', 409)

    give = payload.get('give')
    take_index = payload.get('takeIndex')
    give_kind = _item_kind(give)
    if give_kind is None:
        return _err('Unknown item.')
    if give_kind == 'consumable':
        return _err('Umori only trades in gear and grimoires.', 409)

    stock = _umori_barter_stock(table, sid, win)
    if not isinstance(take_index, int) or not (0 <= take_index < len(stock)):
        return _err('Pick something to take.', 409)
    taken = stock[take_index]
    take_kind = _item_kind(taken['item'])

    # Match rule — one slot at a time.
    if take_kind == 'gear':
        if give_kind != 'gear' or data.GEAR[give]['slot'] != data.GEAR[taken['item']]['slot']:
            slot = data.GEAR[taken['item']]['slot']
            return _err(f'Umori wants the same slot — offer a {slot} for that {slot}.', 409)
    elif take_kind == 'grimoire':
        if give_kind != 'grimoire':
            return _err('Umori wants a grimoire for that grimoire.', 409)

    gear = doc.get('gear') or {}
    grimoires = doc.get('grimoires') or []
    stash = doc.get('gearStash') or []

    # Give-side ownership: gear may come from the equipped slot OR the stash.
    give_from_stash = False
    if give_kind == 'gear':
        slot = data.GEAR[give]['slot']
        if gear.get(slot) == give:
            give_from_stash = False
        elif give in stash:
            give_from_stash = True
        else:
            return _err("You don't have that piece to trade.", 409)
    elif give_kind == 'grimoire' and give not in grimoires:
        return _err("You don't own that grimoire.", 409)

    # Take-side guards.
    if take_kind == 'grimoire' and taken['item'] in grimoires:
        return _err('You already own that grimoire.', 409)
    if take_kind == 'gear':
        effective_stash = len(stash) - (1 if give_from_stash else 0)
        if effective_stash >= data.GEAR_STASH_SIZE:
            return _err('Your gear stash is full — salvage a piece at the Plaza first.', 409)

    # Remove the given item from wherever it lives.
    if give_kind == 'gear':
        if give_from_stash:
            stash = list(stash)
            stash.remove(give)
            doc['gearStash'] = stash
        else:
            gear = dict(gear)
            del gear[data.GEAR[give]['slot']]
            doc['gear'] = gear
    elif give_kind == 'grimoire':
        doc['grimoires'] = [g for g in grimoires if g != give]
        if doc.get('equippedGrimoire') == give:
            doc['equippedGrimoire'] = None

    # Apply the taken item.
    if take_kind == 'gear':
        doc.setdefault('gearStash', []).append(taken['item'])
    elif take_kind == 'grimoire':
        doc.setdefault('grimoires', []).append(taken['item'])
        if not doc.get('equippedGrimoire'):
            doc['equippedGrimoire'] = taken['item']

    # Leave the given piece in that stock slot for the rest of the window.
    stock = list(stock)
    stock[take_index] = {'item': give, 'foundBy': doc.get('username', 'someone')}

    doc['umoriTradedWindow'] = win                       # spend the rotation's barter

    conflict = _save_or_conflict(table, doc)             # guard the player write first
    if conflict:
        return conflict
    table.put_item(Item={'pk': _season_pk(sid),          # then the shared window stock
                         'sk': f'POST#UMORI#{win}', 'stock': stock})

    give_name = _item_name(give)
    take_name = _item_name(taken['item'])
    _event(table, sid, 'trade',
           f"{doc['username']} bartered a {give_name} for {take_name} at Umori's stall.",
           actor=doc['userId'])
    return _ok(doc, text=f"You hand over your {give_name} and take {take_name}.",
               node=node, stock=stock)


# ── Excavation dig sites ──────────────────────────────────────────────────────

# Masked client cell codes; revealed item cells report their item index (>= 0).
_DIG_COVERED = -2
_DIG_EMPTY = -1


def _shape_cells(shape, w, h):
    """Random in-bounds footprint for a shape, as a list of (r, c)."""
    if shape == '2x2':
        r, c = _rng.randint(0, h - 2), _rng.randint(0, w - 2)
        return [(r, c), (r, c + 1), (r + 1, c), (r + 1, c + 1)]
    if shape == '1x2':
        if _rng.random() < 0.5:  # horizontal
            r, c = _rng.randint(0, h - 1), _rng.randint(0, w - 2)
            return [(r, c), (r, c + 1)]
        r, c = _rng.randint(0, h - 2), _rng.randint(0, w - 1)  # vertical
        return [(r, c), (r + 1, c)]
    return [(_rng.randint(0, h - 1), _rng.randint(0, w - 1))]  # 1x1


def _roll_dig_loot(shape):
    """Loot scales with footprint — bigger digs are worth more, and every find
    lands something useful (finds are visible now, so a dud would just feel bad)."""
    if shape == '1x1':
        if _rng.random() < 0.55:
            return {'kind': 'spores', 'spores': _rng.randint(15, 25)}
        return {'kind': 'item', 'item': _rng.choice(['healing_moss', 'snare', 'smoke_spore'])}
    if shape == '1x2':
        return {'kind': 'item', 'item': _rng.choice(list(data.CONSUMABLES))}
    # 2x2 marquee — always strong: a rare combat item or a big Spore cache.
    if _rng.random() < 0.55:
        return {'kind': 'item',
                'item': _rng.choice(['loaded_die', 'scrying_spore', 'rot_bomb',
                                     'chitin_ward', 'ambush_musk'])}
    return {'kind': 'spores', 'spores': _rng.randint(50, 80)}


def _gen_dig_grid():
    """Fresh site: the configured items placed non-overlapping on the grid."""
    w, h = data.EXCAVATION_GRID
    occupied, items = set(), []
    for shape in data.EXCAVATION_ITEMS:
        cells = None
        for _ in range(200):
            cand = _shape_cells(shape, w, h)
            if not any(cc in occupied for cc in cand):
                cells = cand
                break
        if cells is None:
            continue  # pathologically unlucky; site just gets fewer items
        occupied.update(cells)
        items.append({'shape': shape, 'cells': [[r, c] for r, c in cells],
                      'loot': _roll_dig_loot(shape), 'collected': False, 'by': None})
    return {'w': w, 'h': h, 'items': items, 'revealed': []}


def _dig_site(table, sid, node):
    """Shared site record, lazily generated + persisted on the first ever dig."""
    rec = _get(table, _season_pk(sid), f'SITE#{node}')
    if rec and rec.get('items'):
        return rec
    site = _gen_dig_grid()
    _save_dig_site(table, sid, node, site)
    return site


def _save_dig_site(table, sid, node, site):
    table.put_item(Item={'pk': _season_pk(sid), 'sk': f'SITE#{node}', **site})


def _dig_view(rec):
    """View for the client: the dirt still hides which cells are dug, but the
    buried finds show through (footprint + loot) so players can see what's down
    there and where to spend their digs."""
    w, h = data.EXCAVATION_GRID
    if not rec or not rec.get('items'):
        return {'w': w, 'h': h, 'cells': [[_DIG_COVERED] * w for _ in range(h)],
                'items': [], 'remaining': len(data.EXCAVATION_ITEMS)}
    w, h = rec['w'], rec['h']
    revealed = set(rec.get('revealed') or [])
    cell_item = {}
    for idx, it in enumerate(rec['items']):
        for r, c in it['cells']:
            cell_item[(r, c)] = idx
    cells = []
    for r in range(h):
        row = []
        for c in range(w):
            row.append(cell_item.get((r, c), _DIG_EMPTY) if f'{r},{c}' in revealed
                       else _DIG_COVERED)
        cells.append(row)
    items = []
    for idx, it in enumerate(rec['items']):
        loot = it.get('loot') or {}
        items.append({'idx': idx, 'shape': it['shape'],
                      'cells': [[r, c] for r, c in it['cells']],
                      'kind': loot.get('kind'), 'item': loot.get('item'),
                      'spores': loot.get('spores'),
                      'collected': it['collected'], 'by': it['by']})
    return {'w': w, 'h': h, 'cells': cells, 'items': items,
            'remaining': sum(1 for it in rec['items'] if not it['collected'])}


def _award_dig_loot(doc, loot):
    if loot['kind'] == 'spores':
        amount = _scrounge(doc, loot['spores'])
        doc['spores'] = doc.get('spores', 0) + amount
        return {'kind': 'spores', 'spores': amount}
    item_id = loot['item']
    if len(doc.get('bag') or []) >= data.BAG_SIZE:
        doc['spores'] = doc.get('spores', 0) + 5  # bag full → salvage for Spores
        return {'kind': 'spores', 'spores': 5, 'bagFull': True, 'item': item_id}
    doc.setdefault('bag', []).append(item_id)
    return {'kind': 'item', 'item': item_id}


def _dig_text(found, cleared, bonus):
    if not found:
        parts = ['Rubble and grit — nothing buried here.']
    elif found['kind'] == 'spores' and found.get('bagFull'):
        parts = [f"You unearth a {data.CONSUMABLES[found['item']]['name']}, but your bag is full — "
                 f"you salvage it for {found['spores']} Spores."]
    elif found['kind'] == 'spores':
        parts = [f"You dig up a cache of {found['spores']} Spores!"]
    else:
        parts = [f"You unearth a {data.CONSUMABLES[found['item']]['name']}!"]
    if cleared:
        parts.append(f'The site is picked clean — +{bonus} Spore bonus, and the rubble resettles.')
    return ' '.join(parts)


def _dig(table, sid, doc, payload):
    """Reveal one cell of the shared dig site; collect any item it completes."""
    nodes = _season_map(table, sid)
    node = doc.get('position')
    if nodes.get(node, {}).get('type') != 'excavation':
        return _err('You are not at a dig site.', 409)
    if doc.get('excavationDigsLeft', 0) < 1:
        return _err('Out of digs — come back next time you land here.', 409)
    site = _dig_site(table, sid, node)
    w, h = site['w'], site['h']
    r, c = payload.get('r'), payload.get('c')
    if not (isinstance(r, int) and isinstance(c, int) and 0 <= r < h and 0 <= c < w):
        return _err('Dig where?', 409)
    key = f'{r},{c}'
    revealed = set(site.get('revealed') or [])
    if key in revealed:
        return _err('You have already cleared that spot.', 409)
    revealed.add(key)
    site['revealed'] = sorted(revealed)
    doc['excavationDigsLeft'] = doc.get('excavationDigsLeft', 0) - 1

    found = None
    for it in site['items']:
        if it['collected']:
            continue
        cellset = {f'{cr},{cc}' for cr, cc in it['cells']}
        if key in cellset and cellset <= revealed:
            it['collected'] = True
            it['by'] = doc.get('username', 'someone')
            found = _award_dig_loot(doc, it['loot'])
            break

    cleared = all(it['collected'] for it in site['items'])
    bonus = 0
    if cleared:
        bonus = data.EXCAVATION_CLEAR_BONUS
        doc['spores'] = doc.get('spores', 0) + bonus
        site = _gen_dig_grid()  # reset for the next digger

    conflict = _save_or_conflict(table, doc)  # guard the player write first
    if conflict:
        return conflict
    _save_dig_site(table, sid, node, site)

    if cleared:
        _event(table, sid, 'excavation',
               f"{doc['username']} unearthed the last relic at a dig site (+{bonus} Spores)! "
               'Fresh finds lie buried anew.', actor=doc['userId'])

    return _ok(doc, node=node, grid=_dig_view(site), digsLeft=doc['excavationDigsLeft'],
               found=found, cleared=cleared, bonus=(bonus if cleared else None),
               text=_dig_text(found, cleared, bonus))


# ── Flow loot puzzle ──────────────────────────────────────────────────────────

def _solve_loot_puzzle(table, sid, doc, payload):
    """Validate the drawn Flow path; award the FIRST reward the path crosses."""
    pending = doc.get('pendingLoot')
    if not pending:
        return _err('No loot puzzle to solve.', 409)
    puzzle = data.flow_puzzle(pending.get('puzzleId'))
    if not puzzle:
        doc.pop('pendingLoot', None)  # pack changed under us — drop the stale gate
        _save_or_conflict(table, doc)
        return _err('That puzzle is no longer available.', 409)
    path = payload.get('path') or []
    if not engine.validate_flow_solution(puzzle, path):
        return _err("That path isn't a full solution.", 409)
    kind = engine.first_reward_on_path(pending.get('rewards') or [], path)
    doc.pop('pendingLoot', None)
    awarder = _LOOT_AWARDERS.get(kind, _award_spores)  # None → spores fallback
    event = awarder(doc)
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    return _ok(doc, spaceEvent=event)


def _cancel_loot_puzzle(table, sid, doc, payload):
    """Give up on a loot puzzle — forfeit the reward, no penalty."""
    if doc.pop('pendingLoot', None) is None:
        return _ok(doc)  # nothing to cancel; idempotent
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    return _ok(doc)


# ── Crystal Veins ─────────────────────────────────────────────────────────────

def _vein_rec(table, sid, region):
    rec = _get(table, _season_pk(sid), f'VEIN#{region}')
    return rec if rec else {'depth': 0}


def _save_vein(table, sid, region, depth):
    table.put_item(Item={'pk': _season_pk(sid), 'sk': f'VEIN#{region}',
                         'depth': depth})


def _vein_item(level):
    """Bonus item chance — consumables mid-vein, rarities in the deep band."""
    if 5 <= level <= 8 and _rng.random() < 0.15:
        return _rng.choice(list(data.CONSUMABLES))
    if level >= 9 and _rng.random() < 0.20:
        return _rng.choice(data.VEIN_RARE_ITEMS)
    return None


def _vein_found_text(found):
    if not found:
        return ''
    name = data.CONSUMABLES[found['item']]['name']
    if found.get('bagFull'):
        return (f' A {name} glints in the tailings, but your bag is full — '
                f'salvaged for {found["spores"]} Spores.')
    return f' A {name} glints in the tailings!'


def _vein_strike_once(table, sid, doc):
    """One swing at the region's shared vein. Mutates doc; persists the shared
    VEIN# record and any feed event (last-writer-wins, like POST# stock). The
    caller persists the player doc."""
    nodes = _season_map(table, sid)
    region = nodes[doc['position']]['region']
    level = _vein_rec(table, sid, region)['depth'] + 1     # the level being entered
    doc['veinStrikesLeft'] = doc.get('veinStrikesLeft', 0) - 1

    if _rng.random() < level * data.VEIN_CAVE_IN_PCT_PER_LEVEL:
        dmg = level * data.VEIN_CAVE_IN_DMG_PER_LEVEL
        doc['hp'] = max(1, doc['hp'] - dmg)
        doc['veinStrikesLeft'] = 0
        _save_vein(table, sid, region, 0)
        _event(table, sid, 'vein',
               f"{doc['username']} triggered a cave-in at level {level} of the "
               'crystal vein — the shaft collapses to the surface!',
               actor=doc['userId'])
        return {'collapsed': True, 'hp': -dmg, 'depth': 0,
                'text': f'CAVE-IN at level {level}! You take {dmg} damage and '
                        'the shaft slumps back to the surface.'}

    spores = 1 + level
    doc['spores'] = doc.get('spores', 0) + spores
    found = None
    item = _vein_item(level)
    if item:
        found = _award_dig_loot(doc, {'kind': 'item', 'item': item})

    if level >= data.VEIN_MAX_DEPTH:
        doc['spores'] += data.VEIN_HEARTSTONE_SPORES
        heart = _award_dig_loot(doc, {'kind': 'item',
                                      'item': _rng.choice(data.VEIN_RARE_ITEMS)})
        _save_vein(table, sid, region, 0)
        _event(table, sid, 'vein',
               f"{doc['username']} pried the Heartstone from the crystal vein "
               f'(+{data.VEIN_HEARTSTONE_SPORES} Spores)! The shaft refills.',
               actor=doc['userId'])
        return {'depth': 0, 'heartstone': True, 'spores': spores, 'found': heart,
                'text': f'Level {level}: +{spores} Spores — and beneath it, THE '
                        f'HEARTSTONE! +{data.VEIN_HEARTSTONE_SPORES} Spores and a '
                        'prize. The shaft rumbles full again.'}

    _save_vein(table, sid, region, level)
    return {'depth': level, 'spores': spores, 'found': found,
            'text': f'You cut into level {level}: +{spores} Spores.'
                    + _vein_found_text(found)}


# ── The Guildvault ────────────────────────────────────────────────────────────

def _fresh_vault():
    return {'combo': _rng.sample(data.VAULT_SIGILS, data.VAULT_SLOTS),
            'pot': data.VAULT_POT_SEED, 'history': []}


def _vault_lock_rec(table, sid, region):
    """Shared lock record, lazily rolled + persisted on first use."""
    rec = _get(table, _season_pk(sid), f'VAULT#{region}')
    if rec and rec.get('combo'):
        return rec
    rec = _fresh_vault()
    _save_vault(table, sid, region, rec)
    return rec


def _save_vault(table, sid, region, rec):
    table.put_item(Item={'pk': _season_pk(sid), 'sk': f'VAULT#{region}',
                         'combo': rec['combo'], 'pot': rec['pot'],
                         'history': rec['history']})


def _vault_view(rec):
    """Public view — the combination NEVER leaves the server."""
    if not rec:
        return {'pot': data.VAULT_POT_SEED, 'history': []}
    return {'pot': rec['pot'], 'history': rec.get('history') or []}


def _strike(table, sid, doc, payload):
    """A deliberate swing at the vein. All strikes this visit are optional —
    landing no longer auto-swings."""
    nodes = _season_map(table, sid)
    node = doc.get('position')
    if nodes.get(node, {}).get('type') != 'crystal_vein':
        return _err('You are not at a crystal vein.', 409)
    if doc.get('veinStrikesLeft', 0) < 1:
        return _err('Out of strikes — come back next time you land here.', 409)
    res = _vein_strike_once(table, sid, doc)
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    return _ok(doc, node=node, strikesLeft=doc.get('veinStrikesLeft', 0), **res)


def _vault_guess(table, sid, doc, payload):
    nodes = _season_map(table, sid)
    node = doc.get('position')
    if nodes.get(node, {}).get('type') != 'vault_lock':
        return _err('You are not at the Guildvault.', 409)
    left = doc.get('vaultPicksLeft')
    if left is None:
        left = data.VAULT_PICKS_PER_VISIT
    if left <= 0:
        return _err('Your picks are blunted — come back next time you land '
                    'here.', 409)
    guess = payload.get('guess')
    if (not isinstance(guess, list) or len(guess) != data.VAULT_SLOTS
            or len(set(guess)) != data.VAULT_SLOTS
            or any(s not in data.VAULT_SIGILS for s in guess)):
        return _err(f'Pick {data.VAULT_SLOTS} different sigils.')

    region = nodes[node]['region']
    rec = _vault_lock_rec(table, sid, region)
    combo = rec['combo']
    exact = sum(1 for g, c in zip(guess, combo) if g == c)
    near = len(set(guess) & set(combo)) - exact
    doc['vaultPicksLeft'] = left - 1
    cracked = exact == data.VAULT_SLOTS
    found = None

    if cracked:
        pot = rec['pot']
        doc['spores'] = doc.get('spores', 0) + pot
        found = _award_dig_loot(doc, {'kind': 'item',
                                      'item': _rng.choice(data.VEIN_RARE_ITEMS)})
        rec = _fresh_vault()
        text = (f'CLICK. CLICK. CLUNK — the Guildvault swings open! You haul '
                f'out {pot} Spores. Fresh tumblers clatter into place behind '
                'you.')
    else:
        rec['pot'] += data.VAULT_POT_PER_FAIL
        rec.setdefault('history', []).append(
            {'user': doc.get('username', '?'), 'guess': guess,
             'exact': exact, 'near': near, 'at': _now()})
        pot = rec['pot']
        text = (f'The lock holds: {exact} placed, {near} misplaced. Your '
                f'attempt is chalked on the wall; the pot swells to {pot} '
                'Spores.')

    conflict = _save_or_conflict(table, doc)   # guard the player write first
    if conflict:
        return conflict
    _save_vault(table, sid, region, rec)
    if cracked:
        _event(table, sid, 'vault_lock',
               f"{doc['username']} cracked the Guildvault and made off with "
               f'{pot} Spores! Fresh tumblers, fresh pot.', actor=doc['userId'])
    return _ok(doc, node=node, vault=_vault_view(rec),
               picksLeft=doc['vaultPicksLeft'],
               guess={'exact': exact, 'near': near, 'cracked': cracked,
                      'pot': pot, 'found': found},
               text=text)


def _use_item(table, sid, doc, payload):
    nodes = _season_map(table, sid)
    item = payload.get('item')
    bag = doc.get('bag') or []
    if item not in bag:
        return _err('Not in your bag.', 409)
    if item == 'healing_moss':
        eff = engine.effective_stats(doc)
        heal = round(eff['maxHp'] * 0.5)
        doc['hp'] = min(eff['maxHp'], doc['hp'] + heal)
        bag.remove(item)
        text = f'The moss knits you back together (+{heal} HP).'
    elif item == 'loaded_die':
        value = payload.get('value')
        if not isinstance(value, int) or not 1 <= value <= 6:
            return _err('Pick a value 1–6.')
        if doc.get('pendingMove'):
            return _err('Resolve your current move first.', 409)
        doc['pendingLoadedDie'] = value
        bag.remove(item)
        text = f'You palm the loaded die. Your next roll will be a {value}.'
    elif item == 'snare':
        node = doc['position']
        if nodes[node]['type'] in ('gate', 'boss'):
            return _err('You cannot snare this hallowed ground.', 409)
        existing = _get(table, _season_pk(sid), f'SPACE#{node}')
        if existing and existing.get('ownerId'):
            return _err('Disturbed ground — a snare is already set here.', 409)
        pile = existing.get('pile', 0) if existing else 0
        table.put_item(Item={'pk': _season_pk(sid), 'sk': f'SPACE#{node}',
                             'ownerId': doc['userId'],
                             'ownerName': doc.get('username'), 'pile': pile})
        bag.remove(item)
        text = 'You bury the snare beneath the mulch and cackle quietly.'
    elif item == 'smoke_spore':
        return _err('Smoke Spores trigger on their own when a flee fails.', 409)
    elif data.CONSUMABLES.get(item, {}).get('combat'):
        return _err('Save that for a fight — it only works mid-battle.', 409)
    else:
        return _err('Unknown item.')
    doc['bag'] = bag
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    return _ok(doc, text=text)


def _drop_item(table, sid, doc, payload):
    """Toss one consumable from the bag — the pure-discard counterpart to the
    Trading Post's leave-one-take-one. Removes a single instance by id."""
    item = payload.get('item')
    bag = doc.get('bag') or []
    if item not in bag:
        return _err('Not in your bag.', 409)
    bag.remove(item)
    doc['bag'] = bag
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    name = data.CONSUMABLES.get(item, {}).get('name', 'item')
    return _ok(doc, text=f'You toss the {name} into the mulch.')


def _shrine(table, sid, doc, payload):
    nodes = _season_map(table, sid)
    if nodes.get(doc.get('position'), {}).get('type') != 'shrine':
        return _err('You are not at a shrine.', 409)
    choice = payload.get('choice')
    eff = engine.effective_stats(doc)
    if choice in ('atk', 'def', 'spd', 'heal'):
        if doc.get('spores', 0) < data.SHRINE_BLESSING_COST:
            return _err('The shrine demands 15 Spores.', 409)
        doc['spores'] -= data.SHRINE_BLESSING_COST
        if choice == 'heal':
            doc['hp'] = eff['maxHp']
            text = 'Candlelight seals your wounds. Fully healed.'
        else:
            doc[choice] += 1
            text = f'The swarm blesses you: +1 {choice.upper()} for the night.'
    else:
        return _err('Choose a blessing: atk, def, spd, or heal.')
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    return _ok(doc, text=text)


def _warp(table, sid, doc, payload):
    nodes = _season_map(table, sid)
    node = doc.get('position')
    if nodes.get(node, {}).get('type') != 'warp':
        return _err('You are not on a warp mushroom.', 409)
    to = payload.get('to')
    if to not in data.WARP_NODES or to == node:
        return _err('Pick another warp mushroom.')
    doc['position'] = to
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    return _ok(doc, text='Spores swallow you… and spit you out across the Undercity.')


def _gamble(table, sid, doc, payload):
    nodes = _season_map(table, sid)
    if nodes.get(doc.get('position'), {}).get('type') != 'ossuary':
        return _err('You are not at the Casino.', 409)
    bet = payload.get('bet')
    call = payload.get('call')
    if not isinstance(bet, int) or bet < 1 or bet > data.OSSUARY_MAX_BET:
        return _err(f'Bet 1–{data.OSSUARY_MAX_BET} Spores.')
    if bet > doc.get('spores', 0):
        return _err('Not enough Spores.', 409)
    if call not in ('high', 'low'):
        return _err('Call high (4–6) or low (1–3).')
    # Three rolls per visit. Missing key = a player already parked here before
    # this rule existed — grandfather them a fresh set.
    left = doc.get('ossuaryRollsLeft')
    if left is None:
        left = data.OSSUARY_ROLLS_PER_VISIT
    if left <= 0:
        return _err("You've had your three rolls. The bouncer won't seat you "
                    'again until you land at the Casino anew.', 409)
    die = _rng.randint(1, 6)
    won = (die >= 4) == (call == 'high')
    doc['spores'] += bet if won else -bet
    left -= 1
    doc['ossuaryRollsLeft'] = left
    tail = (f' {left} roll{"s" if left != 1 else ""} left.' if left > 0
            else ' That was your last roll — the table is closed.')
    text = (f'The die shows {die} — you win {bet} Spores!' if won
            else f'The die shows {die} — the Casino keeps your {bet} Spores.') + tail
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    return _ok(doc, gamble={'die': die, 'won': won, 'rollsLeft': left}, text=text)


# ── Social ───────────────────────────────────────────────────────────────────

def _poke(table, sid, doc, payload):
    target_id = payload.get('targetUserId')
    if not target_id or target_id == doc['userId']:
        return _err('Poke someone else.')
    target = _get_player(table, sid, target_id)
    if not target:
        return _err('Target not found.', 404)
    # Per-target cooldown: can't re-poke the same creature until it expires.
    cds = doc.get('pokeCooldowns') or {}
    until = cds.get(target_id)
    if until and until > _now():
        wait = int((datetime.fromisoformat(until) - datetime.utcnow()).total_seconds() // 60) + 1
        return _err(f'You already poked {target["username"]} — {wait} min left.', 429)
    granted = 0
    if target.get('pokesReceived', 0) < data.POKE_ROLL_LIMIT:
        granted, _lost = _add_rolls(target, 1)
    target['pokesReceived'] = target.get('pokesReceived', 0) + 1
    if not _put_player(table, target):
        return _err('The plaza is crowded — try again.', 409)
    cds[target_id] = (datetime.utcnow() + timedelta(minutes=data.POKE_COOLDOWN_MIN)).isoformat(timespec='seconds')
    doc['pokeCooldowns'] = cds
    _put_player(table, doc)
    _event(table, sid, 'poke',
           f"{doc['username']} poked {target['username']}'s {_creature_label(target)}"
           + (f' (+{granted} roll!)' if granted else ''),
           actor=doc['userId'])
    return _ok(doc, granted=granted)


def _customize(table, sid, doc, payload):
    perm = _get_perm(table, doc['userId'])
    hat = payload.get('hat')
    if hat is not None and hat != '' and hat not in perm['hats']:
        return _err('You do not own that hat.', 409)
    paint = payload.get('paint')
    if paint:
        owned_hues = {p['hue'] for p in data.PAINTS if p['id'] in perm['paints']}
        for region in ('body', 'belly', 'stripes'):
            hue = paint.get(region)
            if hue is not None and int(hue) not in owned_hues:
                return _err('You do not own that paint.', 409)
        doc['paint'] = {r: int(paint.get(r, doc['paint'].get(r, 130)))
                        for r in ('body', 'belly', 'stripes')}
    effect = payload.get('effect')
    if effect is not None:
        if effect == '':
            doc['effect'] = None
        elif effect not in perm['effects']:
            return _err('You do not own that special paint.', 409)
        else:
            doc['effect'] = effect
    doc['hat'] = hat or None
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    return _ok(doc)


def _set_status(table, sid, doc, payload):
    doc['status'] = _normalize_status(payload.get('status', ''))
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    return _ok(doc)
