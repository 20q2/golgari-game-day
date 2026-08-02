# Undercity Animal Companions

## Problem

Undercity is deep on the "modify your creature" axis — gear (Fang/Carapace/
Charm), grimoire spells, form passives, attribute perks — but the **board /
between-fights layer** is comparatively flat, and there is no collectible that
lives *beside* your creature rather than *on* it. Players have asked for animal
companions: a small critter that follows you and does something useful.

The trap is that a naive pet is just "another charm" — a flat stat stick that
dilutes builds instead of expanding them, violating the project's build-
diversity bar. The design below avoids that by making a companion a **small,
characterful ability** (not a stat block), by giving it its **own progression
track fed by existing resources** (a second thing worth spending moltings/gems
on, versus gear), and by making surplus pets *fuel* rather than clutter through
merge / salvage / sell — introducing **no new currency**.

## Goals

- A single **active companion** that follows you and provides one small,
  flavorful effect — some on the board, some in combat — never a dominant stat.
- Companions are **collected via eggs** that drop from existing sources and
  **hatch on a real-time timer**, reusing the game's egg/hatch and timer idioms.
- A progression track that **mirrors gear** (rarity tier + upgrade level) and
  **reuses existing materials** (moltings, gemstones) — no new resource system.
- Every duplicate pet has a purpose: **merge** it into your keeper, **salvage**
  it for moltings, or **sell** it on the marketplace. Nothing is ever clutter.
- A self-contained **Companion section** in the Creature tab's gear hub (the
  currently-empty fourth tile) that houses the incubator, the active pet, the
  inactive roster, and all pet actions.

## Non-goals (Phase 2, explicitly deferred)

- **Taming** wild creatures as an acquisition path (eggs only for now).
- **Evolutions** / species transformation (pets rank up in *rarity*, not form).
- **Multiple incubator slots** (one slot in Phase 1).
- **Multiple simultaneous active pets** / a party.
- **Cross-species merging** — merge fuel is same-species only.
- New combat *actors* that take their own turn — passive pets only *trigger*
  off your combat, they are not a second combatant, so the tuned solo-boss
  difficulty is not perturbed.
- No environmental/arena damage of any kind is introduced (the Fox's follow-up
  is part of *your* offense, gated by its own trigger).

## Design

### 1. Data model

New per-player state on `you` (server truth in DynamoDB, mirrored to the
client `you()` signal):

```
pets: Pet[]              // owned pets (inventory), includes the active one
activePetId: string | null
eggs: Egg[]              // uncracked eggs carried
incubator: { eggId: string; startedAt: number } | null   // single slot
petCooldowns: Record<string, number>   // activated-ability cooldowns, like spellCooldowns

Pet {
  id: string             // unique instance id
  species: PetSpecies    // 'fox' | 'turtle' | 'bird' | 'mouse' | 'grub'
  rarity: RarityTier     // shared with the gear rarity scale (tierRarity)
  level: number          // 1 .. levelCap(rarity)
}

Egg {
  id: string
  rarity: RarityTier     // biases the hatch outcome
}
```

Pets reuse the **existing rarity vocabulary** (`tierRarity` / rarity-badge
classes in `data/items.ts`) so their badges and colors match gear. `PetSpecies`
and the per-species ability/economy tables are new, defined server-side in
`undercity_data.py` with a client mirror in `src/app/undercity/data/pets.ts`.

### 2. Eggs, drops, and the incubator

**Drops.** An egg is a new droppable that can appear from the sources that
already grant loot: loot/cache tiles, combat rewards, the mystery reel, and
bazaar stock. Egg **rarity** biases which species and what starting rarity
hatches (reusing the weighted-table approach already used for loot/evolution,
and the rolled-egg-color/shiny flavor). Eggs sit in `you.eggs` until incubated.

