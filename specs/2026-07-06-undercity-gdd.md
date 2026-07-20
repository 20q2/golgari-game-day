# The Undercity — Game Design Document

**Status:** Approved design, pre-implementation
**Date:** 2026-07-06
**Host site:** Golgari Palace Game Day (Angular 20 PWA, GitHub Pages, Python Lambda + DynamoDB)
**Sibling reference project:** `a:\Coding\AlexBirthdayDinos` ("Dino Party")

---

## 1. Concept & Design Pillars

The Undercity is a phone-first sub-game that runs alongside real-life game night. Each player hatches an egg into a small Golgari creature (a pest, an insect, a saproling) and spends dice rolls — earned by playing real board games — to move around a Dokapon Kingdom-style board map set in the Ravnican undercity. Spaces trigger events: loot, wild battles, shops, shrines, hazards, and fights with other players. Creatures level up and evolve through branching choices toward apex forms like the Golgari Lich Lord or a Grave Titan. The host resets the world every game night; cosmetics and veteran status persist forever.

**Pillars (in priority order):**

1. **Fun in 2–4 minute bites.** Every phone pickup is a complete beat: claim rolls → roll → move → resolve → put phone down. Nothing ever blocks on another player being online.
2. **Real game night feeds the game.** Rolls come from playing actual board games. The sub-game is the connective tissue of the night, not a competitor to it.
3. **Choices that matter within one night.** Evolution branches, stat blessings, gear purchases, and stance settings make each run feel authored. Every run is different because the board events, drops, and evolution picks differ.
4. **Death is compost, not punishment.** Losing a battle is funny and cheap. Golgari flavor: everything that dies feeds the swarm and regrows.
5. **Your creature is *yours*.** Paint and hats (ported from Dino Party) persist across nights. The plaza makes everyone's creature visible and social.

**Scale target:** 8–15 concurrent players, phone-first, single friend group, one physical location, sessions of roughly 4–6 hours (one game night = one season).

---

## 2. Identity & Meta-Persistence

- Identity reuses the site's existing `UserService` (localStorage `gameday-user-id` / `gameday-username`, sign-in dialog, `requireSignIn()` before any write). No new auth.
- **Two persistence scopes:**
  - **Season scope** (wiped every night): creature, level, XP, HP, stats, board position, rolls, Spores, inventory, equipment, stance.
  - **Player scope** (permanent): the **wardrobe** (all hats and paints ever earned), **Guild Seals** (one per night attended), lifetime stats (nights attended, total PvP wins, apex forms reached), hall-of-fame entries.

### Guild Seals (returning-player rewards)

Minted automatically the first time a player joins a season. Grants at season join:

| Seals held | Perk |
|---|---|
| 1+ | Choose your egg's shell color (cosmetic) |
| 3 | Exclusive hat: **Veteran's Cowl** |
| 5 | Exclusive hat: **Crown of the Swarm** |
| Any | Full wardrobe available from minute one of every season |

---

## 3. Season Lifecycle & Host Controls

A **season** = one game night. Exactly one season is active at a time.

- **Start:** Host opens the admin panel (gated by a host passphrase stored in localStorage — same trust level as the rest of the site, no real auth) and presses **New Night**. This archives the previous season, creates a fresh one, and resets the board.
- **Join:** Any signed-in player visiting `/undercity` during an active season gets the egg-hatching flow (§4).
- **Boss phase:** Host presses **Awaken the Behemoth** (intended for the last hour of the night) — unlocks the boss lair (§11).
- **End:** Host presses **End Night** — freezes all actions, computes Renown scores (§12), displays the champion screen, archives results to the hall of fame, and mints Guild Seals.
- **Idle state:** With no active season, `/undercity` shows the previous night's final scoreboard and the hall of fame.

---

## 4. Hatching & The Roll Economy

### Hatching

On first join of a season the player sees their egg (shell color chosen if they have a seal), taps it three times (cracks animate), and it hatches. The player **chooses** one of four starters (shown with stats and evolution preview silhouettes) — choice, not random, because the starter determines the whole run's arc.

