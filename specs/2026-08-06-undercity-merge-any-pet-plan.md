# Merge Any Pet Type to Raise Rarity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any owned pet be flat merge fuel toward a keeper's rarity, replacing the same-species-only rule; the keeper keeps its species/ability/level and only its tier rises.

**Architecture:** One-line rule removal + an active-pointer safety fix in the Python `_merge_pet` handler, then a client rewrite of the creature-tab merge popup from per-species cards into a single keeper + free-fodder panel (with a confirm before feeding in a higher-rarity pet).

**Tech Stack:** Python 3.11 Lambda (pytest + in-memory `FakeTable`), Angular 20 standalone signals component (no frontend test runner — verify with `npm run build`).

**Reference spec:** [specs/2026-08-06-undercity-merge-any-pet-design.md](2026-08-06-undercity-merge-any-pet-design.md)

**Run backend tests from** `infrastructure/lambda/`:
```bash
python -m pytest tests -q
```
Note: ~49 pre-existing failures in `test_deep_dungeons`/`test_map`/`engine`/`spells` are unrelated WIP — this plan must keep the **companions** suite green and add no new failures.

---

## File structure

| File | Responsibility | Change |
|------|----------------|--------|
| `infrastructure/lambda/undercity_db.py` | `_merge_pet`: drop species gate, clear consumed active pet | Modify |
| `infrastructure/lambda/tests/test_undercity_companions.py` | Cross-species + active-pet merge coverage | Modify |
| `src/app/undercity/tabs/creature-tab.component.ts` | Single-keeper merge model (signals/computed/methods) | Modify |
| `src/app/undercity/tabs/creature-tab.component.html` | Merge popup markup + top-bar button condition | Modify |

The client merge-point mirror in `src/app/undercity/data/pets.ts` (`mergePointsFor`, `mergeWouldRankUp`, `PET_MERGE_COST`) is already species-agnostic — **no change**.

---

## Task 1: Server — merge any species + clear consumed active pet

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_merge_pet`, lines ~1129–1159)
- Test: `infrastructure/lambda/tests/test_undercity_companions.py`

- [ ] **Step 1: Replace the cross-species rejection test with a rank-up test**

In `tests/test_undercity_companions.py`, replace the whole `test_merge_rejects_cross_species` function:

```python
def test_merge_rejects_cross_species(table):
    sid, doc = _player_at(table, 'n1')
    keeper = _give_pet(doc, 'baby_leyline_prowler')
    fodder = _give_pet(doc, 'decimator_beetle')
    status, _ = db._merge_pet(table, sid, doc, {
        'targetPetId': keeper['id'], 'fodderPetIds': [fodder['id']]})
    assert status == 409
    assert len(doc['pets']) == 2
```

with:

```python
def test_merge_cross_species_ranks_up(table):
    sid, doc = _player_at(table, 'n1')
    keeper = _give_pet(doc, 'baby_leyline_prowler', tier=1)   # attack role
    f1 = _give_pet(doc, 'decimator_beetle', tier=1)           # defend — different species
    f2 = _give_pet(doc, 'rat', tier=1)                        # forage — different species
    status, _ = db._merge_pet(table, sid, doc, {
        'targetPetId': keeper['id'], 'fodderPetIds': [f1['id'], f2['id']]})
    assert status == 200
    assert keeper['tier'] == 2                               # 1+1 pts >= cost-to-T2 (2)
    assert keeper['species'] == 'baby_leyline_prowler'       # identity unchanged
    assert [p['id'] for p in doc['pets']] == [keeper['id']]
```

- [ ] **Step 2: Add active-pointer tests**

Append to `tests/test_undercity_companions.py`:

```python
def test_merge_consuming_active_pet_clears_pointer(table):
    sid, doc = _player_at(table, 'n1')
    keeper = _give_pet(doc, 'baby_leyline_prowler', tier=1)
    fodder = _give_pet(doc, 'slime', tier=1)
    doc['activePetId'] = fodder['id']
    status, _ = db._merge_pet(table, sid, doc, {
        'targetPetId': keeper['id'], 'fodderPetIds': [fodder['id']]})
    assert status == 200
    assert doc['activePetId'] is None
    assert [p['id'] for p in doc['pets']] == [keeper['id']]