**Incubator (1 slot).** `incubate-egg { eggId }` moves an egg into
`you.incubator` and stamps `startedAt` with the server clock — the same
real-time-timer pattern as the grimoire swap lock (`grimoireSwapLeftMin`). After
**15 minutes** (a `undercity_config.py` tunable, `PET_INCUBATE_MINUTES`) the egg
is ready; `hatch-egg` mints a `Pet` from the egg's weighted table into
`you.pets`, clears the incubator, and returns the new pet for a reveal. Only one
egg incubates at a time — choosing which egg to crack first is a real decision.

### 3. The roster (Phase 1: five species)

Each species is a **small** effect in one of two interaction styles. Magnitudes
and probabilities are `undercity_data.py` tables scaled by the pet's level, kept
deliberately low so a companion is a nudge, not a win condition.

| Species | Style | Signature ability |
| --- | --- | --- |
| **Fox** | passive (combat) | Chance each attack round to add a small follow-up hit. |
| **Turtle** | passive (combat) | Chance to deflect a few points of incoming damage. |
| **Bird** | activated | Reveal a facility's (bazaar) stock before you travel to it. |
| **Mouse** | activated | Send to scavenge; returns a small loot roll (a "mini lootbox"). |
| **Grub** | passive (board/economy) | Small trickle of moltings/spores as you move — feeds the upgrade loop. |

### 4. Progression — rarity + level, no new currency

Two inputs feed **one** coherent track, mirroring how a rare weapon both drops
at a rarity and is upgraded with materials:

- **Merge → Rarity.** `merge-pet { targetPetId, fodderPetIds[] }` consumes
  **same-species** duplicate pets from `you.pets` to advance the target's
  `rarity` by one tier when enough fuel is provided. Fodder of higher rarity
  counts for more (a merge-progress value per fodder pet, `undercity_data.py`).
  This is the collection payoff and consumes the fed pets.
- **Level → fills the rarity's cap.** `level-pet { petId }` spends **moltings +
  gemstones** (the existing cache/mining materials) to raise `level` by one, up
  to `levelCap(rarity)`. Rarity raises the cap; leveling climbs to it. Higher
  level increases the ability's magnitude/frequency (and shortens an activated
  pet's cooldown).

`levelCap(rarity)`, merge-fuel requirements, and per-level costs are all
`undercity_config.py` / `undercity_data.py` tunables with client mirrors.

### 5. Disposal — three exits, so nothing is clutter

From a pet's detail popup:

- **Merge** — feed it into a same-species keeper (see §4).
- **Salvage** — `salvage-pet { petId }` destroys it for **moltings** scaled by
  its rarity + level, plus **gemstone(s)** when it clears a value threshold
  (rarity/level bar, tunable) — the user's "gems if it's enough."
- **Sell** — list it on the marketplace via the existing item-sell flow.
  `MarketKind` gains `'pet'` (and `'egg'`, so eggs are sellable too);
  `marketBand` gets pet/egg price bands. This reuses the item-popup-market UI
  and server market path wholesale.

### 6. Activated abilities & cooldowns

Activated pets (Bird, Mouse) are used from the Companion section (or a board
affordance) via `use-pet-ability { species, ...targetArgs }`, gated by a
**real-time cooldown** written to `you.petCooldowns` and surfaced with the same
`cooldownLeftMin` helper the spells use. Bird's target is a facility whose stock
it returns without a visit; Mouse rolls a small loot result immediately and goes
on cooldown. Cooldown length is a per-species, level-scaled `undercity_config.py`
value. Passive pets (Fox, Turtle, Grub) have no activation — they trigger
automatically.

### 7. Combat hooks (passive pets)

When a battle starts, the engine reads `you.activePetId` and, if the active
pet is a combat species, registers its trigger on the existing combatant:

