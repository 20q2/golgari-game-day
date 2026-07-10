# Undercity Spells — Design Spec

**Date:** 2026-07-10
**Status:** Approved design, pending implementation plan
**Related:** `specs/2026-07-06-undercity-gdd.md` (GDD), `.claude/specs/2026-07-06-undercity-dokapon-board-design.md`

## Summary

A Dokapon-inspired spell system for the Undercity. Every player has one **innate spell** determined by their home biome, always castable. Additional spells come from **grimoires** — found/bought items pre-loaded with a fixed set of 1–3 spells. Players keep every grimoire they find (permanent collection) but equip only **one at a time**; the equipped book plus the innate spell is the active loadout. **Scrolls** are bag consumables that cast one spell once, outside the grimoire system.

Spells cover four categories: self buffs/enemy curses for upcoming battles, offensive field spells hurled at other players on the map, traversal spells, and boss/lair chip-damage spells. Casting is limited by **real-time cooldowns** (no mana). Targeted spells are **range-limited** by board distance and can be **dodged** via a flat SPD-based chance. **No spell can ever kill** — damage floors at 1 HP for players, and boss/lair pools can't be finished by a spell; killing blows happen in person.

## Decisions (locked during brainstorming)

| Question | Decision |
| --- | --- |
| "Race" starting spell | Home biome (5 innate spells) |
| Categories in scope | Buffs/curses, offensive field, traversal, boss/lair — all four |
| Cast limiter | Real-time cooldowns; scrolls exempt but consumed |
| Loadout model | Innate spell always castable + one equipped grimoire (fixed 1–3 spell bundles); grimoire collection is permanent, swap freely |
| Player targeting | Range-limited (BFS board distance) |
| Counterplay | Flat SPD-based dodge chance; **no** defensive spell slot |
| Lethality | Never kills — floor 1 HP (players, boss, lairs alike) |
| Acquisition | Shops (tier I), mystery/loot (scrolls + rare books), dungeon/POI rewards (tier II/III), new spell-shrine space |
| Upgrades | Via tiers: better grimoires carry higher-tier spells; no in-place upgrading |
| Async feedback | Log entry + toast for active victims; "While you were away" modal for returning ones |

## 1. Data model

### 1.1 Spell table (`undercity_data.py` → `SPELLS`)

Each spell id maps to:

```python
'spore_bolt': {
    'name': 'Spore Bolt', 'blurb': 'Hurl a puff of caustic spores at a rival.',
    'category': 'field',        # buff | field | traversal | boss
    'tier': 1,                  # 1–3
    'cooldownMin': 20,          # real-time minutes
    'range': 6,                 # board steps; omitted for self/anywhere spells
    'effect': 'field_damage',   # effect-kind vocabulary, §2.2
    'power': 12,                # meaning depends on effect kind
}
```

Display mirror: `src/app/undercity/data/spells.ts` (names, blurbs, numbers — same duplication convention as `forms.ts`/`items.ts`).

### 1.2 Grimoire table (`undercity_data.py` → `GRIMOIRES`)

Each grimoire has `name`, `blurb`, `tier`, and a **fixed** `spells` list (1–3 ids). Players never learn loose spells; the book is the loadout. Higher tiers carry higher-tier spells — that is the entire upgrade system.

### 1.3 Innate biome spells (`undercity_data.py` → `BIOME_SPELLS`)

One spell per biome, always castable regardless of equipped grimoire. Three reuse buff kinds the engine already reads:

| Biome | Spell | Effect (initial values — tune during implementation) |
| --- | --- | --- |
| Compost Heaps | Rot Surge | self: +3 ATK next battle (existing `rot_surge` buff kind) |
| Bone Fields | Bone Chill | target in range 5: −2 ATK next battle (existing `bone_chill`) |
| The Mire | Bog Snare | target in range 5: next roll halved (existing `vines`) |
| Luminous Grove | Glowveil | self: +15% flee chance, +2 SPD next battle (new `glowveil` buff kind) |
| City Above | Scrap Toss | target in range 5: 8 field damage |

All innate spells: cooldown 30 min (initial value).

### 1.4 Player doc additions

- `grimoires: [id, ...]` — owned books, permanent (wardrobe-style; never sold or lost)
- `equippedGrimoire: id | null` — swap freely at any time (battles resolve atomically server-side, so there is no mid-battle state to protect)
- `spellCooldowns: {spellId: readyAtISO}` — expired entries pruned on doc load (same pass as `_expire_buffs`)
- `awayEvents: [{kind, from, spell, dmg?, at}, ...]` — capped at 20, oldest dropped

