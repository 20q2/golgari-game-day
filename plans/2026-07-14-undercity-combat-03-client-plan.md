# Undercity Combat Redesign — Plan 3: Interactive Client

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Angular client the interactive PvE battle UI that Plan 2's server now speaks: a landing opens a battle showing the monster's **telegraph** + personality; the player taps a **stance** (Aggress/Guard/Feint) — plus optional **peek**, **flee**, or a **combat consumable** — each round; the client submits `combat-round`, animates the returned exchange, and shows the next telegraph until the fight ends. Also surfaces the new **charm** gear slot, gear **riders**, and combat consumables in the shop/creature UI, and updates the TS display mirrors.

**Architecture:** A new standalone `InteractiveBattleComponent` owns the PvE loop (telegraph, HP bars, action buttons, per-round strike animation), driven by callbacks into `UndercityStateService.action(...)`. `board-tab.component` routes the new `battle_start` space-event into it and relays `combat-round`/`combat-peek`/`combat-flee` responses, finishing on the terminal `spaceEvent` (rewards/compost) exactly as today. The existing `BattlePlaybackComponent` stays untouched and continues to render **PvP** one-shot battles (`resp.battle`). Data mirrors (`src/app/undercity/data/*.ts`) gain the charm slot, riders, combat consumables, and stance/personality display copy.

**Tech Stack:** Angular 20 standalone components, signals, SCSS. **No test runner** — verify each task with `npm run build` (production build = tsc + Angular template typecheck). Final task drives a live fight via the `run` skill.

**Reference:** `specs/2026-07-14-undercity-combat-redesign-design.md`, `specs/undercity-combat.md`, and Plan 2 (server contract). Server response shapes to consume:
- landing → `spaceEvent = { type: 'battle_start', kind, npc:{id,name,hp,maxHp,atk,def,spd}, telegraph, round, text }`
- `combat-round` (ongoing) → `{ you, combat: { round, entries:[…], telegraph, playerHp, npcHp, revealNext } }`
- `combat-round` (final) → `{ you, spaceEvent: <wild|elite|barrier|lair|boss reward event with .battle> }`
- `combat-peek` → `{ you, peek: { trueIntent, round } }`
- `combat-flee` → `{ you, combat: { fled: true, smokeSporeUsed } }` or `{ combat: { fled: false, round, telegraph } }`

**Out of scope:** balance changes (Plan 2), any server change. If a server gap is found, note it — don't patch the Lambda here.

---

## File Structure

- **`services/undercity-models.ts`** — add `battle_start` fields to `SpaceEvent`, a `CombatRound` interface, and `combat?`/`peek?` on `ActionResponse`; add optional `personality`/`telegraph` on the event `npc`.
- **`data/combat.ts`** (new) — stance display (label/icon/blurb), personality tells, telegraph copy, the counter map (client-side hint only).
- **`data/items.ts`** — widen `GearInfo.slot` to include `'charm'`; add charm gear + rider descriptions; add combat consumables with an in-battle flag.
- **`tabs/interactive-battle.component.{ts,html,scss}`** (new) — the PvE battle loop UI.
- **`tabs/board-tab.component.{ts,html}`** — route `battle_start`, host the interactive component, relay round actions, finish on terminal event.
- **`tabs/creature-tab.component.html`** — add the charm gear tile; show rider text.
- Shop list already iterates `GEAR`/`CONSUMABLES` — verify charms/combat items surface and are grouped sensibly.

---

## Task 1: Models for the interactive contract

**Files:** `src/app/undercity/services/undercity-models.ts`

- [ ] **Step 1: Extend `SpaceEvent`** — add the `battle_start` fields and telegraph, and widen `npc`:

```ts
  // battle_start (interactive PvE, Plan 2)
  kind?: 'wild' | 'elite' | 'barrier' | 'lair' | 'boss';
  telegraph?: Stance;
  round?: number;
```
and on the inline `npc` object add:
```ts
    personality?: string;
```
(Keep `bounty` optional — `battle_start`/finish npc payloads omit it; change `bounty: number` to `bounty?: number`.)

- [ ] **Step 2: Add stance + combat types** near `BattleResult`:

