# Sedgemoor Witch + Spell Scrolls + Mutable Grimoires — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add spell scrolls (tiered world drops that can be cast one-shot or inscribed), a new singleton **Sedgemoor Witch** facility space that inscribes scrolls into grimoires and sells tier-I scrolls, and the data-model shift that makes grimoires **mutable per-player** (capacity by tier).

**Architecture:** Grimoire contents become per-player state (`grimoireSpells: {id: [spellId,…]}`), seeded from the static bundle on acquisition, read everywhere via a `_book_spells(doc, gid)` helper. Scrolls live in a `scrolls: [spellId,…]` satchel; a shared `_roll_scroll_drop(doc, source)` hooks reward points, tiered by content difficulty. The witch is a `witch` node with `_witch_inscribe`/`_witch_buy_scroll` actions in the shrine/ossuary mold. The client witch modal reuses the existing `tierRarity` + plaza rarity chips and adds a spell-category color axis (design §7).

**Tech Stack:** Python 3.11 Lambda (pytest FakeTable suite; a test enforces `map.json` ↔ `public/data/undercity-map.json` parity — run `python sync_map.py` after editing the map) + Angular 20 standalone components (`npm run build`; drive with `run-undercity`).

**Prerequisite:** `2026-07-23-undercity-spell-scaling-plan.md` (scroll cards show level-scaled numbers via `spellPower`). Squirrel plan is independent.

Design source: [2026-07-23-undercity-bog-witch-scrolls-design.md](2026-07-23-undercity-bog-witch-scrolls-design.md). UX: that doc §7.

---

## Part A — Config & tables

### Task 1: Scalars & tables

**Files:**
- Modify: `infrastructure/lambda/undercity_config.py`
- Modify: `infrastructure/lambda/undercity_data.py`

- [ ] **Step 1: Config scalars**

Add to `undercity_config.py`:
```python
# ── Spell scrolls & the Sedgemoor Witch (design 2026-07-23) ──────────────────
SCROLL_SATCHEL_CAP = 6                       # held scrolls before drops convert to Spores
GRIMOIRE_CAPACITY = {1: 2, 2: 3, 3: 4}       # spells a book can hold, by book tier
INSCRIBE_COST = {1: 10, 2: 20, 3: 30}        # Spore fee to inscribe, by scroll tier
SCROLL_OVERFLOW_SPORES = 12                  # Spores when a scroll drop/over-cap is refunded
WITCH_SCROLL_MARKUP = 1.6                    # tier-I scroll shop price = spell tier price * markup
# Per-source scroll drop chance (which tier drops where lives in SCROLL_DROP_TIER below).
SCROLL_DROP_CHANCE = {
    'loot': 0.08, 'mystery': 0.10,
    'elite': 0.15, 'dig': 0.20, 'cache': 0.18,
    'lair': 0.35, 'vault': 0.40, 'boss': 0.50,
}
```

- [ ] **Step 2: Data tables (tier→spell pools, source→tier, witch stock)**

Add to `undercity_data.py` (after `SPELLS`/`GRIMOIRES`):
```python
# Which spell tier a scroll from each source carries (design §3 drop table).
SCROLL_DROP_TIER = {
    'loot': 1, 'mystery': 1,
    'elite': 2, 'dig': 2, 'cache': 2,
    'lair': 3, 'vault': 3, 'boss': 3,
}

# Spell ids grouped by tier, for weighted scroll rolls (equal weight within tier).
SCROLLABLE_BY_TIER = {
    1: [sid for sid, s in SPELLS.items() if s['tier'] == 1],
    2: [sid for sid, s in SPELLS.items() if s['tier'] == 2],
    3: [sid for sid, s in SPELLS.items() if s['tier'] == 3],
}

# The witch's rotating tier-I scroll stock offer (spell ids); price derived from
# the spell's tier via WITCH_SCROLL_MARKUP in _witch_buy_scroll.
WITCH_SCROLL_STOCK = ['spore_bolt', 'mend_flesh', 'harden_shell', 'scrap_toss']
```

- [ ] **Step 3: Verify**

Run: `cd infrastructure/lambda && python -c "import undercity_data as d; print(d.GRIMOIRE_CAPACITY, d.SCROLLABLE_BY_TIER[2])"`
Expected: `{1: 2, 2: 3, 3: 4} ['rot_bolt', 'weaken_hex', 'mycelial_recall', 'fate_die']`

- [ ] **Step 4: Commit**

