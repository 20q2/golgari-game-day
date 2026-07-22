# Player Status Bubble — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a player set a short free-text status that renders as a speech bubble above their creature — persisted server-side, shown above their own creature in the Plaza and board view, and above other players in the Plaza.

**Architecture:** A new server `set-status` action normalizes and stores `status` on the player DynamoDB doc; it's echoed into the self `you` doc (automatic — `you` is the raw doc) and into the peer roster (`_public_player`). The Angular client adds `status` to its player models, a thin `store.setStatus()` wrapper over the existing `action()` flow, a status bubble drawn above the creature's head in `PlazaCanvas` and `BoardCanvas`, and two editors (Creature tab + tapping your own creature in the Plaza).

**Tech Stack:** Python 3.11 Lambda (pytest, in-memory FakeTable suite), Angular 20 standalone components, canvas rendering (TS).

> **Note on bubble placement:** the design doc says "above the nameplate," but in both canvases the nameplate/banner sits *below* the sprite. To honor the original request ("chat bubble above my creature") and reuse the existing emote anchor, the bubble is drawn **above the creature's head** (where the sniff/startle glyphs already appear).

> **Char cap:** 24 characters, enforced authoritatively on the server (`STATUS_MAX_LEN`) and mirrored client-side as `STATUS_MAX = 24`.

---

## Task 1: Server — `set-status` action, normalization, and roster propagation

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (add constant + `_normalize_status` + `_set_status`, register handler, extend `_public_player`)
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing tests**

Append to `infrastructure/lambda/tests/test_undercity_db.py`:

```python
# ── Status bubble ────────────────────────────────────────────────────────────

def test_set_status_persists_normalized(table):
    act(table, 'join', starter='saproling', home='cavern')
    status, resp = act(table, 'set-status', status='Farming spores')
    assert status == 200
    assert resp['you']['status'] == 'Farming spores'
    # Survives a state read.
    _, state = db.handle_state(table, {'userId': 'user-alex'})
    assert state['you']['status'] == 'Farming spores'


def test_set_status_truncates_and_collapses_whitespace(table):
    act(table, 'join', starter='saproling', home='cavern')
    status, resp = act(table, 'set-status',
                       status='  hello\n\tworld   this is way too long to fit  ')
    assert status == 200
    saved = resp['you']['status']
    # Collapsed to single spaces + trimmed = "hello world this is way too long to fit",
    # then capped at 24 chars → "hello world this is way " (trailing space, len 24).
    assert saved == 'hello world this is way '
    assert len(saved) == 24
    assert '\n' not in saved and '\t' not in saved


def test_set_status_empty_clears(table):
    act(table, 'join', starter='saproling', home='cavern')
    act(table, 'set-status', status='temp')
    status, resp = act(table, 'set-status', status='   ')
    assert status == 200
    assert resp['you']['status'] == ''


def test_status_visible_in_peer_roster(table):
    # Alex and Bea both join; Bea sees Alex's status in the players roster.
    act(table, 'join', user='user-alex', name='Alex', starter='saproling', home='cavern')
    act(table, 'join', user='user-bea', name='Bea', starter='pest', home='bone')
    act(table, 'set-status', user='user-alex', name='Alex', status='Come fight me')
    _, state = db.handle_state(table, {'userId': 'user-bea'})
    alex = next(p for p in state['players'] if p['userId'] == 'user-alex')
    assert alex['status'] == 'Come fight me'
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k status -q`
Expected: FAIL — `Unknown action: set-status` (the 200 assertions fail) / `KeyError`/`assert None == ...` on `status`.

- [ ] **Step 3: Add the normalization constant + helper**

In `infrastructure/lambda/undercity_db.py`, add near the other module-level constants (e.g. just above `_BATTLE_ALLOWED_ACTIONS` around line 1306):

```python
# Max length of a player's status-bubble text (mirror: STATUS_MAX in
# src/app/undercity/tabs/*.component.ts). Trim + collapse whitespace, then cap.
STATUS_MAX_LEN = 24


def _normalize_status(raw):
    """Coerce to a clean single-line status: trim, collapse any whitespace runs
    (spaces/tabs/newlines) to single spaces, and cap at STATUS_MAX_LEN. Non-str
    or empty input yields ''."""
    if not isinstance(raw, str):
        return ''
    return ' '.join(raw.split())[:STATUS_MAX_LEN]
```

