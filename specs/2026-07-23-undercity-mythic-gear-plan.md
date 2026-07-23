# Mythic Gear (T4, craft-only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 4th rarity rung, **Mythic (tier 4)**, one per rider family, obtainable only by upgrading a Legendary at the Blacksmith for 3 Chrysalis Ichor + Spores — never dropped, sold, or found.

**Architecture:** The forge/rarity systems already extend by tier index. Mythic is almost entirely *data*: a `RIDER_SCALE` tier-4 column, tier-4 cost/salvage knobs, and ~16 tier-4 `GEAR` entries that auto-index into `GEAR_FAMILY[rider][4]`, so the existing `_upgrade_gear` path handles Legendary→Mythic with no logic change. Found-gear sources filter by tier and stop at 3, so leaving them untouched makes Mythic craft-only. The engine reads magnitude from `RIDER_SCALE`/`readBonus` and needs no change. The client mirrors the data + adds a Mythic rarity color.

**Tech Stack:** Python 3.11 Lambda (`infrastructure/lambda/`), pytest; Angular 20 / TypeScript client (`src/app/undercity/`), verified via `npm run build` (no client test runner).

**Spec:** [specs/2026-07-23-undercity-mythic-gear-design.md](2026-07-23-undercity-mythic-gear-design.md)

**Working dir for backend tests:** all `pytest` commands run from `infrastructure/lambda/`.

**Coordination note:** `undercity_db.py`, `undercity_data.py`, `undercity_config.py`, and the tests have frequent in-flight working-tree edits. Layer onto whatever is current, not a stale snapshot. Do not revert unrelated working changes.

---

## File Structure

- `infrastructure/lambda/undercity_config.py` — `RIDER_SCALE` gains a tier-4 column; new `UPGRADE_*[4]` and `SALVAGE_MOLTINGS[4]` knobs.
- `infrastructure/lambda/undercity_data.py` — ~16 new tier-4 `GEAR` entries (auto-index into `GEAR_FAMILY`).
- `infrastructure/lambda/undercity_db.py` — one rarity-aware error-message change in `_upgrade_gear`.
- `infrastructure/lambda/tests/test_undercity_gear_scaling.py` — relax `{1,2,3}` assertions to admit tier 4.
- `infrastructure/lambda/tests/test_undercity_gear_drops.py` — new Legendary→Mythic + craft-only tests; fix the now-wrong "Legendary is max" test.
- `src/app/undercity/data/items.ts` — tier-4 in the `tier` type, 16 Mythic entries, `RARITY_BY_TIER[4]`, `UPGRADE_COST[4]`, `SALVAGE_YIELD[4]`, `Rarity` gains `'mythic'`.
- `src/app/undercity/tabs/creature-tab.component.scss` + `plaza-tab.component.scss` — Mythic rarity color.
- `specs/undercity-combat.md` — one-line note that tier 4 = Mythic, forge-gated by 3 Ichor.

---

## Task 1: Config knobs — RIDER_SCALE tier-4 column + cost/salvage

**Files:**
- Modify: `infrastructure/lambda/undercity_config.py` (the `RIDER_SCALE` dict ~line 122; `UPGRADE_*`/`SALVAGE_*` ~lines 102-107)

- [ ] **Step 1: Add the tier-4 column to every `RIDER_SCALE` rider**

Replace the `RIDER_SCALE` dict body (keep the comment header above it) so each rider gains a `4:` key one monotonic step above its tier-3 value:

```python
RIDER_SCALE = {
    # rider          {1: common, 2: rare, 3: legendary, 4: mythic}
    'barbed':        {1: 1,    2: 2,    3: 3,    4: 4},
    'bloodfang':     {1: 0.40, 2: 0.50, 3: 0.60, 4: 0.70},
    'deep_biter':    {1: 0.35, 2: 0.50, 3: 0.70, 4: 0.90},
    'rabid':         {1: 1,    2: 2,    3: 3,    4: 4},
    'gutcleaver':    {1: 0.35, 2: 0.50, 3: 0.70, 4: 0.90},
    'thick':         {1: 0.15, 2: 0.20, 3: 0.25, 4: 0.30},
    'spiked':        {1: 1.3,  2: 1.5,  3: 1.8,  4: 2.0},
    'bramble':       {1: 2,    2: 3,    3: 4,    4: 5},
    'bulwark':       {1: 1,    2: 1,    3: 2,    4: 3},
    'mossback':      {1: 2,    2: 3,    3: 4,    4: 5},
    'trickster':     {1: 0.50, 2: 0.60, 3: 0.70, 4: 0.80},
    'serrated':      {1: 1,    2: 2,    3: 3,    4: 4},
    'venomtrick':    {1: 1,    2: 2,    3: 3,    4: 4},
    'cutpurse':      {1: 4,    2: 6,    3: 9,    4: 12},
}
```

