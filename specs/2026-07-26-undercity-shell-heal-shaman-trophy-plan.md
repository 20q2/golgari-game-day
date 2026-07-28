# Shambling Shell heal + Deathrite Shaman trophy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Shambling Shell (and its apexes) an innate Mend Flesh spell, and replace Deathrite Shaman's Soul Harvest with "Soul Trophy" — a post-win menu that grants +[foe level] to a chosen stat for the next battle.

**Architecture:** All rules live server-side in the Python engine (`undercity_data.py`, `undercity_db.py`, `undercity_engine.py`); the Angular `src/app/undercity/data/*.ts` files are display mirrors kept in sync by hand (spells are auto-generated via `sync_spells.py`). Mend Flesh is granted as an innate gift gated on the accumulated `rootwall` passive (free apex-persistence, no migration). The trophy bonus reuses the existing one-battle-buff rail, extended with a variable-amount buff entry.

**Tech Stack:** Python 3.11 + pytest (in-memory FakeTable suite) for the backend; Angular 20 standalone components for the client (no test runner — client tasks are build-verified with `npm run build`).

**Spec:** [specs/2026-07-26-undercity-shell-heal-shaman-trophy-design.md](2026-07-26-undercity-shell-heal-shaman-trophy-design.md)

**Test command (run from `infrastructure/lambda`):** `python -m pytest tests -q`

---

## File Structure

**Backend (source of truth):**
- `infrastructure/lambda/undercity_data.py` — add `FORM_SPELLS`; change Deathrite Shaman passive.
- `infrastructure/lambda/undercity_config.py` — remove the now-dead `SOUL_HARVEST_MULT`.
- `infrastructure/lambda/undercity_engine.py` — `effective_stats` handles the `trophy` buff.
- `infrastructure/lambda/undercity_db.py` — `_innate_spell_ids` helper + `_cast` gate; `ONE_BATTLE_BUFFS`; pendingTrophy on win in `_finish_battle`; `_trophy_choose` handler + dispatch; remove the `soul_harvest` bounty branch.
- `infrastructure/lambda/tests/test_undercity_spells.py` — innate Mend Flesh tests.
- `infrastructure/lambda/tests/test_undercity_db.py` — trophy tests.

**Client mirrors:**
- `src/app/undercity/data/forms.ts` — Deathrite Shaman passive rename + passive name/blurb tables.
- `src/app/undercity/data/spells.ts` — `FORM_SPELLS` mirror + `innateSpellIds` accepts passives.
- `src/app/undercity/tabs/creature-tab.component.ts` — pass `you.passives` into `innateSpellIds`.
- `src/app/undercity/services/undercity-models.ts` — `SpaceEvent.trophy` field.
- `src/app/undercity/tabs/board-tab.component.ts` (+ its template `.html`) — trophy modal + choose action.

**Docs:**
- `specs/undercity-spells.md`, `specs/undercity-combat.md`, `UNDERCITY_EVOLUTION.html`.

---

## Task 1: Shambling Shell learns Mend Flesh (innate gift)

**Files:**
- Modify: `infrastructure/lambda/undercity_data.py` (after the `SPECIES_SPELLS` block, ~line 647)
- Modify: `infrastructure/lambda/undercity_db.py` (`_cast`, lines 4357-4361; add helper near `_passives`, ~line 446)
- Test: `infrastructure/lambda/tests/test_undercity_spells.py`

- [ ] **Step 1: Write the failing tests**

Append to `infrastructure/lambda/tests/test_undercity_spells.py`:

