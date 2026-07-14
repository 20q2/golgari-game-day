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
from datetime import datetime, timedelta
from decimal import Decimal

from botocore.exceptions import ClientError

import undercity_data as data
import undercity_engine as engine

_rng = random.Random()

META_PK = 'UNDERCITY#META'
HOF_PK = 'UNDERCITY#HALLOFFAME'


# ── Small helpers ────────────────────────────────────────────────────────────

def _now():
    return datetime.utcnow().isoformat(timespec='seconds')


def _now_ms():
    return datetime.utcnow().isoformat(timespec='milliseconds')


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


def _get(table, pk, sk):
    resp = table.get_item(Key={'pk': pk, 'sk': sk})
    return _clean(resp.get('Item')) if resp.get('Item') else None


def _active_season(table):
    meta = _get(table, META_PK, 'CURRENT')
    if not meta:
        return None, None
    sid = meta['seasonId']
    config = _get(table, _season_pk(sid), 'CONFIG')
    return sid, config


def _get_player(table, sid, user_id):
    doc = _get(table, _season_pk(sid), f'PLAYER#{user_id}')
    if doc:
        # Backward-compat: the fourth species was renamed spore -> zombie.
        if doc.get('species') == 'spore':
            doc['species'] = 'zombie'
        if doc.get('form') == 'spore':
            doc['form'] = 'zombie'
    return doc


def _open_barriers(table, sid):
    """Barrier ids broken open this season — shared by every player."""
    item = _get(table, _season_pk(sid), 'BARRIERS')
    return set((item or {}).get('open') or [])


def _closed_barriers(table, sid):
    return frozenset(set(data.BARRIER_GUARDIANS) - _open_barriers(table, sid))


def _open_barrier(table, sid, barrier_id):
    opened = _open_barriers(table, sid)
    opened.add(barrier_id)
    table.put_item(Item={'pk': _season_pk(sid), 'sk': 'BARRIERS',
                         'open': sorted(opened)})


def _put_player(table, doc):
    """Optimistic write: bumps ver, fails (409) if someone wrote in between."""
    expected = doc.get('ver', 0)
    doc = dict(doc)
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
               'nights': 0, 'lifetimePvpWins': 0, 'apexReached': 0}
    for p in data.DEFAULT_PAINTS:
        if p not in doc['paints']:
            doc['paints'].append(p)
    return doc


def _passives(doc):
    return frozenset(doc.get('passives') or [])


def _riders(doc):
    """Gear rider tags across all equipped slots (fang/carapace/charm)."""
    out = set()
    for gid in (doc.get('gear') or {}).values():
        rider = data.GEAR.get(gid, {}).get('rider')
        if rider:
            out.add(rider)
    return frozenset(out)


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
        riders=_riders(doc), buffs=_active_buff_kinds(doc),
        has_smoke_spore='smoke_spore' in (doc.get('bag') or []),
        flee_bonus=(10 if doc.get('homeBiome') == 'cavern' else 0)
                   + (15 if any(b.get('kind') == 'glowveil'
                                for b in (doc.get('buffs') or [])) else 0))


# ── Battle-record serde (Plan 2 interactive combat) ──────────────────────────

def _bt_snapshot(c):
    """Serialize a Combatant to a DynamoDB-safe dict (sets -> sorted lists)."""
    return {
        'name': c.name, 'hp': int(c.hp), 'maxHp': int(c.max_hp),
        'atk': int(c.atk), 'dfn': int(c.dfn), 'spd': int(c.spd),
        'passives': sorted(c.passives), 'riders': sorted(c.riders),
        'buffs': sorted(c.buffs), 'flee_bonus': int(c.flee_bonus),
        'has_smoke_spore': bool(c.has_smoke_spore),
        'rot_stacks': int(c.rot_stacks), 'first_win_used': bool(c.first_win_used),
        'dmg_penalty': int(c.dmg_penalty), 'reveal_next': bool(c.reveal_next),
    }


def _bt_to_combatant(s):
    c = engine.Combatant(
        name=s['name'], hp=int(s['hp']), max_hp=int(s['maxHp']),
        atk=int(s['atk']), dfn=int(s['dfn']), spd=int(s['spd']),
        passives=frozenset(s.get('passives') or []),
        riders=frozenset(s.get('riders') or []),
        buffs=frozenset(s.get('buffs') or []),
        flee_bonus=int(s.get('flee_bonus', 0)),
        has_smoke_spore=bool(s.get('has_smoke_spore', False)))
    c.rot_stacks = int(s.get('rot_stacks', 0))
    c.first_win_used = bool(s.get('first_win_used', False))
    c.dmg_penalty = int(s.get('dmg_penalty', 0))
    c.reveal_next = bool(s.get('reveal_next', False))
    return c


def _bt_store(c, rec_side):
    """Write a resolved Combatant's mutable state back into a snapshot dict."""
    rec_side['hp'] = int(max(0, c.hp))
    rec_side['rot_stacks'] = int(c.rot_stacks)
    rec_side['dmg_penalty'] = int(c.dmg_penalty)
    rec_side['first_win_used'] = bool(c.first_win_used)
    rec_side['reveal_next'] = bool(c.reveal_next)


def _npc_combatant(npc):
    return engine.Combatant(
        name=npc['name'], hp=npc['hp'], max_hp=npc.get('maxHp', npc['hp']),
        atk=npc['atk'], dfn=npc['def'], spd=npc['spd'],
        passives=frozenset(npc.get('passives') or []))


def _telegraph_next(rec):
    """Pick the npc's next true stance from personality, telegraph it (maybe a
    bluff), store both on the record, and return the shown stance."""
    personality = rec['npc'].get('personality', data.NPC_DEFAULT_PERSONALITY)
    bluff = float(rec['npc'].get('bluff', data.NPC_DEFAULT_BLUFF))
    actual = engine.pick_stance(personality, _rng)
    shown = engine.telegraph(actual, bluff, _rng)
    rec['npcActual'] = actual
    rec['npcShown'] = shown
    rec['peeked'] = False
    return shown