def test_merge_keeper_survives_as_active(table):
    sid, doc = _player_at(table, 'n1')
    keeper = _give_pet(doc, 'baby_leyline_prowler', tier=1)
    fodder = _give_pet(doc, 'slime', tier=1)
    doc['activePetId'] = keeper['id']
    status, _ = db._merge_pet(table, sid, doc, {
        'targetPetId': keeper['id'], 'fodderPetIds': [fodder['id']]})
    assert status == 200
    assert doc['activePetId'] == keeper['id']
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `python -m pytest tests/test_undercity_companions.py -q -k "cross_species or active_pet or survives_as_active"`
Expected: `test_merge_cross_species_ranks_up` FAILS (currently returns 409) and `test_merge_consuming_active_pet_clears_pointer` FAILS (pointer not cleared).

- [ ] **Step 4: Update `_merge_pet`**

Replace the whole `_merge_pet` function (lines ~1129–1159) with:

```python
def _merge_pet(table, sid, doc, payload):
    target = _find_pet(doc, payload.get('targetPetId'))
    if not target:
        return _err('No such pet.', 409)
    fodder_ids = payload.get('fodderPetIds') or []
    if not fodder_ids:
        return _err('Pick pets to merge in.')
    fodder = []
    for fid in fodder_ids:
        p = _find_pet(doc, fid)
        if not p or p['id'] == target['id']:
            return _err('Bad merge selection.', 409)
        fodder.append(p)
    # Award merge points (flat by fodder tier, ANY species), then advance tiers
    # while affordable (cap tier 4), banking the remainder.
    gained = sum(data.PET_MERGE_POINTS[p['tier']] for p in fodder)
    target['mergeProgress'] = target.get('mergeProgress', 0) + gained
    while target['tier'] < 4:
        cost = data.PET_MERGE_COST[target['tier'] + 1]
        if target['mergeProgress'] < cost:
            break
        target['mergeProgress'] -= cost
        target['tier'] += 1
    # Consume fodder; clear the active pointer if the active pet was fed in.
    consumed = {p['id'] for p in fodder}
    doc['pets'] = [p for p in doc['pets'] if p['id'] not in consumed]
    if doc.get('activePetId') in consumed:
        doc['activePetId'] = None
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    return _ok(doc, text=f"Your {data.PET_SPECIES[target['species']]['name']} grows stronger.")
```

The only diffs vs. the current function: the per-fodder `if p['species'] != target['species']` rejection is gone, the `activePetId`-clear block is added, and the fuel comment is updated.

- [ ] **Step 5: Run the merge tests to verify they pass**

Run: `python -m pytest tests/test_undercity_companions.py -q`
Expected: PASS (all companions tests, including `test_merge_same_species_ranks_up` and `test_merge_partial_progress_carries`, still green — flat values are unchanged so same-species behaves identically).

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_companions.py
git commit -m "feat(undercity): merge any pet species as flat rarity fuel"
```

---

## Task 2: Client — single-keeper merge model (TS)

Replace the per-species merge state with one keeper + free fodder. All edits are in `src/app/undercity/tabs/creature-tab.component.ts`.

**Files:**
- Modify: `src/app/undercity/tabs/creature-tab.component.ts`

- [ ] **Step 1: Replace the `MergeGroup` interface with `MergeState`**

Replace the interface at lines ~104–122:

```typescript
/** One species' merge card in the roster-wide Merge popup: the keeper to raise,
 *  the same-species dupes available as fodder, and the derived progress. */
interface MergeGroup {
  species: PetSpecies;
  name: string;
  keeper: Pet;
  /** All other same-species pets (candidates to feed in). */
  fodder: Pet[];
  /** Fodder currently ticked (subset of `fodder`). */
  selected: Pet[];
  /** keeper.mergeProgress + points from `selected`. */
  points: number;
  /** Points needed to reach the next tier. */
  need: number;
  /** Whether `selected` would advance the keeper at least one tier. */
  ready: boolean;
  currentRarity: string;
  nextRarity: string;
}
```

with:

```typescript
/** The single-keeper merge model: the pet being raised, every OTHER owned pet as
 *  candidate fuel (any species), the ticked subset, and derived progress. */
interface MergeState {
  keeper: Pet;
  fodder: Pet[];
  selected: Pet[];
  /** keeper.mergeProgress + points from `selected`. */
  points: number;
  /** Points needed to reach the keeper's next tier. */
  need: number;
  /** Whether `selected` would advance the keeper at least one tier. */
  ready: boolean;
  currentRarity: string;
  nextRarity: string;
  /** True if any ticked fodder outranks the keeper (arms the confirm). */
  highRarityFuel: boolean;
}
```

- [ ] **Step 2: Replace the merge signals**

Replace lines ~289–296:

```typescript
  /** Fodder pet ids ticked for a merge into the selected keeper. */
  protected readonly mergePicks = signal<Set<string>>(new Set());
  /** Whether the roster-wide Merge popup is open. */
  protected readonly mergeOpen = signal(false);
  /** Per-species keeper override (species → pet id). Empty = use auto-pick. */
  protected readonly mergeKeepers = signal<Record<string, string>>({});
  /** Species whose inline keeper picker is currently expanded (null = none). */
  protected readonly mergeKeeperPicker = signal<PetSpecies | null>(null);