```bash
git add infrastructure/lambda/undercity_config.py infrastructure/lambda/undercity_data.py
git commit -m "feat(undercity): scroll + witch config and tier tables"
```

---

## Part B — Mutable grimoires & scroll satchel

### Task 2: Per-book contents + new-doc fields

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_book_spells`, `_grant_grimoire`, `_new_player_doc`)
- Test: `infrastructure/lambda/tests/test_undercity_spells.py`

- [ ] **Step 1: Write the failing test**

```python
def test_book_spells_seeds_and_reads_per_player(fresh_table):
    table, sid = fresh_table
    doc = db._new_player_doc(sid, 'u1', 'W', 'pest', 'bog')
    assert doc['scrolls'] == [] and doc['grimoireSpells'] == {}
    db._grant_grimoire(doc, 'moldering_folio')          # tier-I, 1 spell
    # contents seeded onto the doc from the static bundle
    assert doc['grimoireSpells']['moldering_folio'] == ['spore_bolt']
    assert db._book_spells(doc, 'moldering_folio') == ['spore_bolt']
    # unknown/older doc falls back to the static bundle
    doc2 = {'grimoires': ['gardeners_primer']}
    assert db._book_spells(doc2, 'gardeners_primer') == ['mend_flesh', 'harden_shell']
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_spells.py::test_book_spells_seeds_and_reads_per_player -v`
Expected: FAIL — `KeyError: 'scrolls'` / no `_book_spells`.

- [ ] **Step 3: Implement**

Add the helper near `_grant_grimoire`:
```python
def _book_spells(doc, gid):
    """A grimoire's CURRENT spells for this player. Mutable per-player state in
    doc['grimoireSpells']; falls back to the static bundle for older docs."""
    per = (doc.get('grimoireSpells') or {}).get(gid)
    if per is not None:
        return per
    return list(data.GRIMOIRES.get(gid, {}).get('spells') or [])
```

In `_grant_grimoire`, seed the per-book list when a book is first added (inside the `owned.append(gid)` branch):
```python
    owned.append(gid)
    doc.setdefault('grimoireSpells', {})[gid] = list(
        data.GRIMOIRES.get(gid, {}).get('spells') or [])
    if not doc.get('equippedGrimoire'):
        doc['equippedGrimoire'] = gid
    return True
```

In `_new_player_doc`, add to the doc dict:
```python
        'scrolls': [], 'grimoireSpells': {},
```

- [ ] **Step 4: Point the grimoire-source cast check at `_book_spells`**

In `_cast`, the grimoire source branch currently reads the static bundle:
```python
    elif source == 'grimoire':
        book = data.GRIMOIRES.get(doc.get('equippedGrimoire') or '')
        if not book or spell_id not in book['spells']:
            return _spell_err('That spell is not in your open grimoire.', 'not_castable')
```
Replace the condition with the per-player contents:
```python
    elif source == 'grimoire':
        gid = doc.get('equippedGrimoire') or ''
        if gid not in (doc.get('grimoires') or []) or spell_id not in _book_spells(doc, gid):
            return _spell_err('That spell is not in your open grimoire.', 'not_castable')
```

- [ ] **Step 5: Run test + full spell suite**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_spells.py -q`
Expected: PASS (existing casts still resolve — seeded contents equal the old bundle).

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_spells.py
git commit -m "feat(undercity): per-player mutable grimoire contents + scroll satchel field"
```

---

## Part C — Scroll casting (Phase 2)

### Task 3: One-shot scroll cast via `source: 'scroll'`

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_cast`)
- Test: `infrastructure/lambda/tests/test_undercity_spells.py`

- [ ] **Step 1: Write the failing test**

```python
def test_scroll_cast_consumes_and_ignores_cooldown(fresh_table):
    table, sid = fresh_table
    doc = db._new_player_doc(sid, 'u1', 'W', 'pest', 'bog')
    doc['hp'] = 5; doc['maxHp'] = 30; doc['scrolls'] = ['mend_flesh', 'mend_flesh']
    _put(table, doc)
    # cast a scroll twice in a row — no cooldown gating, one consumed each time
    for expect_left in (1, 0):
        status, body = db._cast(table, sid, _load(table, sid, 'u1'),
                                {'spellId': 'mend_flesh', 'source': 'scroll'})
        assert status == 200
        assert _load(table, sid, 'u1')['scrolls'].count('mend_flesh') == expect_left
    # third cast fails — none left
    status, _ = db._cast(table, sid, _load(table, sid, 'u1'),
                         {'spellId': 'mend_flesh', 'source': 'scroll'})
    assert status != 200
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_spells.py::test_scroll_cast_consumes_and_ignores_cooldown -v`
Expected: FAIL — `_cast` rejects `source: 'scroll'` (`not_castable`).

