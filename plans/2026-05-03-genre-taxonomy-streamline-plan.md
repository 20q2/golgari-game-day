# Genre Taxonomy Streamline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 27-tag genre list with the 11-tag taxonomy from [`plans/2026-05-03-genre-taxonomy-streamline-spec.md`](2026-05-03-genre-taxonomy-streamline-spec.md), retag every game in `public/data/games.json` to use the new tags, and trim the icon/color map to match.

**Architecture:** Three coordinated edits in this order: (1) re-tag the 56 games in `games.json` so data uses only the new strings, (2) trim the `GameGenre` enum to 11 members, (3) trim the icon/color map to match the new enum. No runtime cascade exists — the spec mentioned `stringToGameGenres()` but the actual code (`GamesService.loadGamesFromJson`) loads JSON strings directly into `Game.genres`, so no string-mapping logic needs to change. This means the order is "data first, then code" — JSON tolerates the old enum until step 2.

**Tech Stack:** Angular 20 (standalone components), TypeScript strict mode, no test runner (Karma was removed; verification uses `npm run lint` + `npm run build` + manual smoke test). Material icons for chip glyphs.

---

## File map

| File | Change |
|---|---|
| `public/data/games.json` | Rewrite each of 56 entries' `genres` array to use only the 11 new tag strings. |
| `src/app/models/game.model.ts` | Trim `GameGenre` enum from 28 members down to 11. Add `SOCIAL`, rename `DECK_BUILDING`→`DECK_BUILDER`, rename `ENGINE_BUILDING`→`ENGINE_BUILDER`. |
| `src/app/services/genre-icon.service.ts` | Trim `genreIcons` and `genreColors` records to the 11 new enum keys; pick icon for new `SOCIAL`. |
| `.claude/skills/add-board-game/SKILL.md` | Replace the 28-row Genre Values table with the new 11-row table; update example arrays in description and "Use multiple values" line. Otherwise the skill will keep recommending dropped tags when adding new games. |

`src/app/services/games.service.ts` is **not** touched — `loadGamesFromJson` already loads strings as-is and just dedupes via `new Set(...)`.

---

## Task 1: Re-tag `public/data/games.json`

Edit each game's `genres` array. The file loads as JSON; nothing else in the file changes — only the `"genres": [...]` line per entry.

**Files:**
- Modify: `public/data/games.json` (every game entry)

**Per-game new tags** (id → new `genres` array). This is the source of truth for the rewrite. Apply each one verbatim.

