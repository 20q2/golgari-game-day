# The Undercity — Playtest Findings (real session `20260725-151118`)

**Status:** findings / reference · written 2026-07-26
**Source:** host `export` of the live night `20260725-151118` — 8 real players, 8.8 h span,
370 events, per-player metric counters + full event log.
**Related work:** [enemy difficulty ladder](2026-07-21-undercity-combat-rebalance-design.md)
context and the change this playtest kicked off,
`2026-07-26-undercity-enemy-ladder-design.md` (change #1, implemented), and
`2026-07-26-undercity-sim-directives-design.md` (sim upgraded to model whole-game play so
future tuning can predict nights like this one).

> **Note on corrections.** A first-pass read of this data made two mistakes that are fixed
> here: (1) it claimed poking supplied ~67% of the roll economy — it did not, the cap held
> (~15%); (2) it claimed the boss wasn't solo-reachable in one night — it plainly is, one
> player did it. Both corrections are baked into the sections below.

## 1. Executive summary

The core loop and build variety are working; the problems are a **backwards difficulty curve**
and an **endgame that only the most dedicated player reached**. Difficulty is a wall when you're
weak and trivial once you're strong, so the night split into a **rich-get-richer top** (cap out
fast, hoard, coast) and a **stuck-poor bottom** (can't win fights → can't level → farmed in
PvP → quit). The **T2 middle cohort is where the game sang** — real challenge, active
progression, and goals all at once. Balance work should stretch that middle experience across
the whole level range.

## 2. Roster & outcomes