- [ ] **Step 2: Add tier-4 cost + salvage knobs**

In the forge-economy block, extend the three upgrade dicts and the salvage-moltings dict (leave `SALVAGE_ICHOR = 1` as-is — `_grind_materials` already awards it for `tier >= 3`, so a Mythic salvage returns 1 Ichor, strictly below the 3 it costs to craft):

```python
SALVAGE_MOLTINGS = {1: 1, 2: 2, 3: 4, 4: 6}
SALVAGE_ICHOR = 1             # Chrysalis Ichor from grinding a Legendary OR Mythic (tier >= 3)

UPGRADE_SPORES = {2: 40, 3: 80, 4: 150}
UPGRADE_MOLTINGS = {2: 3, 3: 6, 4: 0}    # Mythic's gate is Ichor, not Moltings
UPGRADE_ICHOR = {2: 0, 3: 1, 4: 3}       # Legendary->Mythic needs 3 Ichor
```

- [ ] **Step 3: Verify the module imports cleanly**

Run: `cd infrastructure/lambda && python -c "import undercity_config as c; print(c.RIDER_SCALE['bramble'][4], c.UPGRADE_ICHOR[4], c.SALVAGE_MOLTINGS[4])"`
Expected: `5 3 6`

- [ ] **Step 4: Commit**

```bash
git add infrastructure/lambda/undercity_config.py
git commit -m "feat(undercity): tier-4 RIDER_SCALE column + Mythic forge knobs"
```

---

## Task 2: The 16 Mythic GEAR entries

**Files:**
- Modify: `infrastructure/lambda/undercity_data.py` (the `GEAR` dict; add the block just before its closing `}` — after the illuminating-gear entries, before `GEAR_FAMILY = {}` at line 297)

Each Mythic reuses its family's slot + rider, takes the new stat band (fangs atk 7-8 + spd; carapaces def 6 / maxHp 8; charms spd 2-3), and `seer`/`glint` carry a Mythic `readBonus` above their tier-3 value (seer 0.45→0.60, glint 0.15→0.20). `cost` is set for sell-back math only (never a buy path). These auto-populate `GEAR_FAMILY[rider][4]`.

- [ ] **Step 1: Add the Mythic entries to `GEAR`**

Insert this block as the final group inside the `GEAR = { ... }` dict:

```python
    # ── Mythic (tier 4) — craft-only; forged from a Legendary at the Blacksmith
    # for 3 Chrysalis Ichor. Never dropped/sold/found (no tier-4 in GEAR_DROP,
    # the bazaar tier set, or the boss trove). One per rider family. New stat
    # band above T3 + the RIDER_SCALE[*][4] magnitude step. Names/stats are the
    # tune-undercity-balance surface.
    # Fangs
    'wyrm_godtooth':    {'name': 'Wyrm Godtooth',    'slot': 'fang', 'tier': 4, 'cost': 150, 'atk': 8, 'spd': 1, 'rider': 'barbed'},
    'sanguine_leviathan':{'name': 'Sanguine Leviathan','slot': 'fang','tier': 4, 'cost': 150, 'atk': 8, 'spd': 1, 'rider': 'bloodfang'},
    'worldrender_maw':  {'name': 'Worldrender Maw',   'slot': 'fang', 'tier': 4, 'cost': 150, 'atk': 8, 'spd': 1, 'rider': 'deep_biter'},
    'apex_ravener':     {'name': 'Apex Ravener',      'slot': 'fang', 'tier': 4, 'cost': 150, 'atk': 7, 'spd': 2, 'rider': 'rabid'},
    'worldcleaver':     {'name': 'Worldcleaver',      'slot': 'fang', 'tier': 4, 'cost': 150, 'atk': 8, 'rider': 'gutcleaver'},
    # Carapaces
    'titan_carapace':   {'name': 'Titan Carapace',    'slot': 'carapace', 'tier': 4, 'cost': 150, 'def': 6, 'maxHp': 8, 'rider': 'thick'},
    'thornlord_aegis':  {'name': 'Thornlord Aegis',   'slot': 'carapace', 'tier': 4, 'cost': 150, 'def': 6, 'maxHp': 8, 'rider': 'bramble'},
    'wyrmscale_wall':   {'name': 'Wyrmscale Wall',    'slot': 'carapace', 'tier': 4, 'cost': 150, 'def': 6, 'maxHp': 8, 'rider': 'spiked'},
    'adamant_bulwark':  {'name': 'Adamant Bulwark',   'slot': 'carapace', 'tier': 4, 'cost': 150, 'def': 6, 'maxHp': 8, 'rider': 'bulwark'},
    'ancient_grove_shell':{'name': 'Ancient Grove Shell','slot': 'carapace','tier': 4, 'cost': 150, 'def': 6, 'maxHp': 8, 'rider': 'mossback'},
    # Charms
    'godtrickster_idol':{'name': "Godtrickster's Idol",'slot': 'charm', 'tier': 4, 'cost': 150, 'spd': 3, 'rider': 'trickster'},
    'plaguelord_idol':  {'name': 'Plaguelord Idol',   'slot': 'charm', 'tier': 4, 'cost': 150, 'spd': 2, 'rider': 'venomtrick'},
    'eviscerator_idol': {'name': 'Eviscerator Idol',  'slot': 'charm', 'tier': 4, 'cost': 150, 'spd': 2, 'rider': 'serrated'},
    'allseeing_idol':   {'name': 'All-Seeing Idol',   'slot': 'charm', 'tier': 4, 'cost': 150, 'spd': 2, 'rider': 'seer', 'readBonus': 0.60},
    'kingpin_idol':     {'name': 'Kingpin Idol',      'slot': 'charm', 'tier': 4, 'cost': 150, 'spd': 3, 'rider': 'cutpurse'},
    'prism_idol':       {'name': 'Prism Idol',        'slot': 'charm', 'tier': 4, 'cost': 150, 'spd': 2, 'rider': 'glint', 'readBonus': 0.20},
```

- [ ] **Step 2: Verify every family now has a tier-4 rung and the engine can read magnitudes**

Run:
```bash
cd infrastructure/lambda && python -c "import undercity_data as d; print(sorted(r for r,v in d.GEAR_FAMILY.items() if 4 in v)); print(len([g for g in d.GEAR.values() if g['tier']==4]))"
```
Expected: a list of all 16 rider families and the count `16`.

- [ ] **Step 3: Commit**

```bash
git add infrastructure/lambda/undercity_data.py
git commit -m "feat(undercity): 16 Mythic (tier-4) gear pieces, one per rider family"
```

---

## Task 3: Rarity-aware "already max rung" message

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_upgrade_gear`, the no-next-rung branch ~line 921-922)

- [ ] **Step 1: Make the terminal error name the actual top rarity**

The current branch always says "already Legendary":

```python
    next_gid = data.GEAR_FAMILY[rider].get(next_tier)
    if not next_gid:
        return _err('That piece is already Legendary.', 409)
```

Replace it so a Mythic (tier 4, no tier-5) reports correctly:

```python
    next_gid = data.GEAR_FAMILY[rider].get(next_tier)
    if not next_gid:
        top = 'Mythic' if g['tier'] >= 4 else 'Legendary'
        return _err(f'That piece is already {top}.', 409)
```

- [ ] **Step 2: Verify import**

Run: `cd infrastructure/lambda && python -c "import undercity_db"`
Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add infrastructure/lambda/undercity_db.py
git commit -m "feat(undercity): Blacksmith reports Mythic as the top rung"
```

---

## Task 4: Update existing scaling tests to admit tier 4

Several assertions in `test_undercity_gear_scaling.py` hardcode `{1,2,3}`; with Mythic on every family they now fail. Update them to require tiers 1-3 as a *subset* (Mythic optional per family, though we add it to all) and allow tier 4 in the shape check. Do this **first** (they should fail against the new data until fixed), then confirm green.

**Files:**
- Modify: `infrastructure/lambda/tests/test_undercity_gear_scaling.py`