| id | title | new genres |
|----|-------|------------|
| 1  | Wingspan | `["Strategy", "Engine Builder"]` |
| 4  | Splendor | `["Strategy"]` |
| 5  | Codenames | `["Party"]` |
| 7  | Ticket to Ride: Europe | `["Family"]` |
| 8  | Gloomhaven | `["Adventure", "Cooperative", "Strategy"]` |
| 9  | Frosthaven | `["Adventure", "Cooperative", "Strategy"]` |
| 10 | Draconis Invasion | `["Adventure", "Cooperative", "Deck Builder"]` |
| 11 | Valor & Villainy: Minions of Mordak | `["Adventure", "Asymmetric"]` |
| 12 | Primal: The Awakening | `["Adventure", "Cooperative"]` |
| 13 | CubeClimbers | `["Strategy"]` |
| 14 | City of the Great Machine | `["Adventure", "Asymmetric", "Cooperative"]` |
| 15 | Drinking Quest: Six Pack | `["Party", "Adventure", "Drinking"]` |
| 16 | Binding of Isaac: Four Souls | `["Adventure"]` |
| 17 | Doomlings | `["Family", "Card Drafting"]` |
| 18 | Stardew Valley: The Board Game | `["Family", "Cooperative"]` |
| 19 | Betrayal at House on the Hill | `["Adventure", "Social"]` |
| 20 | Calico | `["Family"]` |
| 21 | Flourish | `["Strategy", "Family", "Card Drafting"]` |
| 22 | Beast | `["Adventure", "Asymmetric"]` |
| 23 | EOS: Island of Angels | `["Strategy", "Asymmetric", "Engine Builder"]` |
| 24 | Party Wanted | `["Party", "Adventure", "Drinking", "Cooperative", "Deck Builder"]` |
| 25 | Enchanters: East Quest | `["Adventure", "Card Drafting"]` |
| 27 | Unstable Unicorns | `["Party"]` |
| 28 | Munchkin | `["Party", "Adventure"]` |
| 29 | Wyrmspan | `["Strategy", "Engine Builder"]` |
| 30 | Catharsis | `["Adventure", "Cooperative"]` |
| 31 | Overboss: A Boss Monster Adventure | `["Family", "Card Drafting"]` |
| 32 | Small World of Warcraft | `["Strategy", "Asymmetric"]` |
| 33 | Megaland | `["Family"]` |
| 34 | Catacombs (Third Edition) | `["Adventure"]` |
| 35 | Return to Dark Tower | `["Adventure", "Cooperative"]` |
| 36 | Poison | `["Party"]` |
| 37 | Dragonwood | `["Family", "Adventure"]` |
| 38 | Captain's Gambit: Kings of Infinite Space | `["Social", "Asymmetric"]` |
| 39 | Not Enough Mana | `["Drinking"]` |
| 40 | Here to Slay | `["Strategy", "Adventure"]` |
| 41 | Exiled Legends | `["Strategy", "Adventure"]` |
| 42 | Heroes of Barcadia | `["Party", "Adventure", "Drinking"]` |
| 43 | Dice Forge | `["Strategy"]` |
| 44 | Clank! Adventuring Party | `["Adventure", "Deck Builder"]` |
| 45 | Monster Hunter: World - The Board Game | `["Adventure", "Cooperative"]` |
| 46 | Lunar Base | `["Strategy", "Engine Builder", "Card Drafting"]` |
| 47 | Pantheum: Demigods of Olympia | `["Strategy", "Asymmetric", "Engine Builder"]` |
| 48 | Eldritch Horror | `["Adventure", "Cooperative"]` |
| 49 | Sheriff of Nottingham | `["Strategy", "Party", "Social"]` |
| 50 | 7 Wonders | `["Strategy", "Card Drafting"]` |
| 51 | Tellstones: King's Gambit | `["Strategy", "Social"]` |
| 53 | The Werewolves of Miller's Hollow | `["Party", "Social"]` |
| 54 | Cards vs Gravity | `["Party", "Drinking"]` |
| 55 | BANG! | `["Social"]` |
| 56 | Roll Player | `["Strategy", "Adventure"]` |
| 57 | Terraria: The Board Game | `["Adventure", "Cooperative", "Deck Builder"]` |
| 58 | Valheim: The Board Game | `["Adventure", "Cooperative"]` |
| 59 | Shuffle Dungeons | `["Adventure", "Cooperative"]` |
| 60 | One Last Fight | `["Adventure", "Cooperative"]` |
| 61 | Slay the Spire: The Board Game | `["Adventure", "Cooperative", "Deck Builder"]` |

**Hand-tuning notes** (judgment beyond the strict spec mapping table):
- Added `Cooperative` to entries whose descriptions explicitly say co-op but whose old tags missed it: Gloomhaven (8), Frosthaven (9), Draconis Invasion (10), City of the Great Machine (14).
- Added `Strategy` to Gloomhaven/Frosthaven (8, 9) — descriptions describe "tactical combat" which earns a Strategy tag alongside Adventure.
- Removed the auto-added `Adventure` from games whose theme is not adventure/dungeon/campaign even though the old tag list had `Thematic`: Not Enough Mana (39), Dice Forge (43), BANG! (55), Small World of Warcraft (32). For Small World, replaced with `Strategy` since the dropped Area Control mechanic was the gameplay anchor.
- Added `Social` to Betrayal at House on the Hill (19) — its hidden traitor mechanic is core. The old tags didn't reflect it.

- [ ] **Step 1.1: Open `public/data/games.json` and rewrite the `genres` array for every game per the table above**

For each game entry, replace the existing `"genres": [...]` line with the new array from the table. All 56 entries get touched. Nothing else in the entry changes.

- [ ] **Step 1.2: Validate the JSON parses**

Run: `node -e "console.log(require('./public/data/games.json').length)"`

Expected output: `56`

If output differs or the command throws, you introduced a syntax error. Fix it.

