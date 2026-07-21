# Undercity — In-Battle Status Indicators

**Date:** 2026-07-20
**Status:** Approved, ready for implementation
**Scope:** Display layer only. No engine, rules, or balance change — all data already lives in the battle record.

## Problem

In interactive PvE combat, fighters accumulate ongoing conditions — **rot** (a
stacking damage-over-time), self-buffs (Harden Shell, Rot Surge, Glowveil), and
curses cast on a target (Bone Chill, Weaken Hex, and the guardian debuffs). The
server tracks all of this per side on the battle record (`rot_stacks`, `buffs`),
but none of it is visible during the fight. The player sees HP drain and damage
numbers, yet can't tell *why* the enemy is bleeding each round, or that their own
Harden Shell is still up, or that a curse landed on a guardian.

## Goal

Next to each fighter's HP plate, show a compact row of **status chips**: one per
active condition on that fighter, so the player can read the board state at the
moment of decision. Both fighters are covered — mid-fight rot stacked on an enemy
(Barbed / Rot Surge) and curses on a barrier guardian are as visible as the
player's own buffs.

## Conditions in scope

Two chip kinds:

1. **Rot** — a single counted chip, `☣ ×N`, where `N` = `rot_stacks`. The count
   matters (it drives the DoT: `ROT_PER_STACK × N` per round), so it is the one
   status that shows a number.

2. **Buff / debuff kinds** — one chip per active entry in the fighter's `buffs`
   set, colored by tone. Icons reuse the ligatures already defined for these
   effects in [spells.ts](../src/app/undercity/data/spells.ts):

   | Kind | Tone | Icon | Label | Blurb |
   |---|---|---|---|---|
   | `harden_shell` | buff | `shield` | Harden Shell | +2 DEF this battle. |
   | `rot_surge` | buff | `local_fire_department` | Rot Surge | +3 ATK; your Aggress applies rot. |
   | `glowveil` | buff | `flare` | Glowveil | +2 SPD and easier to flee this battle. |
   | `bone_chill` | debuff | `ac_unit` | Bone Chill | Cursed: −2 ATK this battle. |
   | `weaken_hex` | debuff | `heart_broken` | Weaken Hex | Cursed: −3 ATK this battle. |
   | `cursed_idol` | debuff | `dangerous` | Cursed | A lingering curse saps this fighter. |
   | `vines` | debuff | `grass` | Bog Snare | Snared: movement roll halved. |
   | `rot` | debuff | `coronavirus` | Rot | Takes `ROT_PER_STACK × N` damage at end of each round. |

   `cursed_idol`/`vines` are overworld-applied but may ride into a fight on the
   snapshot; they are mapped so they degrade gracefully. Any **unknown** kind is
   skipped, so a buff added later shows nothing until it gets a `STATUS_INFO`
   entry — never a broken chip.

Chips render **only when active**, so a clean fighter shows an empty row (no
clutter). Tapping a chip opens a small popover with its label + blurb, mirroring
the existing help / items tray pattern in the battle component.

## Out of scope

- **Transient per-round ramps** — Rabid's `aggress_ramp`, Bulwark's DEF stacking.
  These live on the `Combatant` dataclass, not in `buffs`/`rot_stacks`, and are
  not surfaced. (A follow-on could add them if desired.)
- **Spectator / TV replay** (`spectator.component`, `battle-playback.component`).
  Not touched. The server status data would be available there for later parity.
- Any engine / rules / balance change. Purely a display layer over existing data.

## Design

### Server — [infrastructure/lambda/undercity_db.py](../infrastructure/lambda/undercity_db.py)

The battle record already carries `rot_stacks` and `buffs` on `rec['player']`
and `rec['npc']` (written by `_bt_snapshot` / `_bt_store`). Add one helper and
attach its output to the three battle-facing payloads. No engine change.

```python
def _battle_status(side):
    """Client-facing standing status for one combatant snapshot."""
    return {'rot': int(side.get('rot_stacks', 0)),
            'buffs': list(side.get('buffs') or [])}
```

Attach `playerStatus` / `npcStatus` to:

- **`_start_battle`** — the `battle_start` space event (~L440). Player's pre-fight
  buffs and any guardian debuffs are visible from round 1.
