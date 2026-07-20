# Undercity — Gear Expansion (10 → 20 pieces)

**Date:** 2026-07-20
**Status:** Approved, ready for planning
**Depends on:** [2026-07-19-undercity-stance-augment-buttons-design.md](2026-07-19-undercity-stance-augment-buttons-design.md)
(the new riders auto-surface on the stance buttons once mirrored client-side).

## Goal

Double the equipment roster from 10 to 20 pieces, purely **horizontally** — new
build archetypes at the existing tiers, no stat-ceiling inflation. Every new piece
carries a rider that sparks a distinct build; no flat stat sticks.

## Design invariant — slot maps to stance

The existing gear already follows a clean rule that this expansion formalizes:

- **fang → Aggress riders**
- **carapace → Guard riders**
- **charm → Feint riders**

This keeps the augment-button display coherent and balances the roster: today
Feint has 4 riders but Aggress and Guard only 2 each, so the expansion leans on
fangs and carapaces.

## New riders (8)

Each hooks into `resolve_round` in [undercity_engine.py](../infrastructure/lambda/undercity_engine.py)
via a `has_rider(...)` branch, mirroring the existing rider pattern. New
`Combatant` fields are per-battle (reset when the Combatant is built), like the
existing `first_win_used` / `dmg_penalty` / `reveal_next`.

### Aggress (fang) riders
| Rider | Effect | Engine hook |
|---|---|---|
| `bloodfang` | Heal 40% of your Aggress-win damage. | In the decisive-win branch, when `win_stance == 'aggress'`, heal off the dealt dmg (like `drain_life` but 0.4 and stance-gated). |
| `rabid` | +2 Aggress damage per Aggress win this fight (stacks). | New field `aggress_ramp` (int). Increment on each Aggress win; add `aggress_ramp` into the swing when the striker's stance is Aggress (`_swing_base`/`_base_hit`). |
| `gutcleaver` | Aggress win vs a foe below 30% max HP deals +50%. | In the decisive-win branch, when `win_stance == 'aggress'` and `losr.hp / losr.max_hp < 0.30` (pre-hit), `mult += 0.5`. |

### Guard (carapace) riders
| Rider | Effect | Engine hook |
|---|---|---|
| `bramble` | Reflect a flat 2 whenever you are struck, any stance. | On any actual strike that damages a combatant with `bramble`, subtract 2 from the striker (guard against rot/frenzy — environmental, no striker). Shares the shape of `_scavenge` but triggers on being hit, not on losing. |
| `bulwark` | +1 DEF per round you end in Guard (stacks). | New field `guard_fortify` — at end of round, if that side's stance was Guard, `c.dfn += 1` (persist for the fight). |
| `mossback` | Heal 3 each round you end in Guard. | End-of-round hook: if the side's stance was Guard and alive, heal 3 (capped at max_hp), log a heal entry. |

### Feint (charm) riders
| Rider | Effect | Engine hook |
|---|---|---|
| `venomtrick` | Winning a Feint applies 1 rot to the foe. | In the winning-Feint block (beside `serrated`/`glint`), `losr.rot_stacks += 1` after the tick, log `rotApplied` (mirror the `barbed` rot-apply). |
| `cutpurse` | If you landed at least one winning Feint, +6 Spores after a won fight (flat, once — not stacking). | Engine sets a per-battle flag `feint_won` when a Feint wins. The reward finisher in [undercity_db.py](../infrastructure/lambda/undercity_db.py) adds a flat `CUTPURSE_SPORES` on a win if `cutpurse` is equipped and `feint_won`. |

## The 20-piece table

Existing pieces unchanged; **new** in bold. Costs follow the current curve
(t1 ~20, t2 ~45–50, t3 ~80). Charms stay light on stats — their value is the rider.