- [ ] **Step 1: Run the suite to see the pre-existing tests fail against Tasks 1-2**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_gear_scaling.py -q`
Expected: FAILures in `test_rider_scale_is_monotonic_non_decreasing`, `test_every_combat_rider_family_spans_all_three_rarities`, `test_read_rate_gear_readbonus_is_monotonic_by_tier`, `test_new_gear_entries_have_valid_shape` (all tripping on tier 4).

- [ ] **Step 2: Relax `test_rider_scale_is_monotonic_non_decreasing`**

Replace the function so it requires tiers 1-3 and validates the full chain including any tier-4:

```python
def test_rider_scale_is_monotonic_non_decreasing():
    for rider, rungs in data.RIDER_SCALE.items():
        assert {1, 2, 3}.issubset(rungs), f"{rider} must define tiers 1,2,3"
        ordered = [rungs[t] for t in sorted(rungs)]
        assert ordered == sorted(ordered), f"{rider} ladder not monotonic: {rungs}"
```

- [ ] **Step 3: Relax `test_every_combat_rider_family_spans_all_three_rarities`**

Replace so it requires tiers 1-3 to be present (tier 4 allowed, not required):

```python
def test_every_combat_rider_family_spans_all_three_rarities():
    """Each rider must have at least a Common (t1), Rare (t2) and Legendary (t3) piece."""
    incomplete = {r: sorted(t) for r, t in _tiers_by_rider().items()
                  if not {1, 2, 3}.issubset(t)}
    assert not incomplete, f"rider families missing rungs: {incomplete}"
```

- [ ] **Step 4: Relax `test_read_rate_gear_readbonus_is_monotonic_by_tier`**

Replace so it requires tiers 1-3 present and the bonus non-decreasing across whatever tiers exist:

```python
def test_read_rate_gear_readbonus_is_monotonic_by_tier():
    """seer/glint scale read-rate via per-piece readBonus (not RIDER_SCALE);
    each spans at least tiers 1-3 with a non-decreasing bonus."""
    for rider in ('seer', 'glint'):
        rungs = sorted((g['tier'], g.get('readBonus', 0))
                       for g in data.GEAR.values() if g.get('rider') == rider)
        tiers = [t for t, _ in rungs]
        assert {1, 2, 3}.issubset(tiers), f"{rider} missing a tier: {rungs}"
        bonuses = [b for _, b in rungs]
        assert bonuses == sorted(bonuses), f"{rider} readBonus not monotonic: {rungs}"
```

- [ ] **Step 5: Allow tier 4 in `test_new_gear_entries_have_valid_shape`**

Change the tier assertion:

```python
        assert g['tier'] in (1, 2, 3, 4), f"{gid} bad tier"
```

- [ ] **Step 6: Run the file green**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_gear_scaling.py -q`
Expected: PASS (all tests).

- [ ] **Step 7: Commit**

```bash
git add infrastructure/lambda/tests/test_undercity_gear_scaling.py
git commit -m "test(undercity): scaling invariants admit the Mythic tier-4 rung"
```

---

## Task 5: Forge tests — Legendary→Mythic craft + craft-only invariant

The existing `test_upgrade_legendary_is_max` asserts a tier-3 piece can't upgrade — now false (it forges to Mythic). Fix it to assert the *Mythic* piece is the max, and add the new happy-path, cost-gate, and craft-only tests.

**Files:**
- Modify: `infrastructure/lambda/tests/test_undercity_gear_drops.py` (the Blacksmith section ~line 157+)

- [ ] **Step 1: Write the new failing tests + fix the max-rung test**

Replace the existing `test_upgrade_legendary_is_max` function with these four tests (all in the Blacksmith section). They use the file's existing `_player_at` helper and `db._upgrade_gear`:

```python
def test_upgrade_legendary_to_mythic_needs_3_ichor(table):
    sid, doc = _player_at(table, 'city_r0', spores=data.UPGRADE_SPORES[4])
    doc['gear'] = {'carapace': 'bramble_aegis'}        # tier-3 bramble (Legendary)
    doc['materials'] = {'moltings': 0, 'ichor': 2}     # one short of 3
    status, _ = db._upgrade_gear(
        table, sid, doc, {'target': {'where': 'equipped', 'slot': 'carapace'}})
    assert status == 409                               # blocked: not enough Ichor
    assert doc['gear']['carapace'] == 'bramble_aegis'  # unchanged

    doc['materials']['ichor'] = 3                      # now exactly enough
    status, _ = db._upgrade_gear(
        table, sid, doc, {'target': {'where': 'equipped', 'slot': 'carapace'}})
    assert status == 200
    assert doc['gear']['carapace'] == data.GEAR_FAMILY['bramble'][4]  # -> Mythic
    assert doc['materials']['ichor'] == 0                            # 3 spent
    assert doc['spores'] == 0                                        # UPGRADE_SPORES[4] spent


def test_upgrade_mythic_is_max(table):
    sid, doc = _player_at(table, 'city_r0', spores=999)
    doc['gear'] = {'carapace': data.GEAR_FAMILY['bramble'][4]}  # tier-4, top rung
    doc['materials'] = {'moltings': 99, 'ichor': 99}
    status, body = db._upgrade_gear(
        table, sid, doc, {'target': {'where': 'equipped', 'slot': 'carapace'}})
    assert status == 409
    assert 'Mythic' in body.get('error', '')


def test_mythic_gear_is_craft_only(table):
    """No tier-4 piece is reachable by any find path (drop / bazaar / boss trove)."""
    mythic = {gid for gid, g in data.GEAR.items() if g['tier'] == 4}
    assert mythic                                       # sanity: Mythics exist
    for src, (_chance, weights) in data.GEAR_DROP.items():
        assert 4 not in weights, f"{src} can drop a tier-4 piece"
    assert 4 not in data.BAZAAR_GEAR_TIERS              # never stocked in the bazaar


def test_mythic_readbonus_scales_seer_glint(table):
    # Mythic seer/glint carry a readBonus above their Legendary rung.
    seer = data.GEAR[data.GEAR_FAMILY['seer'][4]]['readBonus']
    glint = data.GEAR[data.GEAR_FAMILY['glint'][4]]['readBonus']
    assert seer > data.GEAR[data.GEAR_FAMILY['seer'][3]]['readBonus']
    assert glint > data.GEAR[data.GEAR_FAMILY['glint'][3]]['readBonus']
```

- [ ] **Step 2: Run the new tests**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_gear_drops.py -q`
Expected: PASS (the four new tests + all pre-existing ones in the file).

- [ ] **Step 3: Run the full backend suite**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS — the whole suite green (this catches any other tier-3-assuming test).

- [ ] **Step 4: Commit**

```bash
git add infrastructure/lambda/tests/test_undercity_gear_drops.py
git commit -m "test(undercity): Legendary->Mythic forge + Mythic-is-craft-only"
```

---

## Task 6: Client data mirror — items.ts

**Files:**
- Modify: `src/app/undercity/data/items.ts`

- [ ] **Step 1: Widen the `tier` type and `Rarity` union**

In the `GearInfo` interface change:

```typescript
  tier: 1 | 2 | 3 | 4;
