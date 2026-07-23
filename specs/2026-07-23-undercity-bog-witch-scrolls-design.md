# The Undercity — The Sedgemoor Witch & Spell Scrolls (design)

**Status:** approved design, pending implementation plan.
**Date:** 2026-07-23.

Adds a magic-crafting hub — **the Sedgemoor Witch**, a new singleton facility
space — plus a new **spell scroll** item. Scrolls drop in the world and can be
cast one-shot *or* inscribed at the witch into a grimoire. This realizes the
spell system's reserved **Phase 2** (scrolls) and part of **Phase 3** (tier-II/III
spell access), and it **deliberately replaces the fixed-bundle invariant** with a
light deckbuilding layer.

Related: [2026-07-22-undercity-squirrel-caster-design.md](2026-07-22-undercity-squirrel-caster-design.md)
(the caster race + level scaling + in-combat casting). This feature is
complementary but independently shippable.

## 1. Why

The spell system is thin: your loadout is one found book's fixed 1–3 spells, and
tier-II/III spells are defined in data but **unreachable** (no book grants them
yet). There's no reason to explore *for magic*, and a caster has nothing to build
toward. The witch + scrolls give every player a magic economy — find scrolls,
choose whether to spend them now or bank them into a crafted loadout — and give
the Sedgemoor a thematic identity as the arcane hub.

## 2. The invariant change (read this first)

The shipped spell reference states a hard invariant:

> *"Loadouts are fixed bundles — no mechanism may let players compose custom
> spell sets; power growth comes from finding better books."*

**This feature retires that invariant** and replaces it with a bounded one:

> *Grimoires are mutable but capacity-bounded. You grow a loadout by finding
> scrolls in the world and inscribing them, one at a time, at the Sedgemoor
> Witch. A book never holds more spells than its tier allows, and inscribing is
> the only way to add a spell to a book.*

What is preserved: you still **only cast from one open book at a time**; power is
still gated by scarcity (scroll drops) and capacity (per-tier slots); there is no
free "pick any spell from a menu" — every spell added must be a scroll you
physically found or bought. `undercity-spells.md` must be updated to match.

## 3. Scrolls

### The item

A scroll is a new item type carrying exactly one `spellId` (any spell in
`SPELLS`, including tier II/III). Unlike gear/consumables it is **not** in `GEAR`
or `CONSUMABLES`; it is identified by its spell + tier.

- **Storage:** a dedicated **scroll satchel** on the player doc:
  `scrolls: [spellId, ...]`, cap **6** (tunable). Separate from the 3-slot `bag`
  so scrolls don't compete with combat consumables. Over-cap drops convert to
  Spores (like duplicate grimoires) — flagged to the player.
- Scrolls are **not** tied to your open book or your biome; any scroll can be
  cast or inscribed regardless of loadout.

### Two uses

1. **Cast one-shot** — cast a scroll directly: no grimoire needed, **no cooldown
   started, ignores cooldown**, consumed on use. Implemented via the reserved
   `source: 'scroll'` branch in `_cast` (currently rejected). All other cast
   validation still applies (range, dodge, shield, and the board never-kill
   floor). Traversal/boss scrolls behave like their spell.
2. **Inscribe at the witch** — permanently add the scroll's spell to a chosen
   grimoire (§4), consuming the scroll.

### Drops — tiered by difficulty

Scroll tier tracks content risk, so tougher content stays rewarding and tier-II/
III spells finally have a source:

| Scroll tier | Sources (drop chance hooked into the reward finisher) |
|---|---|
| I | `loot`, `mystery` |
| II | `elite`, `excavation` (dig), `cache` |
| III | `lair` (boss pools), `vault`, `boss` (Savra) |

- Drop chance per source is a tunable in `undercity_config.py` (e.g.
  `SCROLL_DROP_CHANCE = {'loot': 0.08, 'elite': 0.15, ...}`). Start conservative.
- Which spell a scroll carries is a **weighted roll within the eligible tier**
  (reuse the loot-weighting pattern already in `undercity_data.py`).
- Drops respect the satchel cap (§3) — a full satchel converts the drop to
  Spores rather than blocking the reward.

## 4. The Sedgemoor Witch (the space)

A new **singleton facility space** in the mold of `shrine` / `ossuary`: one node,
placed in the Sedgemoor (bog) region, its own action handler, dispatched like the
others. Built with the [add-undercity-space](../.claude/skills/add-undercity-space/SKILL.md)
skill.

- **Node type:** `witch`. One node added to `map.json` (+ synced to
  `public/data/undercity-map.json`), placed on a Sedgemoor space.
- **`_resolve_space`** returns a `{'type': 'witch', 'text': ...}` payload so the
  client opens the witch modal on landing.
- **Actions** (dispatched in the `ACTIONS` table, each validating the player is
  on a `witch` node):
  - **`witch-inscribe`** `{scrollSpellId, grimoireId, overwriteSpellId?}` —
    inscribe a held scroll into a grimoire you own:
    - Validate you own the scroll and the book.
    - **Capacity by book tier:** tier I → 2, II → 3, III → 4
      (`GRIMOIRE_CAPACITY` in config). If the book has room, append the spell.
    - If the book is **full**, `overwriteSpellId` must name a spell currently in
      that book; it is **burned out** (removed, destroyed) and the new spell
      takes its slot. Missing/invalid overwrite target on a full book → error.
    - Reject inscribing a spell the book already contains (no duplicates within a
      book).
    - Charge a Spore fee scaled by scroll tier (`INSCRIBE_COST = {1:10, 2:20,
      3:30}`), consume the scroll.
  - **`witch-buy-scroll`** `{spellId}` — buy a tier-I scroll from the witch's
    stock into the satchel for Spores. The witch stocks a small rotating set of
    tier-I scrolls (reuse the shop-stock rotation pattern; witch-specific stock
    list). Respects the satchel cap.
