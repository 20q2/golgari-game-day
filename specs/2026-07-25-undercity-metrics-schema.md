# Undercity Session Metrics & Export Schema

**Date:** 2026-07-25
**Scope:** Reference for the per-player metrics counters and the host `export`
admin command added for playtest balance analysis. Implementation lives in
`infrastructure/lambda/undercity_db.py` (`_metric`, the instrumented chokepoints,
`_admin_export`) and the admin panel (`src/app/undercity/admin/`).

## Getting the data

`/undercity/admin` → enter the host passphrase → **Session data → Export session
data**. Downloads `undercity-session-<seasonId>.json`. Requires an **active
season** (the passphrase lives in the season config). Read-only; safe to run any
time during or after the night. Metrics only accrue **after the Lambda is
deployed** — deploy before the session to capture full journeys.

## Export JSON shape

```jsonc
{
  "ok": true,
  "season": "<seasonId>",           // the night this export covers
  "exportedAt": "<ISO-8601 UTC>",   // when the export was taken
  "players": [ /* player docs, one per participant (incl. bots) */ ],
  "events": [ /* the complete append-only event log for the season */ ],
  "firsts": [ /* season-global first-conqueror records */ ]
}
```

All numbers are plain JSON numbers (DynamoDB `Decimal` is converted on the way out).

## `players[]` — per-player docs

Each entry is the raw season player doc. The fields most useful for balance:

### Identity / end-state
| Field | Meaning |
|---|---|
| `userId`, `username` | player id + display name |
| `isBot` | true for admin-spawned puppet bots |
| `creatureName`, `form`, `formName`, `tier` | creature identity + evolution stage reached |
| `level`, `xp` | final level + XP into the next |
| `hp`, `maxHp` | final HP pool |
| `spores` | final Spore balance (economy end-state) |
| `homeBiome`, `position` | starting biome + where they ended the night |
| `wildWins`, `bossDamage`, `poiClaims` | cumulative stats renown is derived from |
| `passives`, gear/`bag`/`gearStash` fields | loadout at the end |

### `metrics{}` — observational counters (this feature)

Accumulated live during play; purely observational (never read back into game
logic). Absent keys mean the event never happened for that player (treat as 0).
Dotted keys form families you can roll up by prefix.

| Key | Incremented when | Notes |
|---|---|---|
| `rolls` | an ordinary die roll is committed | excludes Fleetfoot rerolls |
| `rerolls` | a Fleetfoot reroll is taken | same turn's die; not an ordinary roll |
| `blinks` | a Blink (SPD-15 chosen-value roll) fires | subset signal for SPD-perk tuning |
| `spaces` | the player lands on / resolves any tile | one per landing |
| `space.<type>` | landing, keyed by node type | e.g. `space.wild`, `space.elite`, `space.shop`, `space.lair`, `space.ossuary`, `space.excavation`, `space.crystal_vein`, `space.trading_post`, `space.vault_lock`, `space.loot`, … `sum(space.*) == spaces` |
| `battles` | any battle finishes | total fights resolved |
| `battle.<kind>.<outcome>` | a battle finishes, keyed by enemy kind + result | `kind` ∈ {`wild`, `elite`, `barrier`, `lair`, `world`, `boss`}; `outcome` ∈ {`win`, `loss`, `timeout`, `fled`}. `win`=you composted it, `loss`=you were composted, `timeout`=ran out of rounds (incl. Last-Stand saves), `fled`=escaped |
| `dmgDealt` | each battle finish | total damage the player dealt across all fights |
| `dmgTaken` | each battle finish | total damage the player absorbed across all fights |
| `xpGained` | any XP grant | cumulative XP earned (sums even the XP already spent on levels) |
| `deaths` | a real compost (post-Undying) | Undying saves do **not** count |

**Derivable rollups (compute in analysis, not stored):**
- Win rate vs a kind: `battle.<kind>.win / (win+loss+timeout+fled)`.
- Avg damage per fight: `dmgDealt / battles`.
- Encounter mix: normalize `space.*` by `spaces`.
- Roll efficiency: `spaces / rolls` (how often a roll led to a meaningful tile).

**Not tracked as counters** (use end-state + events instead): granular Spore
in/out (too many code paths — read final `spores` + economy events like
`jackpot`/`trove`/`vein`), level-up timings (see `level` events), evolutions
(see `evolve` events + final `tier`/`form`).

## `events[]` — the append-only log

One record per milestone, chronologically reconstructable via `ts`.

```jsonc
{
  "sk": "EVENT#<ms>#<rand>",  // sort key; embeds the timestamp
  "ts": 1737800000000,         // epoch milliseconds
  "type": "level",             // event family (see below)
  "text": "…human-readable…",  // display string
  "actor": "<userId>",         // present when tied to a player
  "data": { … }                // rare; structured extra when available
}
```

**Event `type` values seen:** `hatch`, `level`, `evolve`, `compost`, `undying`,
`pvp`, `poke`, `boss`, `sigil`, `lair`, `barrier`, `claim`, `trove`, `cache`,
`vault`, `vault_lock`, `excavation`, `vein`, `jackpot`, `trade`, `snare`,
`spell`, `season`, `host`. Most carry only `text` (parse loosely); filter by
`actor` to reconstruct one player's timeline, or by `type` for cohort stats.

## `firsts[]` — season-global first-conquerors

```jsonc
{ "sk": "FIRST#<node>", "by": "<username>", "uid": "<userId>",
  "at": "<ISO-8601>", "kind": "lair|boss|trove|cache|vault" }
```

Who claimed each landmark first (the one-time "first-clear" bonuses). Useful for
race/pacing analysis — how fast the field cleared each objective.

## Caveats

- **Post-deploy only:** counters start at the deploy; pre-deploy activity has no
  `metrics`.
- **One-shot payload:** the export is a single JSON response. Fine for a normal
  night; a very long session with a huge event log could approach Lambda's
  ~6 MB response limit, at which point we'd add paging.
- **`reset-all` starts a fresh night:** the host Reset admin cmd archives the
  current night — its player docs, `metrics`, and event log are preserved under
  that night's own seasonId — then opens a new empty night and wipes all
  permanent profiles. The export targets the **active** season, so **export
  before resetting** to grab the finished night's JSON; afterwards the active
  season is the new, empty night.