- [ ] **Step 3: Implement the scroll branch**

In `_cast`, replace the `else` that rejects scrolls:
```python
    else:
        return _spell_err('Scrolls come later — cast from your grimoire.',
                          'not_castable', 400)
```
with:
```python
    elif source == 'scroll':
        if spell_id not in (doc.get('scrolls') or []):
            return _spell_err('You have no such scroll.', 'not_castable', 400)
        # scroll bypasses cooldown entirely; consumed only after a clean resolve
    else:
        return _spell_err('Unknown cast source.', 'not_castable', 400)
```

Then guard the cooldown check so scrolls skip it. Change:
```python
    if not _spell_cd_ready(doc, spell_id):
```
(after the acorn-bypass edit from the squirrel plan, or standalone) to skip when scroll:
```python
    if source != 'scroll' and not _spell_cd_ready(doc, spell_id):
```

Finally, after the effect resolves and **before** `_start_spell_cooldown`, consume the scroll and skip starting a cooldown for scrolls:
```python
    if source == 'scroll':
        doc['scrolls'].remove(spell_id)
    else:
        _start_spell_cooldown(doc, spell_id)
```
(Replace the unconditional `_start_spell_cooldown(doc, spell_id)` line with this conditional.)

- [ ] **Step 4: Run test + suite**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_spells.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_spells.py
git commit -m "feat(undercity): one-shot scroll casting (source: scroll), no cooldown"
```

---

## Part D — The Sedgemoor Witch space

### Task 4: `witch` space resolution + node

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_resolve_space`)
- Modify: `infrastructure/lambda/map.json`
- Run: `infrastructure/lambda/sync_map.py`
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Add the space-resolution branch**

In `_resolve_space`, near the `shrine` branch:
```python
    if ntype == 'witch':
        return {'type': 'witch',
                'text': 'The Sedgemoor Witch stirs her cauldron. She reads scrolls '
                        'into books — for a price.'}
```

- [ ] **Step 2: Add one `witch` node to the map**

Pick a Sedgemoor (bog-region) node in `map.json` to convert, or add a new node adjacent to the existing bog cluster. Determine bog nodes:

Run: `cd infrastructure/lambda && python -c "import json; m=json.load(open('map.json')); [print(n.get('id'), n.get('type')) for n in ([*m['nodes'].values()] if isinstance(m['nodes'],dict) else m['nodes']) if 'bog' in str(n).lower()][:20]"`

Convert one suitable `loot`/`wild` bog node's `type` to `"witch"` (mirror how the single `shrine`/`ossuary` node is declared — same fields, just `type: "witch"`). Keep exactly one witch node.

- [ ] **Step 3: Sync the client copy**

Run: `cd infrastructure/lambda && python sync_map.py`
Expected: `public/data/undercity-map.json` updated. (A pytest fails while the copies differ.)

- [ ] **Step 4: Parity + resolution test**

```python
def test_witch_node_resolves(fresh_table):
    table, sid = fresh_table
    doc = _seed_player_on_type(table, sid, 'witch')   # helper: place a player on a witch node
    ev = db._resolve_space(table, sid, doc, doc['position'])
    assert ev['type'] == 'witch'
```

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py::test_witch_node_resolves tests -q -k "map or parity or witch"`
Expected: PASS (including the map-parity test).

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/map.json public/data/undercity-map.json infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): Sedgemoor Witch space + map node"
```

---

### Task 5: `witch-inscribe` action

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (new `_witch_inscribe`, `ACTIONS`)
- Test: `infrastructure/lambda/tests/test_undercity_spells.py`

- [ ] **Step 1: Write the failing tests**