def _start_battle(table, sid, doc, kind, npc, node=None, ctx=None):
    """Snapshot combatants into doc['battle'], telegraph round 1, return the
    battle_start space event. Player buffs/stats freeze here; rewards resolve
    in _finish_battle when the fight ends."""
    player_c = _combatant(doc)
    if kind in ('wild', 'elite') and doc.get('homeBiome') == 'bone':
        player_c.dfn += 2  # Marrowborn hatch perk vs wilds (preserved)
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
    }
    doc['battle'] = rec
    shown = _telegraph_next(rec)
    return {'type': 'battle_start', 'kind': kind,
            'npc': {'name': npc['name'], 'id': npc.get('id'),
                    'hp': npc_snap['hp'], 'maxHp': npc_snap['maxHp'],
                    'atk': npc_snap['atk'], 'def': npc_snap['dfn'],
                    'spd': npc_snap['spd']},
            'telegraph': shown, 'round': 1,
            'text': f'A {npc["name"]} bars your path!'}


def _form_name(doc):
    return data.ALL_FORMS.get(doc.get('form', ''), {}).get('name', 'creature')


def _creature_label(doc):
    """Player-facing creature name: the hatch-chosen name, else the form name."""
    return doc.get('creatureName') or _form_name(doc)


ONE_BATTLE_BUFFS = ('rot_surge', 'bone_chill', 'glowveil', 'harden_shell', 'weaken_hex')


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


def _grant_cosmetic(table, doc, perm, kind):
    """Drop a random hat/paint into the permanent wardrobe. Dupes → Spores."""
    if kind == 'hat':
        weights = [data.HAT_RARITY_WEIGHTS[h['rarity']] for h in data.HATS]
        pick = _rng.choices(data.HATS, weights=weights, k=1)[0]
        owned = perm['hats']
    else:
        pick = _rng.choice(data.PAINTS)
        owned = perm['paints']
    if pick['id'] in owned:
        doc['spores'] = doc.get('spores', 0) + data.DUPLICATE_SPORES
        return pick, True
    owned.append(pick['id'])
    table.put_item(Item=perm)
    return pick, False


def _give_consumable(doc):
    """Random consumable into the bag; falls back to Spores when full."""
    if len(doc.get('bag') or []) >= data.BAG_SIZE:
        doc['spores'] = doc.get('spores', 0) + 5
        return None
    item = _rng.choice(list(data.CONSUMABLES.keys()))
    doc.setdefault('bag', []).append(item)
    return item


def _grant_grimoire(doc, gid):
    """Add a book to the permanent collection; the first one auto-opens.
    Duplicates convert to Spores. Returns True when the book was new."""
    owned = doc.setdefault('grimoires', [])
    if gid in owned:
        doc['spores'] = doc.get('spores', 0) + data.GRIMOIRE_DUPLICATE_SPORES
        return False
    owned.append(gid)
    if not doc.get('equippedGrimoire'):
        doc['equippedGrimoire'] = gid
    return True


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
    home_biome = doc.get('homeBiome')
    home_gate = data.HOME_GATES.get(home_biome, data.GATE_NODE)
    doc['position'] = home_gate  # provisional; a respawn choice may relocate
    doc['hp'] = max(1, round(engine.effective_stats(doc)['maxHp'] * data.COMPOST_RESPAWN_PCT))
    doc['shieldUntil'] = (now + timedelta(minutes=data.COMPOST_SHIELD_MIN)).isoformat(timespec='seconds')
    doc['composts'] = doc.get('composts', 0) + 1
    doc['pendingMove'] = None

    # Offer a respawn choice when the last biome you stood in differs from home,
    # else just wake at the home gate. Options carry friendly labels for the UI.
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

def handle_state(table, query_params):
    user_id = (query_params or {}).get('userId') or ''
    sid, config = _active_season(table)

    if not sid or not config:
        return 200, {'season': None, 'you': None, 'players': [], 'snares': [],
                     'events': [], 'result': None, 'hallOfFame': _hall_of_fame(table)}

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

    players, you, snares, result, posts, sites = [], None, [], None, {}, {}
    veins, vaults = {}, {}
    now = _now()
    for item in items:
        if item['sk'].startswith('PLAYER#'):
            engine.regen_hp(item, now)  # display-only; persisted on next action
            _expire_buffs(item)
            _prune_cooldowns(item)
            players.append(_public_player(item))
            if item['userId'] == user_id:
                you = {k: v for k, v in item.items() if k not in ('pk', 'sk')}
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
        elif item['sk'] == 'RESULT':
            result = {k: v for k, v in item.items() if k not in ('pk', 'sk')}

    # Show a display-seeded stock for any post nobody has traded at yet, so the
    # exchange renders from turn one without a write on read.
    for nid, n in data.MAP_NODES.items():
        if n['type'] == 'trading_post' and nid not in posts:
            posts[nid] = _seed_stock()

    # Masked dig-site views for every excavation node (empty/covered until dug).
    excavations = {nid: _dig_view(sites.get(nid))
                   for nid, n in data.MAP_NODES.items() if n['type'] == 'excavation'}

    # Display-seed untouched veins/vaults so the map renders their facilities
    # from turn one without a write on read.
    for n in data.MAP_NODES.values():
        if n['type'] == 'crystal_vein':
            veins.setdefault(n['region'], {'depth': 0})
        elif n['type'] == 'vault_lock':
            vaults.setdefault(n['region'], _vault_view(None))

    out = {
        'season': {'seasonId': sid, 'status': config.get('status'),
                   'startedAt': config.get('startedAt'),
                   'bossPhase': bool(config.get('bossPhase'))},
        'you': you,
        'players': players,
        'snares': snares,
        'tradingPosts': posts,
        'excavations': excavations,
        'veins': veins,
        'vaults': vaults,
        'barriersOpen': sorted(_open_barriers(table, sid)),
        'boss': {'hp': _boss_hp(table, sid), 'maxHp': data.ROT_SOVEREIGN['hp']},
        'events': [{k: v for k, v in e.items() if k not in ('pk', 'sk')} for e in events],
        'result': result if config.get('status') == 'ended' else None,
    }
    if user_id:
        perm = _get_perm(table, user_id)
        out['wardrobe'] = {'hats': perm['hats'], 'paints': perm['paints'],
                           'seals': perm['seals'], 'nights': perm.get('nights', 0)}
    if config.get('status') == 'ended':
        out['hallOfFame'] = _hall_of_fame(table)
    return 200, out