- [ ] **Step 1.3: Verify only the 11 new tag strings appear**

Run:
```bash
node -e "
const g = require('./public/data/games.json');
const allowed = new Set(['Strategy','Family','Party','Adventure','Drinking','Cooperative','Social','Asymmetric','Deck Builder','Engine Builder','Card Drafting']);
const bad = new Set();
for (const game of g) {
  for (const t of game.genres) if (!allowed.has(t)) bad.add(t);
  if (game.genres.length === 0) console.error('Empty genres:', game.id, game.title);
}
console.log(bad.size === 0 ? 'OK' : 'Unknown tags: ' + [...bad].join(', '));
"
```

Expected output: `OK` (and no "Empty genres" lines).

If any unknown tag appears, find and fix the offending entry.

- [ ] **Step 1.4: Commit the data change**

```bash
git add public/data/games.json
git commit -m "$(cat <<'EOF'
data(games): retag all 56 games with the streamlined 11-tag taxonomy

Drops 17 long-tail/format/component tags (Card Game, Abstract,
Area Control, Dexterity, Memory, Push Your Luck, Route Building,
Set Collection, Thematic, Euro, RPG, Legacy, Miniatures, Horror,
Social Deduction, Bluffing, Negotiation) and consolidates the
catalog onto: Strategy, Family, Party, Adventure, Drinking,
Cooperative, Social, Asymmetric, Deck Builder, Engine Builder,
Card Drafting.
EOF
)"
```

> **Note:** At this point the running app would crash on first load because `Game.genres` is typed `GameGenre[]` and `"Deck Builder"`/`"Engine Builder"`/`"Social"` aren't enum members yet. That's resolved in Task 2. Do not run `npm start` between Task 1 and Task 2.

---

## Task 2: Trim `GameGenre` enum

**Files:**
- Modify: `src/app/models/game.model.ts:22-51`

- [ ] **Step 2.1: Replace the `GameGenre` enum**

Open `src/app/models/game.model.ts` and replace lines 22–51 (the existing 28-member `GameGenre` enum) with:

```typescript
export enum GameGenre {
  STRATEGY = 'Strategy',
  FAMILY = 'Family',
  PARTY = 'Party',
  ADVENTURE = 'Adventure',
  DRINKING = 'Drinking',
  COOPERATIVE = 'Cooperative',
  SOCIAL = 'Social',
  ASYMMETRIC = 'Asymmetric',
  DECK_BUILDER = 'Deck Builder',
  ENGINE_BUILDER = 'Engine Builder',
  CARD_DRAFTING = 'Card Drafting'
}
```

The rest of `model.ts` (other interfaces, `GameDuration`, `SortOrder`, `GameJson`) stays untouched.

- [ ] **Step 2.2: Try the build — it WILL fail**

Run: `npm run build`

Expected: TypeScript errors in `src/app/services/genre-icon.service.ts` complaining about properties like `STRATEGY`, `PARTY`, etc. existing but `CARD_GAME`, `EURO`, `THEMATIC`, `ABSTRACT`, `WAR_GAME`, `DEXTERITY`, `SOCIAL_DEDUCTION`, `BLUFFING`, `MEMORY`, `HORROR`, `AREA_CONTROL`, `RPG`, `MINIATURES`, `LEGACY`, `NEGOTIATION`, `ROUTE_BUILDING`, `SET_COLLECTION`, `PUSH_YOUR_LUCK`, `DECK_BUILDING`, `ENGINE_BUILDING` not on `typeof GameGenre`.

That failure is the cue to do Task 3.

---

## Task 3: Trim `GenreIconService` to match the new enum

**Files:**
- Modify: `src/app/services/genre-icon.service.ts:13-73`

- [ ] **Step 3.1: Replace the icon map and color map**

Open `src/app/services/genre-icon.service.ts`. Replace the `genreIcons` map (lines 13–42) and `genreColors` map (lines 44–73) with:

```typescript
  readonly genreIcons: Readonly<Record<GameGenre, string>> = {
    [GameGenre.STRATEGY]: 'psychology',
    [GameGenre.FAMILY]: 'family_restroom',
    [GameGenre.PARTY]: 'celebration',
    [GameGenre.ADVENTURE]: 'explore',
    [GameGenre.DRINKING]: 'local_bar',
    [GameGenre.COOPERATIVE]: 'groups',
    [GameGenre.SOCIAL]: 'theater_comedy',
    [GameGenre.ASYMMETRIC]: 'balance',
    [GameGenre.DECK_BUILDER]: 'layers',
    [GameGenre.ENGINE_BUILDER]: 'settings',
    [GameGenre.CARD_DRAFTING]: 'view_carousel',
  };

  readonly genreColors: Readonly<Record<GameGenre, GenreColor>> = {
    [GameGenre.STRATEGY]: 'primary',
    [GameGenre.FAMILY]: undefined,
    [GameGenre.PARTY]: 'accent',
    [GameGenre.ADVENTURE]: 'warn',
    [GameGenre.DRINKING]: 'accent',
    [GameGenre.COOPERATIVE]: 'primary',
    [GameGenre.SOCIAL]: 'warn',
    [GameGenre.ASYMMETRIC]: 'primary',
    [GameGenre.DECK_BUILDER]: 'accent',
    [GameGenre.ENGINE_BUILDER]: 'primary',
    [GameGenre.CARD_DRAFTING]: 'accent',
  };
```

The rest of the file (imports, `GenreColor` type, class declaration, `iconFor`, `colorFor`) is unchanged.

- [ ] **Step 3.2: Build — should now pass**

Run: `npm run build`

Expected: clean build. Same pre-existing warnings as before this work (unused `aws-test`, `statistics`, qrcode CommonJS, unused `GamesHeroComponent` in `games.component.ts`) — none of those are new.

If the build still fails, the error message will tell you which enum reference still uses an old member. Fix it.

- [ ] **Step 3.3: Lint**

Run: `npm run lint`

Expected: clean (or same pre-existing warnings).

- [ ] **Step 3.4: Commit the code change**

```bash
git add src/app/models/game.model.ts src/app/services/genre-icon.service.ts
git commit -m "$(cat <<'EOF'
feat(games): trim GameGenre enum to streamlined 11-tag taxonomy

Aligns the enum and icon/color maps with the new tag set used in
games.json: Strategy, Family, Party, Adventure, Drinking, Cooperative,
Social, Asymmetric, Deck Builder, Engine Builder, Card Drafting.
SOCIAL is new (consolidates Social Deduction / Bluffing / Negotiation);
DECK_BUILDING and ENGINE_BUILDING are renamed to DECK_BUILDER /
ENGINE_BUILDER (string values change too: "Deck Builder", "Engine Builder").
EOF
)"
```

---

## Task 4: Update the `add-board-game` skill docs

**Files:**
- Modify: `.claude/skills/add-board-game/SKILL.md` (lines 25, 49–84, 89)

- [ ] **Step 4.1: Replace the example `genres` array in the description**

In `.claude/skills/add-board-game/SKILL.md`, find line 25:

```json
  "genres": ["Cooperative", "Adventure", "Thematic"],
```

Replace with:

```json
  "genres": ["Cooperative", "Adventure"],
```

- [ ] **Step 4.2: Replace the Genre Values table**

Replace the entire "Genre Values (Critical)" section (lines 49–84) with:

```markdown
## Genre Values (Critical)

The `genres` field is a typed array — each entry must be one of the exact strings below. These are the values of the `GameGenre` enum in [src/app/models/game.model.ts](../../../src/app/models/game.model.ts). Anything else won't render correctly.

The list is intentionally short (11 tags). It's organised as **vibe → style → mechanic** — pick the one or two from each tier that genuinely apply, not every tier.

| Value | Tier | Use for |
|-------|------|---------|
| `Strategy` | vibe | Heavy thinky games, long planning horizon |
| `Family` | vibe | Light, accessible, all-ages |
| `Party` | vibe | Large group, fast, social, loud |
| `Adventure` | vibe | Dungeon crawl, story/campaign, RPG, monster-hunting, exploration |
| `Drinking` | vibe | Drinking-mechanic games (adult silly) |
| `Cooperative` | style | Players win or lose together |
| `Social` | style | Bluffing / hidden role / deduction / negotiation as a core mechanic |
| `Asymmetric` | style | Players have different abilities, roles, or win conditions |
| `Deck Builder` | mechanic | Build a deck during play (Clank!, Slay the Spire) |
| `Engine Builder` | mechanic | Build a scoring engine over time (Wingspan, Wyrmspan) |
| `Card Drafting` | mechanic | Drafting cards from a shared pool (7 Wonders, Sushi Go) |

**Use multiple values.** Most games warrant 2–3 tags spread across tiers. A drinking party deck-builder is `["Party", "Drinking", "Deck Builder"]`. A co-op fantasy dungeon crawler is `["Adventure", "Cooperative"]`. A tactical campaign with unique party roles is `["Adventure", "Cooperative", "Asymmetric"]`.

**Don't force a tag if nothing fits.** A pure mechanics-driven Euro that isn't an engine builder can just be `["Strategy"]`. The catalog used to over-tag with `Thematic` and `Card Game` and the tags became meaningless — keep it lean.
```