```python
def test_inscribe_appends_when_room(fresh_table):
    table, sid = fresh_table
    doc = _seed_player_on_type(table, sid, 'witch')
    db._grant_grimoire(doc, 'moldering_folio')     # tier-I, [spore_bolt], cap 2
    doc['scrolls'] = ['mend_flesh']; doc['spores'] = 100
    _put(table, doc)
    status, body = db._witch_inscribe(table, sid, _load(table, sid, doc['userId']),
        {'scrollSpellId': 'mend_flesh', 'grimoireId': 'moldering_folio'})
    assert status == 200
    d = _load(table, sid, doc['userId'])
    assert d['grimoireSpells']['moldering_folio'] == ['spore_bolt', 'mend_flesh']
    assert 'mend_flesh' not in d['scrolls'] and d['spores'] == 90   # INSCRIBE_COST[1]

def test_inscribe_full_book_burns_overwrite_target(fresh_table):
    table, sid = fresh_table
    doc = _seed_player_on_type(table, sid, 'witch')
    db._grant_grimoire(doc, 'gardeners_primer')    # tier-I cap 2, [mend_flesh, harden_shell] = FULL
    doc['scrolls'] = ['scrap_toss']; doc['spores'] = 100
    _put(table, doc)
    # full book with no overwrite target -> error
    status, _ = db._witch_inscribe(table, sid, _load(table, sid, doc['userId']),
        {'scrollSpellId': 'scrap_toss', 'grimoireId': 'gardeners_primer'})
    assert status != 200
    # with a valid overwrite target -> burns it
    status, _ = db._witch_inscribe(table, sid, _load(table, sid, doc['userId']),
        {'scrollSpellId': 'scrap_toss', 'grimoireId': 'gardeners_primer',
         'overwriteSpellId': 'harden_shell'})
    assert status == 200
    assert db._book_spells(_load(table, sid, doc['userId']), 'gardeners_primer') == ['mend_flesh', 'scrap_toss']
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_spells.py -k inscribe -v`
Expected: FAIL — no `_witch_inscribe`.

- [ ] **Step 3: Implement**

```python
def _witch_inscribe(table, sid, doc, payload):
    nodes = _season_map(table, sid)
    if nodes.get(doc.get('position'), {}).get('type') != 'witch':
        return _err('You are not at the witch.', 409)
    scroll = (payload or {}).get('scrollSpellId')
    gid = (payload or {}).get('grimoireId')
    if scroll not in (doc.get('scrolls') or []):
        return _err('You have no such scroll.', 400)
    if gid not in (doc.get('grimoires') or []):
        return _err('You do not own that grimoire.', 400)
    book_tier = data.GRIMOIRES[gid]['tier']
    cap = data.GRIMOIRE_CAPACITY[book_tier]
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
    return _ok(doc, text=f"The witch inscribes {data.SPELLS[scroll]['name']} into {data.GRIMOIRES[gid]['name']}.")
```

Register in `ACTIONS`:
```python
        'witch-inscribe': _witch_inscribe, 'witch-buy-scroll': _witch_buy_scroll,
```
(add both now; `_witch_buy_scroll` lands in Task 6.)

- [ ] **Step 4: Run to verify passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_spells.py -k inscribe -v`
Expected: PASS. (If `ACTIONS` errors on the missing `_witch_buy_scroll` name, define a stub `def _witch_buy_scroll(*a, **k): return _err('coming next')` now; Task 6 replaces it.)

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_spells.py
git commit -m "feat(undercity): witch-inscribe scroll into grimoire (tier cap + burn-out)"
```

---

### Task 6: `witch-buy-scroll` action

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_witch_buy_scroll`)
- Test: `infrastructure/lambda/tests/test_undercity_spells.py`

- [ ] **Step 1: Write the failing test**

```python
def test_witch_buy_scroll(fresh_table):
    table, sid = fresh_table
    doc = _seed_player_on_type(table, sid, 'witch')
    doc['spores'] = 100; doc['scrolls'] = []
    _put(table, doc)
    status, body = db._witch_buy_scroll(table, sid, _load(table, sid, doc['userId']),
        {'spellId': 'spore_bolt'})
    assert status == 200
    d = _load(table, sid, doc['userId'])
    assert d['scrolls'] == ['spore_bolt'] and d['spores'] < 100
    # not in stock -> error
    status, _ = db._witch_buy_scroll(table, sid, _load(table, sid, doc['userId']),
        {'spellId': 'queens_bane'})
    assert status != 200
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_spells.py::test_witch_buy_scroll -v`
Expected: FAIL (stub returns error / not implemented).

- [ ] **Step 3: Implement (replace the stub)**

```python
def _witch_buy_scroll(table, sid, doc, payload):
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
```

- [ ] **Step 4: Run to verify passes + suite**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_spells.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_spells.py
git commit -m "feat(undercity): witch-buy-scroll tier-I stock"
```

---

## Part E — Scroll drops

