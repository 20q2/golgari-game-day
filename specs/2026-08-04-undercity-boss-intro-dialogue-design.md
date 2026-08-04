# Undercity — Boss Intro Dialogue

**Date:** 2026-08-04
**Status:** Design approved, ready for implementation plan

## Problem

Landing on a boss lair currently drops the player straight into the stance
battle with no beat of setup. Bosses are the emotional peaks of a run; they
deserve a moment where the creature you're about to fight *addresses you* before
swords are drawn. When you return to fight a boss's reformed **Vestige** (a
biome-lair boss you already slew, reforged at half strength), it should
acknowledge that history — it remembers dying to you.

## Scope

Boss intro dialogue is shown for:

- **The five biome-lair bosses** (the Guild-Sigil guardians). Each gets an
  `intro` line (first / true-boss fight) **and** a `vestige` line (the re-fight
  after it's been slain once):
  - `ishkanah` — Ishkanah, Grafwidow
  - `sarulf` — Sarulf, Realm Eater
  - `gitrog_monster` — The Gitrog Monster
  - `skullbriar` — Skullbriar, the Walking Grave
  - `slimefoot` — Slimefoot, the Stowaway
- **Savra** (`rot_sovereign`, "Savra, Queen of the Golgari") — the one-time
  finale. `intro` only; Savra has no Vestige re-fight.

**Out of scope** (deliberately excluded):

- **Lord of Extinction (`lair_titan`) and Doomgape (`n288`)** — these are the
  two `RESPAWN_LAIRS`: powerful roaming monsters that spawn in a monster layer
  and run a per-player respawn cycle. They are *not* narrative bosses and leave
  no Vestige, so they get no dialogue.
- **The Moor-Wyrm** (world-event raid boss) and **elite** enemies.

## Approach

Dialogue is **purely cosmetic and client-side** — it never affects rules,
rewards, or combat resolution. It is therefore authored entirely in the Angular
client with **no Lambda change and no backend deploy**. This mirrors how the
client already derives display-only concepts (e.g. `isVestigeFoe`) from the data
the server already sends.

Rejected alternatives:

- *Server-authored dialogue* (attach the line to the `battle_start` event):
  requires editing the Python engine and deploying for pure flavor text, and
  duplicates data we'd mirror client-side anyway.
- *Fold the line into the existing battle card's first frame*: cramped, and
  doesn't read as a distinct "the boss addresses you" beat.

## How boss fights reach the client (context)

Both lair bosses and Savra use the **interactive stance battle**:

- Server: `_start_battle(... kind='lair'|'boss' ...)` returns a
  `{'type': 'battle_start', 'kind', 'npc': {name, id, spriteId, ...}}` space
  event (`infrastructure/lambda/undercity_db.py:830`).
- Client: `routeSpaceEvent` (`src/app/undercity/tabs/board-tab.component.ts:2270`)
  sees `ev.type === 'battle_start'` and calls `openLiveBattle(ev, preHp)`, which
  sets the `liveBattle` signal that renders `<app-undercity-interactive-battle>`.

Key facts that shape the design:

- On a **Vestige** re-fight the npc `id` is unchanged (e.g. `ishkanah`); only
  `npc.name` gets the `"Vestige of …"` prefix (`undercity_db.py:4344`). So we key
  dialogue by `npc.id` and pick the `vestige` variant via the existing
  `isVestigeFoe(npc.name)` helper.
- There is a separate **reload/resume path** (`resumeLiveBattle`, fed by the
  `pendingBattle` effect) that reopens an in-progress boss fight after a page
  reload. Dialogue must **not** replay here — the player already saw it and the
  fight is mid-flight.
- A pre-resolved `battleView` playback branch also exists for `lair`/`boss`
  types. In current flow bosses take the interactive path, but the interception
  point below is chosen so it covers a boss/lair encounter regardless of which
  opener runs, and so it never fires on resume.

## Design

### 1. Dialogue data — `src/app/undercity/data/boss-dialogue.ts`

A plain client-side record keyed by boss npc id:

```ts
export interface BossDialogue {
  /** Shown on the first / true-boss encounter. */
  intro: string[];
  /** Shown when fighting the reformed Vestige. Omit for bosses with no Vestige (Savra). */
  vestige?: string[];
}

export const BOSS_DIALOGUE: Record<string, BossDialogue> = { ... };

/** Returns the lines to speak, or null if this foe has no dialogue.
 *  `vestige` should be the result of isVestigeFoe(npc.name). */
export function bossLines(npcId: string, vestige: boolean): string[] | null;
```

- Lines are arrays so a boss can speak in one or two short beats; the card
  renders them stacked.
- `bossLines` returns `null` when the id isn't a dialogue boss (the common case:
  wild/elite/barrier/respawn-lair foes), which the caller uses to skip the
  interstitial entirely.
