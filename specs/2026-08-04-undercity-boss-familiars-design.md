# The Undercity — Boss Familiars & Sigil Codex

Design doc. Two linked features that deepen the five biome lair bosses:

- **A. Boss familiars** — replace the *borrowed* boss-turf signature minions with
  **bespoke familiars that exist only in that boss's turf**, each a mini-elite
  carrying the **same signature battle trait as its boss**. Meeting the small one
  teaches you the boss's trick before you fight the big one.
- **B. Sigil codex** — tapping a boss in the Sigils sub-tab pops out an in-world
  description of that boss plus its signature trait, so the lore/mechanic is
  legible on the meta screen too.

Companion to [undercity-combat.md](undercity-combat.md). Builds on the boss-area
signature minions from `2026-08-02` (the mechanic this replaces).

---

## 1. Background — what exists today

`undercity_data.LAIR_SIGNATURE` maps each biome (and the ruin) to **an ordinary
existing roster enemy** that gets an elevated spawn rate on that boss's turf:
`_wild_battle` rolls it instead of the flat pool at `SIGNATURE_SPAWN_CHANCE`
(0.40) on **WILD** spaces (never elite). Those signatures are just re-pointers to
pool members (e.g. `bone → mosspit_skeleton`), so the "minion" also shows up
everywhere else — nothing about it is boss-specific, and it carries no combat
identity.

Enemy combat identity is possible but unused: `engine._npc_combatant`
([undercity_db.py:693](../infrastructure/lambda/undercity_db.py)) already builds
the monster `Combatant` with `passives=frozenset(npc.get('passives') or [])`, but
`engine.npc_from_spec` ([undercity_engine.py:1000](../infrastructure/lambda/undercity_engine.py))
copies only the stat keys, so specs can't currently deliver a passive. The five
lair bosses (`LAIR_BOSSES`) likewise carry only stats + personality + bluff — **no
signature traits at all**.

The Sigils sub-tab (`creature-tab.component.html` `@case ('sigils')`) renders one
tile per biome from the `DUNGEONS` client mirror: boss portrait
(`undercity/guardians/<lairNpcId>.png`), biome name, boss name, Defeated/Undefeated.
Tiles are not interactive.

---

## 2. Feature A — Boss familiars

### 2.1 The roster

Five bespoke familiars, one per biome boss. Each lives **only** in a new
`LAIR_FAMILIAR` registry (not in any wild/elite pool), so it appears nowhere but
its boss's turf. `LAIR_SIGNATURE` re-points the five biomes at them; the spawn
mechanic in `_wild_battle` is otherwise unchanged (still 40%, WILD-only).

| Biome | Boss | Familiar | Art (`public/undercity/boss_spawns/`) |
|---|---|---|---|
| bone | Skullbriar, the Walking Grave | **Skullbriar's Familiar** | `skullbriars_familiar` |
| garden | Slimefoot, the Stowaway | **Slimefoot's Saprolings** | `slimefoots_saprolings` (the gang image) |
| bog | The Gitrog Monster | **Gitrog Spawn** | `gitrog_spawn`, `gitrog_spawn2` (random per encounter) |
| cavern | Sarulf, Realm Eater | **Sarulf's Packmate** | `sarulfs_packmate` |
| city | Ishkanah, Grafwidow | **Ishkanah's Hatchling** | `ishankas_hatchling` |

**Ruin** (`LAIR_SIGNATURE['ruin']`) is left on its current `moldering_karock`
signature — the Lord of Extinction / Doomgape lairs are separate side content
(`RESPAWN_LAIRS`) and out of scope here.

### 2.2 Power level — a mini-elite you power through

**The trait is the threat, not the HP bar.** A level-5-ish creature must be able
to power through the dungeon, so familiars run **low HP with elite-ish ATK** —
around the **tier-1 *elite* band** (hp ~30-32), well **below** both their own boss
(hp 40-48) and the tier-2 depths wilds (`DEPTHS_MID`, hp 42-56) they spawn among.
Their identity comes from the signature trait and a modest bounty/xp bump, not
attrition.