```python
def _become(table, form, passives, tier=2, user='user-alex'):
    """Force a player into a given form with an explicit passive list."""
    doc = db._get_player(table, _sid(table), user)
    doc['form'] = form
    doc['tier'] = tier
    doc['passives'] = list(passives)
    assert db._put_player(table, doc)
    return doc


def test_shambling_shell_casts_mend_flesh_innate(table):
    act(table, 'join', starter='zombie', home='cavern')
    doc = _become(table, 'shambling_shell', ['regrowth', 'rootwall'])
    doc['hp'] = 5
    assert db._put_player(table, doc)
    status, resp = act(table, 'cast', spellId='mend_flesh', source='innate')
    assert status == 200, resp
    assert db._get_player(table, _sid(table), 'user-alex')['hp'] == 17  # 5 + 12


def test_shambling_shell_apex_keeps_mend_flesh(table):
    # Grave Titan that came up through Shambling Shell still has rootwall in its
    # accumulated passives, so Mend Flesh stays castable.
    act(table, 'join', starter='zombie', home='cavern')
    doc = _become(table, 'grave_titan',
                  ['regrowth', 'rootwall', 'deathtouch_stomp'], tier=3)
    doc['hp'] = 5
    assert db._put_player(table, doc)
    status, resp = act(table, 'cast', spellId='mend_flesh', source='innate')
    assert status == 200, resp


def test_non_rootwall_form_cannot_cast_mend_flesh_innate(table):
    act(table, 'join', starter='zombie', home='cavern')
    doc = _become(table, 'deathrite_shaman', ['regrowth', 'soul_trophy'])
    status, resp = act(table, 'cast', spellId='mend_flesh', source='innate')
    assert status == 403 or resp.get('reason') == 'not_castable', resp
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/test_undercity_spells.py -k "mend_flesh_innate or apex_keeps_mend" -q`
Expected: FAIL — `not_castable` for Shambling Shell (mend_flesh isn't yet an innate gift). (Note: `test_non_rootwall...` may already pass; that's fine.)

- [ ] **Step 3: Add the `FORM_SPELLS` table**

In `infrastructure/lambda/undercity_data.py`, immediately after the `SPECIES_SPELLS = { ... }` block:

```python
# Form passive -> an extra innate spell that form grants. Because passives
# accumulate through evolution (see _evolve), a form's apexes keep the spell,
# and existing live creatures gain it with no migration. Mirror: FORM_SPELLS in
# src/app/undercity/data/spells.ts + innateSpellIds().
FORM_SPELLS = {
    'rootwall': 'mend_flesh',   # Shambling Shell (+ its apexes) knit their wounds
}
```

- [ ] **Step 4: Add `_innate_spell_ids` and use it in `_cast`**

In `infrastructure/lambda/undercity_db.py`, add near `_passives` (~line 446):

```python
def _innate_spell_ids(doc):
    """Every always-castable innate spell id: home-biome innate, starter-species
    signature, and any FORM_SPELLS granted by a form passive the creature holds."""
    ids = {data.BIOME_SPELLS.get(doc.get('homeBiome')),
           data.SPECIES_SPELLS.get(doc.get('species'))}
    for p in _passives(doc):
        if p in data.FORM_SPELLS:
            ids.add(data.FORM_SPELLS[p])
    ids.discard(None)
    return ids
```

Then in `_cast`, replace the inline set (lines 4358-4359):

```python
    if source == 'innate':
        innate_ids = {data.BIOME_SPELLS.get(doc.get('homeBiome')),
                      data.SPECIES_SPELLS.get(doc.get('species'))}
        if spell_id not in innate_ids:
```

with:

```python
    if source == 'innate':
        if spell_id not in _innate_spell_ids(doc):
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `python -m pytest tests/test_undercity_spells.py -k "mend_flesh or rootwall" -q`
Expected: PASS (all three).

- [ ] **Step 6: Run the full suite**

Run: `python -m pytest tests -q`
Expected: PASS (no regressions).

- [ ] **Step 7: Commit**

```bash
git add infrastructure/lambda/undercity_data.py infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_spells.py
git commit -m "feat(undercity): Shambling Shell learns innate Mend Flesh (persists through apex)"
```

---

## Task 2: Retire Soul Harvest → Soul Trophy passive (data only)

Renames the Deathrite Shaman passive and removes the now-dead Spore-bounty hook. The trophy *behavior* is Task 3; this task only swaps the passive id so nothing still references `soul_harvest`.

**Files:**
- Modify: `infrastructure/lambda/undercity_data.py:127-131` (deathrite_shaman)
- Modify: `infrastructure/lambda/undercity_db.py:3465-3469` (remove `soul_harvest` branch in `_finish_wild`)
- Modify: `infrastructure/lambda/undercity_config.py:67` (remove `SOUL_HARVEST_MULT`)

- [ ] **Step 1: Rename the passive in the form table**

In `infrastructure/lambda/undercity_data.py`, the `deathrite_shaman` entry — change:

```python
    'deathrite_shaman': {
        'name': 'Deathrite Shaman', 'line': 'zombie', 'bonus': {'maxHp': 6, 'def': 2},
        'passive': 'soul_harvest',
        'blurb': 'Durable ritualist. Soul Harvest: +50% Spores from wild & elite battle wins.',
    },