def _public_player(p):
    return {
        'userId': p['userId'], 'username': p.get('username', '?'),
        'species': p.get('species'), 'form': p.get('form'), 'tier': p.get('tier', 1),
        'formName': _form_name(p),
        'creatureName': p.get('creatureName') or _form_name(p),
        'level': p.get('level', 1), 'hp': p.get('hp', 0),
        'maxHp': engine.effective_stats(p)['maxHp'],
        'position': p.get('position'), 'stance': p.get('stance', 'fight'),
        'shieldUntil': p.get('shieldUntil'),
        'spores': p.get('spores', 0), 'rolls': p.get('rolls', 0),
        'pvpWins': p.get('pvpWins', 0), 'wildWins': p.get('wildWins', 0),
        'composts': p.get('composts', 0),
        'paint': p.get('paint'), 'hat': p.get('hat'),
        'renown': data.compute_renown(p),
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

    if atype == 'join':
        return _join(table, sid, user_id, username, payload)

    doc = _get_player(table, sid, user_id)
    if not doc:
        return _err('Join the season first.', 409)
    engine.regen_hp(doc, _now())
    _expire_buffs(doc)
    _prune_cooldowns(doc)

    handlers = {
        'claim': _claim, 'roll': _roll, 'move': _move, 'battle': _battle,
        'combat-round': _combat_round, 'combat-peek': _combat_peek,
        'combat-flee': _combat_flee,
        'set-stance': _set_stance, 'spend-stat': _spend_stat, 'evolve': _evolve,
        'buy': _buy, 'use-item': _use_item, 'shrine': _shrine, 'warp': _warp,
        'gamble': _gamble, 'poke': _poke, 'customize': _customize,
        'attack-boss': _attack_boss, 'trade': _trade, 'dig': _dig, 'strike': _strike,
        'vault-guess': _vault_guess, 'respawn': _respawn,
        'cast': _cast,
        'equip-grimoire': _equip_grimoire, 'ack-events': _ack_events,
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
    'set-stance', 'spend-stat', 'customize', 'ack-events',
})


def _ok(doc, **extra):
    you = {k: v for k, v in doc.items() if k not in ('pk', 'sk')}
    return 200, {'ok': True, 'you': you, **extra}


