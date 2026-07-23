# Spectator Persistent Lobby Card — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pin a compact lobby card to the top-right of the `/tv` spectator broadcast that always shows queued games awaiting players.

**Architecture:** Presentation-layer-only change to the existing `SpectatorComponent`. Reuses the already-present `lobbyGames()`, `rosterNames()`, and `showRail()` helpers plus the polling `queue.entries()` signal. Adds one guard method, one template block, and matching SCSS. No director/engine/map/backend changes.

**Tech Stack:** Angular 20 standalone component, SCSS with the broadcast's existing design tokens (`$gold`, glass panels).

**Verification note:** No frontend test runner exists in this repo (`ng test` is not wired up). Verification is via `npm run build:prod` (must compile) plus driving `/tv` in a browser using the `run-undercity` skill to confirm the card appears, hides on hotspot/boss scenes, and hides when no lobby games exist.

---

### Task 1: Add the visibility guard method

**Files:**
- Modify: `src/app/undercity/spectator/spectator.component.ts` (add near the existing `showRail()` at lines ~323-336)

- [ ] **Step 1: Add `showLobbyPin()` below `showRail()`**

Insert immediately after the `showRail()` method (currently ends ~line 326):

```typescript
  /** True when the persistent lobby pin should occupy the top-right corner.
   *  Yields to the renown rail on hotspot/boss scenes (same anchor), and
   *  hides entirely when nothing is gathering players. */
  protected showLobbyPin(): boolean {
    return this.lobbyGames().length > 0 && !this.showRail();
  }
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build:prod`
Expected: build succeeds (no TS errors). `lobbyGames()` and `showRail()` already exist on the component.

- [ ] **Step 3: Commit**

```bash
git add src/app/undercity/spectator/spectator.component.ts
git commit -m "feat(spectator): add lobby-pin visibility guard"
```

---

### Task 2: Add the lobby-pin template block

**Files:**
- Modify: `src/app/undercity/spectator/spectator.component.html` (add after the `.rail` block, which ends ~line 53)

- [ ] **Step 1: Insert the `.lobby-pin` block after the `.rail` block**

Place directly after the closing `</div>` of the `<!-- Compact renown rail ... -->` block (line 53):

```html
  <!-- Persistent lobby pin — top-right, always visible except when the rail owns
       that corner (hotspot/boss scenes) or nothing is gathering players -->
  <div class="lobby-pin" *ngIf="showLobbyPin()">
    <div class="lobby-head">
      <span class="dot"></span> Waiting for Players
    </div>
    <div class="lobby-row" *ngFor="let e of lobbyGames()">
      <div class="lobby-title">{{ e.gameTitle }}</div>
      <div class="lobby-players">
        <span class="q-count">{{ e.joined.length }} in</span>
        <span class="q-names">{{ rosterNames(e) }}</span>
      </div>
    </div>
  </div>
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build:prod`
Expected: build succeeds. `showLobbyPin()`, `lobbyGames()`, and `rosterNames()` all resolve.

- [ ] **Step 3: Commit**

```bash
git add src/app/undercity/spectator/spectator.component.html
git commit -m "feat(spectator): render persistent lobby pin"
```

---

### Task 3: Style the lobby pin

**Files:**
- Modify: `src/app/undercity/spectator/spectator.component.scss` (add after the `.rail` block, which ends ~line 320; reuse `$gold` and the `.q-*` vocabulary already defined for `.queue-card`)

- [ ] **Step 1: Add `.lobby-pin` styles**

Add after the `.rail { ... }` block. Match the glass-panel look of `.rail`/`.queue-card` (semi-transparent dark fill, blur, subtle border, gold accents). Anchor at the same corner the rail uses:

```scss
.lobby-pin {
  position: absolute;
  top: 24px;
  right: 24px;
  z-index: 6;
  width: 300px;
  max-width: 32vw;
  padding: 14px 16px;
  border-radius: 14px;
  background: $panel;
  backdrop-filter: blur(8px);
  border: 1px solid $panel-line;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
  color: $ink;

  .lobby-head {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.82rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: $gold;
    padding-bottom: 10px;
    margin-bottom: 4px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);

    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: $gold;
      box-shadow: 0 0 8px $gold;
    }
  }

  .lobby-row {
    padding: 8px 0;
    border-top: 1px solid rgba(255, 255, 255, 0.06);

    &:first-of-type {
      border-top: none;
    }

    .lobby-title {
      font-size: 0.98rem;
      font-weight: 600;
      line-height: 1.2;
    }

    .lobby-players {
      display: flex;
      align-items: baseline;
      gap: 8px;
      margin-top: 3px;
      font-size: 0.8rem;
      color: rgba(255, 255, 255, 0.72);

      .q-count {
        flex: 0 0 auto;
        font-weight: 700;
        color: $gold;
      }

      .q-names {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    }
  }
}
```

Note: `$gold`, `$panel`, `$panel-line`, and `$ink` are all defined at the top of this SCSS file (lines 5-9) and already used by `.rail`/`.queue-card` — they are in scope.

- [ ] **Step 2: Verify it compiles**

Run: `npm run build:prod`
Expected: build succeeds (SCSS compiles, no unknown-variable errors).

- [ ] **Step 3: Commit**

```bash
git add src/app/undercity/spectator/spectator.component.scss
git commit -m "style(spectator): lobby pin glass panel"
```

---

### Task 4: Verify in the live broadcast

**Files:** none (verification only)

- [ ] **Step 1: Drive `/tv` in a browser**

Use the `run-undercity` skill to launch the dev server against the live AWS backend and open `/tv`. Confirm:
  - The lobby pin appears top-right during flyover / hero / leaderboard / queue / attract scenes when at least one game has status `'lobby'`.
  - The pin disappears (rail takes the corner) during hotspot and boss scenes.
  - The pin is absent entirely when no games are in the lobby state.
  - Rows show game title, "N in" count, and roster names; long names truncate rather than overflow.

- [ ] **Step 2: Final commit if any polish tweaks were needed**

```bash
git add -A
git commit -m "polish(spectator): lobby pin verification tweaks"
```

(Skip if no changes were needed during verification.)
