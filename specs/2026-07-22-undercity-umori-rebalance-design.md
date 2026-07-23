# Undercity — Umori Rebalance (same-slot upgrade, one barter per rotation)

**Date:** 2026-07-22
**Status:** Design (approved)
**Supersedes the barter rules in:** [2026-07-21-undercity-umori-wandering-post-design.md](2026-07-21-undercity-umori-wandering-post-design.md)
(location/window/rendering from that doc are unchanged; only the stock composition
and the give/take rules change here.)

## Problem / intent

Umori, the wandering ooze, is too strong. It stocks three T3 items (2 gear + 1
grimoire) and the only give-side rule blocks *consumables* — not low tiers, not
wrong slots — with **no per-visit limit**. A player brings three junk pieces,
swaps all three for legendaries in a single stop, and steamrolls the rest of the
run.

We keep Umori as an endgame legendary vendor, but turn each stop into a single,
honest **same-slot upgrade** instead of a free legendary dump:

1. Umori stocks **one T3 gear per slot (fang, carapace, charm) + one T3 grimoire**.
2. To take a stock line you must **hand over an item that matches it** — a gear
   piece of the *same slot* for a gear line, a grimoire for the grimoire line.
3. You may barter **once per rotation** (per 2-hour window). After Umori wanders
   on, the limit resets and you can come back for a different slot.

Net effect: at most one legendary per 2-hour rotation, and only as a genuine
slot-for-slot trade.

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Keep grimoires? | **Yes — one T3 grimoire line stays.** Umori is the game's only T3-grimoire source (bazaars/mysteries give only T1). Trading for it requires giving a grimoire, and it still spends your one barter for the rotation. |
| Stock composition | **One T3 gear per slot (fang, carapace, charm) + one T3 grimoire** = 4 lines, deterministic per window. |
| Trade-in match rule | Gear line ⇒ give a gear piece of the **same slot**; grimoire line ⇒ give a grimoire. Consumables never accepted. |
| Trade-in source | The given gear may be **equipped or in the gear stash** (not equipped-only as today). |
| Where the legendary lands | **Gear stash** (existing convention — equip later at the Plaza). Grimoire auto-equips if no grimoire is equipped (existing). |
| Fate of the given piece | **Fills that stock slot** for the rest of the window (existing leave-one-take-one within the window); resets to a fresh legendary next window. |
| Per-visit limit | **One barter per rotation** (per window), gear or grimoire. |
| UX flow | **Take-first:** tap the stock line you want → a picker lists your qualifying items (equipped one badged "Equipped") → choose one → confirm. |

## Architecture

Changes are localized to the Umori stock generator and the `_trade` action on the
server, plus the trading-post modal on the client. No new persistence shape, no
new node type, no change to Umori's location/window/rendering.

### Server (`infrastructure/lambda/`)

**Stock composition (`undercity_data.py` + `undercity_db._umori_stock`):**

- `UMORI_STOCK_SPEC` becomes `{'gear_per_slot': 1, 'grimoire': 1}` (one T3 gear
  for *each* gear slot + one T3 grimoire). Keeping it as data documents the shape
  and lets tests assert against it.
- `_umori_stock(window)` produces, deterministically per window: for each gear
  slot in a fixed order (`fang`, `carapace`, `charm`), one crc32-seeded pick from
  that slot's T3 gear pool; then `UMORI_STOCK_SPEC['grimoire']` T3 grimoire(s).
  Lines keep the `{'item', 'foundBy': 'the Swarm'}` seed shape. Ordering is fixed
  (fang, carapace, charm, grimoire) so `takeIndex` and the UI stay stable.

**Barter (`undercity_db._trade`):** add three rules; leave the rest intact.

1. **Once-per-rotation guard (first):** if `doc.get('umoriTradedWindow') == win`,
   reject with `409` "You've already bartered with Umori this stop — catch it
   after it wanders on." On a successful trade, set `doc['umoriTradedWindow'] = win`.
2. **Match rule:** after resolving `taken` and `take_kind`:
   - `take_kind == 'gear'`: require `give_kind == 'gear'` **and**
     `data.GEAR[give]['slot'] == data.GEAR[taken['item']]['slot']`. Otherwise
     reject `409` "Umori wants the same slot — offer a {slot} for that {slot}."
   - `take_kind == 'grimoire'`: require `give_kind == 'grimoire'`. Otherwise reject
     `409` "Umori wants a grimoire for that grimoire."
   - Consumable give is still rejected up front (unchanged).
3. **Give-source (equipped *or* stash):** replace the equipped-only ownership check
   for gear. A gear `give` qualifies if it is the equipped piece in its slot
   (`doc['gear'].get(slot) == give`) **or** present in `doc['gearStash']`. On
   removal: if equipped, delete it from `doc['gear']`; else remove one instance
   from `gearStash`. Grimoire give/removal unchanged (owned check + `equippedGrimoire`
   cleanup).