def _save_or_conflict(table, doc):
    if not _put_player(table, doc):
        return _err('Someone moved your creature first — refreshing.', 409)
    return None


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
            'hat': p.get('hat'),
        })
        # Lifetime stats onto the permanent doc.
        perm = _get_perm(table, p['userId'])
        perm['lifetimePvpWins'] = perm.get('lifetimePvpWins', 0) + p.get('pvpWins', 0)
        if p.get('tier') == 3:
            perm['apexReached'] = perm.get('apexReached', 0) + 1
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

    perm = _get_perm(table, user_id)
    seals_before = perm.get('seals', 0)
    perm['seals'] = seals_before + 1
    perm['nights'] = perm.get('nights', 0) + 1
    table.put_item(Item=perm)

    s = data.STARTERS[starter]
    body_hue = 130
    egg = payload.get('eggHue')
    if seals_before >= 1 and isinstance(egg, (int, float)):
        body_hue = int(egg) % 360
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
        'position': data.HOME_GATES[home],
        'homeBiome': home,
        'rolls': data.JOIN_ROLLS + min(seals_before, data.SEAL_BONUS_CAP),
        'spores': 15 if home == 'city' else 0,  # City Rat hatch perk
        'bag': [], 'gear': {}, 'stance': 'fight',
        'pendingMove': None, 'buffs': [],
        'grimoires': [], 'equippedGrimoire': None,
        'spellCooldowns': {}, 'awayEvents': [],
        'lastFinishedClaim': None, 'taughtClaims': 0, 'pokesReceived': 0,
        'pvpWins': 0, 'wildWins': 0, 'composts': 0, 'bossDamage': 0,
        'paint': {'body': body_hue, 'belly': 50, 'stripes': body_hue},
        'hat': None, 'joinedAt': _now(), 'ver': 0,
    }
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    biome = data.BIOMES[home]
    named = f" named {doc['creatureName']}" if doc['creatureName'] != s['name'] else ''
    _event(table, sid, 'hatch',
           f"{doc['username']}'s egg cracks open in {biome['name']} — "
           f"a {s['name']}{named} skitters out! ({biome['perkName']}: {biome['perkBlurb']})",
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
    if not data.UNLIMITED_ROLLS and doc.get('rolls', 0) < 1:
        return _err('No rolls banked. Finish a board game to earn more!', 409)
    if doc.get('pendingMove'):
        return _err('You already rolled — pick a destination.', 409)
    # Rolling without choosing a respawn gate accepts the provisional home gate.
    doc.pop('pendingRespawn', None)

    # Dev convenience (only while rolls are unlimited): the client may name the
    # face it wants instead of rolling randomly. Skips loaded-die / vines so the
    # picked number is exactly what moves you.
    picked = payload.get('value') if payload else None
    picked = int(picked) if isinstance(picked, (int, float)) and 1 <= picked <= 6 else None

    value = None
    if data.UNLIMITED_ROLLS and picked is not None:
        value = picked
    elif doc.get('pendingLoadedDie'):
        value = int(doc.pop('pendingLoadedDie'))
    else:
        value = _rng.randint(1, 6)

    vines = [b for b in (doc.get('buffs') or []) if b.get('kind') == 'vines']
    if vines and picked is None:
        value = (value + 1) // 2
        doc['buffs'] = [b for b in doc['buffs'] if b.get('kind') != 'vines']

    dests = engine.legal_destinations(data.MAP_NODES, doc['position'], value,
                                      _closed_barriers(table, sid))
    if not dests:
        # Dead-end corner case: refund the roll, let them try again.
        return _err('The tunnels shift — no path fits that roll. Try again.', 409)
    if not data.UNLIMITED_ROLLS:
        doc['rolls'] -= 1
    doc['pendingMove'] = {'value': value, 'dests': sorted(dests)}
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    return _ok(doc, roll={'value': value, 'destinations': sorted(dests)})


def _move(table, sid, doc, payload):
    pm = doc.get('pendingMove')
    to = payload.get('to')
    if not pm:
        return _err('Roll first.', 409)
    if to not in pm['dests']:
        return _err('That space is not reachable with this roll.', 409)
    doc['pendingMove'] = None
    prev = doc['position']
    doc['position'] = to

    space_event = _resolve_space(table, sid, doc, to, prev)

    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict

    occupants = _occupants(table, sid, to, doc['userId'])
    return _ok(doc, spaceEvent=space_event, occupants=occupants)


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


def _resolve_space(table, sid, doc, node, prev):
    """Apply the landing event for `node`, mutating doc. Returns event dict."""
    ntype = data.MAP_NODES[node]['type']

    # Remember the last home-biome you stood in — a death here (or later, on the
    # isle/in the depths) offers this biome's gate as a respawn option. Set
    # before any battle/compost resolves so it reflects where you actually died.
    region = data.MAP_NODES[node].get('region')
    if region in data.BIOMES:
        doc['lastBiome'] = region

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

    if ntype == 'loot':
        if _rng.random() < 0.10:
            item = _give_consumable(doc)
            if item:
                return {'type': 'loot', 'text': f'You unearth a {data.CONSUMABLES[item]["name"]}!',
                        'item': item}
        amount = _rng.choice([8, 8, 9, 9, 10, 10, 11, 12, 13, 15])
        if 'scrounger' in _passives(doc):
            amount += 2
        if doc.get('homeBiome') == 'garden':
            amount += 2  # Composter hatch perk
        doc['spores'] = doc.get('spores', 0) + amount
        return {'type': 'loot', 'text': f'You forage {amount} Spores from the rot.', 'spores': amount}

    if ntype == 'wild':
        return _wild_battle(table, sid, doc)

    if ntype == 'elite':
        return _wild_battle(table, sid, doc, elite=True)

    if ntype == 'mystery':
        return _mystery(table, sid, doc)

    if ntype == 'hazard':
        return _hazard(table, sid, doc, node)

    if ntype == 'warp':
        if _rng.random() < 0.20:
            # Never wild-warp someone past a sealed barrier or into a POI.
            no_go = {'boss', 'barrier', 'lair', 'vault'}
            options = [n for n, nd in data.MAP_NODES.items()
                       if n != node and nd['type'] not in no_go
                       and nd.get('region') != 'ruin']
            dest = _rng.choice(options)
            doc['position'] = dest
            return {'type': 'wild_warp', 'text': 'The mushroom convulses — a WILD warp!',
                    'to': dest}
        options = [w for w in data.WARP_NODES if w != node]
        return {'type': 'warp', 'text': 'The warp mushroom hums. Step through?',
                'options': options}

    if ntype == 'gate':
        doc['hp'] = engine.effective_stats(doc)['maxHp']
        doc['hpUpdatedAt'] = _now()
        return {'type': 'gate', 'text': 'The Gate of the Swarm mends you fully.'}

    if ntype == 'boss':
        return _boss(table, sid, doc, node, prev)

    if ntype == 'shop':
        return {'type': 'shop', 'text': 'The Rot-Farm Bazaar creaks open.'}

    if ntype == 'trading_post':
        return {'type': 'trading_post', 'node': node,
                'text': 'A crooked stall of swapped oddments. Leave one, take one.',
                'stock': _trading_post_stock(table, sid, node)}

    if ntype == 'excavation':
        doc['excavationDigsLeft'] = data.EXCAVATION_DIGS_PER_VISIT
        rec = _get(table, _season_pk(sid), f'SITE#{node}')
        return {'type': 'excavation', 'node': node,
                'text': 'A patch of disturbed earth, thick with buried finds. Start digging.',
                'grid': _dig_view(rec), 'digsLeft': data.EXCAVATION_DIGS_PER_VISIT}

    if ntype == 'crystal_vein':
        # The first swing is mandatory — you landed in a mine, you swing.
        doc['veinStrikesLeft'] = data.VEIN_STRIKES_PER_VISIT
        res = _vein_strike_once(table, sid, doc)
        return {'type': 'crystal_vein', 'node': node,
                'strikesLeft': doc['veinStrikesLeft'], **res,
                'text': 'The crystal vein glitters — your pick is already '
                        'swinging. ' + res['text']}

    if ntype == 'vault_lock':
        doc['vaultPicksLeft'] = data.VAULT_PICKS_PER_VISIT
        region = data.MAP_NODES[node]['region']
        rec = _get(table, _season_pk(sid), f'VAULT#{region}')
        return {'type': 'vault_lock', 'node': node,
                'text': 'The Guildvault: six sigils, three tumblers, one fat '
                        'pot. Every botched pick is chalked on the wall for '
                        'all to read.',
                'vault': _vault_view(rec),
                'picksLeft': data.VAULT_PICKS_PER_VISIT}

    if ntype == 'shrine':
        return {'type': 'shrine', 'text': 'A shrine of candles and bone. The swarm listens.'}

    if ntype == 'ossuary':
        # Fresh landing refills the visit's dice — three rolls, then the
        # bouncer waves you off until you land here again.
        doc['ossuaryRollsLeft'] = data.OSSUARY_ROLLS_PER_VISIT
        return {'type': 'ossuary', 'text': 'The Ossuary. Dice clatter in the dark.'}

    if ntype == 'barrier':
        return _barrier(table, sid, doc, node)

    if ntype == 'lair':
        return _lair(table, sid, doc, node)

    if ntype == 'vault':
        return _vault(table, sid, doc)

    if ntype == 'cache':
        return _cache(table, sid, doc, node)

    if ntype == 'ladder':
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
    res = engine.roll_mystery(_rng, 'drift' in _passives(doc),
                              'doubling_rot' in _passives(doc))
    eff = engine.effective_stats(doc)
    if res['spores']:
        doc['spores'] = max(0, doc.get('spores', 0) + res['spores'])
    if res['xp']:
        _grant_xp(table, sid, doc, res['xp'])
    if res['hpPct']:
        doc['hp'] = max(1, doc['hp'] + round(doc['hp'] * res['hpPct']))
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
        dest = _rng.choice([n for n in data.MAP_NODES if n != data.BOSS_NODE])
        doc['position'] = dest
        res['to'] = dest
    out = {'type': 'mystery', 'roll': res['roll'], 'text': res['text']}
    if res['item']:
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
    perm = None
    if res['paint']:
        perm = _get_perm(table, doc['userId'])
        pick, dupe = _grant_cosmetic(table, doc, perm, 'paint')
        out['paint'] = pick['id']
        out['duplicate'] = dupe
    if res['hat']:
        perm = _get_perm(table, doc['userId'])
        pick, dupe = _grant_cosmetic(table, doc, perm, 'hat')
        out['hat'] = pick['id']
        out['duplicate'] = dupe
    if res['roll'] == 12:
        _event(table, sid, 'jackpot',
               f"{doc['username']} hit a JACKPOT BLOOM in the tunnels!", actor=doc['userId'])
    if res['teleport']:
        out['to'] = res['to']
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
    dmg = round(doc['hp'] * (0.075 if mire else 0.15))
    doc['hp'] = max(1, doc['hp'] - dmg)
    return {'type': 'hazard', 'text': f'A choking spore cloud! You lose {dmg} HP.', 'hp': -dmg}


def _dungeon_hazard(table, sid, doc, node, biome, mire):
    """v6 signature hazards — one per dungeon, themed to its pocket."""
    h = data.DUNGEON_HAZARDS[biome]
    out = {'type': 'hazard', 'hazardId': h['id'], 'text': h['text']}
    if h['id'] == 'webbing':
        # Reuses the vines mechanic: _roll halves and consumes it.
        doc.setdefault('buffs', []).append({'kind': 'vines'})
    elif h['id'] == 'spore_cloud':
        pocket = [nid for nid, n in data.MAP_NODES.items()
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
        dmg = 1 if mire else 3
        doc['hp'] = max(1, doc['hp'] - dmg)
        doc['spores'] = doc.get('spores', 0) + 4
        out['hp'] = -dmg
        out['spores'] = 4
    return out


# ── Battles ──────────────────────────────────────────────────────────────────

def _wild_battle(table, sid, doc, elite=False):
    """Landing on a wild/elite space STARTS an interactive battle (Plan 2)."""
    biome = data.dungeon_biome(doc.get('position', ''))
    if biome:
        spec = data.DUNGEON_NPCS[biome]          # dungeon fauna, themed per pocket
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
    npc = dict(g, personality=g.get('personality', 'turtle'),
               bluff=g.get('bluff', 0.15))
    return _start_battle(table, sid, doc, 'barrier', npc, node=node)


def _lair_state(table, sid, node):
    """Season-shared lair pool: current HP + whether the true boss has fallen."""
    rec = _get(table, _season_pk(sid), f'LAIR#{node}') or {}
    full = data.LAIR_BOSSES[node]['hp']
    return int(rec.get('hp', full)), bool(rec.get('slain', False))


def _set_lair_state(table, sid, node, hp, slain):
    table.put_item(Item={'pk': _season_pk(sid), 'sk': f'LAIR#{node}',
                         'hp': hp, 'slain': slain})


def _lair(table, sid, doc, node):
    """
    Lair bosses share one persistent HP pool per season (like Savra): wounds
    linger between challengers. The global first kill slays the TRUE boss and
    pays the major reward; it then reforms at HALF strength as the "Vestige
    of <boss>", whose kills pay the minor reward. Guild Sigils stay
    per-player — a Vestige kill still claims yours.
    """
    b = data.LAIR_BOSSES[node]
    hp_pool, slain = _lair_state(table, sid, node)
    vest_max = b['hp'] // 2
    display = f"Vestige of {b['name']}" if slain else b['name']
    npc = dict(b, hp=hp_pool, name=display, maxHp=(vest_max if slain else b['hp']),
               personality=b.get('personality', 'balanced'), bluff=b.get('bluff', 0.20))
    return _start_battle(table, sid, doc, 'lair', npc, node=node,
                         ctx={'slain': slain, 'vestMax': vest_max})


def _sigil_count(doc):
    return len([c for c in (doc.get('poiClaims') or []) if c in data.SIGIL_LAIRS])


def _boss_hp(table, sid):
    item = _get(table, _season_pk(sid), 'BOSS')
    return int((item or {}).get('hp', data.ROT_SOVEREIGN['hp']))


def _set_boss_hp(table, sid, hp):
    table.put_item(Item={'pk': _season_pk(sid), 'sk': 'BOSS', 'hp': hp})


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
    entries = engine.resolve_round(
        player_c, npc_c, stance, rec['npcActual'], rnd, _rng,
        force_winner=force_winner, double_win_for=double_win_for,
        negate_loss_for=negate_loss_for)
    rec['strikes'].extend(entries)
    _bt_store(player_c, rec['player'])
    _bt_store(npc_c, rec['npc'])

    over = player_c.hp <= 0 or npc_c.hp <= 0 or rnd >= data.MAX_ROUNDS_COMBAT
    if over:
        if npc_c.hp <= 0 and player_c.hp <= 0:
            outcome = 'attacker' if player_c.hp >= npc_c.hp else 'defender'
        elif npc_c.hp <= 0:
            outcome = 'attacker'
        elif player_c.hp <= 0:
            outcome = 'defender'
        else:
            # Both survive the round cap: a neutral timeout. This is load-bearing
            # for persistent-pool foes (lair/boss) — a non-kill must NOT award a
            # slay/sigil; the foe lingers at its current HP (see _finish_*).
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
    return _ok(doc, combat={'round': rec['round'], 'entries': entries,
                            'telegraph': shown,
                            'playerHp': rec['player']['hp'],
                            'npcHp': rec['npc']['hp'],
                            'revealNext': rec['player']['reveal_next']})


def _combat_flee(table, sid, doc, payload):
    rec = doc.get('battle')
    if not rec:
        return _err('No battle in progress.', 409)
    if rec['kind'] in ('barrier', 'boss'):
        return _err('There is no fleeing this fight.', 409)
    player_c = _bt_to_combatant(rec['player'])
    npc_c = _bt_to_combatant(rec['npc'])
    r = engine.flee_attempt(player_c, npc_c, _rng)
    if r['escaped']:
        if r['smokeSporeUsed'] and 'smoke_spore' in (doc.get('bag') or []):
            doc['bag'].remove('smoke_spore')
        doc['hp'] = player_c.hp
        doc['hpUpdatedAt'] = _now()
        doc.pop('battle', None)
        _consume_one_battle_buffs(doc)
        conflict = _save_or_conflict(table, doc)
        if conflict:
            return conflict
        return _ok(doc, combat={'fled': True, 'smokeSporeUsed': r['smokeSporeUsed']})
    # failed flee: caught off guard (-1 DEF), forfeit the round.
    _bt_store(player_c, rec['player'])
    rec['player']['dfn'] = player_c.dfn
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    return _ok(doc, combat={'fled': False, 'round': rec['round'],
                            'telegraph': rec['npcShown']})


def _finish_battle(table, sid, doc, rec, result):
    """Apply final HP, consume buffs, dispatch to the per-kind reward finisher,
    persist, and return the space-event response."""
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
    else:
        out = _finish_boss(table, sid, doc, rec, result)
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
        bounty = npc['bounty'] + (2 if 'scrounger' in _passives(doc) else 0)
        doc['spores'] = doc.get('spores', 0) + bounty
        doc['wildWins'] = doc.get('wildWins', 0) + 1
        levels = _grant_xp(table, sid, doc, npc['xp'])
        out['spores'] = bounty
        out['xp'] = npc['xp']
        if levels:
            out['levels'] = levels
        if npc['itemChance'] and _rng.random() < npc['itemChance']:
            item = _give_consumable(doc)
            if item:
                out['item'] = item
        out['text'] = f"You compost the {npc['name']}! +{bounty} Spores."
    elif result['outcome'] == 'defender':
        _grant_xp(table, sid, doc, data.XP_REWARDS['wild_loss'])
        _compost(table, sid, doc,
                 f"{doc['username']}'s {_creature_label(doc)} was composted by a "
                 f"{npc['name']}. The swarm remembers.")
        out['text'] = f"The {npc['name']} grinds you into the mulch. Back to the Gate…"
    else:
        _grant_xp(table, sid, doc, data.XP_REWARDS['timeout'])
        out['text'] = f"You and the {npc['name']} circle each other and part ways."
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
    elif result['outcome'] == 'defender':
        _grant_xp(table, sid, doc, data.XP_REWARDS['wild_loss'])
        _compost(table, sid, doc,
                 f"{doc['username']} was crushed by the {g['name']}. The barrier holds.")
        out['text'] = f"The {g['name']} hurls you back. The barrier holds…"
    else:
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
        else:
            out['text'] = (f"The {display} falls! +{reward['spores']} Spores."
                           + ('' if slain else ' A legendary first kill!'))
            if not slain:
                _event(table, sid, 'lair',
                       f"{doc['username']} slew the {b['name']} — "
                       'its Vestige stirs in the lair!', actor=doc['userId'])
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
        out['text'] = (f'SAVRA, QUEEN OF THE GOLGARI FALLS! +{reward["spores"]} Spores. '
                       'Her husk collapses — and already the rot begins to knit anew…')
        _event(table, sid, 'boss',
               f"{doc['username']} struck down SAVRA, QUEEN OF THE GOLGARI! "
               'The island trembles as she reforms.', actor=doc['userId'])
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
    sigils = _sigil_count(doc)
    config = _get(table, _season_pk(sid), 'CONFIG') or {}
    if sigils < data.SIGILS_REQUIRED and not config.get('bossPhase'):
        doc['position'] = prev if prev in data.MAP_NODES[node]['neighbors'] else 'isl_ossuary'
        missing = data.SIGILS_REQUIRED - sigils
        return {'type': 'boss_sealed',
                'text': f'The rot-wards hurl you back. The Queen demands tribute: '
                        f'{missing} more Guild Sigil{"s" if missing != 1 else ""}. '
                        f'({sigils}/{data.SIGILS_REQUIRED})'}

    boss = data.ROT_SOVEREIGN
    hp_before = _boss_hp(table, sid)
    npc = dict(boss, hp=hp_before, maxHp=boss['hp'])
    return _start_battle(table, sid, doc, 'boss', npc, node=node,
                         ctx={'hpBefore': hp_before})


def _vault(table, sid, doc):
    claims = doc.setdefault('poiClaims', [])
    if 'vault' in claims:
        return {'type': 'vault',
                'text': 'The vault stands looted bare — by you, last time.'}
    claims.append('vault')
    r = data.VAULT_REWARD
    doc['spores'] = doc.get('spores', 0) + r['spores']
    _grant_xp(table, sid, doc, r['xp'])
    _event(table, sid, 'vault',
           f"{doc['username']} plundered the Sunken Vault!", actor=doc['userId'])
    return {'type': 'vault', 'spores': r['spores'],
            'text': f"The hoard of the Erstwhile! +{r['spores']} Spores."}


def _cache(table, sid, doc, node):
    """One treasure per dungeon, first visit per player (mini-vault)."""
    claims = doc.setdefault('poiClaims', [])
    key = f'cache:{node}'
    if key in claims:
        return {'type': 'cache', 'text': 'The hollow stands empty — you plundered it already.'}
    claims.append(key)
    r = data.CACHE_REWARD
    doc['spores'] = doc.get('spores', 0) + r['spores']
    _grant_xp(table, sid, doc, r['xp'])
    biome = data.dungeon_biome(node)
    dname = data.DUNGEONS[biome]['name'] if biome else 'the depths'
    _event(table, sid, 'cache',
           f"{doc['username']} plundered the treasure of {dname}!", actor=doc['userId'])
    return {'type': 'cache', 'spores': r['spores'],
            'text': f"A hidden trove! +{r['spores']} Spores."}


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
    until = (datetime.utcnow()
             + timedelta(minutes=data.SPELLS[spell_id]['cooldownMin']))
    doc.setdefault('spellCooldowns', {})[spell_id] = until.isoformat(timespec='seconds')


def _apply_buff(doc, kind, until=None):
    """Refresh-don't-stack: strip any same-kind buff, then append."""
    doc['buffs'] = [b for b in (doc.get('buffs') or []) if b.get('kind') != kind]
    entry = {'kind': kind}
    if until:
        entry['until'] = until
    doc['buffs'].append(entry)


def _push_away_event(target, entry):
    events = target.setdefault('awayEvents', [])
    events.append(entry)
    if len(events) > data.AWAY_EVENTS_CAP:
        del events[:len(events) - data.AWAY_EVENTS_CAP]


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
        book = data.GRIMOIRES.get(doc.get('equippedGrimoire') or '')
        if not book or spell_id not in book['spells']:
            return _spell_err('That spell is not in your open grimoire.', 'not_castable')
    else:
        return _spell_err('Scrolls come later — cast from your grimoire.',
                          'not_castable', 400)
    if not _spell_cd_ready(doc, spell_id):
        return _spell_err(f"{spell['name']} is still recharging.",
                          'spell_on_cooldown', 429)

    effect = spell['effect']
    extra = {}
    if effect == 'self_buff':
        _apply_buff(doc, spell['buffKind'])
        result = {'text': f"{spell['name']} takes hold. {spell['blurb']}"}
    elif effect == 'self_heal':
        eff = engine.effective_stats(doc)
        heal = max(0, min(spell['power'], eff['maxHp'] - doc['hp']))
        doc['hp'] += heal
        result = {'text': f'Torn flesh knits closed (+{heal} HP).', 'hp': heal}
    elif effect in ('field_damage', 'field_curse'):
        out = _cast_at_player(table, sid, doc, spell_id, spell, payload.get('target'))
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
        value = payload.get('value')
        if not isinstance(value, int) or not 1 <= value <= 6:
            return _err('Pick a value 1–6.')
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

    _start_spell_cooldown(doc, spell_id)
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    return _ok(doc, cast={'spellId': spell_id, 'effect': effect, **result}, **extra)


def _cast_at_player(table, sid, doc, spell_id, spell, target_id):
    """Field damage/curse at a rival. Returns a cast-result dict, or an error
    tuple (in which case the caster's cooldown never starts)."""
    if not target_id or target_id == doc['userId']:
        return _spell_err('Pick a target.', 'invalid_target', 400)
    target = _get_player(table, sid, target_id)
    if not target:
        return _spell_err('Target not found.', 'invalid_target', 404)
    if _shielded(target):
        return _spell_err('They are protected by a Compost Shield.', 'target_shielded')
    dist = engine.board_distance(data.MAP_NODES, doc['position'],
                                 target['position'], spell['range'],
                                 _closed_barriers(table, sid))
    if dist is None:
        return _spell_err(f"They are beyond the spell's reach "
                          f"({spell['range']} spaces).", 'out_of_range')

    caster_spd = engine.effective_stats(doc)['spd']

    def apply(t):
        engine.regen_hp(t, _now())
        _expire_buffs(t)
        chance = engine.spell_dodge_chance(caster_spd, engine.effective_stats(t)['spd'])
        dodged = _rng.random() * 100 < chance
        dmg = 0
        if not dodged:
            if spell['effect'] == 'field_damage':
                dmg = spell['power']
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
    if to not in data.MAP_NODES or to == doc['position']:
        return _spell_err('No such tunnel to blink to.', 'invalid_target', 400)
    dist = engine.board_distance(data.MAP_NODES, doc['position'], to,
                                 spell['range'], _closed_barriers(table, sid))
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
        new_hp = max(1, hp - spell['power'])
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
        hp, slain = _lair_state(table, sid, target)
        new_hp = max(1, hp - spell['power'])
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


def _equip_grimoire(table, sid, doc, payload):
    gid = payload.get('grimoireId') or None
    if gid and gid not in (doc.get('grimoires') or []):
        return _err('You do not own that grimoire.', 409)
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
        return _err('Cannot spend a point there (max +1 per stat per level).', 409)
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
    node = doc.get('position')
    if data.MAP_NODES.get(node, {}).get('type') != 'shop':
        return _err('You are not at a shop.', 409)
    item_id = payload.get('itemId')

    if item_id in data.GEAR:
        g = data.GEAR[item_id]
        cost = g['cost']
        old_id = (doc.get('gear') or {}).get(g['slot'])
        refund = int(data.GEAR[old_id]['cost'] * data.GEAR_SELL_BACK) if old_id else 0
        if doc.get('spores', 0) + refund < cost:
            return _err('Not enough Spores.', 409)
        doc['spores'] = doc.get('spores', 0) + refund - cost
        doc.setdefault('gear', {})[g['slot']] = item_id
        # Troll Hide etc. can raise effective max HP; clamp is handled on damage.
        text = f"Bought {g['name']}" + (f' (traded in for {refund})' if refund else '')
    elif item_id in data.CONSUMABLES:
        c = data.CONSUMABLES[item_id]
        if len(doc.get('bag') or []) >= data.BAG_SIZE:
            return _err('Your bag is full (3 slots).', 409)
        if doc.get('spores', 0) < c['cost']:
            return _err('Not enough Spores.', 409)
        doc['spores'] -= c['cost']
        doc.setdefault('bag', []).append(item_id)
        text = f"Bought {c['name']}"
    elif item_id in data.GRIMOIRES:
        g = data.GRIMOIRES[item_id]
        if g['tier'] != 1:
            return _err('The bazaar does not stock that tome.', 409)
        if item_id in (doc.get('grimoires') or []):
            return _err('You already own that grimoire.', 409)
        if doc.get('spores', 0) < g['cost']:
            return _err('Not enough Spores.', 409)
        doc['spores'] -= g['cost']
        _grant_grimoire(doc, item_id)
        text = f"Bought {g['name']}"
    else:
        return _err('Unknown item.')
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
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


def _save_trading_post(table, sid, node, stock):
    table.put_item(Item={'pk': _season_pk(sid), 'sk': f'POST#{node}', 'stock': stock})


def _trade(table, sid, doc, payload):
    """Swap one bag consumable for one of the post's 3 stock items. The item
    you leave becomes the next visitor's stock, tagged with your name."""
    node = doc.get('position')
    if data.MAP_NODES.get(node, {}).get('type') != 'trading_post':
        return _err('You are not at a trading post.', 409)
    give = payload.get('give')
    take_index = payload.get('takeIndex')
    bag = doc.get('bag') or []
    if give not in data.CONSUMABLES:
        return _err('Unknown item.')
    if give not in bag:
        return _err("You don't have that item to trade.", 409)
    stock = _trading_post_stock(table, sid, node)
    if not isinstance(take_index, int) or not (0 <= take_index < len(stock)):
        return _err('Pick something to take.', 409)

    taken = stock[take_index]
    bag = list(bag)
    bag.remove(give)               # give one…
    bag.append(taken['item'])      # …take one (net bag size unchanged)
    doc['bag'] = bag
    stock = list(stock)
    stock[take_index] = {'item': give, 'foundBy': doc.get('username', 'someone')}

    conflict = _save_or_conflict(table, doc)  # guard the player write first
    if conflict:
        return conflict
    _save_trading_post(table, sid, node, stock)  # then the shared stock

    give_name = data.CONSUMABLES[give]['name']
    take_name = data.CONSUMABLES[taken['item']]['name']
    _event(table, sid, 'trade',
           f"{doc['username']} traded a {give_name} for {take_name} "
           f"(left by {taken['foundBy']}) at the trading post.", actor=doc['userId'])
    return _ok(doc, text=f"You leave your {give_name} and take {take_name} "
               f"(found by {taken['foundBy']}).", node=node, stock=stock)


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
    """Loot scales with footprint — bigger digs are worth more."""
    if shape == '1x1':
        if _rng.random() < 0.7:
            return {'kind': 'spores', 'spores': _rng.randint(8, 15)}
        return {'kind': 'item', 'item': _rng.choice(['healing_moss', 'snare'])}
    if shape == '1x2':
        return {'kind': 'item', 'item': _rng.choice(list(data.CONSUMABLES))}
    if _rng.random() < 0.5:  # 2x2
        return {'kind': 'item', 'item': _rng.choice(['loaded_die', 'smoke_spore'])}
    return {'kind': 'spores', 'spores': _rng.randint(30, 50)}


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
    """Masked view for the client: covered cells never leak item positions."""
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
    items = [{'idx': idx, 'shape': it['shape'], 'collected': it['collected'], 'by': it['by']}
             for idx, it in enumerate(rec['items'])]
    return {'w': w, 'h': h, 'cells': cells, 'items': items,
            'remaining': sum(1 for it in rec['items'] if not it['collected'])}


def _award_dig_loot(doc, loot):
    if loot['kind'] == 'spores':
        doc['spores'] = doc.get('spores', 0) + loot['spores']
        return {'kind': 'spores', 'spores': loot['spores']}
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
    node = doc.get('position')
    if data.MAP_NODES.get(node, {}).get('type') != 'excavation':
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
    region = data.MAP_NODES[doc['position']]['region']
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
    """Optional strikes 2-3 at the vein (the first happens on landing)."""
    node = doc.get('position')
    if data.MAP_NODES.get(node, {}).get('type') != 'crystal_vein':
        return _err('You are not at a crystal vein.', 409)
    if doc.get('veinStrikesLeft', 0) < 1:
        return _err('Out of strikes — come back next time you land here.', 409)
    res = _vein_strike_once(table, sid, doc)
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    return _ok(doc, node=node, strikesLeft=doc.get('veinStrikesLeft', 0), **res)


def _vault_guess(table, sid, doc, payload):
    node = doc.get('position')
    if data.MAP_NODES.get(node, {}).get('type') != 'vault_lock':
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

    region = data.MAP_NODES[node]['region']
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
        if data.MAP_NODES[node]['type'] in ('gate', 'boss'):
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
    else:
        return _err('Unknown item.')
    doc['bag'] = bag
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    return _ok(doc, text=text)


def _shrine(table, sid, doc, payload):
    if data.MAP_NODES.get(doc.get('position'), {}).get('type') != 'shrine':
        return _err('You are not at a shrine.', 409)
    choice = payload.get('choice')
    eff = engine.effective_stats(doc)
    if choice == 'tithe':
        cost_hp = round(doc['hp'] * data.SHRINE_TITHE_HP_PCT)
        doc['hp'] = max(1, doc['hp'] - cost_hp)
        _grant_xp(table, sid, doc, data.XP_REWARDS['shrine_tithe'])
        text = f'You tithe {cost_hp} HP of blood. The shrine grants +8 XP.'
    elif choice in ('atk', 'def', 'spd', 'heal'):
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
        return _err('Choose a blessing: atk, def, spd, heal, or tithe.')
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    return _ok(doc, text=text)


def _warp(table, sid, doc, payload):
    node = doc.get('position')
    if data.MAP_NODES.get(node, {}).get('type') != 'warp':
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
    if data.MAP_NODES.get(doc.get('position'), {}).get('type') != 'ossuary':
        return _err('You are not at the Ossuary.', 409)
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
                    'again until you land at the Ossuary anew.', 409)
    die = _rng.randint(1, 6)
    won = (die >= 4) == (call == 'high')
    doc['spores'] += bet if won else -bet
    left -= 1
    doc['ossuaryRollsLeft'] = left
    tail = (f' {left} roll{"s" if left != 1 else ""} left.' if left > 0
            else ' That was your last roll — the table is closed.')
    text = (f'The die shows {die} — you win {bet} Spores!' if won
            else f'The die shows {die} — the Ossuary keeps your {bet} Spores.') + tail
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
    granted = 0
    if target.get('pokesReceived', 0) < data.POKE_ROLL_LIMIT:
        granted, _lost = _add_rolls(target, 1)
    target['pokesReceived'] = target.get('pokesReceived', 0) + 1
    if not _put_player(table, target):
        return _err('The plaza is crowded — try again.', 409)
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
    doc['hat'] = hat or None
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    return _ok(doc)