- **`_combat_round`** — the `combat={...}` response (~L2070), updated each round so
  freshly-applied rot / expired buffs track live.
- **`_battle_resume`** — the client-safe resume view (~L2129) returned in the
  game-state response for a pending battle, so reopening a fight after a reload
  restores the chips. `playerStatus` reads from `rec['player']`, `npcStatus` from
  `rec['npc']`.

### Model — [src/app/undercity/services/undercity-models.ts](../src/app/undercity/services/undercity-models.ts)

```ts
export interface BattleStatus {
  rot: number;        // stack count (0 = no rot)
  buffs: string[];    // active effect kinds
}
```

Add optional `playerStatus?` / `npcStatus?` (nullable for back-compat with older
battle records) to the battle_start, combat-round, and resume response
interfaces.

### Data — [src/app/undercity/data/combat.ts](../src/app/undercity/data/combat.ts)

```ts
export interface StatusInfo {
  label: string;
  icon: string;                 // Material Icons ligature
  tone: 'buff' | 'debuff';
  blurb: string;
}
// kind -> display info; `rot` is included alongside the buff kinds.
export const STATUS_INFO: Record<string, StatusInfo> = { ... };

export interface StatusChip { kind: string; count: number; info: StatusInfo; }

/** Build the ordered chip list for one side: rot first (if any), then each
 *  mapped buff kind; unknown kinds skipped. */
export function statusChips(status: BattleStatus | null | undefined): StatusChip[];
```

Ordering: rot first (most actionable), then buffs, then debuffs — stable and
deterministic.

### Component — [interactive-battle.component.ts](../src/app/undercity/tabs/interactive-battle.component.ts)

- New `@Input() attackerStatus`/`defenderStatus` (`BattleStatus | null`), mirrored
  into signals so the row re-renders per round.
- Update those signals everywhere the HP signals update: `ngOnInit` (start),
  `applyRound` (each resolved round), and the resume path.
- `chipsFor(side): StatusChip[]` via `statusChips(...)` for the template.
- A `openChip` signal (`{ side, kind } | null`) toggled on tap to show the popover
  (same shape as the existing `showItems`/`showHelp` toggles).

### Wiring — [board-tab.component.ts](../src/app/undercity/tabs/board-tab.component.ts)

The parent owns the `LiveBattle` state and feeds the component. Thread the new
`playerStatus`/`npcStatus` from the store's `battle_start`, `combat`, and resume
payloads into the battle inputs, alongside the existing `playerHp`/`npcHp`
plumbing (map server `player`→attacker, `npc`→defender).

### Template + SCSS — HP plate

Under the existing `.hp-num`, add a `.status-row` of `.status-chip`s. Each chip:
the Material icon, plus `×N` when `count > 1` (rot). Tone drives the chip color —
buffs in the Golgari green `--accent-color`, debuffs in a rot-red. Tapping toggles
a small popover anchored to the chip with `label` + `blurb`.

```
You   ████████  30/30 HP
      🛡  🔥                     <- Harden Shell, Rot Surge (buffs, green)

Foe   █████░░  18/30 HP
      ☣×3  💔                   <- Rot ×3, Weaken Hex (debuffs, red)
        └─ tap → "Rot ×3 — 3 damage at end of each round."
```

The `.right` HP plate already flips layout (`direction: rtl`); the status row
follows the same alignment so each side's chips sit under its own bar.

## Testing

Backend has a pytest suite; frontend has no test runner.

1. **pytest** (`cd infrastructure/lambda && python -m pytest tests -q`): add a case
   asserting the `combat-round` response carries `npcStatus.rot` incremented after
   a Barbed/Rot-Surge Aggress applies rot, and that a player buff kind round-trips
   in `playerStatus.buffs`. Keep the suite green.
2. **`npm run build`** — clean compile (lint is unreliable in this repo; the build
   is the type gate).
3. Drive a fight: apply rot to a foe (Barbed fang), confirm the `☣ ×N` chip
   appears on the enemy and its count climbs each round; enter with Harden Shell up
   and confirm the buff chip shows on your side; tap a chip and confirm the popover
   text.

## Follow-on

Because the client maps kinds through `STATUS_INFO`, any buff/debuff added later
surfaces as a chip for free once it gets a map entry. Spectator/TV parity and the
transient stat-ramp chips are natural later extensions on the same server data.