```ts
export type Stance = 'aggress' | 'guard' | 'feint';

export interface CombatEntry {
  round: number;
  by?: 'attacker' | 'defender';
  winner?: 'attacker' | 'defender' | 'clash' | 'stall' | 'whiff';
  aStance?: Stance;
  dStance?: Stance;
  dmg?: number;
  heal?: number;
  miss?: boolean;
  negated?: boolean;
  rot?: boolean;
  swarm?: boolean;
  retaliation?: boolean;
  rotApplied?: number;
}

export interface CombatRound {
  round: number;
  entries: CombatEntry[];
  telegraph: Stance;
  playerHp: number;
  npcHp: number;
  revealNext: boolean;
}

export interface CombatFlee {
  fled: boolean;
  smokeSporeUsed?: boolean;
  round?: number;
  telegraph?: Stance;
}

export interface CombatPeek {
  trueIntent: Stance;
  round: number;
}
```

- [ ] **Step 3: Add to `ActionResponse`**:

```ts
  combat?: CombatRound | CombatFlee;
  peek?: CombatPeek;
  text?: string;   // if not already present
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: compiles clean (no template consumer of these yet).

- [ ] **Step 5: Commit**

```bash
git add src/app/undercity/services/undercity-models.ts
git commit -m "feat(undercity/client): models for interactive combat contract"
```

---

## Task 2: Combat display mirror

**Files:** `src/app/undercity/data/combat.ts` (new)

- [ ] **Step 1: Create the file**

```ts
/** Client display copy for the stance-triangle combat (mirrors undercity_data.py). */
import { Stance } from '../services/undercity-models';

export interface StanceInfo {
  id: Stance;
  label: string;
  icon: string;   // Material Icons ligature
  blurb: string;  // what it beats, one line
}

export const STANCES: StanceInfo[] = [
  { id: 'aggress', label: 'Aggress', icon: 'sports_mma', blurb: 'Beats Feint. Loses to Guard.' },
  { id: 'guard',   label: 'Guard',   icon: 'shield',     blurb: 'Beats Aggress. Loses to Feint.' },
  { id: 'feint',   label: 'Feint',   icon: 'theater_comedy', blurb: 'Beats Guard. Loses to Aggress.' },
];
export const STANCE_MAP: Record<Stance, StanceInfo> =
  Object.fromEntries(STANCES.map((s) => [s.id, s])) as Record<Stance, StanceInfo>;

/** The stance that beats `s` — a client hint only; the server is authoritative. */
export const COUNTER: Record<Stance, Stance> = {
  aggress: 'guard', guard: 'feint', feint: 'aggress',
};

/** Personality → the tell shown before a fight ("the beast looks…"). */
export const PERSONALITY_TELL: Record<string, string> = {
  brute: 'itching to lunge',
  turtle: 'hunkered down',
  trickster: 'shifting and feinting',
  balanced: 'reading you',
};