- [ ] **Step 4: Add the `_set_status` handler**

In `infrastructure/lambda/undercity_db.py`, add near `_customize` (around line 4531):

```python
def _set_status(table, sid, doc, payload):
    doc['status'] = _normalize_status(payload.get('status', ''))
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    return _ok(doc)
```

- [ ] **Step 5: Register the handler and allow it mid-battle**

In the `handlers` dict inside `handle_action` (around line 1283), add `'set-status'`:

```python
        'gamble': _gamble, 'poke': _poke, 'customize': _customize,
        'set-status': _set_status,
        'drop-item': _drop_item,
```

In `_BATTLE_ALLOWED_ACTIONS` (around line 1307) add `'set-status'` alongside `'customize'` so a cosmetic status change isn't blocked by an in-progress fight:

```python
_BATTLE_ALLOWED_ACTIONS = frozenset({
    'combat-round', 'combat-peek', 'combat-flee',
    'set-stance', 'spend-stat', 'customize', 'set-status', 'ack-events',
```

(Keep every other entry already present in that frozenset — only add `'set-status'`.)

- [ ] **Step 6: Expose `status` in the peer roster**

In `_public_player` (around line 1208), add a `status` field to the returned dict:

```python
        'paint': p.get('paint'), 'hat': p.get('hat'),
        'isBot': p.get('isBot', False),
        'status': p.get('status', ''),
        'renown': data.compute_renown(p),
```

(The self `you` doc already carries `status` automatically — `you` is built as the raw doc minus `pk`/`sk` in `_ok` and `handle_state`, so no change is needed there.)

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k status -q`
Expected: PASS (4 passed).

- [ ] **Step 8: Run the full lambda suite to confirm nothing broke**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: all pass (same count as before + 4).

- [ ] **Step 9: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): server set-status action + roster propagation"
```

---

## Task 2: Client — models + store wrapper

**Files:**
- Modify: `src/app/undercity/services/undercity-models.ts` (add `status?` to `PublicPlayer` and `YouDoc`)
- Modify: `src/app/undercity/services/undercity-state.service.ts` (add `setStatus`)

- [ ] **Step 1: Add `status` to `PublicPlayer`**

In `src/app/undercity/services/undercity-models.ts`, in `interface PublicPlayer` (around line 38), add after `hat`:

```typescript
  hat: string | null;
  /** Free-text status bubble shown above the creature; '' or absent = none. */
  status?: string;
  renown: number;
```

- [ ] **Step 2: Add `status` to `YouDoc`**

In the same file, in `interface YouDoc` (starts around line 78), add the field (place it near `username`/`creatureName` around line 81):

```typescript
  creatureName?: string;
  /** Free-text status bubble shown above your creature; '' or absent = none. */
  status?: string;
```

- [ ] **Step 3: Add the `setStatus` store method**

In `src/app/undercity/services/undercity-state.service.ts`, add a method next to the existing `action()` (after line 156). It reuses `action()`, which already patches `you` from the server response and triggers a refresh:

```typescript
  /** Set the status-bubble text (server trims/caps; '' clears it). */
  async setStatus(text: string): Promise<void> {
    await this.action('set-status', { status: text });
  }
```

- [ ] **Step 4: Verify the client compiles**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/undercity/services/undercity-models.ts src/app/undercity/services/undercity-state.service.ts
git commit -m "feat(undercity): status field on player models + setStatus store method"
```

---

## Task 3: Plaza canvas — render the status bubble + live update

**Files:**
- Modify: `src/app/undercity/engine/plaza-canvas.ts` (add `status` to `PlazaCreature`, `drawStatusBubble`, draw call, `setStatus` method)

- [ ] **Step 1: Add `status` to `PlazaCreature`**

In `src/app/undercity/engine/plaza-canvas.ts`, in `interface PlazaCreature` (around line 24), add after `evolveGlow`:

```typescript
  shielded: boolean;
  evolveGlow: boolean;
  /** Status-bubble text; '' or absent = no bubble. */
  status?: string;