```

with:

```typescript
  /** Fodder pet ids ticked for a merge into the keeper. */
  protected readonly mergePicks = signal<Set<string>>(new Set());
  /** Whether the roster-wide Merge popup is open. */
  protected readonly mergeOpen = signal(false);
  /** Explicit keeper id; null = auto-pick the best non-max-tier pet. */
  protected readonly mergeKeeperId = signal<string | null>(null);
  /** Armed high-rarity-fuel confirm (a second tap actually commits the merge). */
  protected readonly mergeConfirm = signal(false);
```

- [ ] **Step 3: Replace `mergeGroups` + `mergeableSpeciesExist` with `mergeState` + `canMerge`**

Replace the `mergeGroups` computed and the `mergeableSpeciesExist` computed (lines ~311–356) with:

```typescript
  /** The single-keeper merge model, or null when nothing can be ranked up. */
  protected readonly mergeState = computed<MergeState | null>(() => {
    const pets = this.store.you()?.pets ?? [];
    if (pets.length < 2) return null;
    const eligible = pets.filter((p) => !atMaxTier(p));
    if (!eligible.length) return null;
    // Auto keeper: best non-max-tier pet (tier → level → banked progress).
    const sorted = [...eligible].sort(
      (a, b) => b.tier - a.tier || b.level - a.level || b.mergeProgress - a.mergeProgress,
    );
    const overrideId = this.mergeKeeperId();
    const keeper = eligible.find((p) => p.id === overrideId) ?? sorted[0];
    const fodder = pets.filter((p) => p.id !== keeper.id);
    const picks = this.mergePicks();
    const selected = fodder.filter((p) => picks.has(p.id));
    return {
      keeper,
      fodder,
      selected,
      points: keeper.mergeProgress + mergePointsFor(selected),
      need: PET_MERGE_COST[keeper.tier + 1] ?? Infinity,
      ready: mergeWouldRankUp(keeper, selected),
      currentRarity: tierRarity(keeper.tier).label,
      nextRarity: tierRarity(keeper.tier + 1).label,
      highRarityFuel: selected.some((f) => f.tier > keeper.tier),
    };
  });

  /** Is there anything to merge right now? Drives the top-bar button. */
  protected readonly canMerge = computed<boolean>(() => this.mergeState() !== null);
```

- [ ] **Step 4: Rewrite the merge action + helper methods**

Replace `openMerge` / `closeMerge` / `speciesPets` / `toggleKeeperPicker` / `chooseKeeper` / `mergeProgressPct` (lines ~429–462) AND the `mergeGroup` method (lines ~464–482) with:

```typescript
  protected openMerge(): void {
    this.mergePicks.set(new Set());
    this.mergeKeeperId.set(null);
    this.mergeConfirm.set(false);
    this.mergeOpen.set(true);
  }

  protected closeMerge(): void {
    this.mergeOpen.set(false);
    this.mergeConfirm.set(false);
  }

  /** Make a pet the keeper; it can't also be fodder, so drop it from picks and
   *  disarm any pending confirm. */
  protected chooseKeeper(petId: string): void {
    this.mergeKeeperId.set(petId);
    this.mergePicks.update((s) => {
      const next = new Set(s);
      next.delete(petId);
      return next;
    });
    this.mergeConfirm.set(false);
  }

  protected mergeProgressPct(): number {
    const st = this.mergeState();
    if (!st || !st.need || st.need === Infinity) return 0;
    return Math.min(100, Math.round((st.points / st.need) * 100));
  }

  /** Merge the ticked fodder into the keeper. Higher-rarity fuel arms a confirm
   *  on the first tap; the second tap (mergeConfirm true) commits. Keeps the
   *  popup open and lets mergeState() recompute; closes only if nothing remains. */
  async doMerge(): Promise<void> {
    const st = this.mergeState();
    if (!st || !st.ready) return;
    const fodderPetIds = st.selected.map((p) => p.id);
    if (!fodderPetIds.length) return;
    if (st.highRarityFuel && !this.mergeConfirm()) {
      this.mergeConfirm.set(true);
      return;
    }
    await this.run(async () => {
      const resp = await this.store.action('merge-pet', {
        targetPetId: st.keeper.id,
        fodderPetIds,
      });
      this.showToast(resp.text ?? 'Merged.');
    });
    this.mergePicks.set(new Set());
    this.mergeKeeperId.set(null);
    this.mergeConfirm.set(false);
    if (!this.mergeState()) this.closeMerge();
  }