/** Telegraph verb the monster shows for its next move. */
export const TELEGRAPH_TEXT: Record<Stance, string> = {
  aggress: 'coils to strike',
  guard: 'braces to block',
  feint: 'weaves a trick',
};
```

- [ ] **Step 2: Build + commit**

Run: `npm run build` → clean.
```bash
git add src/app/undercity/data/combat.ts
git commit -m "feat(undercity/client): stance + personality display mirror"
```

---

## Task 3: Gear/consumable mirror — charm slot, riders, combat items

**Files:** `src/app/undercity/data/items.ts`

- [ ] **Step 1: Widen the slot union and add rider text**

Change `slot: 'fang' | 'carapace'` → `slot: 'fang' | 'carapace' | 'charm'`. Add an optional `rider?: string` field to `GearInfo`. Update every `GEAR` entry's `desc` to include its rider effect, and add the three charms (mirror `undercity_data.GEAR` / `GEAR_RIDERS`):

```ts
export const GEAR: GearInfo[] = [
  { id: 'rusted_fang', name: 'Rusted Fang', slot: 'fang', tier: 1, cost: 20, rider: 'barbed',
    desc: '+2 ATK · Barbed: Aggress applies rot even on a loss.' },
  { id: 'kraul_barb', name: 'Kraul Barb', slot: 'fang', tier: 2, cost: 45, rider: 'deep_biter',
    desc: '+4 ATK · Deep-biter: winning hits hit harder.' },
  { id: 'wurm_tooth', name: 'Wurm Tooth', slot: 'fang', tier: 3, cost: 80, rider: 'deep_biter',
    desc: '+6 ATK, +1 SPD · Deep-biter: winning hits hit harder.' },
  { id: 'chitin_scrap', name: 'Chitin Scrap', slot: 'carapace', tier: 1, cost: 20, rider: 'thick',
    desc: '+2 DEF · Thick: Guard chips in a stall, softer when wrong.' },
  { id: 'bark_hide', name: 'Bark Hide', slot: 'carapace', tier: 2, cost: 45, rider: 'spiked',
    desc: '+4 DEF · Spiked: Guard counter reflects extra.' },
  { id: 'troll_hide', name: 'Troll Hide', slot: 'carapace', tier: 3, cost: 80, rider: 'spiked',
    desc: '+5 DEF, +6 max HP · Spiked: Guard counter reflects extra.' },
  { id: 'quartz_charm', name: 'Quartz Charm', slot: 'charm', tier: 1, cost: 20, rider: 'trickster',
    desc: '+1 SPD · Trickster: a lost Feint isn’t fully punished.' },
  { id: 'serrated_charm', name: 'Serrated Charm', slot: 'charm', tier: 2, cost: 45, rider: 'serrated',
    desc: '+1 SPD · Serrated: Feint break saps the enemy next round.' },
  { id: 'glint_charm', name: 'Glint Charm', slot: 'charm', tier: 3, cost: 80, rider: 'glint',
    desc: '+2 SPD · Glint: winning a Feint reveals the true next intent.' },
];
```

- [ ] **Step 2: Add combat consumables** (mirror the `combat: True` entries; add an `inBattle` flag + `effect`):

Add `inBattle?: boolean` and `effect?: string` to `ConsumableInfo`, then append:

```ts
  { id: 'scrying_spore', name: 'Scrying Spore', cost: 20, icon: 'visibility',
    inBattle: true, effect: 'reveal', desc: 'In battle: reveal the enemy’s true intent this round.' },
  { id: 'rot_bomb', name: 'Rot Bomb', cost: 22, icon: 'coronavirus',
    inBattle: true, effect: 'double_punish', desc: 'In battle: double your damage if you win this round.' },
  { id: 'chitin_ward', name: 'Chitin Ward', cost: 22, icon: 'security',
    inBattle: true, effect: 'negate', desc: 'In battle: cancel the punish from one wrong guess.' },
  { id: 'ambush_musk', name: 'Ambush Musk', cost: 25, icon: 'bolt',
    inBattle: true, effect: 'auto_win', desc: 'In battle: win one exchange regardless of choices.' },
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: FAILS if any code narrowed `slot` to the old union (e.g. `creature-tab` max-HP check). Fix those consumers (they should already handle string keys). Re-run until clean.

- [ ] **Step 4: Commit**

```bash
git add src/app/undercity/data/items.ts
git commit -m "feat(undercity/client): charm slot, gear riders, combat consumables in mirror"
```

---

## Task 4: InteractiveBattleComponent — scaffolding + inputs

**Files:** `src/app/undercity/tabs/interactive-battle.component.ts` (new), `.html`, `.scss`

- [ ] **Step 1: Create the component shell** with inputs and outputs, reusing `BattleSide` from battle-playback:

```ts
import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { BattleSide, BattleRewards } from './battle-playback.component';
import { CombatEntry, Stance } from '../services/undercity-models';
import { STANCES, STANCE_MAP, PERSONALITY_TELL, TELEGRAPH_TEXT } from '../data/combat';
import { ConsumableInfo } from '../data/items';

/** A held combat consumable the player may fire this round. */
export interface BattleItem { id: string; name: string; icon: string; effect: string; }

@Component({
  selector: 'app-undercity-interactive-battle',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  templateUrl: './interactive-battle.component.html',
  styleUrls: ['./interactive-battle.component.scss'],
})
export class InteractiveBattleComponent {
  @Input({ required: true }) attacker!: BattleSide;
  @Input({ required: true }) defender!: BattleSide;
  @Input({ required: true }) personality!: string;
  @Input({ required: true }) telegraph!: Stance;
  @Input() canFlee = true;
  @Input() items: BattleItem[] = [];       // usable combat consumables in bag
  @Input() hasScry = false;                 // holds a Scrying Spore

  /** Parent handles the network round; resolves with the raw ActionResponse. */
  @Output() submitStance = new EventEmitter<{ stance: Stance; item?: string }>();
  @Output() peek = new EventEmitter<void>();
  @Output() flee = new EventEmitter<void>();
  @Output() closed = new EventEmitter<void>();

  protected readonly STANCES = STANCES;
  protected readonly stanceMap = STANCE_MAP;
  protected readonly tellText = () => PERSONALITY_TELL[this.personality] ?? 'watching you';
  protected readonly telegraphText = () => TELEGRAPH_TEXT[this.telegraph];

  protected readonly attackerHp = signal(0);
  protected readonly defenderHp = signal(0);
  protected readonly busy = signal(false);      // awaiting a round result
  protected readonly revealed = signal<Stance | null>(null);  // from a peek
  protected readonly log = signal<string[]>([]);
  protected readonly done = signal(false);

  ngOnInit(): void {
    this.attackerHp.set(this.attacker.startHp);
    this.defenderHp.set(this.defender.startHp);
  }

  hpPct(side: 'attacker' | 'defender'): number {
    const hp = side === 'attacker' ? this.attackerHp() : this.defenderHp();
    const max = side === 'attacker' ? this.attacker.maxHp : this.defender.maxHp;
    return Math.max(0, Math.min(100, Math.round((hp / Math.max(1, max)) * 100)));
  }
}
```

- [ ] **Step 2: Minimal template** (`.html`) — HP bars, the telegraph banner, three stance buttons, peek/flee/item buttons. Disable all buttons while `busy()`. Base it on `battle-playback.component.html`'s arena markup for visual consistency (copy the sprite/HP-bar block, then add the controls):

```html
<div class="uc-modal-backdrop">
  <div class="uc-battle" (click)="$event.stopPropagation()">
    <!-- arena: reuse battle-playback's two-sprite + HP-bar layout -->
    <!-- telegraph banner -->
    @if (!done()) {
      <div class="tele">
        <span class="tell">The {{ defender.name }} is {{ tellText() }}…</span>
        <span class="intent">
          @if (revealed(); as r) { It WILL {{ stanceMap[r].label }} (scried). }
          @else { It {{ telegraphText() }} — looks like {{ stanceMap[telegraph].label }}. }
        </span>
      </div>
      <div class="stance-row">
        @for (s of STANCES; track s.id) {
          <button class="stance-btn" [disabled]="busy()" (click)="submitStance.emit({ stance: s.id })">
            <mat-icon class="mi">{{ s.icon }}</mat-icon><span>{{ s.label }}</span>
          </button>
        }
      </div>
      <div class="util-row">
        @if (hasScry) { <button [disabled]="busy() || !!revealed()" (click)="peek.emit()">Scry</button> }
        @if (canFlee) { <button [disabled]="busy()" (click)="flee.emit()">Flee</button> }
        @for (it of items; track it.id) {
          <button [disabled]="busy()" (click)="submitStance.emit({ stance: 'guard', item: it.id })"
                  title="{{ it.name }}"><mat-icon class="mi">{{ it.icon }}</mat-icon></button>
        }
      </div>
    } @else {
      <button class="uc-btn" (click)="closed.emit()">Continue</button>
    }
    <ul class="battle-log">@for (line of log(); track $index) { <li>{{ line }}</li> }</ul>
  </div>
</div>
```

(Note: item buttons emit a stance too — the player picks the stance first, then taps an item to attach it. Refine in Task 5 to let the item ride the *next* stance tap; the simplest v1 fires the item with a Guard. If you prefer stance+item composition, wire a `pendingItem` signal in Task 5.)

- [ ] **Step 3: Stub `.scss`** — reuse tokens/classes from `battle-playback.component.scss` (copy the arena/hp-bar rules; add `.tele`, `.stance-row`, `.stance-btn`, `.util-row`). Keep it phone-first.

- [ ] **Step 4: Build + commit**

Run: `npm run build` → clean.
```bash
git add src/app/undercity/tabs/interactive-battle.component.*
git commit -m "feat(undercity/client): interactive battle component scaffold"
```

---

## Task 5: Round animation + reveal/flee handling (component API)

**Files:** `interactive-battle.component.ts`

The parent owns the network; the component exposes methods it calls with results.