```

And the rarity type:

```typescript
export type Rarity = 'common' | 'rare' | 'legendary' | 'mythic';
```

- [ ] **Step 2: Add `RARITY_BY_TIER[4]`**

Extend the map:

```typescript
const RARITY_BY_TIER: Record<number, RarityInfo> = {
  1: { key: 'common', label: 'Common' },
  2: { key: 'rare', label: 'Rare' },
  3: { key: 'legendary', label: 'Legendary' },
  4: { key: 'mythic', label: 'Mythic' },
};
```

- [ ] **Step 3: Add the 16 Mythic entries to the `GEAR` array**

Insert before the closing `];` of `GEAR` (after the illuminating-gear entries). `desc` strings state the Mythic magnitude (matching `RIDER_SCALE[*][4]` / the new `readBonus`):

```typescript
  // Mythic (tier 4) — craft-only; forge a Legendary at the Blacksmith for 3 Chrysalis Ichor.
  { id: 'wyrm_godtooth', name: 'Wyrm Godtooth', slot: 'fang', tier: 4, cost: 150, rider: 'barbed', atk: 8, spd: 1,
    desc: '+8 ATK, +1 SPD · Barbed: Aggress applies rot even on a loss.' },
  { id: 'sanguine_leviathan', name: 'Sanguine Leviathan', slot: 'fang', tier: 4, cost: 150, rider: 'bloodfang', atk: 8, spd: 1,
    desc: '+8 ATK, +1 SPD · Bloodfang: heal 70% of your winning Aggress damage.' },
  { id: 'worldrender_maw', name: 'Worldrender Maw', slot: 'fang', tier: 4, cost: 150, rider: 'deep_biter', atk: 8, spd: 1,
    desc: '+8 ATK, +1 SPD · Deep-biter: winning hits hit much harder.' },
  { id: 'apex_ravener', name: 'Apex Ravener', slot: 'fang', tier: 4, cost: 150, rider: 'rabid', atk: 7, spd: 2,
    desc: '+7 ATK, +2 SPD · Rabid: each Aggress win, your Aggress hits gain +4 for the fight.' },
  { id: 'worldcleaver', name: 'Worldcleaver', slot: 'fang', tier: 4, cost: 150, rider: 'gutcleaver', atk: 8,
    desc: '+8 ATK · Gutcleaver: winning Aggress vs a foe below 30% HP deals +90%.' },
  { id: 'titan_carapace', name: 'Titan Carapace', slot: 'carapace', tier: 4, cost: 150, rider: 'thick', def: 6, maxHp: 8,
    desc: '+6 DEF, +8 max HP · Thick: Guard chips in a stall, softer when wrong.' },
  { id: 'thornlord_aegis', name: 'Thornlord Aegis', slot: 'carapace', tier: 4, cost: 150, rider: 'bramble', def: 6, maxHp: 8,
    desc: '+6 DEF, +8 max HP · Bramble: reflect 5 damage whenever you are struck.' },
  { id: 'wyrmscale_wall', name: 'Wyrmscale Wall', slot: 'carapace', tier: 4, cost: 150, rider: 'spiked', def: 6, maxHp: 8,
    desc: '+6 DEF, +8 max HP · Spiked: Guard counter hits +100% harder.' },
  { id: 'adamant_bulwark', name: 'Adamant Bulwark', slot: 'carapace', tier: 4, cost: 150, rider: 'bulwark', def: 6, maxHp: 8,
    desc: '+6 DEF, +8 max HP · Bulwark: each round you Guard, +3 DEF for the fight.' },
  { id: 'ancient_grove_shell', name: 'Ancient Grove Shell', slot: 'carapace', tier: 4, cost: 150, rider: 'mossback', def: 6, maxHp: 8,
    desc: '+6 DEF, +8 max HP · Mossback: heal 5 each round you end in Guard.' },
  { id: 'godtrickster_idol', name: 'Godtrickster’s Idol', slot: 'charm', tier: 4, cost: 150, rider: 'trickster', spd: 3,
    desc: '+3 SPD · Trickster: a lost Feint punishes 80% less.' },
  { id: 'plaguelord_idol', name: 'Plaguelord Idol', slot: 'charm', tier: 4, cost: 150, rider: 'venomtrick', spd: 2,
    desc: '+2 SPD · Venomtrick: winning a Feint applies 4 rot.' },
  { id: 'eviscerator_idol', name: 'Eviscerator Idol', slot: 'charm', tier: 4, cost: 150, rider: 'serrated', spd: 2,
    desc: '+2 SPD · Serrated: a winning Feint saps 4 from the foe’s next-round damage.' },
  { id: 'allseeing_idol', name: 'All-Seeing Idol', slot: 'charm', tier: 4, cost: 150, rider: 'seer', spd: 2,
    desc: '+2 SPD · Seer: overwhelmingly raises how often you read the foe’s intent.' },
  { id: 'kingpin_idol', name: 'Kingpin Idol', slot: 'charm', tier: 4, cost: 150, rider: 'cutpurse', spd: 3,
    desc: '+3 SPD · Cutpurse: land a winning Feint for +12 Spores after a win.' },
  { id: 'prism_idol', name: 'Prism Idol', slot: 'charm', tier: 4, cost: 150, rider: 'glint', spd: 2,
    desc: '+2 SPD · Glint: winning a Feint reveals the true next intent; ++read rate.' },
```

- [ ] **Step 4: Add tier-4 to `UPGRADE_COST` and `SALVAGE_YIELD`**

```typescript
export const UPGRADE_COST: Record<number, { spores: number; moltings: number; ichor: number }> = {
  2: { spores: 40, moltings: 3, ichor: 0 },
  3: { spores: 80, moltings: 6, ichor: 1 },
  4: { spores: 150, moltings: 0, ichor: 3 },
};

