# The Golgari Throne — succession, prestige, and the boss sprite

Design doc — 2026-09-20

## Summary

Felling Savra no longer ends the Undercity's endgame; it *transfers* it. The
slayer's creature ascends, is retired from play, and is seated on the Golgari
Throne as the boss the next challenger must fight. The player prestiges into a
fresh level-1 creature, keeping their renown and their companions, and the
night keeps having a summit to climb after the Queen falls.

Three things ship together, because they share one root cause — a creature's
sprite descriptor never reaching the client:

1. **Succession + prestige** (the feature).
2. **The PvP paw-print bug** (the same descriptor, the same three payloads).
3. **Boss art on the isle node, and the spectator board's missing layers.**

## Player-facing loop

1. Hold `SIGILS_REQUIRED` Guild Sigils (or wait for the host's `boss-awaken`).
2. Fight whoever sits the throne — Savra first, a player lord thereafter.
3. Win: rewards pay out, a Hall-of-Fame animation plays, your sprite rises to
   the throne, and your creature is retired.
4. You are **ascended**: board actions refused, token off the map, shown
   standing on the isle throne, until you open the hatch flow.
5. Hatch a new starter. You keep your banked renown, your companions, and a
   bundle of bonus rolls. Everything else starts over.
6. Someone else (or a later you, on a second run) comes to take the seat.

## Server — data model

The season already carries `UNDERCITY#{sid} / BOSS` holding `slayer`,
`slayerName`, `slayerAt` and the Queen's field-curses. The throne lives there
too, so it resets nightly for free: a new night mints a new `sid`.

```
BOSS record
  slayer / slayerName / slayerAt   # Queenslayer — unchanged, first Savra kill only
  buffs                            # field-curses — unchanged
  throne: {                        # NEW — the current occupant, absent = Savra
      userId, username, takenAt,
      npc: { ...frozen stat block... }
  }
  lineage: [                       # NEW — the Hall of Fame, append-only
      { userId, username, creatureName, formName,
        sprite: {form, paint, hat, spriteVariant},
        takenAt, deposedAt }
  ]
```

### `_build_throne(doc)`

Reuses `_build_clone(doc)` — the existing PvP clone builder — with four
overrides:

| Field | Value |
|---|---|
| `name` | `"{creature label}, Lord of the Golgari"` |
| `id` | `'golgari_throne'` (stable art + dialogue key) |
| `hp` / `maxHp` | effective `maxHp * THRONE_HP_MULT` |
| `dmgMult` | `THRONE_DAMAGE_MULT` |

Everything else rides along from `_build_clone`: gear-inclusive ATK/DEF/SPD,
passives, attribute perks, riders and magnitudes, themed personality, bluff,
and the `form`/`paint`/`hat`/`spriteVariant` sprite descriptor. All frozen at
the instant of the kill — the retired creature never changes again.

No companion and no spells: NPCs have neither today, and adding NPC-side
companion support is out of scope (see Out of scope).

## Server — combat

### The damage restriction

`Combatant` gains `dmg_mult: float = 1.0`, persisted through `_bt_snapshot` /
`_bt_to_combatant` (the same treatment the Reach charge got). It applies at
exactly one place, `engine._base_hit`:

```python
hit = max(1, round(raw * (1 - mitigation) * striker.dmg_mult))
```

That is the chokepoint the function already centralises `armor_strip` at, so
every strike site inherits it without touching call sites. Rot ticks, thorns
and the Collapse ramp stay unscaled — the same scope `_incoming_mult`
(Colossus) already uses.

**Why a multiplier and not stat caps.** Savra is `hp 560, atk 26, def 12,
spd 6`. Her ATK is *higher* than any normal creature (above the isle apex
Deity's 25); her length comes from the HP pool, not from soft punches. So an
uncapped mono-ATK lord at ~ATK 33 would be strictly harder than the Queen.
`THRONE_DAMAGE_MULT = 0.7` brings that build to ~23 effective, just under her.

**Known shape: the turtle reign.** A mono-DEF lord seats at ~550 HP with
ATK ~12, or ~8 effective. The Collapse ramp (from round 4, +0.2/tier, x5.2 by
the round-24 hard cap) guarantees the challenger still wins, but around round
12-15 and without drama. Accepted; watch it on game day.

### Flow

- `_boss()` picks the occupant: a stored `throne`, else `ROT_SOVEREIGN`. The
  sigil gate, `bossPhase` and field-curse spending are identical on both paths.
  `ctx` gains `throne: True` so the finisher can tell them apart.
- `_award_boss_kill()` calls `_set_throne(table, sid, doc)` on every win and
  appends to `lineage`, stamping the outgoing lord's `deposedAt`. The deposed
  lord gets an away-event push.
- The **Queenslayer crown**, its `QUEENSLAYER_RENOWN` perm grant, and the
  night-wide `AWAKENING_XP_BUFF` stay bound to the first *Savra* kill. A
  succession never re-fires them.
- Payout is the Queen's own `first` / `repeat` tiers keyed on the player's
  existing `poiClaims 'boss'`, plus the boss gear-drop table — unchanged.
- **Challenging your former self is allowed.** After prestiging you are a
  different creature; a second full run can end with you facing the one you
  retired. Deliberate, not an oversight.

## Server — ascension and prestige

### States

A new `ascended: True` flag on the season player doc. While set, every
gameplay action is refused except `state` and the prestige hatch — the same
shape as the existing `_BATTLE_ALLOWED_ACTIONS` gate. The doc keeps the retired
creature's fields until re-hatch, so standings and the isle display still know
who the lord is.

### Renown banking — the part that must not be got wrong

`compute_renown` is derived from `wildWins`, `pvpRenownWins`, `poiClaims`,
`bossDamage` and `winRenown`. `_new_player_doc` zeroes every one of them. A
naive re-hatch would therefore **reset the winner's leaderboard renown to
zero** — winning the game would cost you your standing.

Ascension snapshots `compute_renown(old_doc)` into `bankedRenown`, and
`compute_renown` gains it as a term.

**Banking happens at ascension, not at the hatch, and it must zero its own
sources in the same step.** A player can ascend and never hatch — the night
ends, or they simply stop. If `bankedRenown` were added while `wildWins`,
`poiClaims`, `bossDamage` and `winRenown` still sat on the doc, that player's
renown would *double*. So ascension moves those counters into `prestigeTotals`
and zeroes them on the live doc in one write. The sum is then correct whether
or not a new creature is ever hatched, and the prestige hatch has nothing left
to bank.

Two further leaks in `_archive_season`, both pre-existing and both newly
reachable through prestige:

- `perm['lifetimePvpWins']` reads the live doc's `pvpWins`, so a prestiged
  player's retired PvP wins vanish from their permanent record.
- `perm['apexReached']` tests `p.get('tier') == 3`; someone who ascended a
  tier-3 apex creature archives as tier 1 and loses the credit.

Both are banked in a `prestigeTotals` accumulator that `_archive_season` adds
in.

### The prestige hatch

A new action, not `_join` (which short-circuits on an existing doc). It:

- rebuilds the doc through `_new_player_doc` (so human join, `bot-add` and
  prestige can never drift);
- carries forward `bankedRenown`, `prestigeTotals`, and the companion block —
  `pets`, `activePetId`, `eggs`, `incubator`, `petRecharge`;
- grants `PRESTIGE_ROLLS` bonus rolls. `ROLL_CAP` is 10 but overflow banks into
  the `rested` pool (`RESTED_CAP` 15) and pays double on regen, so a generous
  bundle meters out rather than being wasted;
- bumps `perm['seals']` (a genuine new creature, and it earns the veteran
  shell-paint grant) but **not** `perm['nights']`;
- skips `_apply_shop_purchases` — the pre-spawn renown shop stays a night-start
  thing.

Everything else resets: level, stats, form, gear, stash, spores, materials,
sigils, board position.

`royalJelly` is deliberately **not** carried. It sits with the pet data
structurally, but it is the swarm-drop currency that buys a challenger's kit
for the Queen; carrying it would let the new creature pre-fund its own boss run
off the retired one's work, which is the spore carry that was turned down.

## Client — the sprite pipeline (shared fix)

### Root cause

`_build_clone` already stamps `form` / `paint` / `hat` / `spriteVariant` onto
the PvP clone, and carries a comment claiming these "survive into the finisher
and battle reloads via npcMeta". That claim is **false**. They reach `npcMeta`
but three client-facing payloads drop them:

- `_start_battle`'s returned `npc` dict
- `_battle_resume`'s `npc` dict
- the finishers' `out['npc']` — `_finish_pvp` and `_finish_boss`

So the client's PvP branch never fires, falls through to
`enemyArtUrl('pvp:<userid>')`, 404s, and lands on the `'pets'` paw print.

### Fix

Server: send the four fields in all three payloads, read off the `npcMeta`
that already holds them. Delete the false comment.

Client: four call sites in `board-tab.component.ts` independently decide a
foe's sprite — boss intro, result card, live battle, resume — and only one has
the PvP branch. That duplication *is* the bug. Collapse all four onto a single
`foeSpriteUrl(npc, kind)` helper: prefer the sprite descriptor when present,
else `npcSpriteUrl` by art id. The throne then renders everywhere without being
special-cased anywhere, and the paw print returns to being a genuine last
resort.

`BattleResume.npc` gains the four fields in the model. `SpaceEvent.npc` already
declares them — the client was ready, the server just never spoke.

## Client — board and overworld

### Boss art on the isle node

`drawLairBoss` already looms a boss's art behind its node with a breath/lunge
cycle. The isle `boss` node never used it — it draws a bare skull glyph. Add
`drawIsleBoss(n)` modelled on it, rendering whoever holds the node:

- **Savra** from her existing art, `public/undercity/guardians/rot_sovereign.png`.
- **A lord** from their recolored creature sprite, loaded through a new
  `setThroneLord(spriteUrl)` that mirrors the existing `setActivePet` loader.

The skull glyph stays as the space-type marker (lair nodes keep theirs). No HP
bar: she is a personal trial with no shared pool, unlike the lairs.

### Crown and plate

`_finale_public` gains a `throne: {userId, username, takenAt}` block — one
source feeding both markers:

- `BoardPlayer` gains `crowned?: boolean`; `board-canvas` draws a small crown
  over that player's token.
- The boss node's name-plate reads `Throne held by {username}` while a lord
  sits, replacing the `First to fell the Queen` plate. The Queenslayer is still
  carried in the event feed, the finale block, and the ceremony.

### Ascension animation and hatch

A new overlay component: the sprite rises to the throne, name plate, `LORD OF
THE GOLGARI`, then a CTA into the hatch flow. The "choose a starter" UI already
exists for un-joined players, so the between-characters state reuses that path.

### Dialogue

`BOSS_DIALOGUE['golgari_throne']` — two beats, no emoji, in the register of
*"The Queen's chair was still warm when I took it. Yours will not be."*

## Client — spectator drift

`/tv` calls only `setPlayers`, `setBarriersOpen`, `setGuardianPools`,
`setSwarm`, `setAwakened`, `setDiceMarkers`. It is missing ten layers:
`setUmori`, `setWorldEvent`, `setEnraged`, `setFirsts`, `setFogReveals`,
`setReclaimed`, `setProgress`, `setClearedDungeons`, `setAbandonedLairs`,
`setSeason`.

The cause is structural: `board-tab` and `spectator` each hand-wire a
`BoardCanvas` from the same store, so any layer added to one silently never
reaches the other. Patching ten calls into spectator fixes today and guarantees
the same drift next feature.

Extract one `syncBoardWorldState(board, store)` that both components call for
every pure store-to-canvas layer, leaving each with only its genuine extras —
`board-tab` keeps choices / info / stepDie / activePet, spectator keeps
diceMarkers. Two derivations currently inside `board-tab` (cleared dungeons,
and the `RUIN_LAIRS` + `ruinLairAbandoned` filter) move into the helper.

## Config

In `infrastructure/lambda/undercity_config.py`, with the client mirror under
`src/app/undercity/data/`:

| Constant | Value | Meaning |
|---|---|---|
| `THRONE_HP_MULT` | `5` | seated lord's HP = their effective maxHp x this |
| `THRONE_DAMAGE_MULT` | `0.7` | multiplier on the throne's dealt strike damage |
| `PRESTIGE_ROLLS` | `6` | bonus rolls granted at the prestige hatch |

`PRESTIGE_ROLLS = 6` is a starting value, not a tuned one: it fills most of a
`ROLL_CAP` bank so a fresh creature can move immediately, and any overflow
banks into `rested` rather than being lost. Expect to tune it after one night.

## Testing

Server, extending `infrastructure/lambda/tests/test_undercity_savra.py`:

- the throne seats on a Savra kill
- the next challenger meets the lord, not the Queen
- succession transfers the seat and appends to `lineage`
- HP is maxHp x `THRONE_HP_MULT`
- `dmg_mult` measurably lowers dealt damage
- the sprite descriptor round-trips through `_start_battle` and
  `_battle_resume`
- the Queenslayer crown and XP buff fire once and are not re-fired by a
  succession
- ascension blocks gameplay actions until the prestige hatch
- `compute_renown` is preserved across a prestige (the anti-regression test
  for the zeroing bug)
- `prestigeTotals` survives into `_archive_season`
- companions and eggs carry; gear, spores and `royalJelly` do not
- a new night clears the seat

Run with `cd infrastructure/lambda && python -m pytest tests -q`.

No frontend test runner exists in this repo, so the client side verifies with
`npm run build:prod`.

## Deliberate decisions

- **Savra pays zero leaderboard renown today.** `RENOWN_WIN` has no `'boss'`
  key and `_award_boss_kill` never calls `_add_win_renown` — a lair mini-boss
  pays 8, the Queen pays 0. The throne inherits that same zero rather than
  inventing a number inside this feature. Flagged as a separate tuning pass.
- Stat caps rejected in favour of the damage multiplier (see Combat).
- The turtle reign is a known dull shape, accepted (see Combat).
- Challenging your former self is allowed.
- `royalJelly` does not carry across a prestige.
- `perm['seals']` bumps on a prestige hatch; `perm['nights']` does not.

## Out of scope

- NPC-side companion support (a lord's pet fighting beside them on the throne).
- NPC spellcasting.
- Cross-night persistence of the throne. It is a within-night mechanic: it
  keeps the endgame alive after Savra falls and gives the winner a seat to
  defend.
- A boss-class `RENOWN_WIN` entry (see Deliberate decisions).