```

to:

```python
    'deathrite_shaman': {
        'name': 'Deathrite Shaman', 'line': 'zombie', 'bonus': {'maxHp': 6, 'def': 2},
        'passive': 'soul_trophy',
        'blurb': 'Grave ritualist. Soul Trophy: after any won fight, take a trophy — '
                 '+[foe level] to a stat you choose, for your next battle.',
    },
```

- [ ] **Step 2: Remove the dead Spore-bounty hook**

In `infrastructure/lambda/undercity_db.py`, in `_finish_wild`, delete these two lines (currently 3467-3468):

```python
        if 'soul_harvest' in _passives(doc):
            bounty = round(bounty * data.SOUL_HARVEST_MULT)
```

(Leave the surrounding `bounty = _scrounge(...)` / `doc['spores'] += bounty` lines intact.)

- [ ] **Step 3: Remove the unused config constant**

In `infrastructure/lambda/undercity_config.py`, delete line 67:

```python
SOUL_HARVEST_MULT = 1.5   # Deathrite Shaman: ×Spores from wild & elite battle wins
```

- [ ] **Step 4: Verify nothing else references the old names**

Run: `grep -rn "soul_harvest\|SOUL_HARVEST" infrastructure/lambda/*.py`
Expected: no output.

- [ ] **Step 5: Run the full suite**

Run: `python -m pytest tests -q`
Expected: PASS (no test referenced `soul_harvest`).

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_data.py infrastructure/lambda/undercity_db.py infrastructure/lambda/undercity_config.py
git commit -m "refactor(undercity): retire Soul Harvest, rename Deathrite Shaman passive to soul_trophy"
```

---

## Task 3: Soul Trophy behavior — trophy buff + post-win menu + choose action

**Files:**
- Modify: `infrastructure/lambda/undercity_engine.py:706-741` (`effective_stats` buff loop)
- Modify: `infrastructure/lambda/undercity_db.py:717-719` (`ONE_BATTLE_BUFFS`)
- Modify: `infrastructure/lambda/undercity_db.py:3444-3456` (`_finish_battle`, set pendingTrophy)
- Modify: `infrastructure/lambda/undercity_db.py` (add `_trophy_choose`; register in `handlers`, ~line 1550)
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing tests**

Append to `infrastructure/lambda/tests/test_undercity_db.py` (the `_finish_started_battle`, `_sid`, `act` helpers already exist in this file; `_sid` is defined in test_undercity_spells — add a local one if not present):

```python
def _sid_db(table):
    sid, _ = db._active_season(table)
    return sid


def _make_deathrite(table, user='user-alex'):
    doc = db._get_player(table, _sid_db(table), user)
    doc['form'] = 'deathrite_shaman'
    doc['tier'] = 2
    doc['passives'] = ['regrowth', 'soul_trophy']
    assert db._put_player(table, doc)
    return doc


def test_soul_trophy_win_offers_menu(table, monkeypatch):
    act(table, 'join', starter='zombie')
    doc = _make_deathrite(table)
    db._wild_battle(table, _sid_db(table), doc)
    doc = db._get_player(table, _sid_db(table), 'user-alex')
    npc = doc['battle']['npc']
    expected = data.enemy_level(npc['atk'], npc['dfn'], npc['spd'], npc['maxHp'])
    se = _finish_started_battle(table, monkeypatch, doc, 'attacker')
    assert se['trophy'] == {'amount': expected}
    assert db._get_player(table, _sid_db(table), 'user-alex')['pendingTrophy'] == {'amount': expected}


def test_trophy_choose_applies_one_battle_buff(table, monkeypatch):
    act(table, 'join', starter='zombie')
    doc = _make_deathrite(table)
    db._wild_battle(table, _sid_db(table), doc)
    doc = db._get_player(table, _sid_db(table), 'user-alex')
    npc = doc['battle']['npc']
    amount = data.enemy_level(npc['atk'], npc['dfn'], npc['spd'], npc['maxHp'])
    _finish_started_battle(table, monkeypatch, doc, 'attacker')

    status, resp = act(table, 'trophy-choose', stat='atk')
    assert status == 200, resp
    doc = db._get_player(table, _sid_db(table), 'user-alex')
    assert {'kind': 'trophy', 'stat': 'atk', 'amount': amount} in doc['buffs']
    assert 'pendingTrophy' not in doc or doc['pendingTrophy'] is None
    base = engine.effective_stats({**doc, 'buffs': []})['atk']
    assert engine.effective_stats(doc)['atk'] == base + amount


def test_trophy_buff_consumed_after_next_fight(table, monkeypatch):
    act(table, 'join', starter='zombie')
    doc = _make_deathrite(table)
    db._wild_battle(table, _sid_db(table), doc)
    doc = db._get_player(table, _sid_db(table), 'user-alex')
    _finish_started_battle(table, monkeypatch, doc, 'attacker')
    act(table, 'trophy-choose', stat='spd')
    doc = db._get_player(table, _sid_db(table), 'user-alex')
    assert any(b.get('kind') == 'trophy' for b in doc['buffs'])
    # Fight again: the trophy buff should be consumed as a one-battle buff.
    db._wild_battle(table, _sid_db(table), doc)
    doc = db._get_player(table, _sid_db(table), 'user-alex')
    _finish_started_battle(table, monkeypatch, doc, 'attacker')
    doc = db._get_player(table, _sid_db(table), 'user-alex')
    assert not any(b.get('kind') == 'trophy' for b in doc['buffs'])


def test_trophy_choose_rejects_without_pending(table):
    act(table, 'join', starter='zombie')
    _make_deathrite(table)
    status, resp = act(table, 'trophy-choose', stat='atk')
    assert status == 409, resp


def test_trophy_choose_rejects_bad_stat(table, monkeypatch):
    act(table, 'join', starter='zombie')
    doc = _make_deathrite(table)
    db._wild_battle(table, _sid_db(table), doc)
    doc = db._get_player(table, _sid_db(table), 'user-alex')
    _finish_started_battle(table, monkeypatch, doc, 'attacker')
    status, resp = act(table, 'trophy-choose', stat='maxHp')
    assert status == 400, resp


def test_non_deathrite_win_offers_no_trophy(table, monkeypatch):
    act(table, 'join', starter='pest')
    sid = _sid_db(table)
    doc = db._get_player(table, sid, 'user-alex')
    db._wild_battle(table, sid, doc)
    doc = db._get_player(table, sid, 'user-alex')
    se = _finish_started_battle(table, monkeypatch, doc, 'attacker')
    assert 'trophy' not in se
    assert not db._get_player(table, sid, 'user-alex').get('pendingTrophy')
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/test_undercity_db.py -k trophy -q`
Expected: FAIL — `trophy-choose` is an unknown action / no `trophy` on the space event.

- [ ] **Step 3: Handle the `trophy` buff in `effective_stats`**

In `infrastructure/lambda/undercity_engine.py`, inside the `for buff in ...` loop in `effective_stats`, add a branch (after the `high_five` branch, before the loop ends):

```python
        elif kind == 'trophy':
            stat = buff.get('stat')
            if stat in ('atk', 'def', 'spd'):
                eff[stat] += int(buff.get('amount', 0))
```

- [ ] **Step 4: Register `trophy` as a one-battle buff**

In `infrastructure/lambda/undercity_db.py`, extend `ONE_BATTLE_BUFFS` (lines 717-719):

```python
ONE_BATTLE_BUFFS = ('rot_surge', 'acorn_fury', 'bone_chill', 'glowveil', 'harden_shell',
                    'weaken_hex', 'savage_roar', 'iron_hide', 'fleetfoot', 'warding_dance',
                    'sap_vigor', 'rust_curse', 'high_five', 'trophy')
```

- [ ] **Step 5: Set the pending trophy on a win in `_finish_battle`**

In `infrastructure/lambda/undercity_db.py`, in `_finish_battle`, just before `conflict = _save_or_conflict(table, doc)` (currently ~line 3453), insert:

```python
    # Soul Trophy (Deathrite Shaman): a win lets the player take a trophy from
    # the slain — +[foe level] to a chosen stat next battle. Latest kill wins.
    if result['outcome'] == 'attacker' and 'soul_trophy' in _passives(doc):
        npc = rec['npc']
        amount = data.enemy_level(npc['atk'], npc['dfn'], npc['spd'], npc['maxHp'])
        doc['pendingTrophy'] = {'amount': amount}
        out['trophy'] = {'amount': amount}
```

- [ ] **Step 6: Add the `_trophy_choose` handler**

In `infrastructure/lambda/undercity_db.py`, add near `_spend_stat` (~line 4741):

```python
def _trophy_choose(table, sid, doc, payload):
    pending = doc.get('pendingTrophy')
    if not pending:
        return _err('You have no trophy to claim.', 409)
    stat = payload.get('stat')
    if stat not in ('atk', 'def', 'spd'):
        return _err('Choose ATK, DEF, or SPD.', 400)
    doc.setdefault('buffs', []).append(
        {'kind': 'trophy', 'stat': stat, 'amount': int(pending['amount'])})
    doc['pendingTrophy'] = None
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    return _ok(doc)
```

- [ ] **Step 7: Register the action in the dispatcher**

In `infrastructure/lambda/undercity_db.py`, add to the `handlers` dict (~line 1550):

```python
        'trophy-choose': _trophy_choose,
```

- [ ] **Step 8: Run the trophy tests to verify they pass**

Run: `python -m pytest tests/test_undercity_db.py -k trophy -q`
Expected: PASS (all trophy tests).

- [ ] **Step 9: Run the full suite**

Run: `python -m pytest tests -q`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add infrastructure/lambda/undercity_engine.py infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): Soul Trophy — post-win stat-choice buff for Deathrite Shaman"
```

---

## Task 4: Client mirrors — forms.ts + spells.ts + creature-tab

No client test runner; verify with `npm run build` (from repo root). `mend_flesh` already exists in `spells.generated.ts`, so **no `sync_spells.py` run is needed** — only the hand-written mirror + the passive tables.

**Files:**
- Modify: `src/app/undercity/data/forms.ts` (PASSIVE_NAMES ~33, PASSIVE_BLURBS ~60, deathrite_shaman ~108)
- Modify: `src/app/undercity/data/spells.ts` (`innateSpellIds` ~11-21)
- Modify: `src/app/undercity/tabs/creature-tab.component.ts:431`

- [ ] **Step 1: Update `forms.ts` passive tables**

In `src/app/undercity/data/forms.ts`, in `PASSIVE_NAMES` replace `soul_harvest: 'Soul Harvest',` with:

```ts
  soul_trophy: 'Soul Trophy',
```

In `PASSIVE_BLURBS` replace `soul_harvest: '+50% Spores from wild & elite battle wins.',` with:

```ts
  soul_trophy: 'After any won fight, choose a stat — gain +[foe level] to it for your next battle.',
```

In the `TIER2` array, change the `deathrite_shaman` entry's `passive` and `passiveName`:

```ts
  { id: 'deathrite_shaman', name: 'Deathrite Shaman', tier: 2, line: 'zombie', passive: 'soul_trophy', passiveName: 'Soul Trophy', bonus: { maxHp: 6, def: 2 }, blurb: 'Grave ritualist (+HP/+DEF).' },
```

- [ ] **Step 2: Extend `innateSpellIds` + add the `FORM_SPELLS` mirror in `spells.ts`**

In `src/app/undercity/data/spells.ts`, replace the `innateSpellIds` function (lines 9-21) with:

```ts
/** Form passive -> extra innate spell it grants. Mirror of FORM_SPELLS in
 *  infrastructure/lambda/undercity_data.py (NOT part of the sync_spells payload —
 *  keep in sync by hand). */
