# Undercity PvP → AI-Clone Duel

**Date:** 2026-07-27
**Status:** Design approved, pending implementation plan

## Summary

Replace Undercity's one-shot auto-resolved PvP with an **interactive duel against an
AI-controlled clone** of the target player. Attacking a player on your space spawns a
snapshot copy of them, given a stance-AI personality derived from their stat spread, and
runs it through the existing round-by-round combat machine (currently PvE-only). The real
target is never touched during the fight — only the attacker risks HP loss and death.
Spores, XP, and renown resolve on the attacker's win; the target learns they were attacked
via a return popup.

## Motivation

Today's PvP (`_battle` in `undercity_db.py`) calls `engine.resolve_battle` once with
auto-stances and mutates *both* players' HP, composting the loser. The interactive
stance-triangle combat that makes PvE engaging is explicitly walled off from PvP
("PvP stays one-shot … the interactive round-by-round machine is PvE-only this iteration").
This design brings PvP into that interactive machine while removing the "lose your creature
while you're offline and away from your phone" feel-bomb.

## Design

### The fight (`kind: 'pvp'`)

- Attacking a player (existing preconditions: standing on their space, not shielded) now
  calls `_start_battle` with a new `kind='pvp'` and an NPC built from a **snapshot clone**
  of the target, instead of running the one-shot resolver.
- Subsequent rounds and flee reuse the existing `_combat_round` / `_combat_flee` handlers
  (they operate on `doc['battle']` and are already kind-agnostic). Only `_finish_battle`
  needs a new `pvp` dispatch branch.

### The clone

Built from the target at attack time:

- **Stats:** gear-inclusive ATK/DEF/SPD + perks (the `perk_stat` basis), snapshotted.
- **HP:** the target's **full/max HP** — a fresh representative fighter, not their
  PvE-damaged current HP. This avoids leaking the target's live state and avoids making a
  monster-weakened player a free kill.
- **Personality (from stat spread):** compare the clone's gear-inclusive ATK/DEF/SPD:
  - dominant ATK → `brute`
  - dominant DEF → `turtle`
  - dominant SPD → `trickster`
  - no stat clearly ahead (top within ~20% of the second-highest) → `balanced`
- **Bluff:** scaled by the target's level, like elites (higher-level clones read/bluff
  better).
- **Stances only.** The clone does not cast spells or use consumables this iteration
  (YAGNI — can be added later). It behaves like any other NPC through `pick_stance`.

The snapshot is taken at attack time; if the target evolves or re-gears mid-duel, the clone
is stale — accepted snapshot semantics.

### Stakes — attacker-only death

| Outcome | Attacker | Target |
|---|---|---|
| Attacker **wins** | takes HP damage from the fight | loses spores (steal); **no** HP loss, **no** compost |
| Attacker **loses** | **composted** (same as dying to any monster) | untouched — HP, creature, spores all safe |
| Flee / timeout | keeps creature and whatever HP remains | untouched |

The target's HP is **never** modified by a PvP duel.

### Rewards (attacker win)

- **Spores:** steal from the target's *live* spore pile at finish time, using the existing
  `pvp_spore_steal` base rate. The old defend-stance reduction (`PVP_SPORE_STEAL_DEFEND`)
  is dropped — there is no single "loser stance" in an interactive fight.
- **XP:** both sides earn XP as today — `XP_REWARDS['pvp_win']` to the attacker,
  `XP_REWARDS['pvp_loss']` to the target.
- **Renown — level-gated:** the win contributes renown **only if the clone's level ≥ the
  attacker's level** (`data.enemy_level` on the clone's stat block vs. the attacker's).
  Beating a weaker player yields spores + XP but **no renown**, removing the incentive to
  farm low-level players.
  - Implemented as a **new `pvpRenownWins` counter** that feeds `compute_renown`, so the
    existing raw `pvpWins` / `lifetimePvpWins` counters keep their current meaning and
    display. `RENOWN['per_pvp_win']` (currently 15) moves to weight `pvpRenownWins`.

### Attacker loss

- Attacker is **composted** (consistent with dying to any PvE monster).
- **No spore transfer on loss.** The offline target gains nothing from a successful
  defense beyond the return popup — the attacker already pays the heavy price (losing their
  creature). (Deliberate asymmetry; the winner-steals symmetry of old PvP is dropped.)

### Return popup (target notification)

The away-event mechanism already exists: `_push_away_event` stores a `pvp` entry on the
target, and the client renders it on the target's next return
(`board-tab.component.ts` ~1173–1278). Two changes:

1. **Push the right event from the new flow.** The clone duel resolves inside
   `_finish_battle`, which only has the attacker `doc` in hand — so the finisher must
   re-load the target, apply the spore steal / XP, and push the away-event there. Store the
   target's `userId` (and a spore snapshot for reference) in `rec['ctx']` at
   `_start_battle` so the finisher can reach them.
2. **Fix the copy for the no-death reality.** Today's `composted` outcome text reads
   *"{from} composted your creature and looted {spores} Spores."* — which is now wrong (the
   creature never dies). The attacker-win outcome needs distinct copy that makes it **clear
   you were beaten** without claiming your creature died, e.g.
   *"{from} beat your clone in a duel and looted {spores} Spores."* The attacker-loss case
   maps cleanly to the existing `defended` outcome (*"{from} jumped you — and you drove
   them off!"*) and is now literally true (the attacker was composted).

### Client

- The "attack player" button flow changes from showing a one-shot result popup to opening
  the **same interactive combat modal PvE uses**. The `battle` action now returns a
  `battle_start`-shaped payload the combat UI already knows how to render; rounds and flee
  drive through the existing combat actions.
- Add a `pvp` result type to the combat finish screen (spoils: spores stolen, XP, renown
  if the level gate passed).

## Out of scope (this iteration)

- Clone casting spells / using consumables.
- Spore transfer on attacker loss.
- Target-side compost or HP loss of any kind.
- Revenge buffs / bounties (already deferred per GDD §14).

## Touch points

- `infrastructure/lambda/undercity_db.py` — `_battle` (rewrite as duel start),
  `_finish_battle` dispatch + new `_finish_pvp`, away-event push.
- `infrastructure/lambda/undercity_engine.py` — stat-spread → personality helper.
- `infrastructure/lambda/undercity_data.py` — `RENOWN` (add `per_pvp_win` gated to
  `pvpRenownWins`), `compute_renown`.
- `infrastructure/lambda/undercity_config.py` — any new scalars (personality dominance
  threshold, bluff-by-level).
- Client: `board-tab.component.ts` (attack flow → combat modal, away-event copy),
  combat modal `pvp` result type, `undercity-models.ts` (`AwayEvent` outcome + any new
  fields).
- Tests: `tests/test_undercity_db.py` (PvP paths), plus a personality-derivation unit test.
- Balance mirrors: `src/app/undercity/data/*.ts` if any tuned numbers surface.

## Open questions

None blocking. Numbers (dominance threshold, bluff-by-level curve) will be picked during
implementation and are cheap to tune later via `undercity_config.py`.