### Fangs — Aggress (7)
| Piece | id | Tier | Cost | Stats | Rider |
|---|---|---|---|---|---|
| Rusted Fang | `rusted_fang` | 1 | 20 | +2 ATK | barbed |
| **Bloodfang** | `bloodfang` | 1 | 25 | +2 ATK | **bloodfang** |
| Kraul Barb | `kraul_barb` | 2 | 45 | +4 ATK | deep_biter |
| **Rabid Fang** | `rabid_fang` | 2 | 48 | +3 ATK, +1 SPD | **rabid** |
| **Gutcleaver** | `gutcleaver` | 2 | 50 | +4 ATK | **gutcleaver** |
| Wurm Tooth | `wurm_tooth` | 3 | 80 | +6 ATK, +1 SPD | deep_biter |
| **Ravening Maw** | `ravening_maw` | 3 | 85 | +5 ATK, +1 SPD | **rabid** |

### Carapaces — Guard (7)
| Piece | id | Tier | Cost | Stats | Rider |
|---|---|---|---|---|---|
| Chitin Scrap | `chitin_scrap` | 1 | 20 | +2 DEF | thick |
| **Bramble Hide** | `bramble_hide` | 1 | 25 | +2 DEF | **bramble** |
| Bark Hide | `bark_hide` | 2 | 45 | +4 DEF | spiked |
| **Bulwark Plate** | `bulwark_plate` | 2 | 48 | +3 DEF, +3 HP | **bulwark** |
| **Mossback** | `mossback` | 2 | 50 | +3 DEF | **mossback** |
| Troll Hide | `troll_hide` | 3 | 80 | +5 DEF, +6 HP | spiked |
| **Ironshell Bulwark** | `ironshell_bulwark` | 3 | 85 | +5 DEF, +6 HP | **bulwark** |

### Charms — Feint (6)
| Piece | id | Tier | Cost | Stats | Rider |
|---|---|---|---|---|---|
| Quartz Charm | `quartz_charm` | 1 | 20 | +1 SPD | trickster |
| **Venom Charm** | `venom_charm` | 1 | 25 | +1 SPD | **venomtrick** |
| Serrated Charm | `serrated_charm` | 2 | 45 | +1 SPD | serrated |
| Seer Charm | `seer_charm` | 2 | 50 | +1 SPD | seer |
| **Cutpurse Charm** | `cutpurse_charm` | 2 | 48 | +1 SPD | **cutpurse** |
| Glint Charm | `glint_charm` | 3 | 80 | +2 SPD | glint |

## Files to touch

**Backend ([infrastructure/lambda/](../infrastructure/lambda/)):**
- `undercity_data.py` — 10 new `GEAR` entries; 8 new `GEAR_RIDERS` entries
  (`stance` + `blurb`); a `CUTPURSE_SPORES` tunable (or into `undercity_config.py`
  with the other scalar knobs); add the new gear to the **bazaar stock pools** and
  **gear-drop tables** so it appears in-game.
- `undercity_engine.py` — new `Combatant` fields (`aggress_ramp`, `guard_fortify`,
  `feint_won`); the 7 in-battle rider branches above.
- `undercity_db.py` — Cutpurse payout in the reward finisher.
- `tests/` — one engine unit test per new rider; keep
  `test_balance_good_play_beats_fodder` and the full suite green.

**Client mirrors ([src/app/undercity/data/](../src/app/undercity/data/)):**
- `items.ts` — 10 new `GEAR` entries (name/slot/tier/cost/stats/rider/desc).
- `combat.ts` — 8 new `RIDER_AUGMENTS` entries (stance + short label + blurb) so
  they display on the stance buttons. No component change needed — the augment UI
  is data-driven.

## Balance & invariants

- Purely horizontal: no stat line exceeds the current tier-3 ceiling; existing
  enemies need no rebalance.
- Balance numbers stay mirrored between `undercity_data.py` and the client
  `data/*.ts` (combat spec §6).
- `test_balance_good_play_beats_fodder` must stay green.

## Testing

- `cd infrastructure/lambda && python -m pytest tests -q` — all green, including a
  new test per rider.
- `npm run build` — client compiles.
- Manual: equip one new piece per stance and confirm the rider tag shows on the
  right button and the effect fires in a battle.

## Coordination note

`undercity_data.py`, `undercity_db.py`, and `tests/test_undercity_engine.py`
currently have unrelated in-flight edits in the working tree. Implementation should
layer onto whatever those land as, not assume the committed versions.
