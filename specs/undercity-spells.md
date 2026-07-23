# The Undercity — Spell System Reference

A living reference for the Dokapon-style spell system: what it does for players, how it works under the hood, and how to extend it. The approved design rationale lives in [2026-07-10-undercity-spells-design.md](2026-07-10-undercity-spells-design.md); this document tracks what is actually shipped.

**Status:** Core casting, scrolls, and the Sedgemoor Witch are all live. Tier-II/III spells are reachable today via scroll drops; dedicated tier-II/III *book* acquisition is still data-only (not yet dropped in the world) — see [Roadmap](#roadmap).

---

## Player rules

### Your loadout

- **Innate spell** — every creature can always cast the signature spell of its *home biome* (chosen at hatch). No book needed, no way to lose it.
- **Grimoires** — spell books found in the world. A book starts with 1–3 spells and can hold up to its tier's capacity (I:2 / II:3 / III:4); you **grow a book by inscribing scrolls at the Sedgemoor Witch** (a full book burns out a spell to make room). Every book you ever find goes into a **permanent collection** (never sold, never lost; duplicates convert to 15 Spores), but only **one book is open at a time**. Swap freely from the Creature tab. Your first book auto-opens.
- **Scrolls** — one-spell items found in the world (tiered drops) or bought from the witch. Cast one-shot (no cooldown, consumed) or inscribe into a grimoire. Held in a capped satchel.
- Castable at any moment = innate spell + the spells in your open book.

### Casting

- **Cooldowns**, not mana: each spell has a real-time cooldown (15–60 min). Cooldowns keep ticking while your phone is down.
- **Range**: targeted spells reach N board spaces, measured as shortest-path distance over the tunnels (sealed barriers block the path). Teleports use the same rule.
- **Dodge**: spells aimed at players can be dodged. Chance = `10% + 3% × (target SPD − caster SPD)`, clamped to 5–40%, using effective stats (gear + buffs count). A dodged spell still burns your cooldown.
- **No spell can kill.** Player damage floors at 1 HP; boss/lair HP pools floor at 1. Killing blows must be landed in person. Casting a spell never composts anyone.
- Freshly composted players are **shield-protected** and cannot be targeted (and a rejected cast never starts your cooldown).
- Casting is independent of movement, except teleport/recall (they cancel any pending move and relocate you — teleports resolve the destination space exactly like landing on it).

### Spell categories

| Category | What it does |
| --- | --- |
| **Buff** | Boost yourself for your *next battle* (one-battle buffs, consumed when the fight ends), or heal. |
| **Field** | Dokapon's signature: hit or curse a rival anywhere within range, resolved instantly even if they're offline. |
| **Traversal** | Blink to a nearby space, recall to your home gate, or fix your next die roll. |
| **Boss** | Chip Savra's (or a lair boss's) persistent HP pool from anywhere on the map. Damage counts toward your `bossDamage` renown (Savra only). |

### Getting hit while away

Every spell that hits (or fizzles against) you lands in your inbox:

- Playing right now → a toast on your next poll (~10 s).
- Coming back later → a **"While you were away…"** modal listing who hit you, with what, for how much. Dismissing it clears the inbox (capped at the 20 most recent events).

### The five innate spells

| Home biome | Spell | Effect | Cooldown |
| --- | --- | --- | --- |
| The Rot-Gardens (garden) | **Rot Surge** | Self: +3 ATK next battle | 30 min |
| Ossuary Fields (bone) | **Bone Chill** | Curse, range 5: −2 ATK next battle | 30 min |
| The Sedgemoor (bog) | **Bog Snare** | Curse, range 5: next roll halved | 30 min |
| Mosslight Cavern (cavern) | **Glowveil** | Self: +2 SPD & +15% flee next battle | 30 min |
| The Undercity (city) | **Scrap Toss** | 8 damage, range 5 | 30 min |

### Grimoire spells