- A Vestige request for a boss with no `vestige` array falls back to `null`
  (won't happen for the five biome bosses, which all define both).

**Proposed lines** (short, in each boss's voice — final wording tunable during
implementation, no emojis per project convention; stage directions like
*(a wet croak)* are allowed as plain italic text):

- **Ishkanah, Grafwidow**
  - intro: "Little morsel, you have wandered into my web. My daughters are so hungry — and you look *delicious*."
  - vestige: "You cut me down once, little morsel. But a web has a thousand threads, and I still remember your taste."
- **Sarulf, Realm Eater**
  - intro: "I have swallowed whole realms, whelp. What is one more scrap of meat to the maw of the end?"
  - vestige: "You laid me low, and still I gnaw at the edge of things. Dying only left me hungrier for you."
- **The Gitrog Monster**
  - intro: "*A wet, rumbling croak.* The bog takes all things, small one. Sink. Sink down into the muck with the rest."
  - vestige: "You dredged me up from the dark once. The mire always coughs me back — and it never forgives a debt."
- **Skullbriar, the Walking Grave**
  - intro: "Every step I take, I grow. Every grave I pass, I feed. Hold still — you will make fine soil."
  - vestige: "You buried me. Foolish. A grave is where I grow *strongest* — see how much larger I have become."
- **Slimefoot, the Stowaway**
  - intro: "We are many. We are patient. We will bloom from the husk you leave behind."
  - vestige: "You scattered us before, little host. But spores drift, and spores return. We have been *waiting*."
- **Savra, Queen of the Golgari** (intro only)
  - intro: "So — a subject climbs to my throne uninvited. Kneel, or be composted with the rest of my garden."

### 2. Interception in `routeSpaceEvent`

At the top of `routeSpaceEvent(ev, preHp)`, before the existing dispatch:

1. Detect a fresh boss/lair encounter: `ev.npc` present, the encounter is a
   boss/lair fight (`ev.type === 'battle_start'` with `ev.kind` of `'lair'`/
   `'boss'`, or `ev.type` of `'lair'`/`'boss'`), and
   `bossLines(ev.npc.id, isVestigeFoe(ev.npc.name))` returns non-null.
2. If so: stash the pending `{ ev, preHp }`, set a `bossIntro` signal with the
   presentation payload, and `return` (defer the real dispatch).
3. When the player taps **Fight**, clear `bossIntro` and re-run the normal
   dispatch on the stashed event — i.e. call the same path
   `routeSpaceEvent`/`openLiveBattle` would have taken. Implementation detail for
   the plan: either re-invoke a small "dispatch now" helper extracted from
   `routeSpaceEvent`, or call `openLiveBattle`/`battleView.set` directly for the
   stashed event. The intro logic guards against re-interception (it only fires
   when `bossIntro` is null).

The `resumeLiveBattle` path is **not** touched, so a reload never replays the
dialogue.

`bossIntro` signal payload:

```ts
interface BossIntroView {
  name: string;        // ev.npc.name (may be "Vestige of …")
  spriteUrl: string;   // this.npcSpriteUrl(kind, ev.npc.id)
  lines: string[];     // from bossLines(...)
  vestige: boolean;
}
```

### 3. UI — `BossIntroComponent`

A new standalone component (`src/app/undercity/tabs/boss-intro.component.ts`),
rendered in `board-tab.component.html` alongside the existing battle overlays:

```html
@if (bossIntro(); as bi) {
  <app-undercity-boss-intro
    [name]="bi.name"
    [spriteUrl]="bi.spriteUrl"
    [lines]="bi.lines"
    [vestige]="bi.vestige"
    (begin)="beginBossBattle()"
  />
}
```

- **Layout:** dimmed full-screen scrim, boss portrait (the sprite, sized like the
  battle card's foe art), the boss name as a heading, the speech line(s) stacked
  as quoted dialogue, and a single prominent **Fight** button.
- **Voices:** boss only — the player creature does not reply.
- **Interaction:** tap-to-begin — the fight starts only when the player presses
  **Fight** (no auto-advance, no skip-to-nothing; the button *is* the advance).
- **Styling:** reuse existing card / scrim / button tokens from
  `STYLE_GUIDE.md` and neighboring overlays; the Golgari palette. A subtle
  visual tell can distinguish a Vestige (e.g. a desaturated / spectral portrait
  treatment) since `vestige` is passed in, but this is optional polish, not
  required for the feature.
- Self-contained: inputs + one `begin` output, no store access.

## Data flow

```
land on boss tile
  -> server: _start_battle -> {type: battle_start, kind: lair|boss, npc:{id,name,...}}
  -> client routeSpaceEvent:
       bossLines(npc.id, isVestigeFoe(npc.name)) != null ?
          yes -> stash {ev, preHp}; bossIntro.set({name, spriteUrl, lines, vestige})   [defer]
          no  -> existing dispatch (unchanged)
  -> BossIntroComponent renders; player reads; taps Fight
  -> beginBossBattle(): bossIntro.set(null); dispatch stashed ev -> openLiveBattle(ev, preHp)
  -> interactive stance battle as today

reload mid-fight -> resumeLiveBattle (unchanged, NO dialogue)
```

## What this does NOT change

- No server / Lambda / DynamoDB changes; no deploy required.
- No change to combat resolution, rewards, telegraphs, or the interactive battle
  component itself.
- No change to wild/elite/barrier/world/respawn-lair encounters.
- No new persistence — the dialogue is stateless; "have I seen this before" is
  already encoded in whether the foe is a Vestige.

## Testing

No test runner is wired up for the frontend (per CLAUDE.md). Verification is:

- `npm run build` succeeds (the project's stand-in for lint, which is broken).
- Manual verification via the `run-undercity` skill: reach a biome-lair boss and
  confirm the intro card appears then the fight starts on **Fight**; slay it,
  return, and confirm the **Vestige** variant line shows; confirm a page reload
  mid-fight does **not** replay the dialogue; confirm wild/elite encounters are
  unaffected.

## Files touched

- **New:** `src/app/undercity/data/boss-dialogue.ts` (data + `bossLines`).
- **New:** `src/app/undercity/tabs/boss-intro.component.ts` (+ scss if separated).
- **Edit:** `src/app/undercity/tabs/board-tab.component.ts` — `bossIntro` signal,
  pending-event stash, interception in `routeSpaceEvent`, `beginBossBattle()`.
- **Edit:** `src/app/undercity/tabs/board-tab.component.html` — render the
  `<app-undercity-boss-intro>` overlay.