export const FORM_SPELLS: Record<string, string> = {
  rootwall: 'mend_flesh', // Shambling Shell (+ its apexes)
};

/** Every always-castable innate spell id for a creature: biome innate, species
 *  signature (squirrels get Acorn Fury), plus any FORM_SPELLS granted by a
 *  passive the creature carries. Order: biome first. */
export function innateSpellIds(
  homeBiome: string | undefined,
  species: string | undefined,
  passives: string[] = [],
): string[] {
  const ids: string[] = [];
  const biome = BIOME_SPELLS[homeBiome ?? ''];
  if (biome) ids.push(biome);
  const sig = SPECIES_SPELLS[species ?? ''];
  if (sig && !ids.includes(sig)) ids.push(sig);
  for (const p of passives) {
    const spell = FORM_SPELLS[p];
    if (spell && !ids.includes(spell)) ids.push(spell);
  }
  return ids;
}
```

- [ ] **Step 3: Pass passives at the call site**

In `src/app/undercity/tabs/creature-tab.component.ts`, in the `innateSpells` computed (~line 431), change:

```ts
    return innateSpellIds(you.homeBiome, you.species)
```

to:

```ts
    return innateSpellIds(you.homeBiome, you.species, you.passives ?? [])
```

(Confirm the `you` type exposes `passives: string[]`; the state payload is the full player doc, so it does. If the local type omits it, add `passives?: string[]` to that interface in `undercity-models.ts`.)

- [ ] **Step 4: Build to verify**

Run (from repo root): `npm run build`
Expected: build succeeds, no TS errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/undercity/data/forms.ts src/app/undercity/data/spells.ts src/app/undercity/tabs/creature-tab.component.ts
git commit -m "feat(undercity/client): mirror Soul Trophy passive + Shambling Shell innate Mend Flesh"
```

