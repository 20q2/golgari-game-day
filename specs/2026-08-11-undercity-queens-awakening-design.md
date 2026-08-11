# The Queen's Awakening — Savra Finale Redesign

**Date:** 2026-08-11
**Status:** Approved (brainstorm) — pending spec review
**Related:** combat model in [specs/undercity-combat.md](undercity-combat.md);
session findings in `2026-08-08-undercity-night-feedback-design.md`; balance sim
caveats in `infrastructure/lambda/sim/FINDINGS.md`.

## Motivation

Session `20260808-182231` exposed the finale as a private walk. Savra is a
season-shared 560 HP pool that players chip across many engagements and that
**reforms at full strength** after each kill. In practice one player (Rumtin)
dealt exactly 560 damage — the entire pool — soloed the encounter in about
twenty minutes, and took the crown at 00:42. The other three players never
engaged her at all. `bossDamage: 0` for everyone else.

Three problems, in order of severity:

1. **The finale involves one person.** Everyone else is elsewhere on the board
   doing ordinary content while the night's climax happens without them.
2. **It is a war of attrition, not a fight.** Chipping a shared pool across
   engagements has no dramatic shape — no single moment where it is won.
3. **Only the leader can reach it.** A player who fell behind has no road into
   the endgame at all, so the last hour is dead time for them.

This redesign makes the Awakening a **board-wide event with three acts**, turns
Savra into **one epic fight**, and gives every player — at any level — an earned
road into the finale.

## Design targets (from the user)

- Savra is **a single epic fight**, not a chip-away pool.
- **A high-level player can handle her**; a **lower-level player can gamble** on
  her if they have invested financially in gear and items.
- The Awakening is **a significant worldwide event**, not a local encounter.
- The finale is a **personal trial** — every qualified player gets their own
  fight — **plus a first-blood crown** for the first to fell her.
- On the kill, a **world buff** in the Zul'Gurub tradition, weighted so it helps
  players who are behind **without** being a catch-up handicap on the leader.

## Calibration: the encounter already works

Measured in the arena, win rate against Savra in **one** 24-round fight
(`rusher` policy, `atk/def/spd` spread, 300 trials per cell):

| kit | L6 | L8 | L10 | L12 |
|---|---|---|---|---|
| naked | 1% | 7% | 37% | **67%** |
| T1 kit | 6% | 12% | 66% | 83% |
| T2 kit | 11% | 45% | 79% | 89% |
| T3 kit | **30%** | **49%** | 88% | 94% |
| T4 Mythic kit | 72% | 92% | 99% | 100% |

Two conclusions drive the whole design:

- **A level 12 wins 67% naked.** "A high-level player can handle it" is already
  true; no HP retuning is required. Her stat block (560 HP / ATK 26 / DEF 12 /
  SPD 6 / trickster / 30% bluff) is **unchanged**.
- **Gear is worth roughly four levels.** A L6 in a Legendary kit (30%) is a
  better bet than a naked L10 (37% — comparable), and a L8 in Legendary is a
  **49% coin flip**. That is the gamble, and it is real.

`COMBAT_HARD_CAP = 24` rounds with the frenzy ramp from round 4 (≈5× swings by
the end) means 560 HP **can** resolve inside a single fight. No cap change.

## Act I — The Release

**Trigger.** The first player in the season to claim their **third Guild Sigil**
fires the Awakening. It is one-way for the night.

**Effect.** Two things happen at once, for everyone:

1. **The rot-wards fall globally.** The island opens to *every* player,
   regardless of sigil count. Sigils stop being a personal turnstile and become
   the thing that *starts the endgame*.
2. **The Scouring Swarm is released** onto the board (Act II).

The existing host trigger (`boss-awaken` → `config.bossPhase`) is retained as a
manual override so a host can start the finale on a slow night.

> **Why global.** This is what makes it a world event rather than a private
> unlock, and it is safe *because* of the calibration table: an ungeared level 6
> who wanders in loses 99% of the time. Anyone may try; only the strong or the
> well-equipped win. The gate is now competence, not permission.

## Act II — The Scouring Swarm