**Low HP is also the primary balance lever for the snowball traits.** Because the
fight ends fast, Grave Growth and Doom Counters rarely reach dangerous stacks —
you burst the familiar down before it spirals. A player who *stalls* still gets
punished, which is the lesson. The stack caps (§2.4) are a backstop, not the main
control; Dredge's regen stays below the frenzy ramp for the same reason.

> **Balance gate (hard requirement).** Each familiar is validated in
> `infrastructure/lambda/sim/` against a **~level-5** creature powering through
> the dungeon. If good play can't reliably clear it — comparable to beating a
> tier-1 elite — the numbers come down. Familiars are *teachers*, not walls.

Starting stat blocks (pre-sim, to be confirmed by the sim pass — treat as a
starting point, not final):

```python
LAIR_FAMILIAR = {
  'skullbriars_familiar': {
     'id': 'skullbriars_familiar', 'name': "Skullbriar's Familiar",
     'hp': 32, 'atk': 12, 'def': 4, 'spd': 6, 'bounty': 20, 'xp': 30,
     'itemChance': 0.25, 'personality': 'brute', 'bluff': 0.18,
     'passives': ['grave_growth'],
     'sprites': ['skullbriars_familiar']},
  'slimefoots_saprolings': {
     'id': 'slimefoots_saprolings', 'name': "Slimefoot's Saprolings",
     'hp': 34, 'atk': 10, 'def': 5, 'spd': 5, 'bounty': 20, 'xp': 30,
     'itemChance': 0.25, 'personality': 'balanced', 'bluff': 0.12,
     'passives': ['swarm'],
     'sprites': ['slimefoots_saprolings']},
  'gitrog_spawn': {
     'id': 'gitrog_spawn', 'name': 'Gitrog Spawn',
     'hp': 34, 'atk': 10, 'def': 6, 'spd': 5, 'bounty': 20, 'xp': 30,
     'itemChance': 0.25, 'personality': 'turtle', 'bluff': 0.12,
     'passives': ['dredge'],
     'sprites': ['gitrog_spawn', 'gitrog_spawn2']},
  'sarulfs_packmate': {
     'id': 'sarulfs_packmate', 'name': "Sarulf's Packmate",
     'hp': 30, 'atk': 11, 'def': 4, 'spd': 8, 'bounty': 20, 'xp': 30,
     'itemChance': 0.25, 'personality': 'trickster', 'bluff': 0.18,
     'passives': ['doom_counters'],
     'sprites': ['sarulfs_packmate']},
  'ishkanahs_hatchling': {
     'id': 'ishkanahs_hatchling', 'name': "Ishkanah's Hatchling",
     'hp': 30, 'atk': 11, 'def': 4, 'spd': 8, 'bounty': 20, 'xp': 30,
     'itemChance': 0.25, 'personality': 'trickster', 'bluff': 0.18,
     'passives': ['web_venom'],
     'sprites': ['ishankas_hatchling']},
}
```

`LAIR_SIGNATURE` then becomes (bone/garden/bog/cavern/city → the familiar id;
ruin unchanged), and `_wild_battle` resolves the spec from `LAIR_FAMILIAR` (not
`ENEMY_SPECS_BY_ID`, which only indexes pool members).

### 2.3 Shared boss traits — the five signatures

The **same trait** is added to each familiar **and** its lair boss, so the
familiar is a genuine preview. Each is surfaced as a named, tappable status
(§2.5). Two are brand-new stacking mechanics; the rest reuse existing combat
infrastructure.