| Spell | Tier | Effect | Range | Cooldown |
| --- | --- | --- | --- | --- |
| Spore Bolt | I | 12 damage | 6 | 20 min |
| Mend Flesh | I | Self-heal 12 HP | — | 15 min |
| Harden Shell | I | Self: +2 DEF next battle | — | 20 min |
| Skitter Step | I | Choose next roll (1–3) | — | 25 min |
| Rot Bolt | II | 20 damage | 7 | 25 min |
| Weaken Hex | II | Curse: −3 ATK next battle | 6 | 25 min |
| Mycelial Recall | II | Return to your home gate | — | 45 min |
| Fate Die | II | Choose your next roll (1–6) | — | 40 min |
| Spore Burst | III | 30 damage | 8 | 30 min |
| Deep Step | III | Teleport | 6 | 30 min |
| Queen's Bane | III | 15 damage to Savra or a lair pool, from anywhere | ∞ | 60 min |
| Ember Fleck | I | 10 damage | 4 | 15 min |
| Necrotic Lance | II | 16 damage | 9 | 28 min |
| Withering Gout | III | 26 damage | 6 | 26 min |
| Renewing Bloom | II | Self-heal 20 HP | — | 25 min |
| Deep Mend | III | Self-heal 34 HP | — | 30 min |
| Shadowstep | II | Teleport | 3 | 25 min |
| Savage Roar | II | Self: +5 ATK next battle | — | 25 min |
| Iron Hide | II | Self: +4 DEF next battle | — | 25 min |
| Fleetfoot Draught | II | Self: +3 SPD next battle | — | 25 min |
| Warding Dance | III | Self: +3 DEF & +3 SPD next battle | — | 30 min |
| Sap Vigor | II | Curse: −3 SPD next battle | 6 | 25 min |
| Rust Curse | III | Curse: −4 DEF next battle | 6 | 28 min |
| Sear the Throne | III | 22 damage to Savra or a lair pool, from anywhere | ∞ | 60 min |

### Spell power scales with level

Damage/heal/boss-strike magnitude is `base + round(SPELL_POWER_PER_LEVEL ×
(level − 1))` (`SPELL_POWER_PER_LEVEL = 1.0`, `undercity_config.py`). The tables
above list **base** (level-1) values; e.g. a level-10 Spore Bolt lands for 21,
not 12. Buff/curse/traversal spells are flat. Server: `engine.spell_power`.
Client mirror: `data/spells.ts` `spellPower` / `spellPowerLabel` (the cast picker
shows the live scaled number).

### The books

| Grimoire | Tier | Cost | Spells | How to get it |
| --- | --- | --- | --- | --- |
| Moldering Folio | I | 25 | Spore Bolt | Any bazaar; rare mystery drop |
| Gardener's Primer | I | 30 | Mend Flesh, Harden Shell | Any bazaar; rare mystery drop |
| Vagrant's Chapbook | I | 30 | Skitter Step | Any bazaar; rare mystery drop |
| Warcaster's Screed | I | 35 | Rot Surge, Spore Bolt | Any bazaar; rare mystery drop |
| Hexweaver's Codex | I | 35 | Bone Chill, Bog Snare | Any bazaar; rare mystery drop |
| Nightrunner's Ledger | I | 32 | Glowveil, Skitter Step | Any bazaar; rare mystery drop |
| Tinker's Manual | I | 30 | Harden Shell, Scrap Toss | Any bazaar; rare mystery drop |
| Skirmisher's Notes | I | 32 | Ember Fleck | Any bazaar; rare mystery drop |
| Kraul Warcodex | II | 70 | Rot Bolt, Weaken Hex | *Phase 3 (not yet obtainable)* |
| Wayfarer's Atlas | II | 70 | Mycelial Recall, Fate Die, Skitter Step | *Phase 3 (not yet obtainable)* |
| Bulwark Breviary | II | 70 | Iron Hide, Renewing Bloom | *Phase 3 (not yet obtainable)* |
| Sniper's Folio | II | 70 | Necrotic Lance, Fleetfoot Draught | *Phase 3 (not yet obtainable)* |
| Saboteur's Libram | II | 70 | Sap Vigor, Shadowstep | *Phase 3 (not yet obtainable)* |
| Berserker's Roll | II | 72 | Savage Roar, Ember Fleck | *Phase 3 (not yet obtainable)* |
| Queensbane Grimoire | III | 150 | Queen's Bane, Spore Burst | *Phase 3 (not yet obtainable)* |
| Tome of the Deep Roads | III | 150 | Deep Step, Fate Die, Mycelial Recall | *Phase 3 (not yet obtainable)* |
| Throneburner Codex | III | 150 | Sear the Throne, Withering Gout, Rust Curse | *Phase 3 (not yet obtainable)* |
| Warding Tome | III | 150 | Warding Dance, Deep Mend | *Phase 3 (not yet obtainable)* |

