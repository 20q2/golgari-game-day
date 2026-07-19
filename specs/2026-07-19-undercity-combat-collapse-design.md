# The Undercity — Combat "Collapse" (no more stalemates)

Design origin: 2026-07-19. Companion to
[undercity-combat.md](undercity-combat.md) and the combat redesign
[2026-07-14-undercity-combat-redesign-design.md](2026-07-14-undercity-combat-redesign-design.md).

## Problem

Interactive PvE combat is hard-capped at `MAX_ROUNDS_COMBAT = 6` rounds. A
non-kill at the cap is a **neutral timeout**: `_finish_wild` awards only a token
`XP_REWARDS['timeout']` — **no bounty, no gear drop, no `wildWins`** — and the
foe "parts ways."

This strictly punishes **tanky builds** (high DEF / high HP, lower ATK):

- Low ATK means hits against a defended foe floor near **1 damage**
  (`_base_hit` floors at 1).
- Stalls (Guard-vs-Guard) deal **0**; whiffs (Feint-vs-Feint) chip only 0.15×.
- So a tank routinely cannot burn the foe down inside 6 rounds → timeout →
  walks away with **nothing**, even sitting at 90% HP against a foe at 5%. It
  did all the attrition work and got robbed by the clock.

A glass cannon kills in ~3 rounds and takes full loot. The attrition archetype
is unrewardable. Barrier guardians are worse still: a tank that times out leaves
the **gate closed**, so a tank can effectively *never open a barrier*.

## Solution — "The Collapse"

Sudden-death escalation: unstable-cavern environmental damage that ramps once a
fight drags past a threshold, guaranteeing every slayable-foe fight ends in a
**real kill** (full rewards) rather than an empty timeout.

### Mechanic

- **Rounds 1 – 3 (`< FRENZY_START`):** unchanged. Full tactical stance play —
  stalls still deal 0, whiffs chip, reads matter. This is where a decisive build
  closes the kill.
- **Round `FRENZY_START` (= 4) onward:** at the **end** of each round (in the
  same place the rot DoT ticks), **both living combatants** take unavoidable
  environmental damage:

  ```
  frenzy_dmg = round(max_hp * FRENZY_PCT * tier)
  tier       = rnd - FRENZY_START + 1        # 1, 2, 3, …
  ```

  With `FRENZY_PCT = 0.18` and the round cap of 6:

  | Round | tier | Frenzy hit (of own max HP) | Cumulative |
  |------:|-----:|---------------------------:|-----------:|
  | 4 | 1 | 18% | 18% |
  | 5 | 2 | 36% | 54% |
  | 6 | 3 | 54% | **108%** |

### Why this fixes tanks

Frenzy is a fraction of **each fighter's own max HP**, and cumulatively exceeds
**100%** by the cap. Therefore:

1. **Someone always dies by round 6** — a timeout for a frenzy-enabled foe is
   now impossible. The outcome is a genuine kill (`attacker`/`defender`), so the
   winner gets the full finisher payout (bounty, gear roll, `wildWins`++, XP).
2. **The higher HP-fraction fighter wins.** Both lose the same *fraction* per
   round, so whoever entered the collapse healthiest crosses zero *later*. That
   is the tank: high DEF floored incoming hits to ~1 through rounds 1 – 3, so it
   enters the collapse at the highest HP fraction and outlasts the foe.
3. **Ties favor the player.** If both cross zero on the same round, the existing
   `_combat_round` resolution (`outcome = 'attacker' if player_c.hp >=
   npc_c.hp`) already picks the player.

Intended flip side: a glass build that **fails to close a kill by round 4** now
risks dying to the collapse instead of walking away neutral. Glass should kill
fast or pay for it — this is the tension that makes the tank archetype good.

## Scope & invariants

- **Frenzy applies only to slayable foes:** `wild`, `elite`, and **`barrier`**.
  Including `barrier` is deliberate — it lets a tank actually win and open a
  gate instead of timing out with it still sealed.
- **Boss & lair are exempt** (`frenzy_from = None`). Their persistent HP pools
  **must linger** on a neutral timeout (the load-bearing invariant in
  [undercity-combat.md](undercity-combat.md) §6); frenzy would wrongly force the
  player's death there. Their multi-encounter chip loop is by design, not the
  stalemate being removed.
- **PvP is untouched.** PvP resolves one-shot via `engine.resolve_battle` /
  `resolve_battle_rounds`, which never enable frenzy (`frenzy_from` defaults to
  `None`).
- **Damage floor:** frenzy is additive end-of-round damage; it does not touch
  the `_base_hit` floor-at-1 rule for stance hits. No other floor is violated.

## Implementation

### Engine (`infrastructure/lambda/undercity_engine.py`)

- Add a keyword arg `frenzy_from: int | None = None` to `resolve_round`.
- After the rot-tick block (end of `resolve_round`), when `frenzy_from is not
  None and rnd >= frenzy_from`, for each side still alive apply
  `round(max_hp * FRENZY_PCT * (rnd - frenzy_from + 1))` damage and append a log
  entry tagged `{'round': rnd, 'by': side, 'dmg': dmg, 'frenzy': True}`.
  `drain_life` does **not** heal off frenzy (it is environmental, not a strike).

### DB layer (`infrastructure/lambda/undercity_db.py`)

- In `_combat_round`, compute
  `frenzy_from = data.FRENZY_START if rec['kind'] in ('wild', 'elite',
  'barrier') else None` and pass it to `engine.resolve_round`.
- Expose `frenzyFrom` on the battle payload (`battle_start`, `combat-round`,
  resume) so the client can warn the player. Snapshot it onto `rec` at
  `_start_battle` for the enabled kinds.

### Data / tunables (`infrastructure/lambda/undercity_data.py`)

```python
FRENZY_START = 4     # round the collapse begins (of MAX_ROUNDS_COMBAT)
FRENZY_PCT   = 0.18  # per-tier fraction of max HP taken at end of round
```

Add both to the tuning-knobs list in [undercity-combat.md](undercity-combat.md)
§7. Mirror them into `src/app/undercity/data/*.ts` (display mirror invariant).

### Client (`src/app/undercity/`)

- Read `frenzyFrom` from battle state; when the current round is within one of
  `frenzyFrom` (or past it), show a "⚠ the cavern is collapsing" warning so
  guarding into round 4 is a known risk.
- Render `{frenzy: true}` log entries as a distinct collapse line
  (e.g. "The cavern caves in! −N").

### Tests (`infrastructure/lambda/tests`)

- `resolve_round` with `frenzy_from` set applies the ramped damage on/after the
  threshold and nothing before it.
- A frenzy-enabled battle between two survivors **always** ends in a kill by the
  round cap (no timeout outcome).
- The **higher-HP-fraction** combatant wins the collapse.
- Boss / lair battles never receive `frenzy_from` and can still time out (linger).
- Keep `test_balance_good_play_beats_fodder` green.

## Tunables summary

| Knob | Default | Effect |
|---|---|---|
| `FRENZY_START` | 4 | First round the collapse damage applies. Lower = fights end sooner. |
| `FRENZY_PCT` | 0.18 | Per-tier fraction of max HP. Cumulative over rounds 4–6 must stay ≥ 1.0 to guarantee resolution. |
