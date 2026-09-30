# The Undercity — Playtest Findings (real session `20260919-130131`)

**Status:** findings / reference · written 2026-09-20
**Source:** host `export` of the live night `20260919-130131` — 7 players, 293 events,
13.8 h from first hatch, per-player `metrics` counters + full event log + world rows.
**Report tool:** `python scripts/analyze_undercity_session.py undercity-session-20260919-130131.json`
**Prior nights:** [20260725](2026-07-26-undercity-playtest-findings-20260725.md) (8 players),
`20260808-182231` (4 players, directives captured in memory only).

## 1. Executive summary

The **top half of the night is in great shape** and several shipped fixes are visibly
working: the enemy ladder gives the mid cohort real fights, the rested-roll bank behaves,
the level cap is no longer hit at hour 3, and the chat instrumentation gap from August is
closed. Three problems dominate:

1. **Savra became a renown vending machine.** The `repeat` reward table nerfs loot on
   re-kills but the **renown path is uncapped** — Andrew's four post-crown re-kills alone
   (+224) exceeded his 166-point winning margin. The leaderboard was decided after the
   finale was already over.
2. **The finale fired at hour 5 of a 6–8 h event.** Savra died at 21:02, ~5.0 h in. 77% of
   the night's events land in the 16:00–21:00 window; everything after is two players
   farming a dead climax until 02:16.
3. **Two of seven players never took a turn.** David and Wheels hatched and never rolled a
   single die — 29% of the table. The only thing that ever happened to them was Wheels
   killing an idle David in PvP at 23:36. Third session running with a cold-start failure.

## 2. Roster & outcomes

Staggered arrival across 4.6 h (first hatch 16:05, last 20:41). Renown =
`winRenown + 25·POI + 15·pvpRenownWin + bossDamage/10`.

| Player | species / form | Tier·Lv | Renown | rolls | wild | POI | bossDmg | deaths | spores held |
|---|---|---|---|---|---|---|---|---|---|
| **Andrew** | kraul / swarm_lord | T3·10 | **630** | 63 | 18 | 10 | 2800 | 3 | 201 |
| Brandon | zombie / grime_gorger | T3·12 | 464 | 78 | 33 | 9 | 560 | 1 | 970 |
| Waffle | kraul / swarm_lord | T3·12 | 422 | 83 | 37 | 5 | 1462 | 8 | 675 |
| Rumtin | squirrel / squirrel_mage | T2·10 | 275 | 55 | 19 | 7 | 0 | 2 | 133 |
| Pig | kraul / golgari_longlegs | T2·7 | 68 | 38 | 15 | 1 | 0 | 2 | 113 |
| David | zombie / — | T1·1 | 0 | **0** | 0 | 0 | 0 | 1 | 0 |
| Wheels | squirrel / — | T1·2 | 0 | **0** | 0 | 0 | 0 | 0 | 0 |

Three apexes rose (Andrew 21:03 Swarm Lord, Brandon 21:09 Grime Gorger, Waffle 23:37 Swarm
Lord). Andrew took the Queenslayer crown at 21:02:54.

## 3. What's working

- **The enemy ladder holds for the mid cohort.** Waffle — the most combat-active player —
  ran **69% elite / 8 deaths**, and lost the world boss. That's a player genuinely being
  fought back at. Pig (T2·7) at 92% wild / 75% elite is the healthy band.
- **The level ceiling arrives late now.** The band-aligned XP table (950→1355) pushed L12 to
  **22:59 and 23:37** — hours 7 and 8. Last July three players capped by hour 3 and flatlined.
  Andrew won the night at **L10**, so the cap is no longer the win condition.
- **Rested rolls behave exactly as designed.** The two heaviest players (Waffle 83 rolls,
  Brandon 78) ended with **0 rested** — they never overflowed. The idle players banked the
  full 15. The net-neutral overflow pool is doing its job silently.
- **Push-your-luck spaces are being pushed.** Three crystal-vein cave-ins at depth **5, 6,
  and 8** — players are riding it deep, not cashing out at 2.