- **Casting a scroll** is the normal `cast` action with `source: 'scroll'`; it
  does **not** require being at the witch (scrolls are portable). Only inscription
  and buying are witch-gated.

## 5. Grimoire mutability

- Grimoires stay a `grimoires: [id, ...]` collection with `equippedGrimoire` as
  the one open book — unchanged. What changes is that a book's spell list is now
  **per-player mutable state**, not a fixed lookup into `GRIMOIRES`.
- **Data-model shift:** today `GRIMOIRES[id]['spells']` is the source of truth for
  a book's contents. With inscription, contents diverge per player. Store the
  player's per-book spell lists on the doc, e.g.
  `grimoireSpells: {grimoireId: [spellId, ...]}`, seeded from
  `GRIMOIRES[id]['spells']` when the book is first acquired (`_grant_grimoire`).
  All read paths (`_cast` grimoire-source check, client Grimoire card) read the
  doc's per-book list, falling back to the static bundle for older docs.
- Capacity is enforced against the book's **tier** (`GRIMOIRES[id]['tier']`),
  which never changes.

## 6. Where the code changes land

Server is the source of truth; the client mirrors for display (per CLAUDE.md).

### Backend (`infrastructure/lambda/`)

| Concern | File / symbol |
|---|---|
| Scroll casting | `undercity_db._cast` — implement the `source: 'scroll'` branch: verify satchel holds the scroll, resolve the spell with no cooldown, consume the scroll |
| Inscribe / buy | `undercity_db` — new `_witch_inscribe`, `_witch_buy_scroll`; register in `ACTIONS`; witch-node guard like `_shrine` |
| Space resolution | `undercity_db._resolve_space` — add the `witch` branch |
| Grimoire contents | `undercity_db` — per-book `grimoireSpells` on the doc; seed in `_grant_grimoire`; read in the `_cast` grimoire check; helper `_book_spells(doc, gid)` with static fallback |
| Scroll drops | reward finishers (`_finish_*`) / loot / mystery / dig — a shared `_roll_scroll_drop(doc, source)` gated by `SCROLL_DROP_CHANCE`, respecting the satchel cap |
| New-doc fields | `_new_player_doc` — `scrolls: []`, `grimoireSpells: {}` |
| Map | `map.json` (+ `sync_map.py` → `public/data/undercity-map.json`): one `witch` node in the Sedgemoor. A pytest fails while the copies differ |
| Tables/tunables | `undercity_data.py`: witch stock list, scroll tier→spell weights. `undercity_config.py`: `SCROLL_SATCHEL_CAP`, `SCROLL_DROP_CHANCE`, `GRIMOIRE_CAPACITY`, `INSCRIBE_COST`, witch scroll prices |
| Spell reference | `specs/undercity-spells.md` — rewrite the fixed-bundle invariant (§2), document scrolls, inscription, the witch space, and mark Phase 2 / tier-II-III access as shipped |
| Tests | `tests/` — scroll cast (no cooldown, consumed, validation), inscribe (append, tier cap, full-book overwrite burns a spell, dup rejected, fee charged, scroll consumed), witch-buy, tiered drops (seeded RNG), satchel cap → Spores, per-book contents read by `_cast`. Keep the suite green |

### Client (`src/app/undercity/`)

| Concern | File |
|---|---|
| Witch modal | new component for the `witch` space: inscribe flow (pick scroll → pick book → pick overwrite target if full) + buy-scroll list. Follows the shrine/ossuary modal pattern |
| Scroll casting | `tabs/board-tab.component.*` cast flow — a "Scrolls" source alongside innate/grimoire; sends `source: 'scroll'` |
| Loadout UI | `tabs/creature-tab.component.*` Grimoire card — render per-book contents from `grimoireSpells`; show the satchel |
| Data mirrors | `data/spells.ts` (SCROLL tier→spell weights for display, witch stock), `data/items.ts` if scrolls surface there |
| Types | `services/undercity-models.ts` — `scrolls`, `grimoireSpells` on `YouDoc`; witch space payload; scroll cast source |

## 7. Balance & interaction notes

- **Power ceiling** is bounded by per-tier capacity (max 4 in a tier-III book) +
  one-book-open + scroll scarcity + cooldowns (board casting is still on
  cooldown; only *scroll* casts bypass it, and those are consumed). A player can
  assemble a strong 4-spell book but casts it under the normal cooldown economy.
- **Caster synergy:** with the squirrel design, inscribing damage spells into a
  book and casting them in combat (acorn-fueled, level-scaled) is the payoff
  build. Scroll one-shot casts are *not* in scope for in-combat use here — combat
  casting stays acorn-from-loadout (see open question).
- **Never-kill:** scroll casts on the board keep the 1-HP floor, exactly like
  book/innate casts. No new kill path is introduced by this feature.

## 8. Out of scope / open questions

- **Casting scrolls *in combat*.** This feature makes scrolls board-castable and
  inscribable. Whether a one-shot scroll can also be spent inside the
  stance-triangle fight is deferred — the squirrel's acorn-fueled combat casting
  already covers in-fight magic. Easy to add later. **Open for review.**
- **Inscription reversibility.** Burned-out spells are destroyed; there is no
  "un-inscribe." Re-adding a burned spell means finding another scroll of it.
- No scroll trading between players; no crafting scrolls from other scrolls.
- Witch cosmetic art / dedicated space sprite: placeholder to start.
- **Supersedes** the "fixed bundles" invariant asserted in the squirrel spec §5;
  that spec's other invariants stand.
