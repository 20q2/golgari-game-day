# Undercity — Stance-Augment Buttons

**Date:** 2026-07-19
**Status:** Approved, ready for implementation
**Scope:** Client-only UI. No engine, server, or balance change.

## Problem

In interactive PvE combat the player picks one of three stances each round —
Aggress / Guard / Feint (the "Strike / Defend / Feign" buttons). Equipped gear
**riders** and some creature **passives** change what a given stance does (e.g.
Barbed makes Aggress apply rot even on a loss), but nothing on the button tells
the player this. The augment is invisible at the moment of decision.

## Goal

When the player has an equipped gear rider or a stance-specific passive that
augments a stance, show that effect inline on the corresponding stance button.

## Sources of augments (in scope)

1. **Gear riders** — the backend already tags every rider with a stance in
   `GEAR_RIDERS` ([undercity_data.py](../infrastructure/lambda/undercity_data.py)).
   All 8 riders map:

   | Rider | Stance | Short label | Blurb |
   |---|---|---|---|
   | `barbed` | aggress | Barbed | Aggress applies rot even on a clash or loss. |
   | `deep_biter` | aggress | Deep-biter | Winning exchanges hit harder. |
   | `thick` | guard | Thick | Guard chips in a stall; softer when wrong. |
   | `spiked` | guard | Spiked | Guard counter reflects part of the blocked hit. |
   | `trickster` | feint | Trickster | A lost Feint isn't fully punished. |
   | `serrated` | feint | Serrated | Feint break lowers the enemy's next-round damage. |
   | `glint` | feint | Glint | Winning a Feint reveals the true next intent; +read rate. |
   | `seer` | feint | Seer | Sharply raises how often you read the enemy's intent. |

   `seer`/`glint` are read-rate effects but the backend files them under Feint;
   the client mirror follows the backend 1:1 so the mapping stays authoritative.

2. **Stance-specific passives** — only the passives that clearly augment a single
   stance are surfaced. Everything else (flyby, scavenge, swarm, drain_life,
   first_bite, …) fires regardless of stance and is deliberately excluded to keep
   the buttons honest.

   | Passive | Stance | Short label | Blurb |
   |---|---|---|---|
   | `venom_barb` | aggress | Venom Barb | Your first strike each battle deals +3. |
   | `deathtouch_stomp` | aggress | Deathtouch Stomp | Your strikes ignore 3 of the enemy's DEF. |
   | `rot_breath` | aggress | Rot Breath | Your round-1 strike hits for double. |

## Out of scope

- **Spell stat-buffs** (Rot Surge +ATK, Harden Shell +DEF, Glowveil +SPD) — these
  already show in the ATK/DEF/SPD numbers beside the fighter; not repeated here.
- Any engine/server/balance change. Purely a display layer over existing data.

## Design

### Data layer — [src/app/undercity/data/combat.ts](../src/app/undercity/data/combat.ts)

Add a mirror + a pure helper:

```ts
export interface StanceAugment {
  stance: Stance;
  label: string;   // short tag shown on the button, e.g. "Barbed"
  blurb: string;   // full effect, shown in the button tooltip
  source: 'gear' | 'passive';
}

// rider id -> augment (mirrors GEAR_RIDERS in undercity_data.py)
export const RIDER_AUGMENTS: Record<string, Omit<StanceAugment, 'source'>> = { ... };
// passive id -> augment (subset of PASSIVE_* in forms.ts that augments one stance)
export const PASSIVE_AUGMENTS: Record<string, Omit<StanceAugment, 'source'>> = { ... };

/** Build the augment list from the player's equipped gear + passives. */
export function computeStanceAugments(
  gear: Record<string, string> | undefined,      // slot -> gear id
  passives: string[] | undefined,
): StanceAugment[];
```

`computeStanceAugments` looks each equipped gear id up in `GEAR_MAP` to get its
`rider`, maps the rider through `RIDER_AUGMENTS`, and maps each passive through
`PASSIVE_AUGMENTS`. Unknown/rider-less entries are skipped.

### Wiring — [board-tab.component.ts](../src/app/undercity/tabs/board-tab.component.ts)

- Add `augments: StanceAugment[]` to the `LiveBattle` interface.
- In `openLiveBattle` and `resumeLiveBattle`, set
  `augments: computeStanceAugments(you?.gear, you?.passives)`.
- Bind `[augments]="lb.augments"` on `<app-undercity-interactive-battle>`.

### Component — [interactive-battle.component.ts](../src/app/undercity/tabs/interactive-battle.component.ts)

- New `@Input() augments: StanceAugment[] = []`.
- `augmentsFor(stance): StanceAugment[]` — filter by stance (used in template).
- `buttonTitle(s): string` — the existing `s.blurb` plus one `\n+ <label>: <blurb>`
  line per augment, so full detail lives in the tooltip without crowding the button.

### Template + SCSS — stance button

Under `.stance-label`, render a wrap container of augment tags, one per augment:
a small spark icon (`auto_awesome`) + the short label, in the Golgari
`--accent-color`. Swap the button's `[title]="s.blurb"` for `[title]="buttonTitle(s)"`.

```
┌──────────┐
│    ⚔     │
│  Aggress │
│ ✦ Barbed │   <- one tag per augment (Aggress may show up to 2)
└──────────┘
```

Realistic counts: Guard/Feint ≤ 1 tag (one carapace/charm rider), Aggress up to 2
(fang rider + one passive). Container wraps if more.

## Testing

No test runner is wired up in this repo. Verify by:
1. `npm run build` — clean compile.
2. Drive a battle with gear equipped (e.g. Rusted Fang → Barbed on Aggress) and a
   passive-bearing form, and confirm the right tags appear on the right buttons and
   the tooltip lists the full blurbs.

## Follow-on

This data-driven design auto-displays any rider added later, so the planned
**equipment expansion** (doubling gear via new riders/archetypes) will surface on
these buttons for free — no UI change needed per new piece.