- **The chat instrumentation gap is closed.** August's export returned an empty `chat`
  array despite in-game use; this export carries 4 chat rows and 4 `type:'chat'` events.
  Supersedes the caveat in `project_undercity_session_export_gaps`.
- **Sigil race was genuinely contested.** Five players raised a first sigil; three reached
  3/3. Rumtin dropped the rot-wards for the whole table at 20:40.

## 4. What's not working (ranked)

### 1 — Savra's renown is uncapped, and it decided the night

She was killed **8 times**: Andrew ×5, Waffle ×2, Brandon ×1. Andrew's last four came in a
**9-minute window** (00:46, 00:51, 00:52, 00:55) — a 560 HP "epic finale" dying every ~2
minutes.

The loot side is correctly nerfed — `ROT_SOVEREIGN['repeat']` pays 40 spores / 20 XP vs the
first kill's 120/60. But `_finish_boss` does `doc['bossDamage'] += dealt` on **every** kill,
and `compute_renown` reads `bossDamage // 10` with no cap and no first-kill gate. So each
re-kill silently pays a **flat +56 renown** that the `repeat` table was explicitly written
to prevent.

Arithmetic: Andrew's 4 post-crown re-kills = 2240 bossDamage = **+224 renown**. His margin
over Brandon was **166**. The leaderboard was won on a boss he had already beaten.

Boss damage is **25.9% of all renown earned on the table** and **44% of the winner's score**.

> **Stale-comment flag.** `ROT_SOVEREIGN`'s docstring still reads *"She's a SHARED
> persistent pool, so a full table or a lone challenger who pre-chips (Spore Bolts) tips a
> close solo win."* That is no longer true — the Queen's Awakening redesign made her a
> personal trial with no stored pool and no ranged damage, and `_award_boss_kill` says so.
> The sim tuning the comment cites (`~68%` win vs a bare max player) was measured under the
> shared-pool model, so the 560/26/12/6 block should be treated as **unvalidated** against
> how she's actually fought now. Worth a re-sim before tuning her again.

### 2 — The climax lands at hour 5 of an 8-hour event

| window | events | note |
|---|---|---|
| 16:00–21:00 | 226 (77%) | the actual game day |
| 21:00–02:00 | 66 | two players farming a beaten boss |

Savra fell 5.0 h after the night opened. Rumtin — who raised the **third sigil** and opened
the island for everyone at 20:40 — logged off at 21:06 without ever challenging her. Pig
left at 21:39. The event that is supposed to be the peak is instead the point where the
table empties.

Per the 6–8 h game-day pacing note, the finale wants to be gated later (sigil pacing, or a
time/availability window), or the post-finale hours need their own content.

### 3 — Two of seven players never rolled a die

- **Wheels** hatched 19:18 at `city_r0`, never moved, never rolled, 0 battles in 2.3 h.
- **David** hatched 20:41 at the same node, never moved, never rolled. At **23:36** — 2.9 h
  after hatching — Wheels PvP'd him where he stood. That kill is Wheels' only XP and only
  level-up, and David's only battle of the entire night.

Both ended holding a **full 10 rolls plus 15 rested**. They accrued the entire economy and
spent none of it. This is not a balance problem — it's an onboarding/first-turn problem, and
it has now produced quit-outs in three consecutive sessions (Hue + Gol Gaga in July, the low
cohort in August, David + Wheels now).

Both hatched into `city_r0`, the same node, which is also why the one interaction available
to them was attacking each other.

### 4 — POI claims are still 43% of renown

Unchanged from July's 44%. Andrew won with **10 claims**; Waffle out-fought everyone (37
wild wins, 5715 damage dealt) and finished 3rd on 5 claims. Acknowledged-and-deferred in
August on the theory that bigger dungeons would absorb it — they have not yet.

Combat renown is 25.4% of the table total despite being the bulk of the actual play time.

### 5 — Spores still have no reachable sink

