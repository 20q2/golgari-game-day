# Undercity Config File, Timed Roll Regen & Debug Gating — Design

Date: 2026-07-17
Status: Approved

## Goal

1. One easily accessible config file for Undercity tunables — roll economy first
   and foremost, plus other simple scalar knobs.
2. A new mechanic: timed roll regeneration (rolls trickle back over time).
3. Debug features (unlimited rolls, pick-your-roll) behind a single `DEBUG`
   flag instead of scattered hardcoded TODOs.

## Current state (before this change)

- Roll-economy constants live mid-file in `infrastructure/lambda/undercity_data.py`
  (lines ~488–514); the `UNLIMITED_ROLLS = True` dev switch sits separately at
  line ~664 with a "flip before game night" TODO.
- Rolls are only earned via claims (finished/won/taught board games) and pokes;
  there is no timed refresh.
- The client's Pick-a-face button and "Roll (∞)" label are unconditionally
  rendered in `board-tab.component.html` with their own remove-before-game-night
  TODOs.
- Color-test and map-editor navbar links are already gated by Angular
  `isDevMode()`; their routes always exist (harmless in prod).

## Design

### 1. `infrastructure/lambda/undercity_config.py` (new)

A small file that is *only* tunables — no tables, no logic:

```python
# ── Debug ────────────────────────────────────────────────────────────────
DEBUG = True   # unlimited rolls + pick-your-roll cheat; flip to False
               # (and cdk deploy) before game night

# ── Roll economy ─────────────────────────────────────────────────────────
ROLL_CAP = 6
JOIN_ROLLS = 3
SEAL_BONUS_CAP = 3
ROLL_REGEN_MINUTES = 10       # +1 banked roll every N minutes, up to ROLL_CAP
CLAIM_FINISHED_ROLLS = 2
CLAIM_WON_BONUS_ROLLS = 1
CLAIM_WON_SPORES = 10
CLAIM_FINISHED_COOLDOWN_MIN = 15
CLAIM_TAUGHT_ROLLS = 1
CLAIM_TAUGHT_MAX = 2
POKE_ROLL_LIMIT = 3

# ── Other scalar knobs ───────────────────────────────────────────────────
SHOP_REFRESH_MIN = 30
OSSUARY_MAX_BET = 20
OSSUARY_ROLLS_PER_VISIT = 3
SNARE_SPILL_PCT = 0.20
HP_REGEN_PCT = 0.10
HP_REGEN_INTERVAL_MIN = 10
...
```

`undercity_data.py` does `from undercity_config import *` where those constants
used to be defined, so every existing `data.ROLL_CAP` reference — including test
monkeypatches via `monkeypatch.setattr(data, ...)` — keeps working unchanged.
`UNLIMITED_ROLLS` is removed and replaced by `DEBUG`.

Weighted tables (dig loot, shop stock, mystery events) stay in
`undercity_data.py`; the config file carries a comment pointing at them.

### 2. Timed roll regen (new mechanic)

Lazy computation, same pattern as HP regen — no cron, no extra infra:

- Each player doc gets `lastRollRegenAt` (ISO timestamp, seeded on join).
- On every state read / action touching the player, grant
  `elapsed_minutes // ROLL_REGEN_MINUTES` rolls via the existing `_add_rolls`
  (which already caps at `ROLL_CAP`), then advance `lastRollRegenAt` by the
  granted whole intervals (not to "now", so partial progress isn't lost).
- While at cap, the timestamp keeps advancing so a full bank doesn't stockpile
  hidden progress.
- The state payload includes `nextRollAt` (server-computed) when below cap;
  the client roll strip shows a countdown ("next roll in 4:32").

### 3. Debug gating

- **Server:** `DEBUG` gates (a) rolling without spending banked rolls and
  (b) accepting a `value` payload on the roll action (pick-your-roll). The
  state payload reports `debug: true/false`.
- **Client:** the Pick button and "(∞)" label render only when the server
  state says `debug`. Normal mode restores the real gate and label
  ("Roll (3)"), disabled at 0 rolls with the "finish a board game" hint.
  No client code change is needed when flipping the flag — the UI follows the
  server.
- Color-test and map-editor remain gated by `isDevMode()` as today.

### 4. Testing

- Existing suite: replace `UNLIMITED_ROLLS` monkeypatches with `DEBUG`.
- New tests: regen grants after N minutes, caps at `ROLL_CAP`, preserves
  partial-interval progress, doesn't grant while at cap, `nextRollAt` is
  reported correctly, pick-your-roll rejected when `DEBUG = False`.
- Keep `cd infrastructure/lambda && python -m pytest tests -q` green.

## Out of scope

- Runtime toggling (env var / DynamoDB flag) — flipping `DEBUG` is a one-line
  edit + `cdk deploy`.
- Moving weighted loot tables into the config file.
- Client-side mirrors in `src/app/undercity/data/*.ts` beyond what the roll
  UI needs (roll numbers come from the live state payload).