The existing bag/dup/overflow guards, the "given piece fills the taken stock slot"
write, and the gear→stash / grimoire→grimoires application all stay.

**State (`handle_state`):** add `traded` to the `umori` view —
`umori: { node, movesAt, traded }` where `traded == (you.get('umoriTradedWindow')
== _umori_window())`. This lets the client disable the barter once it's spent for
the current rotation without recomputing the window itself.

### Client (`src/app/undercity/`)

**Model (`services/undercity-models.ts`):** extend `umori` to
`{ node: string; movesAt: string; traded?: boolean }`.

**Trading-post modal (`tabs/board-tab.component.*`):** reverse the flow to
**take-first**.

- Primary list: Umori's stock lines (gear per slot + grimoire), each with a
  "Trade for this" button. The button is disabled when: `umori.traded` is true, OR
  the player owns no qualifying give item for that line, OR (gear line) the gear
  stash is full.
- Tapping a stock line opens a **trade-in picker** for that line, listing the
  player's **qualifying items**:
  - gear line ⇒ every gear the player owns of that slot — equipped piece **and**
    stash pieces — with the equipped one badged **"Equipped"**;
  - grimoire line ⇒ the player's owned grimoires.
  Each row shows the same icon/rarity vocabulary as today. Selecting one and
  confirming calls `action('trade', { give, takeIndex })`.
- Remove the old give-first "Your items — tap one to offer" section and the
  consumable offers (Umori never takes consumables). `tradeOffers()` /
  `canTakeStock()` are replaced by helpers keyed off the *selected stock line*:
  a `qualifyingGiveItems(stockItem)` that returns the owned same-slot gear (or
  grimoires) with an `equipped` flag, and a `canTradeFor(stockItem)` guard mirror
  of the three server disable conditions.
- Modal sub-text updated to describe the single same-slot upgrade and the
  once-per-stop limit; when `umori.traded`, show a spent-state note ("You've
  already bartered this stop — Umori moves in {countdown}.").

Keeper art/quote and the board rendering / "Find Umori" button are untouched.

## Data / tuning

- `undercity_config.py`: `UMORI_DWELL_MIN = 120` (unchanged).
- `undercity_data.py`: `UMORI_STOCK_SPEC = {'gear_per_slot': 1, 'grimoire': 1}`.
  Gear slots are `fang`, `carapace`, `charm`; T3 grimoires in play:
  `queensbane_grimoire`, `tome_of_deep_roads`.
- No client numeric mirror (stock and the traded flag come from the server;
  countdown is formatted from `movesAt`).

## Edge cases

- **Own the same item id equipped and stashed:** removal prefers the equipped copy
  when `give` matches the equipped slot piece, else removes one stash instance.
- **Traded, then window rolls while modal open:** server validates against the
  current window; `umoriTradedWindow` no longer matches → the next-window barter is
  allowed. The client re-syncs `traded` on the next state fetch.
- **Gear stash full:** gear takes are blocked (existing guard) — surfaced as a
  disabled "Trade for this" and the existing 409 message.
- **No qualifying item:** a player with an empty slot and nothing stashed for it
  simply can't take that gear line (button disabled) — Umori is an upgrade vendor,
  not a free grant.
- **Window rolls mid-trade / player not on node / out-of-range take:** unchanged
  existing rejections.

## Testing (`tests/`)

Update:
- `_umori_stock` composition: 4 lines, one T3 gear per slot (all three slots
  present, distinct), one T3 grimoire; deterministic per window.
- Any test asserting stock length via the old `UMORI_STOCK_SPEC` keys.

Existing (should still pass): `test_umori_swap_gear` (T1 fang → T3 fang, same
slot), `test_umori_swap_grimoire_auto_equips`, `test_umori_rejects_consumable_give`,
`test_umori_rejects_trade_when_not_on_node`, `test_umori_rejects_out_of_range_take`.

Add:
- **Same-slot rejection:** give a fang, take a carapace line → 409.
- **Cross-kind rejection:** give gear, take the grimoire line (and vice versa) → 409.
- **Once-per-rotation:** a second trade in the same window → 409; the same trade in
  a later window (advance `umoriTradedWindow` past `win`) → 200.
- **Give from stash:** a same-slot gear piece in `gearStash` (nothing equipped in
  that slot) qualifies and is removed from the stash.

Frontend: production build compiles (no unit runner) — verify `npm run build`.

## Non-goals / out of scope

- No change to Umori's movement, window math, board rendering, or "Find Umori".
- No new T3-grimoire source elsewhere (deferred; Umori remains the single source).
- No auto-equip of bartered gear (stays stash-then-Plaza).
- No PvP / revenge / achievement changes.