- **Fox** — after a successful attack round, a level-scaled chance to append a
  small follow-up hit (part of the player's offense; no new damage source).
- **Turtle** — on incoming damage, a level-scaled chance to reduce it by a few
  points.

These live in `undercity_engine.py` alongside the current stance/effect
resolution, reading magnitudes from `undercity_data.py` (`PET_ABILITIES`) with
scalars in `undercity_config.py`. They are pure additions to existing hooks —
no new combat actor, no turn-order change. The interactive battle view surfaces
a small "Fox!/Turtle!" trigger note so the player sees the pet act.

### 8. UI — the Companion section (Phase 1)

The gear hub's empty fourth tile becomes **Companion** (a `uc-*` critter icon).
Tapping it opens the section, laid out as three stacked spots the user
specified:

1. **Incubator** — the single slot. Empty: a prompt plus a strip of your
   uncracked `eggs` to choose from (tap an egg → `incubate-egg`). Incubating: egg
   art + a live countdown (reusing the min-based timer display). Ready: a
   **Hatch** button that plays a small reveal.
2. **Active pet** — portrait, name, species, rarity badge, `level / cap`, the
   ability text, and (for activated species) an **Use** button with cooldown
   state. A "Manage" affordance opens its detail popup.
3. **Inactive pets** — a grid/list of the rest of `you.pets`. Tapping one opens
   the **pet detail popup**, the single place all actions live:
   **Activate** (swap in), **Merge** (pick same-species fodder to consume),
   **Level** (spend moltings/gems, disabled at cap or when short), **Salvage**,
   **Sell**. The popup shows rarity, level/cap, ability, and salvage/merge
   previews.

New SCSS follows the established creature-tab tokens (moss/purple/gold palette,
card gradients) and reuses the `gear-hub` tile pattern for the section's cards.
The Companion tile updates the hub grid from three tiles (+ empty cell) to four,
filling the whitespace that motivated the layout.

### 9. Server actions summary

All routed through `POST /game/action` and dispatched in `undercity_db.py`
(pure rules in `undercity_engine.py`):

`incubate-egg`, `hatch-egg`, `activate-pet`, `merge-pet`, `level-pet`,
`salvage-pet`, `use-pet-ability`, plus market list/buy for pets & eggs through
the existing market action path. Each returns the mutated state slice + a
user-facing `text`, matching the current action contract. The in-memory
FakeTable pytest suite gains coverage for hatch, merge (rarity up + fodder
consumed), level (cap enforcement + material spend), and salvage yields.

## Files touched

Server (`infrastructure/lambda/`):
- `undercity_data.py` — `PetSpecies`, `PET_ABILITIES`, egg/hatch weighted
  tables, merge-fuel + level-cap + salvage-yield tables.
- `undercity_config.py` — `PET_INCUBATE_MINUTES`, cooldowns, level costs,
  salvage/gem thresholds (scalars).
- `undercity_engine.py` — pet combat triggers (Fox/Turtle), merge/level/salvage
  pure logic, hatch resolution.
- `undercity_db.py` — the new action dispatch cases + pet/egg/incubator state
  persistence; market path accepts pet/egg kinds.
- `lambda_function.py` — no new routes (rides `/game/action`).
- `tests/` — hatch/merge/level/salvage integration coverage.

Client (`src/app/undercity/`):
- `data/pets.ts` — mirror of species/abilities/costs.
- `data/items.ts` — `MarketKind` gains `'pet' | 'egg'`; `marketBand` bands.
- `tabs/creature-tab.component.*` — the Companion hub tile + section (incubator
  / active / inactive) + pet detail popup + activated-ability use; combat view
  gains the pet-trigger note (`interactive-battle`).
- `services/` — action wrappers for the new pet actions.

## Phasing

**Phase 1 (this spec):** everything above — eggs/drops, 1-slot incubator +
15-min hatch, the five-species roster, rarity-via-merge + level-via-materials,
the three disposal exits, combat hooks, and the full Companion section UI.

**Phase 2 (deferred, §Non-goals):** taming, evolutions, extra incubator slots,
additional species, and any party/multi-active expansion.