---

## Task 5: Client trophy menu (board-tab)

Shows a 3-button ATK/DEF/SPD chooser after a won fight when the server returns `spaceEvent.trophy`, deferred until the victory screen is dismissed. Build-verified.

**Files:**
- Modify: `src/app/undercity/services/undercity-models.ts` (`SpaceEvent`, ~line 547)
- Modify: `src/app/undercity/tabs/board-tab.component.ts` (`finishLiveBattle` ~2557, `routeSpaceEvent` battleView branch ~1931, `closeLiveBattle` ~2587, and the non-interactive close path)
- Modify: `src/app/undercity/tabs/board-tab.component.html` (modal markup)

- [ ] **Step 1: Add the `trophy` field to `SpaceEvent`**

In `src/app/undercity/services/undercity-models.ts`, inside `interface SpaceEvent`, add:

```ts
  /** Soul Trophy (Deathrite Shaman): a won fight offers +amount to a chosen
   *  stat next battle. Present only on wins for that form. */
  trophy?: { amount: number };
```

- [ ] **Step 2: Add a pending-trophy signal + open helper in board-tab**

In `src/app/undercity/tabs/board-tab.component.ts`, add a field near the other pending-* fields:

```ts
  /** Soul Trophy amount awaiting a stat choice; drives the trophy modal. */
  protected readonly pendingTrophy = signal<number | null>(null);
```

