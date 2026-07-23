# Spell Level-Scaling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every `power`-carrying spell (damage/heal/boss-strike) scale with the caster's level — `effective = base + round(SPELL_POWER_PER_LEVEL × (level − 1))` — so magic stays relevant lategame, and show the *current scaled number* in the client cast UI.

**Architecture:** One pure server helper `engine.spell_power(spell, player)` becomes the single source of magnitude; every existing `spell['power']` read in the cast-resolution paths is replaced with a call to it. The client gets a matching `spellPower(base, level)` mirror and a `power` field on the six power spells, and the cast picker renders the scaled value instead of the flat number baked into the description string.

**Tech Stack:** Python 3.11 Lambda (pytest, in-memory FakeTable suite) + Angular 20 standalone components (no test runner — verify with `npm run build`).

Design source: [2026-07-22-undercity-squirrel-caster-design.md](2026-07-22-undercity-squirrel-caster-design.md) §2.5 pillar 1. Only the six spells with a `power` field are affected: `scrap_toss` (8), `spore_bolt` (12), `mend_flesh` (12, heal), `rot_bolt` (20), `spore_burst` (30), `queens_bane` (15, boss). Buff/curse/traversal spells are untouched.

---

### Task 1: Add the scaling scalar

**Files:**
- Modify: `infrastructure/lambda/undercity_config.py`

- [ ] **Step 1: Add the tunable**

Append to `undercity_config.py` (near the other spell scalars, or at the end):

```python
# ── Spell scaling (design 2026-07-22, §2.5 pillar 1) ─────────────────────────
# Every power-carrying spell (damage/heal/boss-strike) gains this much magnitude
# per character level above 1: effective = base + round(PER_LEVEL * (level - 1)).
# Level-1 casts still land for the printed base. Buffs/curses stay flat.
SPELL_POWER_PER_LEVEL = 1.0
```

- [ ] **Step 2: Verify it re-exports through data**

Run: `cd infrastructure/lambda && python -c "import undercity_data as d; print(d.SPELL_POWER_PER_LEVEL)"`
Expected: `1.0`

- [ ] **Step 3: Commit**

```bash
git add infrastructure/lambda/undercity_config.py
git commit -m "feat(undercity): add SPELL_POWER_PER_LEVEL scalar"
```

---

### Task 2: The `spell_power` engine helper

**Files:**
- Modify: `infrastructure/lambda/undercity_engine.py`
- Test: `infrastructure/lambda/tests/test_undercity_spells.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/test_undercity_spells.py`:

```python
def test_spell_power_scales_with_level():
    import undercity_engine as engine
    spell = {'power': 12}
    assert engine.spell_power(spell, {'level': 1}) == 12      # base at level 1
    assert engine.spell_power(spell, {'level': 6}) == 17      # 12 + round(1.0*5)
    assert engine.spell_power(spell, {'level': 10}) == 21     # 12 + 9


def test_spell_power_flat_for_powerless_spell():
    import undercity_engine as engine
    assert engine.spell_power({'effect': 'self_buff'}, {'level': 10}) == 0
    assert engine.spell_power({}, {}) == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_spells.py::test_spell_power_scales_with_level -v`
Expected: FAIL — `AttributeError: module 'undercity_engine' has no attribute 'spell_power'`

- [ ] **Step 3: Implement the helper**

Add to `undercity_engine.py` (near `effective_stats`, after the imports/dodge helpers):

```python
def spell_power(spell: dict, player: dict) -> int:
    """Effective magnitude of a power-carrying spell, scaled by caster level.
    `base + round(SPELL_POWER_PER_LEVEL * (level - 1))`; level-1 casts land for
    the printed base. Spells with no 'power' return 0 (buffs/curses/traversal are
    never routed here). Pure — no I/O."""
    base = spell.get('power', 0)
    if not base:
        return base
    level = player.get('level', 1)
    return base + round(data.SPELL_POWER_PER_LEVEL * (level - 1))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_spells.py::test_spell_power_scales_with_level tests/test_undercity_spells.py::test_spell_power_flat_for_powerless_spell -v`