### Task 7: `_roll_scroll_drop` + hook reward points

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py`
- Test: `infrastructure/lambda/tests/test_undercity_spells.py`

- [ ] **Step 1: Write the failing test**

```python
def test_scroll_drop_tiered_and_capped(fresh_table, monkeypatch):
    table, sid = fresh_table
    doc = db._new_player_doc(sid, 'u1', 'W', 'pest', 'bog')
    monkeypatch.setattr(db, '_rng', _SeededRng(0.0))   # force the drop (chance check passes)
    got = db._roll_scroll_drop(doc, 'elite')            # tier-2 source
    assert got in data.SCROLLABLE_BY_TIER[2]
    assert doc['scrolls'][-1] == got
    # full satchel converts to Spores instead of appending
    doc['scrolls'] = ['spore_bolt'] * data.SCROLL_SATCHEL_CAP
    spores_before = doc['spores'] = 0
    db._roll_scroll_drop(doc, 'loot')
    assert len(doc['scrolls']) == data.SCROLL_SATCHEL_CAP
    assert doc['spores'] == data.SCROLL_OVERFLOW_SPORES
```

(Use the suite's existing seeded-RNG helper if present; otherwise a tiny `_SeededRng` returning a fixed `random()`.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_spells.py::test_scroll_drop_tiered_and_capped -v`
Expected: FAIL — no `_roll_scroll_drop`.

- [ ] **Step 3: Implement the helper**

```python
def _roll_scroll_drop(doc, source):
    """Maybe drop a scroll from a reward `source`. Returns the spell id dropped
    (also appended to the satchel), or None. Over-cap converts to Spores."""
    chance = data.SCROLL_DROP_CHANCE.get(source, 0.0)
    if _rng.random() >= chance:
        return None
    tier = data.SCROLL_DROP_TIER.get(source, 1)
    pool = data.SCROLLABLE_BY_TIER.get(tier) or []
    if not pool:
        return None
    spell_id = pool[_rng.randrange(len(pool))]
    if len(doc.get('scrolls') or []) >= data.SCROLL_SATCHEL_CAP:
        doc['spores'] = doc.get('spores', 0) + data.SCROLL_OVERFLOW_SPORES
    else:
        doc.setdefault('scrolls', []).append(spell_id)
    return spell_id
```

- [ ] **Step 4: Hook the reward points**