```

- [ ] **Step 2: Add the `drawStatusBubble` helper**

In the same file, add this method next to `drawNameplate` (after line 892):

```typescript
  private drawStatusBubble(
    cx: number,
    bottomY: number,
    text: string,
    scale: number,
    isOwn: boolean,
  ): void {
    const ctx = this.ctx;
    const fontSize = Math.round(6 * scale);
    ctx.font = `600 ${fontSize}px sans-serif`;
    const padX = 5 * scale;
    const padY = 3 * scale;
    const bubbleW = ctx.measureText(text).width + padX * 2;
    const bubbleH = fontSize + padY * 2;
    const bx = cx - bubbleW / 2;
    const by = bottomY - bubbleH;
    ctx.save();
    ctx.fillStyle = isOwn ? 'rgba(40,30,10,0.82)' : 'rgba(10,14,10,0.82)';
    ctx.strokeStyle = isOwn ? 'rgba(251,191,36,0.7)' : 'rgba(74,222,128,0.4)';
    ctx.lineWidth = 0.6 * scale;
    ctx.beginPath();
    ctx.roundRect(bx, by, bubbleW, bubbleH, 3 * scale);
    ctx.fill();
    ctx.stroke();
    // Tail pointing down toward the head.
    ctx.beginPath();
    ctx.moveTo(cx - 2.5 * scale, by + bubbleH - 0.5);
    ctx.lineTo(cx, by + bubbleH + 3 * scale);
    ctx.lineTo(cx + 2.5 * scale, by + bubbleH - 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#f2f7f2';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cx, by + bubbleH / 2);
    ctx.restore();
  }
```

- [ ] **Step 3: Draw the bubble above the head in `drawDino`**

In `drawDino`, immediately after the sniff/startle emote block ends (after line 889, before the `drawNameplate` call at line 891), add:

```typescript
    if (d.partner.status && d.fadeOut === 0 && d.dropIn === 0) {
      const isOwnDino =
        this.ownUserId !== null && d.partner.userId === this.ownUserId;
      const headTop = y - halfH + hopY - (d.partner.hat ? 16 : 8);
      this.drawStatusBubble(x, headTop, d.partner.status, d.scale, isOwnDino);
    }
```

- [ ] **Step 4: Add a live `setStatus` method (mirrors `boingDino`)**

In the same file, add next to `boingDino` (after line ~260):

```typescript
  /** Update a creature's status text in place so the bubble reflects a local
   * edit immediately, before the next roster poll arrives. */
  setStatus(userId: string, status: string): void {
    const d = this.dinos.find((x) => x.partner.userId === userId);
    if (d) d.partner.status = status;
  }
```

- [ ] **Step 5: Verify the client compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/app/undercity/engine/plaza-canvas.ts
git commit -m "feat(undercity): draw status bubble above creatures in the plaza"
```

---

## Task 4: Board canvas — render the own creature's status bubble

**Files:**
- Modify: `src/app/undercity/engine/board-canvas.ts` (add `status` to `BoardPlayer`, draw bubble in `drawNameBanner`)
- Modify: `src/app/undercity/tabs/board-tab.component.ts` (pass `status` into `setPlayers`)

- [ ] **Step 1: Add `status` to `BoardPlayer`**

In `src/app/undercity/engine/board-canvas.ts`, in `interface BoardPlayer` (around line 126), add after `tier`:

```typescript
  /** Evolution tier (1/2/3). Own token's tier greys out Tier-1-only tunnels. */
  tier?: number;
  /** Status-bubble text; '' or absent = no bubble. */
  status?: string;
```

- [ ] **Step 2: Draw the bubble above the head in `drawNameBanner`**

In `drawNameBanner` (the method around lines 1955-1977), the name banner is drawn below the feet at `by = y + targetH * 0.55`. Add a status bubble above the head just before the final `ctx.restore()` at line 1976:

```typescript
    ctx.fillStyle = isOwn ? '#fbbf24' : '#e5f0e5';
    ctx.fillText(label, x, by + 3);

    if (p.status) {
      const headTop = y - targetH * 0.55;
      const fontSize = 11;
      ctx.font = `600 ${fontSize}px sans-serif`;
      const padX = 7;
      const padY = 4;
      const bw = ctx.measureText(p.status).width + padX * 2;
      const bh = fontSize + padY * 2;
      const bx = x - bw / 2;
      const bboxY = headTop - bh - 6;
      ctx.beginPath();
      ctx.roundRect(bx, bboxY, bw, bh, 5);
      ctx.fillStyle = isOwn ? 'rgba(40,30,10,0.85)' : 'rgba(12,10,8,0.82)';
      ctx.fill();
      ctx.strokeStyle = isOwn ? 'rgba(251,191,36,0.85)' : 'rgba(190,210,190,0.4)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - 4, bboxY + bh - 1);
      ctx.lineTo(x, bboxY + bh + 5);
      ctx.lineTo(x + 4, bboxY + bh - 1);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = isOwn ? '#fbbf24' : '#e5f0e5';
      ctx.fillText(p.status, x, bboxY + padY + 1);
    }
    ctx.restore();
```

(Note: `drawNameBanner` sets `textBaseline = 'top'` at line 1963, which the bubble text reuses — hence `bboxY + padY + 1` for the text Y.)

- [ ] **Step 3: Pass `status` into the board players**

In `src/app/undercity/tabs/board-tab.component.ts`, in the `setPlayers` mapping (around line 1263-1275), add `status` to the returned object. Use the optimistically-patched `you` doc for your own token (so the bubble updates immediately after editing) and the roster value for everyone else — mirroring the existing `tier` line:

```typescript
          tier: p.userId === ownId ? (you?.tier ?? p.tier) : p.tier,
          status: p.userId === ownId ? (you?.status ?? p.status ?? '') : (p.status ?? ''),
        };
```

- [ ] **Step 4: Verify the client compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/app/undercity/engine/board-canvas.ts src/app/undercity/tabs/board-tab.component.ts
git commit -m "feat(undercity): draw status bubble above own creature on the board"
```

---

## Task 5: Plaza — edit your status by tapping your own creature

**Files:**
- Modify: `src/app/undercity/tabs/plaza-tab.component.ts` (FormsModule import, `statusDraft` signal, `STATUS_MAX`, `saveStatus`, seed draft on self-tap, pass `status` into `toCreature`)
- Modify: `src/app/undercity/tabs/plaza-tab.component.html` (status editor in the self branch of the poke card)

- [ ] **Step 1: Pass `status` through `toCreature`**

In `plaza-tab.component.ts`, in `toCreature` (around line 306), add:

```typescript
      shielded: isShielded(p),
      evolveGlow: evolveGlowActive(p as { evolvedAt?: string }),
      status: p.status ?? '',
    };