Expected: PASS (both)

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_engine.py infrastructure/lambda/tests/test_undercity_spells.py
git commit -m "feat(undercity): spell_power helper scales magnitude by level"
```

---

### Task 3: Route every cast-resolution site through `spell_power`

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (5 sites)
- Test: `infrastructure/lambda/tests/test_undercity_spells.py`

There are exactly five reads of `spell['power']` in the cast paths. Find them with:

Run: `cd infrastructure/lambda && grep -n "spell\['power'\]" undercity_db.py`
Expected lines (approximately): the `self_heal` branch in `_cast`, two `field_damage` branches in `_cast_field` (lair path + player `apply()` path), and two branches in `_cast_boss_strike` (boss + lair pool).

- [ ] **Step 1: Write the failing integration test**

Add to `tests/test_undercity_spells.py` (reuse the suite's existing FakeTable/join helpers — mirror an existing damage-spell test's setup; a helper like `_join`/`_seed_player` already exists in this file):

```python
def test_field_damage_scales_with_caster_level(seeded_table):
    # seeded_table: (table, sid) with two adjacent players A (caster) and B.
    table, sid, caster, victim = _two_adjacent_players(seeded_table)
    _set_level(table, sid, caster, 6)          # +5 levels => +5 damage
    _equip_spell(table, sid, caster, 'spore_bolt')   # base 12
    before = _hp(table, sid, victim)
    res = db._cast(table, sid, _load(table, sid, caster),
                   {'spellId': 'spore_bolt', 'source': 'grimoire',
                    'target': victim})
    after = _hp(table, sid, victim)
    assert before - after == 17                # 12 + round(1.0*5)
```

(If the file lacks `_two_adjacent_players`/`_set_level`/`_equip_spell`/`_hp`/`_load` helpers, add thin ones next to the existing fixtures — do not invent a new harness. Match the patterns already used by the field-damage tests in this file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_spells.py::test_field_damage_scales_with_caster_level -v`
Expected: FAIL — damage is 12 (flat), assert wants 17.

- [ ] **Step 3: Replace all five `spell['power']` reads**

In `undercity_db.py`, replace each occurrence. The caster doc in these functions is the parameter `doc`:

`_cast` self_heal branch:
```python
        eff = engine.effective_stats(doc)
        heal = max(0, min(engine.spell_power(spell, doc), eff['maxHp'] - doc['hp']))
```

`_cast_field` lair-target field_damage branch (the `new_hp = max(1, hp - spell['power'])` near the top of the field_damage block):
```python
        new_hp = max(1, hp - engine.spell_power(spell, doc))
```

`_cast_field` player `apply(t)` branch (`dmg = spell['power']`):
```python
                dmg = engine.spell_power(spell, doc)
```

`_cast_boss_strike` boss branch (`new_hp = max(1, hp - spell['power'])`):
```python
        new_hp = max(1, hp - engine.spell_power(spell, doc))
```

`_cast_boss_strike` lair branch (the second `new_hp = max(1, hp - spell['power'])`):
```python
        new_hp = max(1, hp - engine.spell_power(spell, doc))
```

- [ ] **Step 4: Confirm no stray reads remain**

Run: `cd infrastructure/lambda && grep -n "spell\['power'\]" undercity_db.py`
Expected: no output (all replaced).

- [ ] **Step 5: Run the new test + full spell suite**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_spells.py -v`
Expected: PASS, including `test_field_damage_scales_with_caster_level`.

- [ ] **Step 6: Run the whole suite (no regressions)**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: all pass. Existing spell tests were written at level 1, so their flat expectations still hold (level-1 scaling adds 0).

- [ ] **Step 7: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_spells.py
git commit -m "feat(undercity): route spell damage/heal/boss-strike through level scaling"
```

---

### Task 4: Client mirror — `power` data + `spellPower` helper

**Files:**
- Modify: `src/app/undercity/data/spells.ts`

- [ ] **Step 1: Add `power` to the SpellInfo interface**

In `spells.ts`, add to the `SpellInfo` interface (near `desc`):

```typescript
  /** Base magnitude for damage/heal/boss spells (mirrors undercity_data power).
   *  Omitted for buff/curse/traversal spells. Displayed value is spellPower(). */
  power?: number;
```

- [ ] **Step 2: Add `power` to the six power spells**

Update these six entries in the `SPELLS` array to include `power` (leave all other fields as-is):

```typescript
  // scrap_toss:  add  power: 8
  // spore_bolt:  add  power: 12
  // mend_flesh:  add  power: 12
  // rot_bolt:    add  power: 20
  // spore_burst: add  power: 30
  // queens_bane: add  power: 15
```

Concretely, e.g. `scrap_toss` becomes:
```typescript
  { id: 'scrap_toss', name: 'Scrap Toss', category: 'field', tier: 1, cooldownMin: 30, effect: 'field_damage', range: 5, power: 8, desc: 'Hurl city scrap at a rival.', icon: 'construction' },
```
(Note: drop the hardcoded "for 8 damage" from `desc` on all six — the number is now shown live via `spellPower`. Keep the flavor.)

- [ ] **Step 3: Add the mirror + label helpers**

Add near the bottom of `spells.ts` (mirror of `engine.spell_power`; must match `SPELL_POWER_PER_LEVEL = 1.0`):