Tier-II/III books above are defined in the data model but not yet dropped by phase-3 acquisition. In the meantime their spells are reachable through **scrolls** — the Sedgemoor Witch sells them and reward sources drop them by tier — which can be cast one-shot or inscribed into a grimoire.

Mystery spaces: when the d12 lands on a "free item" outcome, there's a 25% chance it upgrades to a tier-I grimoire you don't own yet.

### UI map

- **Creature tab → Grimoire card**: innate spell pinned on top, open book's spells with live cooldown labels, and your collection as equip chips (tap the open book again to stow it).
- **Board tab → Cast button** (beside Roll): spell picker → then a target picker (rivals in range, with distance and HP), a die-value picker (Fate Die), a pool picker (boss strikes), or highlighted board spaces you tap to blink to (teleports).
- **Bazaar**: a Grimoires section under the consumables.

---

## Developer reference

### Where everything lives

| Concern | File |
| --- | --- |
| Spell/grimoire/balance tables (source of truth) | `infrastructure/lambda/undercity_data.py` — `SPELLS`, `GRIMOIRES`, `BIOME_SPELLS`, `SPELL_DODGE_*`, `AWAY_EVENTS_CAP`, `GRIMOIRE_DUPLICATE_SPORES`, `MYSTERY_GRIMOIRE_CHANCE`. Each `SPELLS` entry also carries the client `icon` + `desc` (server ignores them at runtime; the generator ships them to the client) |
| Client mirror generator | `infrastructure/lambda/sync_spells.py` — renders `src/app/undercity/data/spells.generated.ts` from the Python tables. `tests/test_spells_generated.py` fails while the committed file is stale |
| Pure math (BFS range, dodge %) | `infrastructure/lambda/undercity_engine.py` — `board_distance()`, `spell_dodge_chance()`; spell buff kinds in `effective_stats()` |
| Cast resolution + persistence | `infrastructure/lambda/undercity_db.py` — "Spells" section: `_cast`, `_cast_at_player`, `_cast_teleport`, `_cast_boss_strike`, `_equip_grimoire`, `_ack_events`, plus `_grant_grimoire` (acquisition) and the grimoire branches in `_buy` / `_mystery` |
| Tests | `infrastructure/lambda/tests/test_undercity_spells.py` (in-memory FakeTable suite) |
| Client display mirror | `src/app/undercity/data/spells.generated.ts` (GENERATED data arrays — do not hand-edit) + `src/app/undercity/data/spells.ts` (types, `SPELL_MAP`, helpers like `cooldownLeftMin()`, `spellPower()`, which re-exports the generated `SPELLS`/`GRIMOIRES`/`BIOME_SPELLS`) |
| Client BFS mirror | `src/app/undercity/engine/board-movement.ts` — `boardDistance()`, `nodesWithin()` |
| Client types | `src/app/undercity/services/undercity-models.ts` — `AwayEvent`, `CastResult`, spell fields on `YouDoc` |
| Cast UI | `src/app/undercity/tabs/board-tab.component.*` (cast flow, away inbox, shop section) |
| Loadout UI | `src/app/undercity/tabs/creature-tab.component.*` (Grimoire card) |