| Trait (buff) | Boss / familiar | Mechanic | Reuse / new |
|---|---|---|---|
| **Grave Growth** (`grave_growth`) | Skullbriar | End of every round it survives: **+1 stack**; each stack grants **+`GRAVE_GROWTH_ATK` ATK and +`GRAVE_GROWTH_DEF` DEF**. Unconditional, ATK-leaning ramp. Capped at `GRAVE_GROWTH_MAX`. | **new** |
| **Doom Counters** (`doom_counters`) | Sarulf | On any round the wolf **wins the decisive exchange OR the round is a mirror tie** (clash/stall/whiff): **+1 counter**; each grants **+`DOOM_STEP` (2) to ATK, DEF and SPD**. Bigger than Grave Growth but *deniable* — force it to lose and its ramp stalls. Capped at `DOOM_MAX`. | **new** |
| **Dredge** (`dredge`) | Gitrog | End of round (if alive and below max): regenerate **`DREDGE_REGEN`** HP, kept strictly below the frenzy ramp so the fight still terminates. Flat regrow, **not** lifesteal. | **new (small)** |
| **Saproling Swarm** (`swarm`) | Slimefoot | Existing `swarm` passive — an extra chip every round (the gang piling on). Only new work: give it its own **named, inspectable** status so the player sees it. | **reuse** |
| **Venom** (`web_venom`) | Ishkanah | A decisive winning strike injects **+1 rot** stack (reuses the existing rot DoT). | **reuse (small branch)** |

**Why two stat-stackers don't feel identical:** Grave Growth is *unconditional*,
ATK-leaning, and slow; Doom Counters is *conditional* (win-or-tie), all-stats,
and larger per stack. Skullbriar is a race; Sarulf is a puzzle (deny its wins).

New scalars live in `undercity_config.py` (`GRAVE_GROWTH_ATK`, `GRAVE_GROWTH_DEF`,
`GRAVE_GROWTH_MAX`, `DOOM_STEP`, `DOOM_MAX`, `DREDGE_REGEN`) with the balance
constants; the trait→boss wiring lives in `undercity_data.py`. All are **mirrored**
in `src/app/undercity/data/*.ts` per the display-mirror rule.

### 2.4 Engine implementation

- **Plumbing:** `engine.npc_from_spec` copies `passives` (and `spriteId`, §2.6)
  when present. `LAIR_BOSSES` specs gain a `passives` list; the lair-boss
  combatant path must carry it through the same way `_npc_combatant` does (verify
  `_lair` builds its `Combatant` with `passives`). No change needed to
  `_npc_combatant` itself.
- **Combatant state:** add internal counters mirroring `aggress_ramp`:
  `growth_stacks` and `doom_stacks` (both `int`, `repr=False`). Their stat
  contribution is applied where swings are computed (`_swing_base` /
  `effective_stats`), gated by `has('grave_growth')` / `has('doom_counters')`,
  each clamped to its `*_MAX`.
- **Resolve-round branches** (`engine.resolve_round`):
  - `grave_growth`: at end of round, if the holder is alive, `growth_stacks =
    min(GRAVE_GROWTH_MAX, growth_stacks + 1)`.
  - `doom_counters`: when the round's outcome is a decisive win **for the
    holder** or any mirror (`clash`/`stall`/`whiff`), `doom_stacks =
    min(DOOM_MAX, doom_stacks + 1)`.
  - `dredge`: at end of round (after any frenzy accounting so regen can't outrun
    the Collapse), if alive and `hp < max_hp`, heal `DREDGE_REGEN` (never above
    max).
  - `web_venom`: on a decisive win by the holder, apply `+1` rot to the loser
    (reuse the existing rot-application path used by `rot_breath`/`venom_barb`,
    honoring the "fresh rot waits a round" rule).
- **Invariants preserved:** the Collapse still guarantees a kill by ~round 6 for
  every kind; no trait may push a combatant below the documented floors; regen
  caps below frenzy.

### 2.5 Status display — "tap the buff to see what's going on"

Each trait is surfaced to the client as an inspectable status on the enemy:

- The battle npc payload (battle_start / combat-round / resume) gains a
  `traits` array: `[{kind, name, blurb, stacks?}]`, where `stacks` is present and
  live for `grave_growth` / `doom_counters`. Built server-side from the
  combatant's passives + current counters.
- The client renders these as tappable chips near the enemy (extending the
  existing `combat.ts STATUS_INFO` pattern used for player statuses like
  `trophy`). Tapping shows the name + blurb (+ current stacks). This is the
  "unique buff a player can click" for Slimefoot and the live stack readout for
  Skullbriar/Sarulf.

### 2.6 Sprites

- Specs carry a `sprites` list; at spawn `_wild_battle` sets `npc['spriteId'] =
  _rng.choice(spec['sprites'])` (Gitrog rotates its two; the rest are singletons).
  `npc_from_spec` passes `spriteId` through when already set, or the caller sets
  it post-build.
- Art lives in `public/undercity/boss_spawns/`. The two client sprite loaders
  that today hardcode `undercity/enemies/<id>.png`
  (`board-tab.component.ts` `npcSpriteUrl`, `board-canvas.ts` `loadEnemy`) learn a
  small **boss-familiar set**: if the sprite id is a known familiar sprite, load
  from `undercity/boss_spawns/` instead. This keeps the art folder intact with no
  duplication. (The set is a tiny client constant mirroring the `sprites` values.)
- Filenames are used verbatim (`ishankas_hatchling` keeps its existing spelling to
  match the asset).

### 2.7 What this removes

Nothing is deleted. The old borrowed signature ids remain valid pool members;
`LAIR_SIGNATURE` simply stops pointing at them. `ENEMY_SPECS_BY_ID` is unchanged
(still pool-only); familiar lookup goes through `LAIR_FAMILIAR`.

---

## 3. Feature B — Sigil codex popout

### 3.1 Behavior

In the Sigils sub-tab, a sigil tile becomes tappable. Tapping expands an in-world
**codex** panel for that boss (an accordion beneath/over the grid, one open at a
time), showing:

1. Boss portrait (already present: `undercity/guardians/<lairNpcId>.png`) + name +
   biome.
2. **In-world flavor** — 2-3 sentences describing the boss as an inhabitant of the
   world (not mechanics-speak).
3. **Signature trait** — the same named trait + blurb the familiar/boss carries in
   combat, so the meta screen and the fight agree.
4. Defeated/Undefeated state (already shown).

No new backend: the codex is display copy, added to the `DUNGEONS` client mirror
(§3.2). It reads existing sigil state.

### 3.2 Data

Extend `DungeonInfo` (client mirror) with:

```ts
lore: string;                 // in-world flavor for the codex
trait: { name: string; blurb: string };  // signature trait, mirrors the engine trait
```

Draft copy — written in the game's **region-lore gazetteer voice** (grounded
third-person, concrete and sensory, a dry closing beat; cf. `regions.ts` lore).
Final wording refined during implementation:

- **Skullbriar, the Walking Grave** (bone) — *"The Marrow Pits don't bury their
  dead so much as promote them. Skullbriar is a shamble of borrowed bone that only
  gets heavier — every blow it weathers is another rib lashed to the heap."* —
  **Grave Growth:** grows stronger the longer it lives.
- **Slimefoot, the Stowaway** (garden) — *"A fungal stowaway that treats the
  Rotcellar as one big body. Cut it and it seeds; the thing that answers is never
  one saproling but a whole squabbling patch of them."* — **Saproling Swarm:** its
  brood piles on every round.
- **The Gitrog Monster** (bog) — *"A frog the size of a barge, and the Drownedway
  is its gut. The black water rots whatever it swallows, then hands it back for the
  Gitrog to grow again."* — **Dredge:** knits its wounds shut each round.
