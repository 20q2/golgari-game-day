# Undercity — Rolled egg color + recolor ownership fix

**Date:** 2026-07-23
**Status:** Design approved, pending implementation plan

## Problem

Returning players (Guild Seal perk) report they **cannot change their colors** —
the server responds *"You do not own that paint."* Confirmed root cause chain:

1. The hatch **shell-color picker** ([hatch-flow.component.html:13-19](../src/app/undercity/hatch/hatch-flow.component.html))
   lets a Guild-Seal player pick **any** of the 13 catalog colors, ungated by
   ownership, sending `eggHue` in the `join` action.
2. Hatch stamps that hue into the creature's paint:
   `paint = {body: eggHue, belly: 50, stripes: eggHue}`
   ([undercity_db.py:1911-1938](../infrastructure/lambda/undercity_db.py)). The
   player now **wears** a color they don't **own** (default owned = `forest` +
   `gold` only).
3. The wardrobe's `setPaint` resends **all three** regions —
   `{...you.paint, [region]: newHue}`
   ([creature-tab.component.ts:486-490](../src/app/undercity/tabs/creature-tab.component.ts)) —
   so the un-owned hue rides along in the regions the player didn't touch.
4. `_customize` validates **every** region against owned hues
   ([undercity_db.py:5342-5347](../infrastructure/lambda/undercity_db.py)) and
   rejects on the un-owned hue → `409 "You do not own that paint."`

The ownership check is original code; it only surfaced now that returning players
hatch with custom shell hues. The DynamoDB table is `RETAIN`, so affected players
already have these paints stored — the fix must recover them without a migration.

## Goal

Two things:
- **Fix recolor** so players (including everyone already stuck) can change colors.
- **Replace** the "pick any shell color" perk with a **rolled** color: returning
  players get a single locked spin of a color wheel that lands on one of the 13
  catalog colors, **granted to them as owned**. They can buy more colors with
  renown and swap later.

## Approach

Three coordinated changes. **Rejected alternatives:** a client-only fix that
gates the shell picker to owned colors (doesn't recover already-stuck players);
a data-migration backfill (heavier and riskier than the self-healing server fix
below).

### 1. Hatch: roll replaces pick (client)

In the `canPickShell()` branch of the hatch flow, replace the swatch grid with a
**single locked spin**:

- A "Spin for your shell color" button. On tap, the wheel animates and lands on a
  **random catalog paint** (uniform over the 13 `PAINTS`). The result is **locked**
  — no re-spin.
- The landed paint's `hue` sets `eggHue` (existing signal), which drives the egg
  preview recolor exactly as today. The landed paint's **id** is also captured to
  send to the server (see §2).
- New/night-1 players (`!canPickShell()`) are unchanged — they hatch `forest`.

**Who rolls:** the **client** rolls (chooses the random catalog paint) and sends
its hue + id in the `join` action. This fits the existing single `join` call and
matches the current trust model (the client already sends `eggHue` freely). A
hacked client could cheat a free color — cosmetic and low-stakes, accepted.

### 2. Server: grant the rolled color as owned (`_new_player` / `_join`)

When a shell color is chosen (seals ≥ 1 and an egg hue is provided):

- Resolve the catalog paint for the rolled color. Prefer an explicit `eggPaint`
  id from the payload; fall back to reverse-mapping `eggHue → PAINT.hue` (hues are
  unique across `PAINTS`, so the map is unambiguous).
- Add that paint id to the perm record's `paints` list (dedup) so the player
  **owns** it. `owned_hues` in `_customize` then includes it → full recolor and
  re-apply work.
- `body_hue` / paint stamping stays as today (`body_hue = eggHue % 360`).

If the rolled hue somehow resolves to no catalog paint, skip the grant (paint
still displays; recolor is still covered by §3).

### 3. Server: stop blocking unchanged regions (`_customize`)

Change the region validation so it only requires ownership for a region whose hue
**changed** from the stored value:

```python
cur = doc.get('paint') or {}
for region in ('body', 'belly', 'stripes'):
    hue = paint.get(region)
    if hue is None:
        continue
    if int(hue) == int(cur.get(region, -999)):
        continue  # unchanged — you can always keep what you're wearing
    if int(hue) not in owned_hues:
        return _err('You do not own that paint.', 409)
```

This **recovers every already-stuck player** with no migration: they can recolor
any region to a color they own, and untouched regions (holding their old un-owned
egg hue) pass. It's also a sound permanent invariant — a player is never blocked
by a color they already wear. New rollers (§2) additionally *own* their color, so
they can freely recolor away and back.

## Data flow

```
Hatch (returning): Spin → random catalog paint → eggHue + eggPaint in `join`
  → server grants paint id to perm.paints, stamps paint {body,stripes: hue}
Recolor: setPaint resends {body,belly,stripes} → _customize allows unchanged
  regions + owned new hues → paint updated
```

## Testing

Python engine suite (`cd infrastructure/lambda && python -m pytest tests -q`):

- **Recolor recovery:** a player doc with `paint.body = paint.stripes = 270`
  (violet, un-owned), `perm.paints = ['forest','gold']`; `_customize` with
  `paint = {body:130, belly:50, stripes:270}` (change body→forest, stripes
  unchanged) → **200**, `doc.paint.body == 130`. (Fails before the §3 fix with a
  409.)
- **Still gate genuinely un-owned new hues:** same player, `_customize` with
  `paint = {body:0 (crimson, un-owned), ...}` → **409**.
- **Grant on hatch:** `_new_player` with `seals_before=1`, egg hue = 180 (cyan)
  → perm record's `paints` contains `cyan`; a follow-up `_customize` setting
  `stripes:180` succeeds.

No frontend test runner exists (per CLAUDE.md) — the client wheel is verified by
`npm run build` + manual play via the `run-undercity` skill.

## Scope / invariants

- **No data migration.** §3 self-heals existing stuck players on their next
  recolor.
- **Mirrors:** the client `PAINTS` mirror already matches server `data.PAINTS`;
  no new balance numbers. `PAINT_PRICE` / renown flow unchanged.
- **Belly** stays `50` (gold, a default) — untouched by all three changes.
- The wheel is cosmetic randomness; the renown wardrobe remains the way to add
  specific colors.
```