### Player-doc fields

```
grimoires:        [grimoireId, ...]        permanent collection
equippedGrimoire: grimoireId | None        the open book
spellCooldowns:   {spellId: readyAtISO}    server clock; expired entries pruned on load
awayEvents:       [{kind, from, spell, dmg?, at}, ...]   capped at 20, oldest dropped
```

New players get all four seeded at join; older docs are handled with `.get()` defaults throughout.

### Effect-kind vocabulary

`_cast` dispatches on `SPELLS[id]['effect']`:

| Kind | Extra spell fields | Behavior |
| --- | --- | --- |
| `self_buff` | `buffKind` | Appends `{kind}` to the caster's `buffs` (refresh-don't-stack via `_apply_buff`) |
| `self_heal` | `power` | Heals up to effective max HP |
| `field_curse` | `buffKind`, `range` | Dodge roll, then buff written to the *target's* `buffs` |
| `field_damage` | `power`, `range` | Dodge roll, then damage floored at 1 HP |
| `teleport` | `range` | Clears `pendingMove`, moves, runs `_resolve_space` like a normal landing |
| `recall` | — | Returns to `HOME_GATES[homeBiome]`, no space resolution |
| `fate_die` | `maxValue?` | Payload `value` 1–`maxValue` (default 6; Skitter Step caps at 3) → sets `pendingLoadedDie` (rejected while a move is pending) |
| `boss_strike` | `power` | Payload `target` = `'boss'` or a lair node id → chips the persistent pool, floors at 1 |

One-battle buff kinds the engine consumes after any fight (`ONE_BATTLE_BUFFS` in `undercity_db.py`): `rot_surge` (+3 ATK), `bone_chill` (−2 ATK), `glowveil` (+2 SPD, +15 flee via `_combatant`), `harden_shell` (+2 DEF), `weaken_hex` (−3 ATK), `savage_roar` (+5 ATK), `iron_hide` (+4 DEF), `fleetfoot` (+3 SPD), `warding_dance` (+3 DEF & +3 SPD), `sap_vigor` (−3 SPD), `rust_curse` (−4 DEF). `vines` (Bog Snare) is consumed by the next roll instead. Each kind is one `elif` in `engine.effective_stats()`; self-buffs apply `* mult` (Squirrel Warrior doubling), curses use `max(1, …)` and ignore `mult`.

### Action contracts

```
POST /game/action
  {type: 'cast',           payload: {spellId, source: 'innate'|'grimoire', target?, value?}}
  {type: 'equip-grimoire', payload: {grimoireId | null}}     null = stow
  {type: 'ack-events',     payload: {}}                       clears awayEvents
```

`target` is a userId (field spells), node id (teleports), or `'boss'`/lair node id (boss strikes). Success returns `_ok(doc, cast={spellId, effect, text, dodged?, dmg?, hp?, targetName?, to?})`; teleports additionally return `spaceEvent` + `occupants` exactly like `move`.

Cast failures carry a machine-readable `code` beside the human `error` text:

| Code | Status | Meaning |
| --- | --- | --- |
| `unknown_spell` | 400 | No such spell id |
| `not_castable` | 409 / 400 | Not your biome's innate / not in your open book / scroll source (phase 2) |
| `spell_on_cooldown` | 429 | Still recharging |
| `invalid_target` | 400 / 404 | Missing, self, or nonexistent target |
| `target_shielded` | 409 | Compost shield up — cooldown NOT started |
| `out_of_range` | 409 | Beyond the spell's BFS range — cooldown NOT started |