Staggered real-world arrival: 4 players in the first ~1.5 h, the other 4 at ~hour 4 (activity
6×'d when the room filled). Final Renown = `25·POI + 3·wildWin + 15·pvpWin + bossDmg/10`.

| Player | species / form | Tier·Lv | Renown | rolls | deaths | notes |
|---|---|---|---|---|---|---|
| Andrew | squirrel / calamity_beast | T3·12 | **288** | 60 | 2 | **soloed the boss** |
| David | zombie / grave_titan | T3·11 | 251 | 61 | 3 | DEF tank |
| Rumtin | squirrel / squirrel_mage | T2·8 | 169 | 43 | 2 | caster |
| Refined Pigeon | zombie / lich_lord | T3·12 | 117 | 41 | 1 | most wild wins (34), 0 POI |
| Jabersaw | pest / brackish_trudge | T2·7 | 107 | 51 | 2 | survivor |
| Waffle | saproling / corpsejack | T2·8 | 81 | 43 | 3 | PvP (3 wins) |
| Gol Gaga Deez | saproling | T1·4 | 74 | 19 | 4 | **stalled, quit** |
| Hue Jainus | squirrel | T1·1 | 0 | 2 | 1 | **hatched, quit** |

## 3. What's working

- **Build diversity is real.** The top three are three different archetypes — glass-cannon
  caster (Andrew), DEF tank (David), speed-mage (Rumtin). No single stat dominates the board.
- **Catch-up is viable.** Refined Pigeon hatched *last* (hour ~4.9) and still reached T3/L12.
- **No environmental-damage deaths.** All 18 deaths are creatures (8) or players (10) — the
  no-arena-damage rule held.
- **The boss finale works and is solo-achievable.** Andrew earned 3 Guild Sigils himself
  (bone → garden → bog) and struck down Savra at 23:18, ~7.7 h after spawn, with only 2 deaths
  and **no host "Awaken" trigger**. It's a genuine, hard, solo win — and only 1 of 8 pulled it.

## 4. What's not working (ranked)

**1 — Combat difficulty runs backwards.** Leaders went **93% wild / 36–0 elite**, dealing
4.4× the damage they took; a fresh L1 (base ATK 4) couldn't reliably close *any* fight inside
the 6-round cap. Losses and deaths clustered entirely on the low-level players, who then quit.
Root cause: a thin, malformed enemy roster (a 34→46 HP cliff, "elite" tiers *weaker* than
regular wilds, no apex) and — the big one — **the whole 139-node depths ran flat 22–28 HP
fodder regardless of depth**, so descending never got harder.
→ *Addressed by change #1 (enemy difficulty ladder).* 

**2 — The level ceiling is hit too early.** `xp_to_next = 20 + 5·level` ⇒ ~550 XP ≈ 15 wild
wins to max at **L12**; three players capped out and then had no growth vector left (stats
spent, nothing to buy). The top third of the night is a flat line for your best players.

**3 — Scoring is "claim POIs or lose."** POI claims are **44%** of all Renown (25 each vs 3
per wild win). The leaderboard *is* the claims ranking. The most combat-active player
(Refined Pigeon, 34 wild wins, **0 POI**) finished 4th. Three of eight players claimed 0 POIs
— likely never realising claiming *was* the game. Boss contributed **3%** of total score
despite being the climax.

**4 — Spore sink is locked behind ichor.** **1,766 spores sat unspent**; the top three held
~1,450. The main sink (gear upgrades) needs **ichor**, and **7 of 8 players ended with 0
ichor** — its only source is salvaging tier-3+ gear, which the hoarders (sitting on full 5–6
item stashes) never did. Spores are over-supplied relative to reachable sinks.

**5 — Weak cold open / low-population early game.** Hours 0–3 had 3–4 players and near-zero
activity; the two who hatched into that empty lobby (Hue L1, Gol Gaga L4) stalled and quit.
The game only "turns on" at critical mass. There's a `bot-add` host cmd that could seed a
starting lobby.

**6 — Low-level players get farmed in PvP.** 10 of 18 deaths are player kills, clustering on
the weakest (Gol Gaga, Hue). Cold open **plus** getting farmed is a double-whammy on exactly
the players who bounced. No level-gap protection.

**7 — Half the content is never seen.** Board landings are **29% wild**; the special
facilities are so rare most players never touched them — excavation 1/8, rest 1/8, trove 2/8,
vault 3/8, witch 3/8, **lair 4/8** (60 spores + a sigil!), boss 2/8. A lot of built systems
got near-zero play.

## 5. Economy specifics

- **Rolls (movements).** 320 total; **~50 per engaged player**, matching `6/hour × hours`
  (natural regen is `ROLLS_PER_REGEN 3 / 30 min`) plus a few from pokes/claims/bravery. The
  two quitters (2 and 19 rolls) drag the all-8 average to 40. This ~50-roll budget is now the
  sim's realistic night length.
- **Poke did NOT distort the economy.** The per-player cap held: only **48 of 213 pokes**
  granted a roll (~15% of spend, ~23% of pokes); the other 77% were cosmetic, and the roll
  goes to the **pokee**, not the poker. Poke is a working social toy (the boing animation),
  not a roll farm. Its only real cost is **feed noise** — 58% of the event log is pokes.
- **Spores** — see finding #4: over-supplied, sink gated by ichor scarcity.

## 6. Play patterns

- **Objective-chasers beat grinders.** Andrew's firsts/sigils/boss > Refined Pigeon's 34
  wild wins. Good incentive *design*, but a player who "won every fight" finishing 4th can
  feel bad — worth watching.
- **DEF tanks over-perform**, especially deep — flagged for a later balance pass (do **not**
  fix by inflating enemy rungs; that craters glass builds).
- **Species identity expresses cleanly:** squirrels → SPD, zombies → DEF/HP, saprolings →
  flexible.

## 7. Prioritized recommendations

1. **Fix the difficulty curve** (root cause feeding #2/#5/#6/#7) — *done: enemy ladder,
   change #1.*
2. **Unlock the spore sink** — add a second ichor source or surface salvage; add a high-end
   pure-spore sink so 600-spore leaders have a decision.
3. **Make POI-claiming legible** — tutorial nudge / on-board prompt / a claims HUD; or narrow
   the POI-vs-combat Renown gap.
4. **Fix the cold open** — auto-seed a few bots below a player-count threshold (the `bot-add`
   cmd exists) or richer solo early content.
5. **Protect low-tier creatures from PvP farming** — level-gap shield or reduced compost
   penalty far below your attacker.
6. **Give leaders a post-cap vector** — raise the level cap, steepen the late curve, or add
   post-cap progression (prestige stats, gear mastery).
7. **Rebalance board weights** toward the special facilities (trim wild); most players never
   see lairs/vaults/veins.