### Earning rolls (self-report, honor system)

| Action | Reward | Limits |
|---|---|---|
| Season join | 3 rolls (+1 per Guild Seal, cap +3 bonus) | once |
| **"We finished a game"** button | +2 rolls | 15-min cooldown |
| **"…and I won!"** toggle on the same claim | +1 roll, +10 Spores | same claim |
| **"I taught someone a new game"** | +1 roll, +5 XP | 2× per night |
| Poke received in plaza (§10) | +1 roll to the *poked* player | first 3 pokes/night |

- Rolls **bank up to 6**. Claims that would exceed the cap are lost (displayed clearly) — this pushes people to actually take their turns throughout the night rather than hoarding.
- All claims append to the public event log ("Alex claimed a win at Wingspan table!") — social visibility is the anti-cheat.

---

## 5. Creatures: Stats, Leveling, Evolution

### Stats

Four stats, integers, always visible:

- **HP** — persists *between* battles; regenerates 10% of max per 10 minutes of real time (the swamp heals its own).
- **ATK** — outgoing damage.
- **DEF** — flat damage reduction.
- **SPD** — strike order in battle, flee odds, snare-dodge odds.

### Starters (Tier 1, level 1)

| Starter | Archetype | HP | ATK | DEF | SPD | Passive |
|---|---|---|---|---|---|---|
| **Pest** (sewer rat) | Balanced | 30 | 6 | 5 | 5 | **Scrounger:** +2 Spores from every loot source |
| **Kraul Grub** (insect) | Glass cannon | 24 | 8 | 3 | 7 | **First Bite:** always strikes first in round 1 |
| **Saproling** (plant token) | Tank | 38 | 5 | 7 | 3 | **Regrowth:** heal 20% max HP after any battle |
| **Spore** (fungus) | Trickster | 27 | 5 | 5 | 6 | **Drift:** +15% flee chance; mystery events reroll bad outcomes once |

### Leveling

- XP cost to reach the next level: `20 + 5 × currentLevel` (L1→2 = 25, L9→10 = 65). Level cap **12**.
- Per level: **+3 max HP** automatically, plus **+2 stat points** the player assigns freely between ATK / DEF / SPD (max +1 per stat per level). Small numbers keep balance tight at 15 players.
- XP sources: wild battle win **15**, wild battle loss **5**, PvP win **20**, PvP loss **8**, mystery events **5–10**, shrine tithe option **8**, teaching claim **5**.

### Evolution

Evolutions trigger at **level 5** (Tier 2) and **level 10** (Tier 3) as a full-screen choice moment — two cards, stat previews, no takebacks. Evolving grants an immediate **full heal**, a **+4 bonus** spread across the form's featured stats, swaps the sprite everywhere, and posts to the event log.

**Tier 2 (level 5) — pick one of two per line:**

| From | Option A | Option B |
|---|---|---|
| Pest | **Brackish Trudge** — bruiser (+HP/+ATK); passive: *Undying* — first compost each hour, revive at 50% HP instead | **Stinkweed Imp** — speedster (+SPD/+ATK); passive: *Flyby* — 25% chance enemy strikes miss |
| Kraul Grub | **Kraul Warrior** — striker (+ATK); passive: *Venom Barb* — your first strike each battle deals +3 | **Kraul Forager** — raider (+DEF); passive: *Deathrite* — +50% Spores stolen on PvP wins |
| Saproling | **Slitherhead** — counterpuncher (+ATK/+HP); passive: *Scavenge* — retaliate for 2 damage whenever struck | **Woodwraith Strangler** — fortress (+DEF/+HP); passive: *Rootwall* — Regrowth improves to 35% |
| Spore | **Shambling Shell** — durable trickster (+HP/+DEF); passive: *Dredge* — reclaim your snare after it triggers | **Corpsejack Menace** — fungal tycoon (+ATK); passive: *Doubling Rot* — mystery-event Spore payouts doubled |

**Tier 3 (level 10) — apex forms.** Each Tier-2 form offers two of the four apexes (overlap is intentional — different roads to the same throne):