```

- [ ] **Step 2: Import `FormsModule`**

In `plaza-tab.component.ts`, add `FormsModule` to the Angular imports. Add the import statement near the top:

```typescript
import { FormsModule } from '@angular/forms';
```

and add `FormsModule` to the component's `imports:` array (the `@Component({ ... imports: [...] })` decorator).

- [ ] **Step 3: Add status state + save method**

In `plaza-tab.component.ts`, add fields near the other signals (e.g. beside `busy`):

```typescript
  protected readonly STATUS_MAX = 24;
  protected readonly statusDraft = signal('');

  async saveStatus(): Promise<void> {
    if (this.busy()) return;
    const text = this.statusDraft().trim();
    this.busy.set(true);
    try {
      await this.store.setStatus(text);
      const ownId = this.store.ownUserId;
      if (ownId) this.plaza?.setStatus(ownId, text.slice(0, this.STATUS_MAX));
      this.showToast(text ? 'Status updated.' : 'Status cleared.');
      this.selected.set(null);
    } catch (e) {
      this.showToast(e instanceof Error ? e.message : 'Could not update status');
    } finally {
      this.busy.set(false);
    }
  }
```

(Confirm `signal` is already imported in this file — it is used for `busy`/`selected`. `showToast` already exists — it's used by `poke()`.)

- [ ] **Step 4: Seed the draft when you tap your own creature**

In `ngAfterViewInit` (around line 321), the `PlazaCanvas` is constructed with a selection callback `(creature) => this.selected.set(creature)`. Replace that callback to also seed the draft when the tapped creature is yours:

```typescript
    this.plaza = new PlazaCanvas(
      this.canvasRef.nativeElement,
      this.store.players().map((p) => this.toCreature(p)),
      (creature) => {
        this.selected.set(creature);
        if (creature.userId === this.store.ownUserId) {
          this.statusDraft.set(this.store.you()?.status ?? '');
        }
      },
      this.store.ownUserId,
    );