Cross-doc concurrency: field spells write the victim's doc first (`_put_player`, retried once on a `ver` conflict with a fresh read), then the caster's via `_save_or_conflict` — the same shape as PvP `_battle`.

### Adding a spell or grimoire (checklist)

1. Add the entry to `SPELLS` (and/or `GRIMOIRES` / `BIOME_SPELLS`) in `undercity_data.py` — including the client `icon` + `desc` (a data-integrity test enforces both). Existing effect kinds need **no new code** — the data-integrity tests enforce the required fields per kind.
2. New *buff* kind? Wire it into `engine.effective_stats()` and add it to `ONE_BATTLE_BUFFS` (or give it an `until` and let `_expire_buffs` handle it). Flee-affecting buffs also touch `_combatant`.
3. New *effect* kind? Add a branch in `_resolve_spell_effect` (and a helper alongside `_cast_field` if it needs targeting), plus a test per behavior.
4. Regenerate the client mirror: `python infrastructure/lambda/sync_spells.py`. **Do not hand-edit `spells.generated.ts`** — the `test_spells_generated.py` guard fails while it is stale. Hand-written logic (types, maps, helpers) stays in `spells.ts`.
5. Run `cd infrastructure/lambda && python -m pytest tests -q` and `npm run build`. Both must stay green.
6. Backend changes need a `cdk deploy` before the live client can use them.

### Design invariants (don't break these)

- **Spells never kill** — every damage path floors at 1 (players, Savra, lairs).
- **Cooldowns only start on a successful cast** — validation errors and shielded/out-of-range targets must return before `_start_spell_cooldown`.
- **A dodge still costs the cooldown and still notifies the victim.**
- **The grimoire collection is permanent** — nothing removes entries from `grimoires`.
- **Loadouts are mutable but capacity-bounded** (design 2026-07-23, retires the old
  "fixed bundles" rule). A book's contents are per-player state (`grimoireSpells`,
  read via `_book_spells`), grown by finding **spell scrolls** and inscribing them
  at the **Sedgemoor Witch**. A book never holds more spells than its tier allows
  (`GRIMOIRE_CAPACITY` = I:2 / II:3 / III:4); inscribing into a full book burns out
  a chosen spell. Only **one book is open at a time**, and every added spell must be
  a scroll the player physically found or bought — there is no free "pick any spell"
  menu (except the Calamity Beast's **Wish**).

### Scrolls & the Sedgemoor Witch (design 2026-07-23)

- A **scroll** carries one spell and lives in the `scrolls` satchel (cap
  `SCROLL_SATCHEL_CAP`). It can be **cast one-shot** (`source: 'scroll'` — no book,
  no cooldown, consumed) or **inscribed** into a grimoire at the witch.
- Scrolls **drop tiered by content difficulty** (`_roll_scroll_drop`,
  `SCROLL_DROP_CHANCE`/`SCROLL_DROP_TIER`): tier-I from mystery, tier-II from caches,
  tier-III from vault / lair / boss kills. This is how tier-II/III spells enter play.
- The witch is a singleton `witch` space (bog `bog_r7`). Actions:
  `witch-inscribe` `{scrollSpellId, grimoireId, overwriteSpellId?}` and
  `witch-buy-scroll` `{spellId}` (rotating tier-I stock, `WITCH_SCROLL_STOCK`).

## Roadmap

| Phase | Content | Status |
| --- | --- | --- |
| 1 | Core casting, innate spells, tier-I books in shops + mystery drops, full UI | ✅ Shipped |
| 2 | Scrolls — one-shot casts (`source: 'scroll'`, no cooldown) + tiered world drops | ✅ Shipped (2026-07-23) |
| 3 | Tier-II/III spell access — via scroll drops from caches / vault / lair / boss | ✅ Shipped (scrolls; books still defined in data) |
| 4 | Sedgemoor Witch space (inscribe scrolls into books, buy tier-I scrolls) | ✅ Shipped (2026-07-23) |