| Apex | Offered to | Featured stats | Passive |
|---|---|---|---|
| **Grave Titan** | Brackish Trudge, Kraul Forager, Woodwraith Strangler, Shambling Shell | HP/DEF | *Deathtouch Stomp:* your strikes ignore 3 of the enemy's DEF |
| **Golgari Lich Lord** | Kraul Forager, Slitherhead, Woodwraith Strangler, Corpsejack Menace | ATK/HP | *Drain Life:* heal for 50% of damage you deal |
| **Swamp Dragon** | Brackish Trudge, Stinkweed Imp, Kraul Warrior | ATK/SPD | *Rot Breath:* round-1 strike hits for double |
| **Izoni, Thousand-Eyed** | Stinkweed Imp, Kraul Warrior, Slitherhead, Shambling Shell, Corpsejack Menace | SPD | *Swarm:* one extra strike every battle round |

*(Matrix invariant: every Tier-2 form offers exactly two apexes.)*

*(Names are Golgari-flavored placeholders — real MTG cards where they exist (Brackish Trudge, Stinkweed Imp, Shambling Shell, Slitherhead, Corpsejack Menace, Grave Titan, Izoni) and thematic inventions elsewhere. Swap freely; only archetype/stat identities are load-bearing.)*

### Sprite placeholders

The demo ships with Dino Party sprites standing in (they already carry marker-green paint regions and red-pixel hat anchors):

| Creature line | Placeholder sprite |
|---|---|
| Pest line | raptor |
| Kraul line | pterodactyl (or next-smallest) |
| Saproling line | triceratops |
| Spore line | stego |
| Apexes | godzilla + largest remaining sprites, scaled up |

A `species.ts` manifest maps creature → sprite asset, so real Golgari pixel art is a drop-in replacement later.

---

## 6. The Board: "The Undercity Crawl"

### Topology

A static node-graph map (~**40 spaces**) rendered on a pan/zoom canvas: an outer loop (~26 nodes) with two cross-cutting tunnels (~6 nodes each) and a central island holding the **Boss Lair** (reachable only via warp mushrooms until the boss phase opens a bridge). Defined in `public/data/undercity-map.json` as `{ id, x, y, type, neighbors[] }` — hand-authored once, art-directed later.

All players start at (and respawn to) the **Gate of the Swarm** — the start node adjacent to the Grave Plaza entrance.

### Movement

- Spend 1 roll → server rolls **d6** → move **exactly** that many spaces (Dokapon rule).
- At forks the client shows every legal destination for that count (server-computed, no backtracking mid-move); the player taps one. Usually 1–3 choices.
- Landing on a space fires its event immediately and atomically (server-side).
- Passing over other players does nothing; **landing on a space occupied by another player** offers a battle prompt (optional — you may decline and just resolve the space).

### Space distribution (40 nodes)

| Type | Count | On landing |
|---|---|---|
| **Loot** 🍄 | 8 | Gain 8–15 Spores (weighted low); 10% chance an item drops instead |
| **Wild Encounter** ⚔️ | 8 | Immediate PvE battle vs a scaled NPC (§7) |
| **Mystery** ❓ | 7 | Random event from the table below |
| **Shop** 🏪 | 3 | Open the Rot-Farm Bazaar (§8) — reopenable while you remain on the node |
| **Shrine** 🕯️ | 3 | Pay 15 Spores → choose a blessing: +1 ATK, +1 DEF, +1 SPD (permanent this season), or full heal. Or **tithe** blood for free: lose 25% current HP → +8 XP |
| **Hazard** ☠️ | 5 | Random hazard: Swamp Gas (lose 1d10 Spores), Grasping Vines (your next roll is halved, rounded up), Spore Cloud (lose 15% current HP) |
| **Warp Mushroom** 🌀 | 3 | Teleport to any other warp mushroom (choice), or 20% chance of a *wild* warp to a random node |
| **Gate of the Swarm** (start) | 1 | Safe. Full-heal if you land exactly on it |
| **Boss Lair** | 1 | Sealed until boss phase; landing before then = bounce back 1 space + flavor text |
| **The Ossuary** | 1 | Gamble den: bet up to 20 Spores on a d6 high/low call; win = double |