```

Keep `toggleMergePick` but disarm the confirm when the selection changes. Replace it (lines ~421–427):

```typescript
  protected toggleMergePick(id: string): void {
    this.mergePicks.update((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
```

with:

```typescript
  protected toggleMergePick(id: string): void {
    this.mergePicks.update((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
    this.mergeConfirm.set(false);  // selection changed — re-evaluate high-rarity confirm
  }
```

- [ ] **Step 5: Verify no dangling references compile-check comes in Task 3**

Do NOT build yet — the template still references the old members (`mergeGroups`, `mergeableSpeciesExist`, `mergeGroup`, `toggleKeeperPicker`, `speciesPets`, `chooseKeeper(species, id)`). Task 3 updates the template; build at the end of Task 3.

- [ ] **Step 6: Commit**

```bash
git add src/app/undercity/tabs/creature-tab.component.ts
git commit -m "feat(undercity): single-keeper merge model in creature tab"
```

---

## Task 3: Client — merge popup markup + top-bar button

**Files:**
- Modify: `src/app/undercity/tabs/creature-tab.component.html`

- [ ] **Step 1: Update the top-bar Merge button condition**

At line ~758, replace:

```html
                      @if (mergeableSpeciesExist()) {
                        <button type="button" class="uc-btn merge-btn" (click)="openMerge()">
                          <mat-icon class="mi">call_merge</mat-icon> Merge
                        </button>
```

with:

```html
                      @if (canMerge()) {
                        <button type="button" class="uc-btn merge-btn" (click)="openMerge()">
                          <mat-icon class="mi">call_merge</mat-icon> Merge
                        </button>
```

- [ ] **Step 2: Replace the merge popup body**

Replace the whole `@for (group of mergeGroups(); track group.species) { … } @empty { … }` block (lines ~1192–1243, inside `<div class="merge-popup-body">`) with:

```html
            @if (mergeState(); as st) {
              <div class="merge-group" [attr.data-rarity]="petRarity(st.keeper)">
                <div class="merge-keeper">
                  <img class="pet-sprite" [src]="petSpriteUrl(st.keeper.species)" [alt]="petInfo(st.keeper.species).name" />
                  <div class="merge-keeper-info">
                    <span class="merge-keeper-name">{{ petInfo(st.keeper.species).name }}
                      <span class="rarity-badge {{ petRarity(st.keeper) }}">{{ st.currentRarity }}</span>
                    </span>
                    <span class="merge-keeper-rarity">{{ st.currentRarity }} → {{ st.nextRarity }} · keeper Lv {{ st.keeper.level }}</span>
                  </div>
                </div>

                <span class="merge-label muted">Feed in any pets (tap ★ to make one the keeper):</span>
                <div class="merge-fodder">
                  @for (f of st.fodder; track f.id) {
                    <div class="merge-chip-wrap">
                      <button type="button" class="merge-chip" [class.picked]="mergePicks().has(f.id)"
                              [attr.data-rarity]="petRarity(f)" (click)="toggleMergePick(f.id)">
                        <img class="pet-sprite" [src]="petSpriteUrl(f.species)" [alt]="petInfo(f.species).name" />
                        <span>{{ petInfo(f.species).name }} · {{ tierRarity(f.tier).label }}</span>
                      </button>
                      @if (!petAtMaxTier(f)) {
                        <button type="button" class="merge-star" title="Make keeper" (click)="chooseKeeper(f.id)">★</button>
                      }
                    </div>
                  }
                </div>

                <div class="merge-progress">
                  <div class="merge-progress-bar">
                    <div class="merge-progress-fill" [style.width.%]="mergeProgressPct()"></div>
                  </div>
                  <span class="merge-progress-num">{{ st.points }} / {{ st.need }}</span>
                </div>

                @if (mergeConfirm()) {
                  <p class="merge-warn muted">Feeding in a higher-rarity pet as fuel — are you sure?</p>
                  <div class="merge-confirm-row">
                    <button class="uc-btn" (click)="mergeConfirm.set(false)">Cancel</button>
                    <button class="uc-btn merge-go" [disabled]="busy()" (click)="doMerge()">Confirm merge</button>
                  </div>
                } @else {
                  <button class="uc-btn merge-go" [disabled]="busy() || !st.ready" (click)="doMerge()">
                    {{ st.ready ? (st.highRarityFuel ? 'Merge…' : 'Merge') : 'Pick more pets' }}
                  </button>
                }
              </div>
            } @else {
              <p class="muted bag-empty">No pets to rank up right now.</p>
            }
```

- [ ] **Step 3: Update the popup subtitle**

At line ~1187, replace:

```html
              <span class="item-sheet-sub">Feed duplicates into one to raise its rarity</span>
```

with:

```html
              <span class="item-sheet-sub">Feed any pets into one to raise its rarity</span>
```

- [ ] **Step 4: Build to verify the client compiles**

Run: `npm run build`
Expected: build succeeds. Angular's strict template checker will fail on any leftover reference to a removed member — if it does, grep for `mergeGroups`, `mergeableSpeciesExist`, `mergeGroup(`, `toggleKeeperPicker`, `speciesPets`, `mergeKeepers`, `mergeKeeperPicker` in both creature-tab files and remove/replace them.

- [ ] **Step 5: Add minimal styles for the new controls (only if unstyled)**

The new `merge-chip-wrap`, `merge-star`, `merge-warn`, and `merge-confirm-row` classes may have no rules. If the star button or confirm row look unstyled, add to `creature-tab.component.scss` near the existing `.merge-*` rules:

```scss
.merge-chip-wrap { position: relative; display: inline-block; }
.merge-star {
  position: absolute; top: -6px; right: -6px;
  width: 20px; height: 20px; border-radius: 50%;
  border: none; cursor: pointer; line-height: 1;
  background: var(--accent-color); color: #12100c;
}
.merge-warn { margin: 0.5rem 0 0.25rem; }
.merge-confirm-row { display: flex; gap: 0.5rem; }
```

Reuse existing design tokens (`--accent-color`, etc. per STYLE_GUIDE.md); don't invent new colors. Skip this step if the elements already inherit acceptable styling.

- [ ] **Step 6: Commit**

```bash
git add src/app/undercity/tabs/creature-tab.component.html src/app/undercity/tabs/creature-tab.component.scss
git commit -m "feat(undercity): merge popup — single keeper + any-pet fodder"
```

---

## Final verification

- [ ] Companions suite green: `cd infrastructure/lambda && python -m pytest tests/test_undercity_companions.py -q`
- [ ] Full backend suite adds no new failures beyond the known ~49 WIP ones: `python -m pytest tests -q`
- [ ] Frontend compiles: `npm run build`
- [ ] No stragglers: `git grep -n "mergeGroups\|mergeableSpeciesExist\|mergeGroup(\|toggleKeeperPicker\|speciesPets\|mergeKeepers\|mergeKeeperPicker\|MergeGroup"` returns nothing in `src/app/undercity/tabs/creature-tab.*`.
- [ ] Manual (optional, via `run-undercity` skill): open the creature tab with 2+ pets of mixed species, tap Merge, feed different-species pets into a keeper, confirm rarity climbs; verify the ★ reassigns the keeper; verify feeding a higher-rarity pet prompts the confirm.

**Deploy:** the user runs the deploy (`cdk deploy` for the Lambda, `npm run deploy` for the site). End with tests green and note a deploy is needed for both backend and frontend.

---

## Self-review notes

- **Spec coverage:** flat-fuel any-species (Task 1 server + `test_merge_cross_species_ranks_up`), active-pointer safety (Task 1 + two tests), keep rank-up gate (`doMerge` guards on `st.ready`; button disabled unless ready), high-rarity confirm on strictly-greater tier (`highRarityFuel` + `mergeConfirm` flow), single-keeper UI (Tasks 2–3), mirror unchanged (noted). All spec sections map to a task.
- **Type consistency:** `MergeState` fields (`keeper`/`fodder`/`selected`/`points`/`need`/`ready`/`currentRarity`/`nextRarity`/`highRarityFuel`), signals `mergeKeeperId`/`mergeConfirm`/`mergePicks`, computeds `mergeState`/`canMerge`, and methods `chooseKeeper(petId)`/`doMerge()`/`mergeProgressPct()`/`toggleMergePick(id)`/`openMerge()`/`closeMerge()` are used consistently across TS and template. Template calls only class-exposed members (`petInfo`, `petRarity`, `petAtMaxTier`, `petSpriteUrl`, `tierRarity` — all confirmed present).
- **No placeholders:** every code step shows full code; the only conditional step (Step 5 of Task 3) is styling that may already be inherited and says exactly what to add if not.
