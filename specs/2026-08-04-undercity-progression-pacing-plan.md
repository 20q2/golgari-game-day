# Undercity Progression Pacing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make character leveling last most of a game night (currently caps in ~4h) by steepening the XP curve, add a Sigil XP milestone reward, and fix the tier-2 elite/wild XP-reward inversion — all without raising the level cap or power ceiling.

**Architecture:** Balance numbers are server-authoritative in the Python Lambda (`undercity_config.py` scalars, `undercity_data.py` tables/curve) and the client only *displays* them. The XP curve is the one number mirrored client-side (`src/app/undercity/data/forms.ts`). Each task is TDD: adjust the concrete-number assertion, watch it fail, change the number, watch it pass, commit.

**Tech Stack:** Python 3.11 + pytest (in-memory `FakeTable` suite) for the backend; Angular 20 / TypeScript for the client mirror. Test loop: `cd infrastructure/lambda && python -m pytest tests -q`. Client build: `npm run build` from repo root.

**Spec:** [specs/2026-08-04-undercity-progression-pacing-design.md](2026-08-04-undercity-progression-pacing-design.md)

---

## ⚠️ Precondition — resolve working-tree overlap first

The working tree already has **uncommitted changes in the exact files this plan edits** (`infrastructure/lambda/undercity_config.py`, `undercity_data.py`, `src/app/undercity/data/forms.ts`). Because git stages whole files, the commit steps below would sweep that WIP in.

**Before starting:** confirm with the repo owner that those files' current WIP is intended to ship together, or have them commit/stash it first. Then start from a clean tree for these files. Do **not** `git add -A`; every commit step uses explicit paths.

---

## File Structure

- `infrastructure/lambda/undercity_config.py` — add XP-curve scalars + `SIGIL_XP` (scalars only; re-exported into `undercity_data` via `from undercity_config import *`).
- `infrastructure/lambda/undercity_data.py` — rewrite `xp_to_next` (line 34) to read the scalars; bump `WILDERNESS_NPCS` XP (line ~990).
- `infrastructure/lambda/undercity_db.py` — grant `SIGIL_XP` in `_award_lair_kill` (line ~4927).
- `src/app/undercity/data/forms.ts` — mirror the new curve (line 152).
- Tests: `tests/test_undercity_engine.py` (curve + level-up), `tests/test_undercity_db.py` (sigil XP), `tests/test_undercity_enemy_level.py` (new reward-monotonicity test).

---

## Task 1: Steepen the XP curve (config scalars + formula)

**Files:**
- Modify: `infrastructure/lambda/undercity_config.py` (new scalar block)
- Modify: `infrastructure/lambda/undercity_data.py:34` (`xp_to_next`)
- Test: `infrastructure/lambda/tests/test_undercity_engine.py:68-96`

- [ ] **Step 1: Update the failing curve + level-up tests**

In `tests/test_undercity_engine.py`, replace `test_xp_curve`, `test_level_up_grants`, and `test_gorgon_levels_slower` (lines 68-96) with the new expected numbers. New curve: `xp_to_next(1)=20`, `xp_to_next(9)=150`. L1→2 now costs 20, so the level-up fixtures seed `xp: 20`.

```python
def test_xp_curve():
    # Progressive curve (design 2026-08-04): flat-ish early, ramps after L4.
    assert data.xp_to_next(1) == 20      # anchor: 2 basic wild kills (10 XP each)
    assert data.xp_to_next(4) == 50
    assert data.xp_to_next(5) == 62      # ramp begins
    assert data.xp_to_next(9) == 150
    assert data.xp_to_next(11) == 218
    # A single T2/T3 elite (35-100 XP) must never auto-level in the ramp band.
    assert data.xp_to_next(5) > 47       # vs a T2 elite
    assert data.xp_to_next(8) > 100      # vs the fattest T3 apex elite


def test_level_up_grants():
    p = {'level': 1, 'xp': 20, 'maxHp': 30, 'hp': 10, 'statPoints': 0,
         'spentThisLevel': {'atk': 1, 'def': 0, 'spd': 0}}
    leveled = apply_level_ups(p)
    assert leveled == 1
    assert p['level'] == 2 and p['xp'] == 0
    assert p['maxHp'] == 33 and p['hp'] == 13
    assert p['statPoints'] == 2
    assert p['spentThisLevel'] == {'atk': 0, 'def': 0, 'spd': 0}


def test_gorgon_levels_slower():
    p = {'level': 1, 'xp': 20, 'maxHp': 30, 'hp': 10, 'statPoints': 0,
         'passives': ['stonewright'], 'spentThisLevel': {}}
    assert apply_level_ups(p) == 1
    assert p['statPoints'] == 1          # Gorgon banks 1, not the usual 2
    assert p['maxHp'] == 33              # HP-per-level unchanged
```