- **Sarulf, Realm Eater** (cavern) — *"Gloomroot's apex doesn't hunt so much as
  accrue. Every kill and every stalemate settles onto the wolf like silt, until
  what leaves the fight is a good deal larger than what walked into it."* — **Doom
  Counters:** compounds with every round it doesn't lose.
- **Ishkanah, Grafwidow** (city) — *"The Broodwarrens are her pantry, strung wall
  to wall in grey silk. Ishkanah is in no hurry — a single bite keeps working long
  after you've cut yourself free of the web."* — **Venom:** her strikes leave rot
  behind.

### 3.3 UI

- Sigil tile → `(click)` toggles a `selectedBoss` signal (biome key | null).
- Codex panel renders from the selected `DUNGEONS` entry; styled with existing
  design tokens (Golgari palette, `--accent-color`), phone-first, one open at a
  time, dismissable.
- No emoji; icons via the existing `uc-*`/Material set per the game's symbol rule.

---

## 4. Testing

Backend (`cd infrastructure/lambda && python -m pytest tests -q` — keep green):

- Update the boss-signature tests
  (`test_boss_area_signature_*`, `test_depths_wild_pool_includes_signature`) to
  assert the new **familiar** ids from `LAIR_FAMILIAR` (exclusive: never in a
  general pool) and that elite spaces still skip them.
- `npc_from_spec` copies `passives`/`spriteId`.
- Engine unit tests for each new mechanic: `grave_growth` ramps + caps;
  `doom_counters` increments on win/tie only and caps; `dredge` heals but stays
  under frenzy so the fight still ends; `web_venom` applies rot on a win.
- Lair bosses carry their trait into combat (`_lair` combatant has the passive).
- `test_all_battle_specs_have_valid_personality` covers the new specs;
  `test_balance_good_play_beats_fodder` stays green.
- **Sim gate:** a `sim/` run confirming each familiar's good-play win rate meets
  the "beatable teacher" bar (§2.2).

Frontend: build check (`npm run build`) — lint is known-broken in this repo.
Verify the boss_spawns sprites load, Gitrog rotates, the Slimefoot gang art
shows, enemy trait chips render + tap, and the sigil codex opens/closes.

## 5. Invariants / mirror rules

- Server balance numbers and trait copy are **mirrored** in
  `src/app/undercity/data/*.ts` and `data/dungeons.ts` — update both.
- Combat stays PvE-interactive; no environmental/arena damage is added (traits are
  each creature's own mechanic).
- Familiars are exclusive to their turf; the ruin is untouched.

## 6. Out of scope

- Ruin (Lord of Extinction / Doomgape) familiar or trait.
- Barrier guardians, the enraged wilderness monster, and the finale island boss
  (Savra) — unchanged.
- New art (all five familiars are art-backed already; the codex reuses existing
  guardian portraits).

## 7. Files touched (anticipated)

- `infrastructure/lambda/undercity_data.py` — `LAIR_FAMILIAR`, `LAIR_SIGNATURE`
  re-point, boss `passives`.
- `infrastructure/lambda/undercity_config.py` — trait scalars.
- `infrastructure/lambda/undercity_engine.py` — `npc_from_spec` passthrough,
  Combatant counters, resolve-round branches, swing/effective-stats hooks.
- `infrastructure/lambda/undercity_db.py` — `_wild_battle` familiar lookup +
  sprite rotation; `traits` payload on battle npc; ensure lair boss passives flow.
- `infrastructure/lambda/tests/` — updated + new tests; `sim/` gate.
- `src/app/undercity/data/*.ts` — mirrors (familiar sprites, trait scalars,
  `combat.ts` STATUS_INFO trait chips).
- `src/app/undercity/data/dungeons.ts` — `lore` + `trait` codex fields.
- `src/app/undercity/tabs/board-tab.component.ts`,
  `engine/board-canvas.ts` — boss_spawns sprite loading + trait chips.
- `src/app/undercity/tabs/creature-tab.component.{ts,html,scss}` — sigil codex.