export const SALVAGE_YIELD: Record<number, { moltings: number; ichor: number }> = {
  1: { moltings: 1, ichor: 0 },
  2: { moltings: 2, ichor: 0 },
  3: { moltings: 4, ichor: 1 },
  4: { moltings: 6, ichor: 1 },
};
```

- [ ] **Step 5: Verify the client compiles**

Run (from repo root): `npm run build`
Expected: build succeeds (no TS errors). The repo lint is known-broken — verify via build, not lint.

- [ ] **Step 6: Commit**

```bash
git add src/app/undercity/data/items.ts
git commit -m "feat(undercity): client mirror for Mythic tier-4 gear + forge costs"
```

---

## Task 7: Mythic rarity color

The rarity pill/border read a `data-rarity` attribute and a `.<rarity>` text class. Legendary uses gold `#fbbf24`. Add a Mythic color (a prismatic violet above gold) in both component styles that define the rarity rules.

**Files:**
- Modify: `src/app/undercity/tabs/creature-tab.component.scss` (rarity rules ~line 731 and ~line 778)
- Modify: `src/app/undercity/tabs/plaza-tab.component.scss` (rarity rules ~line 188 and ~line 250)

- [ ] **Step 1: Add the border-color rule after the legendary one (both files)**

In each file, immediately after the line `&[data-rarity='legendary'] { border-left-color: #fbbf24; }` add:

```scss
  &[data-rarity='mythic'] { border-left-color: #c084fc; }
```

- [ ] **Step 2: Add the text-color rule after the legendary one (both files)**

In each file, immediately after the line `&.legendary { color: #fbbf24; }` add:

```scss
    &.mythic { color: #c084fc; }
```

- [ ] **Step 3: Verify the build**

Run (from repo root): `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/app/undercity/tabs/creature-tab.component.scss src/app/undercity/tabs/plaza-tab.component.scss
git commit -m "feat(undercity): Mythic rarity color on gear pills/borders"
```

---

## Task 8: Doc note

**Files:**
- Modify: `specs/undercity-combat.md`

- [ ] **Step 1: Note the Mythic rung**

Find the section that describes gear rarities / `RIDER_SCALE` tuning (search the file for `RIDER_SCALE` or `Legendary`). Add one line noting: *Tier 4 = Mythic, craft-only — forged from a Legendary at the Blacksmith for 3 Chrysalis Ichor (`UPGRADE_ICHOR[4]`); it adds a `RIDER_SCALE[*][4]` magnitude step and a stat band above T3, and is never dropped/sold/found.*

- [ ] **Step 2: Commit**

```bash
git add specs/undercity-combat.md
git commit -m "docs(undercity): note Mythic tier-4 rung in the combat spec"
```

---

## Final verification

- [ ] **Backend suite green:** `cd infrastructure/lambda && python -m pytest tests -q` → all pass.
- [ ] **Client builds:** `npm run build` (from repo root) → succeeds.
- [ ] **Manual (optional, via the `run-undercity` skill):** own a Legendary of some family → Blacksmith offers a Legendary→Mythic upgrade at 3 Ichor + 150 Spores; blocked with < 3 Ichor; succeeds with 3; the piece renders with the Mythic (violet) rarity pill; confirm no Mythic appears in the bazaar or drops.

## Notes for the implementer

- **Do not** add any tier-4 id to `GEAR_DROP`, `BAZAAR_GEAR_TIERS`, or the boss-trove filter (`undercity_db.py` ~line 90-91, which hard-filters `tier == 3`). Leaving them alone is the entire craft-only mechanism, and Task 5's `test_mythic_gear_is_craft_only` guards it.
- **No engine changes:** `_effective_riders` (`undercity_db.py` ~line 482) reads `RIDER_SCALE[rider][tier]`, which now has a tier-4 row; seer/glint read `readBonus` off the gear entry. Both extend to Mythic automatically.
- **No salvage-code change:** `_grind_materials` already awards Ichor for `tier >= 3`, so a Mythic grinds to 1 Ichor (< the 3 it cost — no farm loop) and `SALVAGE_MOLTINGS.get(tier, 1)` picks up the new tier-4 moltings value.
- Balance numbers (stat band, Spore cost, magnitudes, names, `#c084fc`) are the `tune-undercity-balance` surface — adjust freely, keeping the server/`items.ts` mirror in sync and the ladders monotonic.