```typescript
/** Client mirror of engine.spell_power — MUST match undercity_config
 *  SPELL_POWER_PER_LEVEL (1.0). Returns the level-scaled magnitude. */
export const SPELL_POWER_PER_LEVEL = 1.0;

export function spellPower(base: number | undefined, level: number): number {
  if (!base) return 0;
  return base + Math.round(SPELL_POWER_PER_LEVEL * (Math.max(1, level) - 1));
}

/** Short label for a spell's current effect at the player's level, e.g.
 *  "18 dmg", "17 HP", or '' for non-power spells. */
export function spellPowerLabel(spell: SpellInfo, level: number): string {
  if (!spell.power) return '';
  const v = spellPower(spell.power, level);
  if (spell.effect === 'self_heal') return `${v} HP`;
  return `${v} dmg`;
}
```

- [ ] **Step 4: Build to verify types**

Run: `npm run build`
Expected: build succeeds (no TS errors).

- [ ] **Step 5: Commit**

```bash
git add src/app/undercity/data/spells.ts
git commit -m "feat(undercity): client spellPower mirror + power data on spells"
```

---

### Task 5: Show the scaled number in the cast picker (UX)

**Files:**
- Modify: `src/app/undercity/tabs/board-tab.component.ts`
- Modify: `src/app/undercity/tabs/board-tab.component.html`
- Modify: `src/app/undercity/tabs/board-tab.component.scss`

Goal: in the spell/cast picker, each power spell shows a live magnitude chip using the player's current level, so a level-6 caster sees "17 dmg" on Spore Bolt.

- [ ] **Step 1: Locate the cast picker markup**

Run: `grep -n "spell\|cast\|SPELLS\|picker" src/app/undercity/tabs/board-tab.component.html | head -30`
Identify the block that lists castable spells (the spell-picker step of the cast flow).

- [ ] **Step 2: Expose the helper + level in the component**

In `board-tab.component.ts`, import and expose:

```typescript
import { spellPowerLabel } from '../data/spells';
// ...inside the component class:
protected readonly spellPowerLabel = spellPowerLabel;
protected playerLevel(): number {
  return this.store.you()?.level ?? 1;
}
```
(Use the store accessor this component already uses for the player doc — match the existing `this.store.you()` / `store.state()` pattern in the file; adjust the accessor name to whatever the file already uses.)

- [ ] **Step 3: Render the magnitude chip**

In `board-tab.component.html`, inside the spell option row, add after the spell name/desc (only shows for power spells because the label is empty otherwise):

```html
<span class="spell-power-chip" *ngIf="spellPowerLabel(spell, playerLevel()) as pw">{{ pw }}</span>
```

- [ ] **Step 4: Style the chip (reuse tokens)**

In `board-tab.component.scss`, add:

```scss
.spell-power-chip {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 7px;
  border-radius: 10px;
  font-size: 0.72rem;
  font-weight: 700;
  background: rgba(233, 30, 99, 0.15);   // --accent tint
  color: var(--accent-color, #e91e63);
}
```

- [ ] **Step 5: Build + manual verify**

Run: `npm run build`
Expected: build succeeds.

Then use the `run-undercity` skill to launch the app, reach the Cast picker, and confirm a power spell shows a live magnitude chip that increases with level. (No unit test — Angular has no runner here.)

- [ ] **Step 6: Commit**

```bash
git add src/app/undercity/tabs/board-tab.component.ts src/app/undercity/tabs/board-tab.component.html src/app/undercity/tabs/board-tab.component.scss
git commit -m "feat(undercity): show level-scaled spell power in cast picker"
```

---

### Task 6: Update the spell reference doc

**Files:**
- Modify: `specs/undercity-spells.md`

- [ ] **Step 1: Document scaling**

In `specs/undercity-spells.md`, under the Grimoire-spells table (or a new "Scaling" note near it), add:

```markdown
### Spell power scales with level

Damage/heal/boss-strike magnitude is `base + round(SPELL_POWER_PER_LEVEL ×
(level − 1))` (`SPELL_POWER_PER_LEVEL = 1.0`, `undercity_config.py`). The table
above lists **base** (level-1) values. Buff/curse/traversal spells are flat.
Server: `engine.spell_power`. Client mirror: `data/spells.ts` `spellPower`.
```

- [ ] **Step 2: Commit**

```bash
git add specs/undercity-spells.md
git commit -m "docs(undercity): document spell level-scaling"
```

---

## Self-review notes

- **Spec coverage (§2.5 pillar 1):** base+per-level formula (Tasks 1–2), applies to field_damage/self_heal/boss_strike everywhere (Task 3, all 5 sites), buffs/curses stay flat (helper returns 0 for powerless; Task 3 touches no buff branch), client mirror + display (Tasks 4–5), reference doc (Task 6). ✔
- **Never-kill floor:** untouched — every replaced site kept its `max(1, …)` floor; only the subtrahend changed. ✔
- **Naming consistency:** server `spell_power(spell, player)`; client `spellPower(base, level)` + `spellPowerLabel(spell, level)`; scalar `SPELL_POWER_PER_LEVEL` on both sides. ✔
- **Level-1 back-compat:** existing level-1 spell tests keep their flat expectations because scaling adds `round(1.0×0)=0` at level 1. ✔