```

- [ ] **Step 5: Add the editor to the poke card's self branch**

In `plaza-tab.component.html`, replace the self branch (lines 16-18, the `@else { <span class="own-note">That's you! Looking sharp.</span> }`) with a status editor:

```html
      } @else {
        <div class="status-editor">
          <label class="status-label">Your status</label>
          <input
            class="status-input"
            type="text"
            [maxlength]="STATUS_MAX"
            placeholder="Say something…"
            [(ngModel)]="statusDraft"
            (keyup.enter)="saveStatus()"
          />
          <div class="status-row">
            <span class="status-count">{{ statusDraft().length }}/{{ STATUS_MAX }}</span>
            <button class="uc-btn uc-btn-primary" [disabled]="busy()" (click)="saveStatus()">
              <mat-icon class="mi">chat_bubble</mat-icon> Set status
            </button>
          </div>
        </div>
      }
```

(`[(ngModel)]` on a signal works in Angular 20 with `FormsModule` imported.)

- [ ] **Step 6: Style the editor**

In `src/app/undercity/tabs/plaza-tab.component.scss`, add (reuse existing design tokens where present):

```scss
.status-editor {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
}
.status-label {
  font-size: 0.75rem;
  opacity: 0.75;
}
.status-input {
  width: 100%;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid rgba(251, 191, 36, 0.45);
  background: rgba(20, 24, 18, 0.9);
  color: inherit;
  font: inherit;
}
.status-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.status-count {
  font-size: 0.7rem;
  opacity: 0.6;
}
```

- [ ] **Step 7: Verify the client compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/app/undercity/tabs/plaza-tab.component.ts src/app/undercity/tabs/plaza-tab.component.html src/app/undercity/tabs/plaza-tab.component.scss
git commit -m "feat(undercity): set status by tapping your own creature in the plaza"
```

---

## Task 6: Creature tab — status field

**Files:**
- Modify: `src/app/undercity/tabs/creature-tab.component.ts` (FormsModule, signals, edit/save/cancel methods)
- Modify: `src/app/undercity/tabs/creature-tab.component.html` (status row under the hero title)
- Modify: `src/app/undercity/tabs/creature-tab.component.scss` (styling)

- [ ] **Step 1: Import `FormsModule`**

In `creature-tab.component.ts`, add near the top imports:

```typescript
import { FormsModule } from '@angular/forms';
```

and add `FormsModule` to the component's `imports:` array.

- [ ] **Step 2: Add status state + methods**

In `creature-tab.component.ts`, add fields near the other signals (beside `busy` at line 58) and methods near `equipFromStash`. The click-to-edit pattern avoids polling clobbering an in-progress edit:

```typescript
  protected readonly STATUS_MAX = 24;
  protected readonly editingStatus = signal(false);
  protected readonly statusDraft = signal('');

  beginEditStatus(): void {
    this.statusDraft.set(this.store.you()?.status ?? '');
    this.editingStatus.set(true);
  }

  cancelEditStatus(): void {
    this.editingStatus.set(false);
  }

  async saveStatus(): Promise<void> {
    await this.run(async () => {
      await this.store.setStatus(this.statusDraft().trim());
      this.editingStatus.set(false);
    });
  }
```

(`run()` is the existing helper used by `equipFromStash` — it manages `busy` and surfaces errors. `signal` is already imported.)

- [ ] **Step 3: Add the status row to the hero block**

In `creature-tab.component.html`, add a status row right after the `hero-titlerow` `</div>` (after line 22, before the `hero-bar` HP block at line 24):

```html
          </div>

          <div class="hero-status">
            @if (editingStatus()) {
              <input
                class="status-input"
                type="text"
                [maxlength]="STATUS_MAX"
                placeholder="Say something…"
                [(ngModel)]="statusDraft"
                (keyup.enter)="saveStatus()"
              />
              <span class="status-count">{{ statusDraft().length }}/{{ STATUS_MAX }}</span>
              <button class="status-btn" [disabled]="busy()" (click)="saveStatus()" title="Save">
                <mat-icon class="mi">check</mat-icon>
              </button>
              <button class="status-btn" (click)="cancelEditStatus()" title="Cancel">
                <mat-icon class="mi">close</mat-icon>
              </button>
            } @else {
              <button class="status-chip" (click)="beginEditStatus()">
                <mat-icon class="mi">chat_bubble</mat-icon>
                @if (you.status) {
                  <span class="status-text">{{ you.status }}</span>
                } @else {
                  <span class="status-text status-empty">Set a status…</span>
                }
                <mat-icon class="mi status-edit">edit</mat-icon>
              </button>
            }
          </div>
```

(This block is inside the `@if (you; ...)`/`you`-scoped template that already references `you.creatureName`, so `you.status` is in scope.)

- [ ] **Step 4: Style the status row**

In `creature-tab.component.scss`, add:

```scss
.hero-status {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
}
.status-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 14px;
  border: 1px solid rgba(251, 191, 36, 0.4);
  background: rgba(20, 24, 18, 0.6);
  color: inherit;
  cursor: pointer;
  font: inherit;
  .status-empty { opacity: 0.6; font-style: italic; }
  .status-edit { font-size: 14px; opacity: 0.6; }
}
.status-input {
  padding: 5px 8px;
  border-radius: 6px;
  border: 1px solid rgba(251, 191, 36, 0.45);
  background: rgba(20, 24, 18, 0.9);
  color: inherit;
  font: inherit;
}
.status-count { font-size: 0.7rem; opacity: 0.6; }
.status-btn {
  display: inline-flex;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  padding: 2px;
}
```

- [ ] **Step 5: Verify the client compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/app/undercity/tabs/creature-tab.component.ts src/app/undercity/tabs/creature-tab.component.html src/app/undercity/tabs/creature-tab.component.scss
git commit -m "feat(undercity): status field on the creature tab"
```

