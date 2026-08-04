# Undercity — Cast spells from the magic menu

**Date:** 2026-08-04
**Scope:** Let players cast their equipped spells directly from the Gear → Magic (Grimoire) panel, instead of only from the board's Cast button. Client-only; casting is already ungated server-side (`_cast` in `undercity_db.py` checks ownership + cooldown, never turn/tab).

## Behaviour

The grimoire "active loadout" rows (innate + equipped-book spells) each gain an action button:

- **On cooldown** — the countdown, disabled.
- **Ready + self-cast** (`self_buff` / `self_heal` / `recall`) — **"Cast"**: fires `store.action('cast', {spellId, source})` inline; a toast confirms and the button flips to its cooldown. `source` is derived from the existing `spellSource()` helper (`Innate` → `innate`, else `grimoire`).
- **Ready + needs input** (`field_damage` / `field_curse` / `boss_strike` / `teleport` / `fate_die` / `wish`) — **"Aim"**: routes to the Board with that spell's targeting picker already open (these need live board positions, a value pick, or a tap-a-space the menu can't provide).

## Cross-tab plumbing (mirrors `recenterRequest`)

- **`UndercityStateService`**: `castRequest = signal<{ id: number; spellId: string } | null>(null)` + `requestBoardCast(spellId)` that bumps a monotonic `id` (counter pattern avoids clear-races between the two consumers).
- **`undercity-page`**: effect watches `castRequest`; on a new id, `setTab('board')`. Tracks last-handled id locally.
- **`board-tab`**: effect watches `castRequest`; on a new id, resolves `SPELL_MAP[spellId]` and calls the existing `pickSpell(spell)` to open its normal routing. The board is always mounted, so this fires whether or not it was visible. Tracks last-handled id locally.

## Scrolls

The Magic menu's **Scrolls** card lists held one-shot scrolls (`you.scrolls`) and casts them through the same path as spells, passing `asScroll` so the server treats the cast as `source: 'scroll'` (consumed on success, no cooldown): self-cast scrolls resolve inline ("Use"); targeted scrolls "Aim" to the board via `requestBoardCast(id, true)`, which routes through the board's `pickScrollCast` rather than `pickSpell`.

## Non-goals

- No board cast-FX for inline menu casts (the board isn't visible) — toast only.
- Unopened/compare-view books are untouched (only the active loadout's spells are castable).
- No server or balance change.
- Aiming a spell with no valid targets lands on the board with an empty picker — same as the board's Cast button today.

## Verification

`npm run build:prod` must pass (no frontend test runner). Optionally drive live via the `run-undercity` skill: cast a self-buff from the menu (toast + cooldown), and "Aim" a field spell (lands on board with picker open). Deploy left to the user.