### Mystery event table (d12, server-rolled)

1. Spore stash — +20 Spores
2. Corpse bloom — +10 XP
3. Lost wardrobe crate — random **paint** drop
4. Hat hermit — random **hat** drop (10% legendary weight)
5. Kindly witch — full heal + cleanse hazard effects
6. Free consumable (random)
7. Rot surge — next battle: +3 ATK (buff icon shown)
8. Pickpocket imp — lose 10 Spores
9. Bad mushrooms — lose 20% current HP
10. Cave-in — teleport to a random node (no event fires there)
11. Cursed idol — −1 ATK for 20 real minutes (choice: pay 15 Spores to skip)
12. **Jackpot bloom** — +30 Spores, +10 XP, and an item

*(Spore's **Drift** passive: outcomes 8–11 reroll once.)*

---

## 7. Battles

All battles resolve **instantly and entirely server-side** in one Lambda call; the client then plays back the returned round-by-round log as a short animated sequence (sprites lunge, damage numbers pop). Nobody ever waits on another human.

### Resolution algorithm

```
order   = by SPD desc (tie: attacker first; First Bite overrides round 1)
rounds  = up to 6
strike  = max(1, round(ATK × rand(0.85–1.15)) − targetDEF_effective)
end     = a side reaches 0 HP, or 6 rounds elapse
timeout = 6 rounds with both alive → attacker retreats; no compost;
          both keep remaining HP; small consolation XP (5/5)
```

Passives (Flyby, Scavenge, Swarm, Drain Life, Rot Breath, Deathtouch Stomp, Venom Barb) hook into obvious points of this loop. Keep the implementation a pure function: `(attackerDoc, defenderDoc, seed) → {log, result}` — trivially testable.

### PvP: stances (the async defense)

Every player has a standing **stance**, settable anytime from the creature sheet:

- **Fight** (default) — battle as normal.
- **Defend** — +40% effective DEF; you deal −25% damage; if composted you lose only 10% Spores instead of 25%.
- **Flee** — before round 1: escape chance = `35% + 5% × (yourSPD − theirSPD)`, clamped 10–90%. Success = no battle, attacker resolves the space normally; failure = fight at −1 DEF (caught off guard).

### Stakes

| Outcome | Winner | Loser |
|---|---|---|
| PvP | +20 XP, steals 25% of loser's carried Spores | **Composted** (below), +8 XP |
| Wild win | +15 XP, +Spore bounty (§ NPC table) | — |
| Wild loss | — | Composted, +5 XP |

### Composting (death)

- Respawn at the Gate of the Swarm at **50% max HP**.
- Keep all gear, items, XP, and level. Lose the Spore stake above.
- Gain a **Compost Shield**: immune to PvP attacks (and your snares can't be triggered against you) for **15 real minutes**. Shield shows as a visible bubble on board and plaza.
- Event log entry, always flavored: *"Alex's Kraul Warrior was composted by Sam's Slitherhead. The swarm remembers."*

### Revenge

When you're composted in PvP, your battle report includes a **Revenge** button (one per defeat, expires when the season ends): your next attack *initiated against that specific player* grants +3 ATK and steals +10% extra Spores. Shown as a grudge icon next to their name.

### Wild NPC table

NPC stats scale off the *player's* level `L`:

| NPC (weighted by player level) | HP | ATK | DEF | SPD | Bounty |
|---|---|---|---|---|---|
| Drudge Beetle (L1–4) | 18+2L | 4+L | 2+⌊L/2⌋ | 4 | 6 Spores |
| Sewer Shambler (L2–6) | 24+3L | 5+L | 3+⌊L/2⌋ | 3 | 10 Spores |
| Fetid Imp (L4–9) | 20+2L | 6+L | 3+⌊L/2⌋ | 7 | 14 Spores + 15% item |
| Rot Shambler (L7–12) | 30+3L | 7+L | 5+⌊L/2⌋ | 4 | 20 Spores + 25% item |

---

## 8. Items & Economy

**Currency: Spores 🟢.** Sources: loot spaces, battle bounties, PvP theft, mystery events, win-claims, the Ossuary. Sinks: shop gear, consumables, shrine blessings, curse cleansing, Ossuary bets. Target: a fully engaged player handles ~150–250 Spores across a night and always has a purchase within reach.

### Equipment — 2 slots

| Slot | Tier 1 (20 Spores) | Tier 2 (45) | Tier 3 (80) |
|---|---|---|---|
| **Fang** (weapon) | Rusted Fang +2 ATK | Kraul Barb +4 ATK | Wurm Tooth +6 ATK, +1 SPD |
| **Carapace** (armor) | Chitin Scrap +2 DEF | Bark Hide +4 DEF | Troll Hide +5 DEF, +6 max HP |

Bought at shops (each shop stocks tiers ≤ its zone's depth) or rarely dropped. Replacing gear auto-sells the old piece for 50%.

### Consumables — 3-slot bag

| Item | Cost | Effect |
|---|---|---|
| **Healing Moss** | 12 | Restore 50% max HP |
| **Smoke Spore** | 15 | Passive while held: your next failed flee auto-succeeds (consumed) |
| **Loaded Die** | 25 | Choose your next roll's value (1–6) instead of rolling |
| **Snare** | 18 | Plant on your current space. Next *other* player to land: 20% of their Spores fly out onto the space (they can grab back half; the rest awaits the next visitor) + skip their space event. Planter is notified with a cackle. One snare per space; visible only as a "disturbed ground" tell (subtle sprite variation — observant players can dodge by pathing) |

### Drop weighting for hats/paints

Cosmetics drop from mystery events, rare loot spaces, Fetid Imp/Rot Shambler bounties, and boss participation. Rarity: common 70% / uncommon 25% / legendary 5%. Duplicates in the permanent wardrobe convert to +10 Spores.

---

## 9. Asynchronous Social Layer

Everything multiplayer works with both parties never online simultaneously:

- **PvP battles** — instant resolution vs stance (§7).
- **Snares** — traps left for whoever comes next (§8).
- **Pokes** — tap a creature in the plaza → owner gets a log entry + their first 3 pokes received each night grant +1 roll. Poking is thus a *gift* — the social loop encourages checking the plaza.
- **Event log** ("The Grapevine") — a reverse-chron public feed of everything: hatches, claims, evolutions, compostings, jackpots, boss hits. This is the game's heartbeat and the thing people read aloud at the table.
- **Grudge icons** — revenge markers visible on the leaderboard, inviting table talk.
- **The board itself** — seeing a cluster of players near the shop, or an apex creature camping a fork, changes your pathing choices.

---

## 10. The Grave Plaza (page)

A direct port of Dino Party's `PlazaCanvas.js` engine to an Angular component:

- Every joined player's creature wanders a 1800×1200 world: waypoint AI, hop-bob animation, dust particles, follow/sniff/startle interactions, level-scaled sprite size, nameplates, hats, and paint — all as-is from the dinos engine.
- **Sync adaptation:** the dinos WebSocket events (`dino_arrive`, `partner_update`, …) are replaced by **poll deltas**. The shared 10-second state poll (§13) diffs the player list against the previous snapshot: new player → drop-in-from-sky animation; changed paint/hat/species → live restyle + boing; departed (season archived) → fade-out. The engine's public methods (`updatePartners`, `dropInDino`, `boingDino`) already support exactly this.
- Ambient state mirrors the game: Compost Shield bubbles, evolution glow for ~60s after evolving, and the boss-phase tremor overlay reused from the dinos buildup effect.
- **Tap a creature** → nameplate enlarges + poke action (§9).

---

## 11. Boss Finale: The Rot Behemoth

The night's collective climax, host-triggered for the final hour:

- The Boss Lair bridge opens; a tremor ripples the plaza; the event log announces it.
- Boss HP = `150 × players joined this season`. HP bar visible on every tab.
- On the lair node, **Attack** costs 1 roll: deal `ATK + d6` (passives apply; Swarm/Rot Breath make apexes shine). The Behemoth counterattacks for `8 − yourDEF/2` (min 2) — you can be composted mid-raid.
- Rewards: every participant +15 Spores and +10 XP when it dies; top damage dealer earns the legendary **Behemoth-Slayer's Mantle** hat (permanent); a defeat banner and full damage table go to the log and the end-of-night ceremony.
- If the night ends with the Behemoth alive, it "burrows away" — participants keep a smaller reward (+5 Spores) and the log taunts everyone.

---

## 12. Scoring & Season End

**Renown** (computed at End Night):

| Source | Points |
|---|---|
| Creature level | 10 × level |
| PvP victories | 15 each |
| Wild victories | 3 each |
| Spores held at end | 1 per 5 |
| Boss damage | 1 per 10 |
| Achievements (see below) | 10 each |

**Night achievements** (each: +10 Renown, log fanfare): *First Blood* (first PvP win of the night), *Apex Predator* (first to reach an apex form), *Untouchable* (5+ PvP wins, never composted), *Deep Pockets* (hold 100 Spores at once), *Cartographer* (land on every space type), *Slayer's Eye* (top boss damage).

End-of-night ceremony screen: champion's creature center-stage in its hat/paint, podium of top 3, full Renown table, achievement callouts. Archived permanently to the **Hall of Fame** (visible between seasons), which lists each night's champion, their creature's final form, and their look.

---

## 13. Technical Architecture

### Frontend

- **Route:** `/undercity`, lazy-loaded (`loadComponent`) standalone feature, nav link added in `navbar.component.html`. Base-href-relative paths throughout (GitHub Pages serves under `/golgari-game-day/`).
- **Layout:** phone-first bottom tab bar within the page: **Board 🗺️ | Creature 🐌 | Plaza 🍄 | Log 📜**. Roll button and roll/Spore counters live in a persistent header strip across tabs.
- **Feature folder** `src/app/undercity/`:
  - `undercity-page.component` — shell, tabs, header, polling lifecycle (poll only while the page is mounted and the document is visible; `visibilitychange`-aware)
  - `board-tab/` — canvas node-map renderer (pan/zoom camera lifted from `PlazaCanvas`), creature tokens on nodes, movement-choice overlay, event-result modals
  - `creature-tab/` — stat sheet, stance selector, stat-point spending, inventory/equipment, evolution flow, wardrobe (paint/hat) editor
  - `plaza-tab/` — ported plaza engine
  - `log-tab/` — Grapevine feed + live leaderboard + claim buttons
  - `services/undercity-api.service.ts` — thin fetch client mirroring `AwsApiService` patterns
  - `services/undercity-state.service.ts` — signal-based store; one poll drives all tabs; optimistic updates on own actions, reconciled by the next poll
  - `engine/sprite-engine.ts`, `engine/plaza-canvas.ts` — TypeScript ports of the dinos `spriteEngine.js` / `PlazaCanvas.js` (hue-shift recolor, region masks, red-pixel hat anchors, wander AI)
- **Assets:** dino sprite PNGs + hat PNGs copied from Dino Party; `public/data/undercity-map.json` for the board graph; species/hats/paints manifests as TS data files.
- **Egg-hatch, evolution, and battle-playback** are client-side animation sequences over server-returned results — pure presentation, no gameplay logic in the client.

### Backend (extends the existing Lambda + table; zero infra changes)

**Endpoints** (added to `lambda_function.py`'s dispatch):

- `GET /game/state?since={ts}` → `{ season, you, players[], spaces[], events[] }` — the single polling endpoint. `since` trims the event list.
- `POST /game/action` → `{ type, payload, userId, seasonId }` — one dispatcher, action types: `join`, `claim`, `roll`, `move`, `battle`, `set-stance`, `spend-stat`, `evolve`, `buy`, `equip`, `use-item`, `plant-snare`, `poke`, `gamble`, `attack-boss`, `customize` (paint/hat), and host actions `season-start`, `season-end`, `boss-awaken` (checked against a host passphrase attribute on the season config).
- All randomness (die rolls, battle variance, event tables, drops) is **server-side**. `roll` stores a `pendingMove {value, legalDestinations}` on the player doc; `move` validates against it — no client-trusted dice.
- Concurrency: single-item writes with `ConditionExpression` guards (e.g. rolls remaining, pendingMove present, HP unchanged since read) — adequate at 15 players.

**DynamoDB items** (existing table `game-day-data`, existing pk/sk pattern):

| pk | sk | Contents |
|---|---|---|
| `UNDERCITY#META` | `CURRENT` | active season id pointer |
| `UNDERCITY#{seasonId}` | `CONFIG` | status, startedAt, hostKeyHash, boss state (hp, damage table) |
| `UNDERCITY#{seasonId}` | `PLAYER#{userId}` | full season player doc: creature (species/tier/stats/hp/xp/level), position, rolls, spores, inventory, equipment, stance, shieldUntil, pendingMove, buffs, revenge list, claim cooldowns |
| `UNDERCITY#{seasonId}` | `SPACE#{nodeId}` | snare state (only written when a snare exists) |
| `UNDERCITY#{seasonId}` | `EVENT#{isoTs}#{shortId}` | log entries (type, actor, target, text, data); capped to most recent ~150 in the state response |
| `UNDERCITY#{seasonId}` | `RESULT` | archived final scoreboard (written at season-end) |
| `UNDERCITYUSER#{userId}` | `META` | permanent: seals, wardrobe (hats[], paints[]), lifetime stats |

`GET /game/state` = one `Query` on `pk = UNDERCITY#{seasonId}` (config + players + spaces + events in a single round trip, sorted by sk) plus a `GetItem` for the caller's permanent doc. At 15 players this is a few KB.

### Polling model

- 10-second interval while `/undercity` is open and the tab is visible; immediate refetch after any own action.
- The state service diffs snapshots to drive plaza arrive/leave/restyle animations and to surface "while you were away" toasts (battle reports, snare triggers, pokes).

---

## 14. Demo Scope (the one-shot build)

**In scope — must work end to end:**

1. Season lifecycle (host start/end via passphrase), egg hatch, starter choice
2. Roll claims with cooldowns/caps; server-side roll → fork choice → move → space resolution for all 10 space types (boss lair as sealed bounce)
3. Full battle engine: wild + PvP, stances, passives, composting, shields, Spore theft
4. Leveling, stat points, both evolution tiers with choice screens
5. Economy: Spores, shops, both equipment slots, all four consumables including snares
6. Plaza port with poll-delta animations, pokes
7. Paint + hat systems on placeholder dino sprites; permanent wardrobe; Guild Seals with +rolls and egg colors
8. Grapevine log, leaderboard, end-of-night ceremony + hall-of-fame archive

**Deferred (designed above, stubbed in demo):**

- Boss finale (§11) — lair stays sealed; host button hidden
- Revenge bonus (§7) — battle reports yes, grudge buff no
- Milestone seal hats (§2) — seals counted, hats granted retroactively later
- Achievements (§12) — Renown from the main table only
- Real Golgari pixel art — dino placeholders via the species manifest

**Out of scope permanently (YAGNI):** real auth, WebSockets, multiple concurrent seasons, spectator mode, push notifications.

---

## 15. Open Risks & Mitigations

- **Honor-system claims get abused →** it's a friend group; claims are public in the log; cooldowns + roll cap bound the damage. If needed later: host approve/revoke buttons.
- **Snowballing (early PvP winner dominates) →** compost shields, cheap deaths, Defend/Flee stances, revenge buffs, and level-scaled wild XP all favor catch-up; PvP theft is % of *carried* Spores so leaders risk more.
- **Polling costs →** 15 players × 6 req/min × 6 hrs ≈ 32k reads/night — comfortably free-tier.
- **Dokapon exact-count movement frustrating on a loop →** fork density (every 3–5 nodes) keeps choices meaningful; Loaded Die exists precisely for the "I need the shop" moment.
- **Two-page split (board vs plaza) makes plaza a ghost town →** pokes grant rolls, so visiting the plaza has mechanical pull.