Savra is the only boss without a themed minion; the other five have entries in
`LAIR_FAMILIAR` with art already in `public/undercity/boss_spawns/`. The
**Scouring Swarm** (`scouring_swarm.png`, already in that folder, unwired) is
hers. Flavour follows the Magic card: it copies itself.

**Presence.** Swarms occupy board nodes and are **visible from the surface**,
like the enraged monster — a shared, spell-targetable board presence rather than
a random encounter roll.

**Seeding.** On release, the swarm seeds so that **every living player has one
within `SWARM_SEED_RADIUS` board spaces of their current position** (start: 3 —
roughly one roll). This is the load-bearing rule: it is what puts a level-3
player in the city ring into the finale on the same tick as the leader.

**Killing one clears its node.** A swarm node is consumed by the kill; the
population only grows back through the split window. So the board state is a
race between players clearing them and the swarm doubling.

**Multiplication.** While the finale is unresolved, the swarm splits on a
recurring window, adding nodes. Wall-clock is correct here (shared world state,
same rule as Umori / the enraged monster / Grothoma — see the step-timer rule);
step timers are for a player's *own* action economy.

**Rewards.** A swarm kill pays renown and XP like an elite, plus **Royal Jelly**
(Act III). They are **opportunity, not menace** — they do not squat on shops,
choke gates, or block dungeon mouths. The board does not degrade; it fills with
things worth killing.

**Persistence.** The swarm remains until the night ends, *not* until the crown
is claimed, so a player who arrives late still finds a finale to take part in.

## Act III — Royal Jelly and the Back Room

**The currency.** Swarm kills drop **Royal Jelly** — the Queen's brood-stuff,
produced by nothing else. It is a separate currency from Spores, Moltings and
Chrysalis Ichor, and it is earned **only** by fighting the Awakening.

**The shop.** No new map nodes. The existing **Rot-Farm Bazaar** keepers become
hungry for jelly the moment the Awakening fires: they pay well for it and open
**the good stuff from the back** — a back-room stock reachable only with Jelly.

**What the back room sells: Legendary (T3), not Mythic.** Two reasons:

- Mythic (T4) is deliberately **craft-only** — 3 Chrysalis Ichor at the
  Blacksmith, never sold, dropped, or stocked. Vending it would gut the crafting
  path.
- T3 is the better gamble. It puts a L6 at 30% and a L8 at 49% against the
  Queen — a coin flip you can talk yourself into. T4 at L6 is 72%, which is not
  a gamble, it is a purchase.

> **This does not conflict with the gear rarity cap.**
> `GEAR_RARITY_CAP_BY_TIER` limits **found** gear, so an early cache cannot hand
> a hatchling a Legendary. Buying one with a currency earned by fighting the
> Queen's swarm is the opposite of a lucky drop. Shop purchases are not
> creature-tier gated today (`tier_cap` is passed only on the scout remote-buy
> path), so no gate change is needed.

**The loop this closes.** Previously the "gamble with money" path existed in the
numbers but had no *source* — a level-6 had no way to assemble a kit by the
finale. Now:

> **Awakening → farm the swarm → sell/spend Jelly → buy a Legendary kit →
> attempt the Queen**

Every player has a road into the finale that runs through *playing*, not through
already being ahead. It is not a handout: the currency is earned.

## Act IV — The Crown and the Afterglow

**Savra becomes a personal trial.** The season-shared HP pool is removed.
Every challenger faces a **fresh 560 HP Queen**. No chipping, no reforming, no
inherited damage. One fight decides it — win or lose.

**The Queenslayer crown.** The **first** player in the season to fell her is
recorded as Queenslayer: a title plus a large renown bounty. Later winners get
the achievement and a smaller reward. This keeps the race drama at the top
without locking anyone out of the encounter.

**The afterglow.** That first kill fires a **world buff for every player:
+50% XP for the remainder of the night.**

> **Why XP, and why this is not rubberbanding.** The buff is *identical* for
> everyone — no scaling by how far behind you are. It self-targets because it is
> denominated in something the leader has already exhausted: bonus XP is
> enormous for a level 6 still climbing and worth **exactly zero** to a level 12
> at cap. Nobody is handicapped and nobody is handed an unearned edge; the
> leader simply has nothing left to spend it on. A "+3 ATK if you're behind"
> buff *would* violate the equal-turns principle. This does not.

