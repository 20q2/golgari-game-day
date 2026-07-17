# Undercity Trading Post — visual polish + gear/grimoire swaps

## Problem

The Trading Post modal (`board-tab.component.html`, `showTradingPost`) is visually
behind the game's other facility modals (Bazaar, Shrine, Ossuary): no `modal-art`
icon, a bare chip list for "your items," and plain name-only rows for the stock
you can take. It's also functionally narrower than it needs to be — you can only
offer bag consumables, even though gear and grimoires are both things a player
might want to trade away for something better someone else left behind.

## Goals

- Bring the Trading Post modal's visual quality up to the Bazaar's bar: themed
  header art, grouped sections, richer per-item rows (blurb/stats/spell list).
- Let players offer *any* owned item — bag consumable, an equipped gear piece,
  or an owned grimoire — not just bag consumables.
- Grimoires become tradeable (a deliberate change from their "yours forever"
  framing in the Bazaar — the user confirmed this is intended).

## Backend changes

### `undercity_db.py::_trade`

Item kind is inferred from the id — `CONSUMABLES`, `GEAR`, and `GRIMOIRES` keys
are disjoint, so no new field is needed on the wire. Add a small helper:

```python
def _item_kind(item_id):
    if item_id in data.CONSUMABLES: return 'consumable'
    if item_id in data.GEAR: return 'gear'
    if item_id in data.GRIMOIRES: return 'grimoire'
    return None
```

**Give-side validation** (replacing the current bag-only check):
- `consumable` — must be in `doc['bag']`.
- `gear` — must equal `doc['gear'].get(GEAR[give]['slot'])` (i.e. currently
  equipped).
- `grimoire` — must be in `doc.get('grimoires') or []`.
- Unknown kind (not in any catalog) — `_err('Unknown item.')` as today.

**Removing the given item:**
- `consumable` — `bag.remove(give)`, unchanged.
- `gear` — `del doc['gear'][slot]` (slot becomes unequipped; no refund — this
  is a swap, not a sale, consistent with there being no currency at the post).
- `grimoire` — remove from `doc['grimoires']`; if it was
  `doc.get('equippedGrimoire')`, set that to `None` (player re-equips from the
  Creature tab, same flow as any other grimoire change).

**Take-side validation** (on `stock[take_index]['item']`):
- `consumable` — if `len(bag) >= data.BAG_SIZE` (post-removal of `give` if it
  was also a consumable) → `_err('Your bag is full (3 slots).', 409)`.
- `grimoire` — if already in `doc['grimoires']` → `_err('You already own that
  grimoire.', 409)`.
- `gear` — no extra check; silently overwrites whatever currently occupies
  that slot (mirrors the Bazaar's auto-equip-on-buy behavior).

**Applying the taken item:**
- `consumable` — `bag.append(taken['item'])`.
- `gear` — `doc.setdefault('gear', {})[GEAR[taken['item']]['slot']] =
  taken['item']`.
- `grimoire` — `doc['grimoires'].append(taken['item'])`; if
  `not doc.get('equippedGrimoire')`, auto-equip it (mirrors
  `_grant_grimoire`'s behavior).

Stock slot bookkeeping (`stock[take_index] = {'item': give, 'foundBy':
doc['username']}`) is unchanged — it already works for any item kind since it
just stores an id.

### `undercity_data.py`

No changes — `TRADING_POST_SEED` stays consumables-only (what the "house"
seeds each post with); gear and grimoires only enter stock once a player
leaves one behind.

### Tests

Extend the existing trading-post coverage in `test_undercity_db.py` (and/or
`test_undercity_spells.py` if grimoire-specific) with cases for:
- Offering an equipped gear piece and receiving a different one (slot updates,
  old piece is gone, no refund).
- Offering a grimoire and receiving a different one (ownership swaps,
  `equippedGrimoire` clears if the given one was equipped, auto-equip on take
  if none was equipped).
- Rejecting a take that would overflow the bag.
- Rejecting a take of an already-owned grimoire.
- Rejecting a give of gear/grimoire the player doesn't currently
  hold/have-equipped.

## Frontend changes

### `board-tab.component.ts`

- `openTradingPost` builds a combined "offerable items" list: bag items +
  each filled `gear` slot + each entry in `grimoires`, each annotated with
  display info pulled from `CONSUMABLE_MAP` / `GEAR_MAP` / `GRIMOIRE_MAP`
  (name, icon, blurb/stat text, kind).
- `giveItem` signal keeps holding a bare item id (kind stays inferred from
  the id via the maps, matching the backend).
- Take-button disabled state grows two client-side pre-checks mirroring the
  server: bag-would-overflow, and grimoire-already-owned — so those cases
  read as a disabled button, not a failed action + toast.

### `board-tab.component.html` / `.scss`

- Add a `modal-art` image at the top of the trading modal
  (`undercity/icons/trading_post.png` — user is supplying this asset).
- Replace the flat `trade-chip` grid with mini `.shop-section`-labeled groups
  (Consumables / Gear / Grimoires) — all shown at once (not tabbed, since the
  offerable set is small, unlike the Bazaar's larger rotating catalog).
- Replace the bare-name "Offered — take one" rows with `shop-row`-style
  entries carrying the same per-kind detail the Bazaar shows: consumable
  blurb, gear slot + stat blurb, grimoire spell list (reuse
  `grimoireSpellList()`).
- Update the modal's subtitle copy to mention gear/grimoires are tradeable
  too, not just "one of your items" ambiguity.
- No new SCSS classes needed beyond what `shop-row`/`shop-section`/`shop-tab`
  already provide — reuse those for visual consistency with the Bazaar.

## Out of scope

- No changes to the Bazaar, Shrine, Ossuary, or other facility modals.
- No new server-side stock-seeding logic for gear/grimoires — they only
  appear in trading-post stock once left behind by a player.
- No compensation/refund mechanic for gear or grimoires given up (this is a
  swap venue, not a sell-back venue — that's the Bazaar's job).