(Leave `test_level_cap` unchanged — a capped creature still gains 0 levels.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py -k "xp_curve or level_up_grants or gorgon_levels_slower" -q`
Expected: FAIL — `test_xp_curve` asserts 20 but the current formula returns 25.

- [ ] **Step 3: Add the curve scalars to config**

In `infrastructure/lambda/undercity_config.py`, add a block after the roll-economy section (near line 36, after the `GRIMOIRE_SWAP_COOLDOWN_MIN` line):

```python
# ── XP curve (design 2026-08-04 progression pacing) ──────────────────────────
# Progressive per-level cost so leveling paces a whole game night instead of
# capping in ~4h. Flat-ish early (casuals unaffected), ramps after RAMP_FROM so
# a single T2/T3 elite never auto-levels. Total L1->12 = 1050 (was 550). Cap
# stays 12 — this changes PACE, not the power ceiling. Client mirror in
# src/app/undercity/data/forms.ts::xpToNext. C=3 (1190) / C=4 (1330) are the
# steeper reserves; sim harness in infrastructure/lambda/sim/.
XP_CURVE_BASE = 10
XP_CURVE_LINEAR = 10
XP_CURVE_RAMP = 2          # the "C" coefficient
XP_CURVE_RAMP_FROM = 4     # ramp only bites for levels above this
```

- [ ] **Step 4: Rewrite `xp_to_next` to use the scalars**

In `infrastructure/lambda/undercity_data.py`, replace the function at line 34:

```python
def xp_to_next(level: int) -> int:
    """XP cost to go from `level` to `level + 1`.

    Progressive curve (design 2026-08-04): flat-ish early so casuals keep fast
    early levels, then a quadratic ramp above XP_CURVE_RAMP_FROM so leveling
    lasts the night and a single elite never auto-levels. Scalars in
    undercity_config; client mirror in src/app/undercity/data/forms.ts.
    """
    ramp = max(0, level - XP_CURVE_RAMP_FROM)
    return XP_CURVE_BASE + XP_CURVE_LINEAR * level + XP_CURVE_RAMP * ramp * ramp
```

(The scalars resolve as module globals — `undercity_data` does `from undercity_config import *`.)

- [ ] **Step 5: Run the curve tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py -k "xp_curve or level_up_grants or gorgon_levels_slower" -q`
Expected: PASS (3 passed).

- [ ] **Step 6: Run the FULL suite (other tests level creatures)**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS. If a db/spell test that grants XP now asserts a stale level/xp, update it to the new curve value (do not loosen the assertion). Note any it touches.

- [ ] **Step 7: Commit**

```bash
git add infrastructure/lambda/undercity_config.py infrastructure/lambda/undercity_data.py infrastructure/lambda/tests/test_undercity_engine.py
git commit -m "feat(undercity): progressive XP curve so leveling paces the night"
```

---

## Task 2: Sigil grants XP

**Files:**
- Modify: `infrastructure/lambda/undercity_config.py` (`SIGIL_XP`)
- Modify: `infrastructure/lambda/undercity_db.py:4913-4933` (`_award_lair_kill`)
- Test: `infrastructure/lambda/tests/test_undercity_db.py:2076-2101`

- [ ] **Step 1: Extend the sigil test with XP assertions**

In `tests/test_undercity_db.py`, add XP assertions to `test_global_first_kill_pays_major_then_vestige_pays_minor_with_sigil`. First-time sigil claimants (Alex first, Bea first) get the reward XP **plus** `SIGIL_XP`; the repeat visit (Alex again, no sigil) gets only the reward XP.

Add after line 2085 (`assert out['sigil'] == 'city'`):
```python
    assert out['xp'] == b['first']['xp'] + data.SIGIL_XP     # first clear + sigil bonus
```
Add after line 2095 (`assert out2['sigil'] == 'city'`):
```python
    assert out2['xp'] == b['repeat']['xp'] + data.SIGIL_XP   # Bea's first sigil, vestige reward
```
Add after line 2101 (`assert 'sigil' not in out3`):
```python
    assert out3['xp'] == b['repeat']['xp']                   # no sigil -> no sigil XP
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k global_first_kill_pays_major -q`
Expected: FAIL — `data.SIGIL_XP` does not exist yet (AttributeError) / `out['xp']` is only the reward XP.

- [ ] **Step 3: Add the `SIGIL_XP` scalar**

In `infrastructure/lambda/undercity_config.py`, add near the XP-curve block from Task 1:

```python
# Flat XP granted the first time a player claims a biome Guild Sigil (on top of
# the lair boss's own XP). Five biome sigils => up to 250 bonus XP over a night,
# an alternative progression path to grinding wilds. Design 2026-08-04.
SIGIL_XP = 50
```

- [ ] **Step 4: Grant `SIGIL_XP` in the sigil-claim block**

In `infrastructure/lambda/undercity_db.py`, inside `_award_lair_kill`, extend the `if personal_first and sigil_biome:` block (starts line 4927). Immediately after `out['sigil'] = sigil_biome` (line 4930), add the grant and fold it into the outbound totals:

```python
        out['sigil'] = sigil_biome
        sigil_levels = _grant_xp(table, sid, doc, data.SIGIL_XP)
        out['xp'] = reward['xp'] + data.SIGIL_XP
        if levels + sigil_levels:
            out['levels'] = levels + sigil_levels
```

(`levels` was computed at line 4916 from the reward XP; `_grant_xp` mutates `doc` and returns any new level-ups, so summing them keeps `out['levels']` correct. On a non-sigil kill this block is skipped and `out['xp']`/`out['levels']` keep their line-4917-4920 values.)

- [ ] **Step 5: Run the sigil test to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k global_first_kill_pays_major -q`
Expected: PASS.

- [ ] **Step 6: Run the FULL suite**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add infrastructure/lambda/undercity_config.py infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): claiming a Guild Sigil grants bonus XP"
```

---

## Task 3: Fix the tier-2 reward inversion (XP only)

**Files:**
- Modify: `infrastructure/lambda/undercity_data.py:975-988` (`WILDERNESS_NPCS`)
- Test: `infrastructure/lambda/tests/test_undercity_enemy_level.py` (new test)

- [ ] **Step 1: Add a reward-monotonicity test**

In `tests/test_undercity_enemy_level.py`, add a new test at the end of the file. It locks the ladder: tier-2 wild < tier-2 elite < tier-3 wild by XP. (`WILDERNESS_NPCS` is the tier-2 *elite* pool per `TIER_NPCS[2]`; `DEPTHS_MID` is tier-2 wild; tier-3 wild = `DEPTHS_DEEP + WILDERNESS_ELITE_NPCS`.)

```python
def test_tier2_elite_outrewards_tier2_wild_by_xp():
    # Region-tier remap made WILDERNESS_NPCS the tier-2 ELITE pool; the tankier
    # elite must out-reward the tier-2 wild (DEPTHS_MID) on XP, and stay below
    # the tier-3 wild floor. Bounty is deliberately left alone (spore economy
    # out of scope) — see the design doc's carve-out.
    t2_wild_max = max(n['xp'] for n in data.DEPTHS_MID)
    t2_elite = [n['xp'] for n in data.WILDERNESS_NPCS]
    t3_wild_min = min(n['xp'] for n in (data.DEPTHS_DEEP + data.WILDERNESS_ELITE_NPCS))
    assert min(t2_elite) > t2_wild_max          # elite floor beats wild ceiling
    assert max(t2_elite) < t3_wild_min          # still below the next tier
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_enemy_level.py -k tier2_elite_outrewards -q`
Expected: FAIL — current `WILDERNESS_NPCS` XP is 35-38, below `DEPTHS_MID`'s max of 45.

- [ ] **Step 3: Raise the `WILDERNESS_NPCS` XP values**

In `infrastructure/lambda/undercity_data.py`, in the `WILDERNESS_NPCS` list (lines 975-988), change only the `xp` field on each entry (leave `bounty` and stats untouched):

- `sluiceway_scorpion`: `'xp': 35` → `'xp': 46`
- `loleth_troll`: `'xp': 38` → `'xp': 48`
- `large_bear`: `'xp': 35` → `'xp': 46`
- `mosspit_skeleton`: `'xp': 38` → `'xp': 49`

Result: tier-2 elite XP 46-49, above tier-2 wild (42-45) and below tier-3 wild (50+). Add a short inline comment on the first entry: `# xp bumped 2026-08-04: tier-2 ELITE must out-reward tier-2 wild (DEPTHS_MID).`

- [ ] **Step 4: Run the monotonicity test to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_enemy_level.py -k tier2_elite_outrewards -q`
Expected: PASS.

- [ ] **Step 5: Run the FULL suite (guards enemy_level bands unchanged)**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS — `enemy_level` is stat-based, so `test_wilderness_wilds_are_mid_level` etc. are unaffected by XP changes.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_data.py infrastructure/lambda/tests/test_undercity_enemy_level.py
git commit -m "fix(undercity): tier-2 elite out-rewards tier-2 wild on XP"
```

---

## Task 4: Mirror the new curve in the client

**Files:**
- Modify: `src/app/undercity/data/forms.ts:152-154`

- [ ] **Step 1: Update the client curve to match the server**

In `src/app/undercity/data/forms.ts`, replace `xpToNext` (lines 152-154):

```typescript
// Mirror of undercity_data.xp_to_next (undercity_config XP_CURVE_* scalars).
// Progressive curve (design 2026-08-04): flat-ish early, ramps after level 4.
// Keep in sync with the server — the client only displays this for the XP bar.
export function xpToNext(level: number): number {
  const ramp = Math.max(0, level - 4);
  return 10 + 10 * level + 2 * ramp * ramp;
}
```

- [ ] **Step 2: Build the client to verify it compiles**

Run: `npm run build`
Expected: build succeeds (no TS errors). The XP-bar denominator now matches the server threshold at every level.

- [ ] **Step 3: Commit**

```bash
git add src/app/undercity/data/forms.ts
git commit -m "feat(undercity): mirror progressive XP curve in client XP bar"
```

---

## Final verification

- [ ] Backend green: `cd infrastructure/lambda && python -m pytest tests -q` → all pass.
- [ ] Client builds: `npm run build` → success.
- [ ] Sanity-read the curve: `python -c "import undercity_data as d; print([d.xp_to_next(l) for l in range(1,12)], 'total', sum(d.xp_to_next(l) for l in range(1,12)))"` from `infrastructure/lambda` → `[20, 30, 40, 50, 62, 78, 98, 122, 150, 182, 218] total 1050`.
- [ ] **Deploy is the host's job.** Nothing changes for players until the host `cdk deploy`s the Lambda. End with tests green and note a deploy is needed. Optionally re-run the `sim/` harness first to confirm pacing.

---

## Self-review (completed by plan author)

- **Spec coverage:** Change 1 (curve) → Task 1 + Task 4 (client mirror). Change 2 (Sigil XP) → Task 2. Change 3 (tier-2 XP fix) → Task 3. Non-goals (spores/crafting/cap) → no tasks, as intended. ✅
- **Placeholders:** none — every code step shows the full edit and expected test output. ✅
- **Type/name consistency:** `SIGIL_XP`, `XP_CURVE_BASE/LINEAR/RAMP/RAMP_FROM` used identically across config, `xp_to_next`, and tests; `_grant_xp(table, sid, doc, amount)` and `_award_lair_kill`'s `levels`/`reward`/`out` names match the real source at `undercity_db.py:4893-4933`. Client `ramp`/formula matches server. ✅