**The gamble needs no extra punishment.** The stake is already real: you spent
the night's economy on gear instead of levels. Win and it was inspired; lose and
you are composted holding a Legendary kit and no XP. That is a decision, not a
dice roll.

## Numbers to tune

Starting values, all expected to move after one playtest. Scalars belong in
`undercity_config.py`; weighted tables in `undercity_data.py`.

| Knob | Start | Rationale |
|---|---|---|
| `SWARM_SEED_PER_PLAYER` | 1 | every player has one in reach at release |
| `SWARM_SEED_RADIUS` | 3 | board spaces — "in reach" is about one roll |
| `SWARM_SPLIT_MINUTES` | 20 | shared world state → wall clock |
| `SWARM_MAX_NODES` | 12 | ceiling so the board does not saturate |
| `SWARM_JELLY_DROP` | 3 | per kill |
| `BACKROOM_JELLY_COST` | 12 | ≈4 swarm kills per piece, ≈12 for a kit |
| `QUEENSLAYER_RENOWN` | 60 | ≈2.4 POI claims; the night's biggest single prize |
| `AWAKENING_XP_BUFF` | 0.50 | +50% XP, rest of night |

The swarm's own stat block should sit at elite strength for the tier it spawns
in, so it is worth fighting but not a wall for a low-level player — it is their
road in. Calibrate with `sim/arena.py`.

## Implementation phases

This is too large for one implementation plan — it spans a boss restructure, a
new board entity, a new currency and a new shop surface. Three plans, each
independently shippable and testable, in dependency order:

**Plan 1 — The finale restructure.** Savra becomes a personal trial (drop the
shared pool), the Queenslayer crown, and the world XP buff. Self-contained: it
touches `_boss`, the `BOSS` record, and the reward path only. Shippable on its
own, and it fixes the worst problem (one player consuming the finale) even if
nothing else lands.

**Plan 2 — The Awakening and the Swarm.** The release trigger on the first third
sigil, globally opening gates, and the Scouring Swarm as a seeded, splitting,
visible board entity with combat rewards. Depends on Plan 1 only for the event
copy.

**Plan 3 — The Royal Jelly economy.** The currency, its drop from swarm kills,
and the bazaar back room selling Legendary kits. Depends on Plan 2 for a source
of Jelly.

Export instrumentation lands with whichever plan introduces the state it covers,
not as a fourth pass — the 2026-08-10 session showed that adding it afterwards
means a playtest you cannot measure.

## Testing

- **Release:** first third sigil sets the Awakening flag; it is one-way and
  idempotent; the host override still works; the island opens for a player with
  zero sigils afterwards.
- **Swarm:** seeds within reach of every living player; splits on its window;
  respects the node ceiling; a kill pays Jelly + renown + XP; persists past the
  crown.
- **Jelly:** is a distinct counter from Spores/Moltings/Ichor; the back room is
  invisible before the Awakening and unaffordable without Jelly; sells T3 and
  never T4.
- **Trial:** every challenger meets a full-HP Savra; damage does not persist
  between challengers; a loss composts without weakening her.
- **Crown:** exactly one Queenslayer per season under concurrent kills; the
  world buff fires once; the buff is identical for every player; a level-12 at
  cap gains nothing from it (asserting the self-targeting property).
- **Export:** the Awakening flag, swarm state, Jelly balances and the Queenslayer
  must all appear in the host export, or the next session cannot measure any of
  this (see the instrumentation work of 2026-08-10).

## Deferred

- **Swarm as menace.** Squatting on shops, choking gates, degrading the board.
  Considered and set aside: the user's intent is opportunity, and menace risks
  punishing the players furthest behind hardest.
- **Selling Jelly for Spores.** The keeper "paying a high price" for jelly is
  good flavour but a second sink direction; start with jelly→goods only.
- **Savra dialogue.** She is in `boss-dialogue.ts` scope (intro only, no
  vestige) and unchanged here.