Call `_roll_scroll_drop(doc, <source>)` at each reward site, alongside the existing `_roll_gear_drop` calls, using the source key that matches `SCROLL_DROP_TIER`. Add (and surface the result in that event's payload as `scroll=<id>` where the code returns a space/finish payload):

- Loot forage (near line ~2310, the `_roll_gear_drop(doc, data.GEAR_DROP['loot'][1])` site): `_roll_scroll_drop(doc, 'loot')`.
- `_mystery` (near ~2594): on the free-item branch, `_roll_scroll_drop(doc, 'mystery')`.
- `_finish_wild` elite path (near ~3113/3116): when `rec['kind'] == 'elite'`, `_roll_scroll_drop(doc, 'elite')`.
- `_dig` (near ~4436, on a successful dig): `_roll_scroll_drop(doc, 'dig')`.
- `_cache` (~3491) and `_trove` (~3464): `_roll_scroll_drop(doc, 'cache')`.
- Lair finish + boss finish + `_vault` claim: `_roll_scroll_drop(doc, 'lair')` / `'boss'` / `'vault'` respectively at their reward payload sites.

For each, add `scroll=<id>` to the returned payload dict when non-None so the client can toast it (grep the site's return to see the payload shape; follow the existing `drop=` gear pattern).

- [ ] **Step 5: Run test + full suite**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: all green (drop chance is 0-by-default in unseeded tests, so existing reward tests are unaffected).

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_spells.py
git commit -m "feat(undercity): tiered scroll drops from reward sources"
```

---

## Part F — Client

### Task 8: Types + data mirrors

**Files:**
- Modify: `src/app/undercity/services/undercity-models.ts`
- Modify: `src/app/undercity/data/spells.ts`

- [ ] **Step 1: Model fields**

Add to `YouDoc`:
```typescript
  /** Held spell scrolls (spell ids) and per-player grimoire contents. */
  scrolls?: string[];
  grimoireSpells?: Record<string, string[]>;
```
Add `'scroll'` to the cast source union used by the cast action/`CastResult`, and add a `WitchSpace`/space payload variant `{ type: 'witch'; text: string }` where space payloads are typed.

- [ ] **Step 2: Mirror witch stock + capacity + a category-color helper**

In `spells.ts`, add:
```typescript
export const GRIMOIRE_CAPACITY: Record<number, number> = { 1: 2, 2: 3, 3: 4 };
export const WITCH_SCROLL_STOCK = ['spore_bolt', 'mend_flesh', 'harden_shell', 'scrap_toss'];

/** Category → semantic color + short kind label (design §7 second color axis). */
export function spellCategoryStyle(spell: SpellInfo): { color: string; kind: string } {
  switch (spell.effect) {
    case 'field_damage': return { color: 'var(--error, #f44336)', kind: 'Damage' };
    case 'self_heal':    return { color: 'var(--success, #4caf50)', kind: 'Heal' };
    case 'self_buff':    return { color: 'var(--info, #2196f3)', kind: 'Buff' };
    case 'field_curse':  return { color: 'var(--accent-color, #e91e63)', kind: 'Curse' };
    case 'boss_strike':  return { color: 'var(--rating-gold, #ffd700)', kind: 'Boss' };
    default:             return { color: 'var(--warning, #ff9800)', kind: 'Mobility' };
  }
}
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/app/undercity/services/undercity-models.ts src/app/undercity/data/spells.ts
git commit -m "feat(undercity): client types + mirrors for scrolls/witch/category colors"
```

---

### Task 9: Witch modal — UX (design §7)

**Files:**
- Modify: `src/app/undercity/tabs/board-tab.component.ts`
- Modify: `src/app/undercity/tabs/board-tab.component.html`
- Modify: `src/app/undercity/tabs/board-tab.component.scss`

The witch modal follows the existing inline space-modal pattern (grep `shrine`/`ossuary` in `board-tab.component.html` for the modal scaffold and copy its structure). Two segments: **Inscribe** and **Buy scrolls**. Reuse `tierRarity` + the plaza `data-rarity`/`.rarity-badge` SCSS; category chips from `spellCategoryStyle`.

- [ ] **Step 1: Component state + helpers**

In `board-tab.component.ts`:
```typescript
import { SPELLS, GRIMOIRE_CAPACITY, WITCH_SCROLL_STOCK, spellCategoryStyle, spellPowerLabel } from '../data/spells';
import { tierRarity } from '../data/items';
// state:
protected readonly witchSeg = signal<'inscribe' | 'buy'>('inscribe');
protected readonly pickedScroll = signal<string | null>(null);
protected readonly pickedBook = signal<string | null>(null);
protected readonly burnTarget = signal<string | null>(null);
// exposed helpers:
protected readonly tierRarity = tierRarity;
protected readonly spellCategoryStyle = spellCategoryStyle;
protected readonly spellPowerLabel = spellPowerLabel;
protected spellInfo(id: string) { return SPELLS.find(s => s.id === id); }
protected bookCap(gid: string): number { /* GRIMOIRE_CAPACITY[tier of gid] */ return GRIMOIRE_CAPACITY[/* book tier */ 1]; }
protected bookSpells(gid: string): string[] { return this.store.you()?.grimoireSpells?.[gid] ?? []; }
protected witchStock() { return WITCH_SCROLL_STOCK; }
async inscribe(): Promise<void> {
  const scroll = this.pickedScroll(), book = this.pickedBook();
  if (!scroll || !book) return;
  await this.store.action('witch-inscribe', {
    scrollSpellId: scroll, grimoireId: book,
    ...(this.burnTarget() ? { overwriteSpellId: this.burnTarget() } : {}),
  });
  this.pickedScroll.set(null); this.pickedBook.set(null); this.burnTarget.set(null);
}
async buyScroll(id: string): Promise<void> { await this.store.action('witch-buy-scroll', { spellId: id }); }
```
(Fill `bookCap` by reading the book's tier from the grimoire list the store already exposes — grep how board-tab reads grimoire tier for the existing bazaar grimoire section.)

- [ ] **Step 2: The modal markup**

In `board-tab.component.html`, add a witch modal shown when the space event type is `witch` (mirror the `*ngIf` the shrine/ossuary modals use). Skeleton:
```html
<div class="witch-modal" *ngIf="spaceEvent()?.type === 'witch'">
  <header class="witch-head"><h3>The Sedgemoor Witch</h3></header>
  <div class="seg">
    <button [class.active]="witchSeg()==='inscribe'" (click)="witchSeg.set('inscribe')">Inscribe</button>
    <button [class.active]="witchSeg()==='buy'" (click)="witchSeg.set('buy')">Buy scrolls</button>
  </div>

  <!-- INSCRIBE -->
  <section *ngIf="witchSeg()==='inscribe'">
    <p class="hint" *ngIf="!(store.you()?.scrolls?.length)">No scrolls yet — find them in the deep, or buy one.</p>
    <div class="scroll-grid">
      <button class="scroll-card" *ngFor="let s of store.you()?.scrolls || []"
              [attr.data-rarity]="tierRarity(spellInfo(s)?.tier || 1).key"
              [class.picked]="pickedScroll()===s" (click)="pickedScroll.set(s)">
        <span class="name">{{ spellInfo(s)?.name }}</span>
        <span class="cat-chip" [style.color]="spellCategoryStyle(spellInfo(s)!).color">
          {{ spellCategoryStyle(spellInfo(s)!).kind }}
          <ng-container *ngIf="spellPowerLabel(spellInfo(s)!, store.you()?.level || 1) as pw"> · {{ pw }}</ng-container>
        </span>
        <span class="rarity-badge" [ngClass]="tierRarity(spellInfo(s)?.tier || 1).key">{{ tierRarity(spellInfo(s)?.tier || 1).label }}</span>
      </button>
    </div>
    <!-- book picker with capacity pips -->
    <div class="book-grid" *ngIf="pickedScroll()">
      <button class="book-card" *ngFor="let g of store.you()?.grimoires || []"
              [attr.data-rarity]="tierRarity(/* g tier */1).key"
              [class.picked]="pickedBook()===g" (click)="pickedBook.set(g)">
        <span class="pips">
          <span class="pip" *ngFor="let i of [].constructor(bookCap(g)); let idx=index"
                [class.filled]="idx < bookSpells(g).length">●</span>
        </span>
        <span class="book-spell" *ngFor="let sp of bookSpells(g)"
              [style.color]="spellCategoryStyle(spellInfo(sp)!).color"
              [class.doomed]="burnTarget()===sp"
              (click)="bookSpells(g).length >= bookCap(g) && burnTarget.set(sp)">{{ spellInfo(sp)?.name }}</span>
      </button>
    </div>
    <button class="confirm" [disabled]="!pickedScroll() || !pickedBook()" (click)="inscribe()">Inscribe</button>
  </section>

  <!-- BUY -->
  <section *ngIf="witchSeg()==='buy'">
    <button class="scroll-card" *ngFor="let id of witchStock()"
            [attr.data-rarity]="tierRarity(spellInfo(id)?.tier || 1).key" (click)="buyScroll(id)">
      <span class="name">{{ spellInfo(id)?.name }}</span>
      <span class="cat-chip" [style.color]="spellCategoryStyle(spellInfo(id)!).color">{{ spellCategoryStyle(spellInfo(id)!).kind }}</span>
    </button>
  </section>
</div>
```
(Use the real `spaceEvent()` accessor board-tab already uses for shrine/ossuary; fill the `/* g tier */` with the book's tier.)

- [ ] **Step 3: Styles — reuse rarity tokens (design §7)**

In `board-tab.component.scss`, reuse the plaza rarity colors and add witch-modal styles (rarity border, category chip, capacity pips, doomed/burn highlight, dimmed-not-hidden states, bog-green→violet header, theme-aware). Mirror the `[data-rarity]` border-left + `.rarity-badge` rules from `plaza-tab.component.scss` (copy the three color rules: common `#9aa7a0`, rare `#5fd18a`, legendary `#fbbf24`). Add:
```scss
.witch-head { background: linear-gradient(135deg, #2a4d3a, #4b2d5e); color: #fff; padding: 10px 14px; border-radius: 8px 8px 0 0; }
.scroll-card, .book-card { border-left: 3px solid transparent; border-radius: 8px; padding: 8px 10px; text-align: left; }
.scroll-card[data-rarity='common'], .book-card[data-rarity='common'] { border-left-color: #9aa7a0; }
.scroll-card[data-rarity='rare'],   .book-card[data-rarity='rare']   { border-left-color: #5fd18a; }
.scroll-card[data-rarity='legendary'], .book-card[data-rarity='legendary'] { border-left-color: #fbbf24; }
.scroll-card.picked, .book-card.picked { outline: 2px solid var(--accent-color, #e91e63); }
.cat-chip { font-size: 0.72rem; font-weight: 700; }
.pips .pip { opacity: 0.3; } .pips .pip.filled { opacity: 1; color: #5fd18a; }
.book-spell.doomed { color: var(--error, #f44336) !important; text-decoration: line-through; }
.confirm:disabled { opacity: 0.5; }
```

- [ ] **Step 4: Build + drive**

Run: `npm run build`
Then use `run-undercity`: reach the witch space, confirm both segments render, scroll/book cards show rarity borders + rarity badges + category chips (with scaled power on damage/heal), the capacity pips fill correctly, a full book forces a burn-out selection (struck-through doomed spell), buying a tier-I scroll adds it to the satchel, and inscribing updates the open book's castable spells.

- [ ] **Step 5: Commit**

```bash
git add src/app/undercity/tabs/board-tab.component.ts src/app/undercity/tabs/board-tab.component.html src/app/undercity/tabs/board-tab.component.scss
git commit -m "feat(undercity): Sedgemoor Witch modal (rarity borders, category chips, capacity pips)"
```

---

### Task 10: Scroll casting + satchel in the cast flow + loadout

**Files:**
- Modify: `src/app/undercity/tabs/board-tab.component.ts` / `.html`
- Modify: `src/app/undercity/tabs/creature-tab.component.html`

- [ ] **Step 1: Add a "Scrolls" source to the cast picker**

In the board-tab cast flow, add the player's `scrolls` as castable options with `source: 'scroll'`; each shows a category chip + scaled power + a "one-shot" marker. Sending cast uses `{ spellId, source: 'scroll' }`. (Reuse the spell-power chip from the scaling plan Task 5.)

- [ ] **Step 2: Render per-book contents + satchel on the Grimoire card**

In `creature-tab.component.html`, change the open-book spell list to read `store.you()?.grimoireSpells?.[openBookId]` (the mutable contents) instead of the static bundle, and add a small satchel row listing held scrolls with category chips.

- [ ] **Step 3: Build + drive**

Run: `npm run build`
Then use `run-undercity`: cast a scroll one-shot from the board (satchel decrements, no cooldown), and confirm the Grimoire card reflects inscribed spells.

- [ ] **Step 4: Commit**

```bash
git add src/app/undercity/tabs/board-tab.component.ts src/app/undercity/tabs/board-tab.component.html src/app/undercity/tabs/creature-tab.component.html
git commit -m "feat(undercity): scroll casting source + mutable book contents in loadout UI"
```

---

## Part G — Docs

### Task 11: Rewrite the spell reference invariant

**Files:**
- Modify: `specs/undercity-spells.md`

- [ ] **Step 1: Replace the fixed-bundle invariant**

In the "Design invariants" section, replace the "Loadouts are fixed bundles" bullet with the bounded rule (design §2): grimoires are mutable but capacity-bounded by tier (I:2/II:3/III:4); growth is by finding/buying scrolls and inscribing at the witch; only one book open at a time. Document scrolls (satchel, one-shot cast via `source: 'scroll'`, tiered drops) and the witch space + `witch-inscribe`/`witch-buy-scroll` actions. Mark Phase 2 (scrolls) and tier-II/III spell access as shipped in the Roadmap table.

- [ ] **Step 2: Commit**

```bash
git add specs/undercity-spells.md
git commit -m "docs(undercity): scrolls, witch, mutable grimoires; retire fixed-bundle invariant"
```

---

## Self-review notes

- **Spec coverage:** scroll item + satchel cap (Tasks 1,2), one-shot cast Phase 2 (Task 3), tiered drops incl. tier-II/III access (Task 7), witch space (Task 4), inscribe w/ per-tier capacity + burn-out + fee + dup-reject (Task 5), witch tier-I stock (Task 6), mutable per-player contents + read paths (Task 2), UX with rarity borders/badges + category chips + capacity pips + dimmed states (Task 9, design §7), scroll cast source + loadout mirror (Task 10), invariant rewrite (Task 11). ✔
- **Never-kill preserved:** scroll casts go through the same `_cast` effect resolution, whose damage/boss floors are untouched (Task 3 only bypasses cooldown + consumes a scroll). ✔
- **Map parity:** Task 4 runs `sync_map.py` and asserts the parity test — the copies never diverge in a commit. ✔
- **Naming consistency:** server `_book_spells`, `_roll_scroll_drop`, `_witch_inscribe`, `_witch_buy_scroll`, fields `scrolls`/`grimoireSpells`, actions `witch-inscribe`/`witch-buy-scroll`; client mirrors `GRIMOIRE_CAPACITY`/`WITCH_SCROLL_STOCK`/`spellCategoryStyle`, same field names. ✔
- **Wiring placeholders (not value placeholders):** Task 9 book-tier reads and `spaceEvent()` accessor, Task 10 cast-source wiring — the executor greps the existing shrine/ossuary + bazaar-grimoire code in board-tab and reuses those accessors. Called out explicitly so they aren't mistaken for TODOs.
- **RNG:** `_roll_scroll_drop` uses module `_rng` so drops are deterministic under the suite's seeding. ✔