- [ ] **Step 1: Add a `pendingItem` composition** so an item attaches to the next stance tap (replaces the Task-4 note's Guard hack):

```ts
  protected readonly pendingItem = signal<string | null>(null);
  protected toggleItem(id: string): void {
    this.pendingItem.set(this.pendingItem() === id ? null : id);
  }
  protected play(stance: Stance): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.submitStance.emit({ stance, item: this.pendingItem() ?? undefined });
    this.pendingItem.set(null);
  }
```
Wire stance buttons to `play(s.id)` and item buttons to `toggleItem(it.id)` (highlight when pending).

- [ ] **Step 2: Add result-application methods** the parent calls:

```ts
  /** Animate one resolved round; advance the telegraph; unlock input. */
  applyRound(entries: CombatEntry[], telegraph: Stance, playerHp: number, npcHp: number): void {
    for (const e of entries) this.logEntry(e);
    this.attackerHp.set(playerHp);
    this.defenderHp.set(npcHp);
    this.telegraph = telegraph;
    this.revealed.set(null);   // scry only lasts the round
    this.busy.set(false);
  }

  applyPeek(trueIntent: Stance): void { this.revealed.set(trueIntent); }

  /** Battle ended: freeze HP, show outcome, offer Continue. */
  finish(playerHp: number, npcHp: number): void {
    this.attackerHp.set(playerHp);
    this.defenderHp.set(npcHp);
    this.done.set(true);
    this.busy.set(false);
  }

  fleeResult(escaped: boolean): void {
    if (escaped) { this.log.set([...this.log(), 'You slip away into the dark.']); this.done.set(true); }
    this.busy.set(false);   // failed flee: fight continues, re-enable input
  }

  private logEntry(e: CombatEntry): void {
    // Compose a readable line from the entry (winner/dmg/heal/rot/miss/negated).
    let line: string;
    if (e.winner && e.aStance && e.dStance) {
      line = `You ${this.stanceMap[e.aStance].label}, it ${this.stanceMap[e.dStance].label}.`;
    } else if (e.rot) { line = `Rot eats ${e.dmg} from ${e.by === 'attacker' ? 'you' : this.defender.name}.`; }
    else if (e.miss) { line = 'Dodged!'; }
    else if (e.negated) { line = 'Warded — no damage.'; }
    else if (e.heal) { line = `Drained ${e.heal} back.`; }
    else if (e.dmg) { line = `${e.by === 'attacker' ? 'You hit' : 'You are hit'} for ${e.dmg}.`; }
    else { line = ''; }
    if (line) this.log.set([...this.log(), line]);
  }
```
(Fix the `defenderRef` placeholder: reference `this.defender.name`. Keep lines short; this is a phone log.)

- [ ] **Step 3: HP-drain animation (optional polish)** — for v1, snapping HP via `applyRound` is acceptable; a tween can come later. Keep the lunge/hit flash from battle-playback if cheap, else skip.

- [ ] **Step 4: Build + commit**

Run: `npm run build` → clean.
```bash
git add src/app/undercity/tabs/interactive-battle.component.*
git commit -m "feat(undercity/client): interactive battle round/peek/flee handling"
```

---

## Task 6: Wire board-tab to drive the battle

**Files:** `tabs/board-tab.component.ts`, `tabs/board-tab.component.html`

- [ ] **Step 1: Add interactive-battle state** alongside `battleView`:

```ts
  protected readonly liveBattle = signal<{
    attacker: BattleSide; defender: BattleSide; personality: string;
    telegraph: Stance; kind: string; items: BattleItem[]; hasScry: boolean;
  } | null>(null);
```
Add a `@ViewChild(InteractiveBattleComponent)` ref so the parent can call `applyRound`/`finish`/etc. Import the component + add to `imports:`.

- [ ] **Step 2: Route `battle_start`** in `routeSpaceEvent` — add before the existing fight-type branch:

```ts
    if (ev.type === 'battle_start' && ev.npc) {
      this.openLiveBattle(ev, preHp);
      return;
    }
```
The old `fightTypes` branch stays: it now only fires for the **terminal** reward `spaceEvent` returned by the final `combat-round` — but that is handled inside `finishLiveBattle` (Step 4), so remove the direct `battleView` set for wild/elite/barrier/lair/boss from move-landing (they can no longer arrive with `.battle` on a landing). Keep `battleView` only for PvP.

- [ ] **Step 3: `openLiveBattle`** builds the sides (reuse `youBattleName`/`youSpriteUrl`/`npcSpriteUrl`/`NPC_ICONS`) and the usable-item list from the bag:

```ts
  private openLiveBattle(ev: SpaceEvent, preHp: number): void {
    const bag = this.store.you()?.bag ?? [];
    const items = bag
      .map((id) => CONSUMABLE_MAP[id])
      .filter((c): c is ConsumableInfo => !!c && !!c.inBattle)
      .map((c) => ({ id: c.id, name: c.name, icon: c.icon, effect: c.effect! }));
    this.liveBattle.set({
      attacker: { name: this.youBattleName(), spriteUrl: this.youSpriteUrl(),
                  startHp: preHp, maxHp: this.store.you()?.maxHp ?? preHp },
      defender: { name: ev.npc!.name, spriteUrl: this.npcSpriteUrl(ev.kind!, ev.npc!.id),
                  icon: NPC_ICONS[ev.npc!.id] ?? 'bug_report',
                  startHp: ev.npc!.hp, maxHp: ev.npc!.maxHp ?? ev.npc!.hp },
      personality: ev.npc!.personality ?? 'balanced',
      telegraph: ev.telegraph!, kind: ev.kind!,
      items, hasScry: bag.includes('scrying_spore'),
    });
  }
```

- [ ] **Step 4: Round/peek/flee relays** — submit and feed results back into the component ref:

```ts
  async onStance(e: { stance: Stance; item?: string }): Promise<void> {
    const resp = await this.store.action('combat-round',
      { stance: e.stance, ...(e.item ? { item: e.item } : {}) });
    if (resp.spaceEvent) { this.finishLiveBattle(resp.spaceEvent); return; }
    const c = resp.combat as CombatRound;
    this.liveB?.applyRound(c.entries, c.telegraph, c.playerHp, c.npcHp);
    this.refreshBagFlags();   // items may have been consumed
  }

  async onPeek(): Promise<void> {
    const resp = await this.store.action('combat-peek');
    if (resp.peek) this.liveB?.applyPeek(resp.peek.trueIntent);
    this.refreshBagFlags();
  }

  async onFlee(): Promise<void> {
    const resp = await this.store.action('combat-flee');
    const c = resp.combat as CombatFlee;
    this.liveB?.fleeResult(!!c.fled);
    if (c.fled) this.finishLiveBattleFled();
  }
```
`finishLiveBattle(ev)` calls `this.liveB?.finish(you.hp, ev.battle.defenderHp)`, stashes the terminal `ev` so the Continue button can show rewards/outcome (reuse `buildRewards`/`spaceModal`), and on close clears `liveBattle`. `refreshBagFlags` re-reads the bag to update `items`/`hasScry` after consumption. Handle the 409 "Finish your fight first" defensively (shouldn't happen since the modal owns input).

- [ ] **Step 5: Template** — render the component when `liveBattle()` is set:

```html
@if (liveBattle(); as lb) {
  <app-undercity-interactive-battle
    [attacker]="lb.attacker" [defender]="lb.defender"
    [personality]="lb.personality" [telegraph]="lb.telegraph"
    [canFlee]="lb.kind !== 'barrier' && lb.kind !== 'boss'"
    [items]="lb.items" [hasScry]="lb.hasScry"
    (submitStance)="onStance($event)" (peek)="onPeek()" (flee)="onFlee()"
    (closed)="closeLiveBattle()" />
}
```

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: clean. Resolve any typing gaps (e.g. `CombatRound`/`CombatFlee` imports, `bag` on `YouDoc`).

- [ ] **Step 7: Commit**

```bash
git add src/app/undercity/tabs/board-tab.component.ts src/app/undercity/tabs/board-tab.component.html
git commit -m "feat(undercity/client): board-tab drives interactive PvE battles"
```

---

## Task 7: Charm slot + rider text in the creature tab

**Files:** `tabs/creature-tab.component.html` (and `.ts` if the max-HP helper narrows slots)

- [ ] **Step 1: Add the charm tile** after the carapace tile (mirror the existing two):

```html
<div class="gear-tile" [class.empty]="!you.gear['charm']">
  <mat-icon class="mi slot-mi">auto_awesome</mat-icon>
  <div class="gear-tile-body">
    <span class="gear-tile-slot">Charm</span>
    @if (you.gear['charm']; as g) {
      <span class="gear-tile-name">{{ gearMap[g].name }}</span>
      <span class="gear-tile-desc">{{ gearMap[g].desc }}</span>
    } @else {
      <span class="gear-tile-empty">empty</span>
    }
  </div>
</div>
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: clean. (The rider text rides the existing `gear-tile-desc`.)

- [ ] **Step 3: Commit**

```bash
git add src/app/undercity/tabs/creature-tab.component.html
git commit -m "feat(undercity/client): charm gear slot in the creature tab"
```

---

## Task 8: Shop surfaces charms + combat consumables

**Files:** verify `tabs/board-tab.component.html` shop block; adjust grouping if needed.

- [ ] **Step 1: Inspect the shop template** (search the board-tab HTML for the `gear`/`consumables` lists). Confirm it iterates all `GEAR`/`CONSUMABLES` and groups by slot/tier. If it hardcodes only fang/carapace groups, add a charm group; if it iterates generically, charms appear automatically.

- [ ] **Step 2: Ensure combat consumables are buyable** — they're in `CONSUMABLES`, so they should list. Confirm the shop shows their `desc` (the in-battle text) and that `buy` works (it already posts `itemId`).

- [ ] **Step 3: Build + visually confirm grouping**

Run: `npm run build` → clean. (Visual check happens in Task 9.)

- [ ] **Step 4: Commit** (only if edits were needed)

```bash
git add src/app/undercity/tabs/board-tab.component.html
git commit -m "feat(undercity/client): shop lists charms + combat consumables"
```

---

## Task 9: Drive a real fight (end-to-end verification)

**Files:** none (verification).

Plan 2's server must be reachable for this. If the deployed Lambda predates Plan 2, run against a local/staging deploy or note that live verification is deferred until the user deploys.

- [ ] **Step 1: Production build is clean**

Run: `npm run build`
Expected: success, no errors.

- [ ] **Step 2: Use the `run` skill** to launch the app and drive a PvE fight:
  - Move onto a wild space → the interactive battle opens with a telegraph + personality tell.
  - Tap each stance across rounds; confirm HP bars move, the log reads sensibly, and the telegraph updates each round.
  - Buy + use a **Scrying Spore** (peek reveals true intent) and a combat consumable (e.g. Rot Bomb) — confirm it's consumed and affects the round.
  - Win a fight → rewards popup (spores/xp) shows; lose one → compost/respawn flows as before.
  - Confirm **Flee** works on a wild and is absent on a barrier/boss.
  - Open the creature tab → the **Charm** slot shows; equip a charm from the shop and see it fill.
  - Confirm **PvP** (attack a co-located player) still plays the old one-shot playback (unchanged).

- [ ] **Step 3: Note any server contract mismatches** discovered while driving (field names, missing data) for a follow-up — do not patch the Lambda in this plan.

- [ ] **Step 4: Final commit** (if any doc/notes)

```bash
git commit --allow-empty -m "chore(undercity/client): Plan 3 end-to-end verified"
```

---

## Done criteria (Plan 3)

- Landing on a PvE foe opens the interactive battle: telegraph + personality tell, three stance buttons, per-round animation, updating telegraph.
- Peek (Scrying Spore), Flee (where allowed), and combat consumables work and are consumed.
- Battle end shows rewards/outcome and returns to the board; loss composts as before.
- Charm slot + gear riders + combat consumables appear in the creature tab and shop.
- PvP unchanged (one-shot `BattlePlaybackComponent`).
- `npm run build` is clean; a real fight has been driven end-to-end (or live verification explicitly deferred to the user's deploy).

## Notes / risks

- **No unit tests** on the client — `npm run build` (tsc + Angular template typecheck) is the gate; Task 9 is the behavioral check. Be rigorous there.
- **Deploy coupling:** the interactive client only works against a Plan-2 server. Until the user deploys the Lambda, Task 9's live check runs against local/staging or is deferred.
- **HP tweening** and richer strike VFX are deliberately minimal in v1 (snap HP, short log). The existing `battle-playback` animation can be ported in later if desired.
- If driving reveals the round log is too terse/noisy, iterate on `logEntry` copy — it's isolated.