And a claim handler:

```ts
  async chooseTrophy(stat: 'atk' | 'def' | 'spd'): Promise<void> {
    this.pendingTrophy.set(null);
    await this.run(async () => { await this.store.action('trophy-choose', { stat }); });
  }

  dismissTrophy(): void { this.pendingTrophy.set(null); }
```

- [ ] **Step 3: Capture the trophy on a won fight (both battle paths)**

In `finishLiveBattle(ev)` (~line 2568, alongside `pendingSigilBiome`), add:

```ts
    this.pendingTrophyAmount = outcome === 'attacker' && ev.trophy ? ev.trophy.amount : null;
```

Add the field `private pendingTrophyAmount: number | null = null;` near `pendingSigilBiome`.

In the non-interactive `routeSpaceEvent` battleView branch (~line 1931, where `rewards: this.buildRewards(ev)` is set), the playback screen has its own close handler — set the same field there when `ev.battle?.outcome === 'attacker' && ev.trophy`:

```ts
        rewards: this.buildRewards(ev),
      });
      this.pendingTrophyAmount =
        ev.battle?.outcome === 'attacker' && ev.trophy ? ev.trophy.amount : null;
```

- [ ] **Step 4: Open the modal after the victory screen closes**

In `closeLiveBattle()` (~line 2587) and in the playback-close handler (search for where `this.battleView.set(null)` is called), after clearing the battle view, add:

```ts
    if (this.pendingTrophyAmount != null) {
      this.pendingTrophy.set(this.pendingTrophyAmount);
      this.pendingTrophyAmount = null;
    }
```

Place it after any sigil/raid celebration is queued so the trophy modal doesn't stack on top of those (they set `levelUpHold`; the trophy is lower priority — opening it after the battle view clears is fine).

- [ ] **Step 5: Add the modal markup**

In `src/app/undercity/tabs/board-tab.component.html`, add near the other modals (follow the existing modal/overlay class pattern in that file — reuse the same backdrop + panel classes an existing simple modal uses):