**2,092 spores unspent** across the table (up from 1,766 in July with one fewer player).
Brandon alone ended on **970**. Total ichor held by all seven players: **6** (Brandon 5,
Waffle 1, everyone else 0). The gear-upgrade sink is still gated behind a material almost
nobody has. This is the same finding as July, unchanged.

### 6 — Difficulty still collapses above T2

| class | record | win rate |
|---|---|---|
| lair | 15–0 | **100%** |
| wild | 82–8 | 91.1% |
| boss (Savra) | 8–1 | 88.9% |
| depths sig1 | 14–0 | **100%** |
| elite | 24–5 | 82.8% |
| depths sig2 | 15–4 | 78.9% |

**Lair mini-bosses went 15–0** — nobody has ever lost one. Brandon's damage ratio was 4.6:1,
Andrew's **9.7:1**. Only Waffle's line (6.8:1 with 8 deaths) looks like a fight. The deepest
content in the game (sig2) is the only thing under 80%, and it's the *only* thing under 80%.

### 7 — Whole systems went essentially unused

| system | usage |
|---|---|
| **Pet merging** | **0 merges.** Every pet on the table is `mergeProgress: 0`. Andrew held **7 pets** and merged none. |
| **Spells** | 34 casts, **28 of them Rumtin** (82%). Brandon 5, Waffle 1, Andrew and Pig **0**. |
| **Umori's auction** | **2 bids all night** (Rumtin ×1, Brandon ×1). |
| **Grime Gorger** (shipped this month) | **1 reclaim**, ~2 h after Brandon evolved, of 3 available claims. |
| **World boss (Grothoma)** | **1 participant.** Only Waffle damaged it (177). It withdrew at 18:56. |
| **Enraged spawn** | `enr_carapace` ended the night at **44/44 HP, untouched**. |
| ossuary / rest / vault / witch | 1–2 landings each all night |

The world-boss result is the **exact** failure the August directive called out ("needs far
more HP, or should become a damage-check boss with tiered rewards") — it was never built,
and it repeated identically.

Pet merging is worse than August's diagnosis. Then the theory was "you don't *find* enough
pets in one night to justify merging." Andrew found seven and still didn't. The blocker is
not supply.

## 5. Notable social data

- **Poking is the single most common action in the game** — 102 events, **34.8% of the
  entire log**. Waffle alone poked 56 times. Rumtin's only chat message is literally
  "POKE ME". Genuinely enjoyed, but it also drowns the event feed.
- Chat itself is near-dead: 4 messages, all in the first hour, all jokes. The table is
  co-located, so this may simply be correct.
- Rumtin used **Spore Bolt offensively against players** (Andrew ×3, Pig ×1, Wheels ×2 for
  28 damage) — including against Wheels, who never took a turn. Worth deciding whether
  ranged PvP chip on an idle player is intended.

## 6. Instrumentation gaps

The event log covers combat, spaces, and social well, but **nothing logs**: shop/market
purchases, gear equips or salvage, pet acquisition/merging, or spore spend. Every economy
conclusion above is inferred from end-state holdings rather than measured flow. If the
spore-sink work gets prioritised, add spend events first or the next export can't grade it.

`firsts` rows carry no username (the report prints `?`) — only the `sk`. Attribution has to
be reconstructed from the event log.

## 7. Open calls for the host

These are decisions, not recommendations already taken:

1. **Cap or gate boss renown.** Options: pay `bossDamage` renown only on the first kill,
   cap it at one kill's worth, or scale re-kills the way `repeat` scales loot.
2. **Gate the finale later**, or build the post-finale hours.
3. **Fix the first turn** — the two idle players are the highest-value fix on this list and
   the third session in a row it's appeared.
4. Decide whether lairs at 15–0 should ever be losable.
5. World boss → damage-check with tiered rewards (carried over from August, still unbuilt).
6. Pet merging: find out *why* a player holding 7 pets doesn't merge. Likely UI discovery,
   not economy.