---

## Task 7: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Full lambda suite green**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: all pass.

- [ ] **Step 2: Production-config build**

Run: `npm run build`
Expected: build succeeds, no errors.

- [ ] **Step 3: Drive the app (use the `run-undercity` skill)**

The backend is live AWS, so this exercises the real `set-status` endpoint. Verify:
1. Creature tab: click the status chip, type a message, save → chip shows the new text.
2. Enter the Plaza: a bubble appears above your creature with the text.
3. Tap your own creature in the Plaza → editor appears seeded with current status; change it and "Set status" → bubble updates immediately.
4. Roll/move to the board → the bubble appears above your creature there too.
5. Set status to empty/whitespace → bubble disappears everywhere.

Note: server deploy is the user's responsibility (see repo conventions). The `set-status` route change in `undercity_db.py` must be deployed (`cdk deploy` from `infrastructure/`) before step 3 works against live AWS; flag this to the user.

---

## Self-review notes

- **Spec coverage:** visibility (server persist + roster + self, Tasks 1/3/4) ✓; free-text 24-char cap (Task 1 `STATUS_MAX_LEN`, client mirrors) ✓; both entry points (Task 5 plaza self-tap, Task 6 creature tab) ✓; sticky/no expiry (no expiry field anywhere) ✓; no moderation (normalization only) ✓.
- **Deviation from spec:** bubble drawn above the head, not "above the nameplate" (nameplate is below the sprite in both canvases) — documented in the header note; matches the user's "above my creature" request.
- **Type consistency:** `status?: string` on `PublicPlayer`, `YouDoc`, `PlazaCreature`, `BoardPlayer`; `setStatus(userId, status)` on `PlazaCanvas` vs `setStatus(text)` on the store — distinct signatures, distinct receivers, intentional.