```html
@if (pendingTrophy() !== null) {
  <div class="uc-modal-backdrop" (click)="dismissTrophy()">
    <div class="uc-modal" (click)="$event.stopPropagation()">
      <h3>Soul Trophy</h3>
      <p>Take a trophy from the slain — <strong>+{{ pendingTrophy() }}</strong> to one stat for your next battle.</p>
      <div class="uc-trophy-choices">
        <button type="button" (click)="chooseTrophy('atk')">+{{ pendingTrophy() }} ATK</button>
        <button type="button" (click)="chooseTrophy('def')">+{{ pendingTrophy() }} DEF</button>
        <button type="button" (click)="chooseTrophy('spd')">+{{ pendingTrophy() }} SPD</button>
      </div>
      <button type="button" class="uc-modal-dismiss" (click)="dismissTrophy()">Leave it</button>
    </div>
  </div>
}
```

(Match the actual backdrop/panel class names already used in `board-tab.component.html`; the names above are placeholders for whatever the file's existing modal uses.)

- [ ] **Step 6: Build to verify**

Run (from repo root): `npm run build`
Expected: build succeeds, no TS/template errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/undercity/services/undercity-models.ts src/app/undercity/tabs/board-tab.component.ts src/app/undercity/tabs/board-tab.component.html
git commit -m "feat(undercity/client): Soul Trophy post-win stat-choice menu"
```

---

## Task 6: Docs + bestiary

**Files:**
- Modify: `specs/undercity-spells.md`
- Modify: `specs/undercity-combat.md`
- Modify: `UNDERCITY_EVOLUTION.html` (via the scratchpad generator)

- [ ] **Step 1: Document the form-innate-spell grant in the spells spec**

In `specs/undercity-spells.md`, add a short subsection under the innate-spell material: describe `FORM_SPELLS` (passive → innate spell, gated on accumulated passives so apexes keep it, mirrored in `spells.ts`), and add Mend Flesh to Shambling Shell's entry.

- [ ] **Step 2: Document the trophy buff + action in the combat spec**

In `specs/undercity-combat.md`, add: the `trophy` buff kind (`{kind, stat, amount}`, a one-battle buff resolved in `effective_stats`), the `trophy-choose {stat}` action, and the `_finish_battle` → `spaceEvent.trophy` post-win flow (Deathrite Shaman's `soul_trophy` passive; latest kill overwrites an unclaimed trophy).

- [ ] **Step 3: Update the bestiary card data**

The bestiary HTML was generated from a data-table script. In the generator at `<scratchpad>/gen_bestiary.py` (recreate from the committed `UNDERCITY_EVOLUTION.html` tables if the scratchpad is gone), update:
- Deathrite Shaman card: passive name "Soul Trophy", text "After any won fight, choose ATK/DEF/SPD — gain +[foe level] to it for your next battle."
- Shambling Shell card: append "Learns Mend Flesh (innate heal)." to its passive/role text.

Then regenerate:

Run: `python <scratchpad>/gen_bestiary.py`
Expected: `wrote A:\Coding\game-day-site\UNDERCITY_EVOLUTION.html`.

- [ ] **Step 4: Verify the bestiary renders**

Open `UNDERCITY_EVOLUTION.html` (or headless-screenshot as before) and confirm the Deathrite Shaman + Shambling Shell cards show the new text and all sprites still load.

- [ ] **Step 5: Commit**

```bash
git add specs/undercity-spells.md specs/undercity-combat.md UNDERCITY_EVOLUTION.html
git commit -m "docs(undercity): document Soul Trophy + Shambling Shell Mend Flesh; refresh bestiary"
```

---

## Final verification

- [ ] Run the full backend suite: `python -m pytest tests -q` (from `infrastructure/lambda`) — expect all green.
- [ ] Run `npm run build` (from repo root) — expect a clean production build.
- [ ] Confirm `grep -rn "soul_harvest" infrastructure/lambda src/app` returns nothing.
- [ ] Note for the user: the backend change requires a `cdk deploy` (user runs deploys) before the live game reflects it.

## Notes / gotchas
- **No migration needed** for Mend Flesh: existing live Shambling Shells already carry `rootwall` in `passives`, so they gain the innate immediately.
- **Enemy-level source:** `rec['npc']` uses the key `dfn` (not `def`) for defense — match it in `data.enemy_level(...)`.
- **Boss finale:** a Savra "win" is the killing blow only, so the trophy fires there rarely — expected.
- **Buff dedup:** only one `trophy` buff is ever live because winning the next fight consumes it before a new one can be claimed; no explicit dedup required.