New players start with `grimoires: []`, `equippedGrimoire: null` — the innate spell alone is the day-one kit.

### 1.5 Scrolls

New `CONSUMABLES` entries carrying a `spell: <id>` field (e.g. `scroll_spore_bolt`, `scroll_recall`, `scroll_fate_die`). Casting from a scroll ignores cooldowns but consumes the item; the 3-slot bag and drop scarcity are the limiter.

## 2. Casting mechanics

### 2.1 The `cast` action

One new handler in the `undercity_db.py` `handlers` dict:

```
POST /game/action  {type: 'cast', payload: {spellId, source: 'innate'|'grimoire'|'scroll', target?}}
```

`target` is a player userId (field/curse spells) or a node id (teleport). Validation, in order:

1. Spell exists and is castable from `source` (innate = your biome's spell; grimoire = in equipped book; scroll = matching scroll in bag).
2. Off cooldown (skip for scrolls; scroll is removed from bag on cast).
3. Target valid: player targets must have joined the season, be **unshielded** (`shieldUntil` respected), and within range; node targets must be within range and not sealed behind a closed barrier.
4. On success: apply effect, stamp `spellCooldowns[spellId]`, write both docs (see §2.5), return `_ok(doc, castResult=...)`.

Errors return the standard `(status, {error})` shape: `spell_on_cooldown`, `out_of_range`, `target_shielded`, `invalid_target`, `not_in_grimoire`, `no_scroll`.

Casting is independent of movement: you may cast with a `pendingMove` outstanding, **except** teleport/recall, which clear `pendingMove` and move you immediately.

### 2.2 Effect-kind vocabulary (resolved in `undercity_engine.py`, pure functions)

| Kind | Behavior |
| --- | --- |
| `self_buff` | Append `{kind, ...}` to caster's `buffs`; consumed by `effective_stats` / battle loop like existing buffs |
| `field_curse` | Append a debuff to the **target's** `buffs` (subject to dodge) |
| `field_damage` | Damage target's HP (subject to dodge); **floor 1 HP — never composts** |
| `self_heal` | Restore HP up to `maxHp` |
| `teleport` | Move caster to chosen node ≤ range away (closed barriers block, same rule as movement); then `_resolve_space` runs normally |
| `recall` | Return caster to home-biome gate (no space resolution; it's home) |
| `fate_die` | Set caster's next roll to a chosen value (rides `pendingLoadedDie` plumbing) |
| `boss_strike` | Chip the persistent boss/lair HP pool from anywhere; damage accrues to `bossDamage` renown; pool floors at 1 HP — a spell can never land the kill |

### 2.3 Range

Board distance = BFS hop count over `MAP_NODES` (new pure helper in `undercity_engine.py` beside `legal_destinations`; unlike movement it is a simple shortest-path, no exact-count or no-backtrack rules). Ladders count as edges, so dungeon pockets are reachable if close enough.

### 2.4 Dodge

Targeted spells on players roll server-side with the injected rng:

```
dodge% = clamp(10 + 3 × (target SPD − caster SPD), 5, 40)
```

SPD values are `effective_stats` outputs (gear and buffs count). A dodge still notifies the target ("X's Spore Bolt fizzled against you") and still starts the caster's cooldown.

### 2.5 Writing the victim's doc

Field spells mutate another player's doc (HP, buffs, `awayEvents`) — same cross-doc pattern as `_battle`/`_compost`. Both writes go through `_save_or_conflict`; on a `ver` conflict on the victim's doc, retry the victim write once with a fresh read before returning 409.

### 2.6 Victim experience

Every hit (and dodge) appends to the victim's `awayEvents` and the season log. Active players see a toast on their next 10 s poll. Returning players get a **"While you were away"** modal (who, which spell, how much damage) built from `awayEvents`, cleared via a new `ack-events` action.

## 3. Acquisition & economy

| Channel | What it grants | Phase |
| --- | --- | --- |
| Shops | Tier-I grimoires + common scrolls, new sections in the existing `_buy` flow | 1 (grimoires), 2 (scrolls) |
| Mystery/loot spaces | Scrolls; rare chance of a grimoire you don't own (mystery-reel + `_give_consumable` patterns) | 1–2 |
| Dungeon/POI rewards | Lair first-kills, vault/cache claims, dig sites grant tier-II/III grimoires | 3 |
| Spell shrine | New board space type (arcane library) per biome ring: buy scrolls and grimoires shops don't stock; built with the `add-undercity-space` skill | 4 |

Duplicate grimoire drops convert to spores. Prices sit alongside gear pricing in `undercity_data.py` (initial: tier-I grimoire ≈ a tier-1 gear piece; exact numbers tuned in the plan against the existing spore economy).

### Draft v1 catalog (initial values — tune during implementation)

**Tier I (shops):** Moldering Folio [Spore Bolt]; Gardener's Primer [Mend Flesh (self_heal), Harden Shell (self +DEF)]; Vagrant's Chapbook [Skitter Step (teleport, range 3)].
**Tier II (mystery-rare, vault/cache):** Kraul Warcodex [Rot Bolt (field_damage 20, range 7), Weaken Hex (−3 ATK curse)]; Wayfarer's Atlas [Mycelial Recall (recall), Fate Die (fate_die), Skitter Step].
**Tier III (lair first-kills, rare digs):** Queensbane Grimoire [Queen's Bane (boss_strike 15, cd 60 m), Spore Burst (field_damage 30, range 8)]; Tome of the Deep Roads [Deep Step (teleport, range 6), Fate Die, Mycelial Recall].
**Scrolls:** Scroll of Spore Bolt, Scroll of Recall, Scroll of Fate Die.

## 4. Client (Angular)

- **Creature tab — Grimoire section:** the collection (owned books, equipped highlighted), free swap outside battle, spell cards with live cooldown countdowns, innate biome spell pinned at top.
- **Board tab — Cast flow:** Cast button beside roll/stance → spell picker (innate + equipped book + castable scrolls, cooldown state shown) → target picker: eligible players listed with board distance, or node picker for teleport (reuses movement-highlight rendering). Results use existing toast/battle-adjacent animation patterns.
- **Away modal:** shown on load when `awayEvents` is non-empty; lists hits; dismissing fires `ack-events`.
- **Mirrors:** `data/spells.ts` (spells + grimoires + scroll display), following the Python↔TS duplication convention in CLAUDE.md.
- **Models:** extend `YouDoc`, `ActionResponse` in `undercity-models.ts` (`grimoires`, `equippedGrimoire`, `spellCooldowns`, `awayEvents`, `castResult`).

New actions besides `cast`: `equip-grimoire` (`{grimoireId}`), `ack-events` (no payload).

## 5. Error handling

- All cast failures are 4xx with a machine-readable `error` code (§2.1); the client maps codes to toasts.
- Optimistic-concurrency: `ver` guard on both docs; victim-write conflict retried once (§2.5).
- Cooldown clock is server time (ISO strings, like `shieldUntil`); the client renders countdowns from server-supplied `readyAt`, never local math on cast time.
- A target who was composted between the caster's state fetch and the cast resolves as `target_shielded` — no error spam, cooldown **not** started.

## 6. Testing

Extend the in-memory FakeTable pytest suite (`infrastructure/lambda/tests`, must stay green):

- One test per effect kind (buff written, damage floored at 1 HP, teleport respects barriers + resolves the space, recall, fate_die sets the pending die, boss_strike floors pool at 1).
- Cooldown enforced; scroll bypasses cooldown and is consumed; scroll absent → `no_scroll`.
- Range: BFS distance boundary (in-range passes, +1 fails); shielded target rejected without starting cooldown.
- Dodge determinism with seeded rng; dodge still logs to `awayEvents` and starts cooldown.
- `awayEvents` cap at 20; `ack-events` clears; `equip-grimoire` rejects unowned books.
- Grimoire acquisition: shop buy, duplicate → spores.

## 7. Phasing (each phase ships playable)

1. **Core casting:** data tables + mirrors, `cast`/`equip-grimoire`/`ack-events` actions, all effect kinds, dodge/range/cooldowns, away-events, innate spells, tier-I grimoires in shops, mystery grimoire drops, full client UI.
2. **Scrolls:** consumable-spell items in shops + mystery/loot drops.
3. **Rare books:** tier-II/III grimoires from lairs, vault/cache, digs.
4. **Spell shrine:** new space type via the `add-undercity-space` skill.

## 8. Out of scope

- Defensive spell slot (rejected — SPD dodge only).
- In-place spell upgrading (tiers come from better grimoires).
- Spell crafting, trading spells between players, MP/mana stat.
- Lethal spells of any kind.