- [ ] **Step 4.3: Update the "Common Mistakes" entry that lists old tags**

Find line 89:

```markdown
- **Using a value not in the table.** There's no `Fantasy`, `Survival`, `Western`, or `Dungeon Crawl` genre — map to `Thematic`, `Adventure`, etc. as appropriate.
```

Replace with:

```markdown
- **Using a value not in the table.** There's no `Fantasy`, `Survival`, `Western`, `Thematic`, `Card Game`, `Euro`, `RPG`, or `Dungeon Crawl` genre. Map to the closest tag in the table — Western/Steampunk theme on a hidden-role game is `Social`; a Fantasy dungeon crawl is `Adventure`; a Euro engine game is `Strategy` + `Engine Builder` if it has an engine, just `Strategy` otherwise.
```

- [ ] **Step 4.4: Commit the skill doc update**

```bash
git add .claude/skills/add-board-game/SKILL.md
git commit -m "$(cat <<'EOF'
docs(add-board-game): update SKILL.md to the 11-tag taxonomy

Mirrors the trimmed GameGenre enum so future runs of this skill
recommend the new tags (Strategy/Family/Party/Adventure/Drinking,
Cooperative/Social/Asymmetric, Deck Builder/Engine Builder/Card
Drafting) instead of the deprecated 28-tag list.
EOF
)"
```

---

## Task 5: Smoke test the running app

No code changes — just verification. Don't commit anything from this task.

- [ ] **Step 5.1: Start the dev server**

Run: `npm start`

Wait for it to print `Local: http://localhost:4200/`.

- [ ] **Step 5.2: Open the games page and verify the genre strip**

Open `http://localhost:4200/golgari-game-day/games` (or whatever route the dev server exposes — `/games` if base href is dropped in dev).

Check:
- The genre strip at the top shows fewer chips than before — should be at most 6 visible plus a "+N more" link (the surface count is `SURFACE_GENRE_COUNT = 6` from `games.component.ts`).
- Tapping each visible chip filters and the result count changes.
- "+N more" opens the filter sheet, which shows all 11 chips in the Genres section — and only those 11. No `Memory`, `Set Collection`, `Card Game`, etc.

- [ ] **Step 5.3: Spot-check three games' chips**

In the games list, find these three and confirm their displayed chips:
- **Wingspan** → Strategy, Engine Builder
- **Codenames** → Party (alone)
- **Slay the Spire** → Adventure, Cooperative, Deck Builder

- [ ] **Step 5.4: Confirm icons render**

In the filter sheet's Genres grid, every chip has its Material icon. Specifically the new `Social` chip should show the theater mask (`theater_comedy`) and `Deck Builder` / `Engine Builder` should show the same icons as before (`layers`, `settings`).

If any chip shows the fallback `category` icon, the icon map missed an entry — back to Task 3.

- [ ] **Step 5.5: Stop the dev server**

`Ctrl+C` in the terminal running `npm start`.

---

## Acceptance

- `public/data/games.json` validates and contains only the 11 new tag strings.
- `GameGenre` enum has exactly 11 members.
- `npm run build` passes (no new warnings).
- `npm run lint` passes (no new warnings).
- The filter sheet's Genres grid shows exactly 11 chips, all with icons.
- Every game card displays at least one chip and at most five.
- No commits along the way mention "WIP" or skip hooks.
