# Relative Combat Sprite Scaling by Tier — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the interactive PvE combat arena, scale the two fighters relative to each other by tier (player evolution tier vs enemy spawn-zone tier; bosses = T3) so size reads as flavor.

**Architecture:** The server stamps an enemy `tier` onto the interactive `battle_start` payload (and its resume view). The client carries `tier` on `BattleSide`, sets it on both fighters when opening the interactive battle, computes a per-side scale (`1 + 0.125 × tierGap`, clamped `[0.75, 1.25]`), and applies it through a `--sprite-scale` CSS var on the sprite's width/height so it composes with the existing flip/struck transforms.

**Tech Stack:** Python Lambda (`undercity_db.py`) + pytest; Angular 20 standalone component (`interactive-battle.component.*`), TypeScript, SCSS.

Design: [specs/2026-08-03-undercity-combat-sprite-scaling-design.md](2026-08-03-undercity-combat-sprite-scaling-design.md)

---

## Task 1: Server — stamp enemy tier onto the interactive battle payload

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_start_battle` ~773-812, `_battle_resume` ~4425-4456; new helper `_battle_tier`)
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

The single choke point for every interactive fight is `_start_battle(table, sid, doc, kind, npc, node=...)`. All kinds (wild/elite/barrier/lair/enraged/boss/world/pvp) route through it, so tier resolution lives there. Rule: `boss`/`lair`/`world` → 3; `pvp` → the clone's own creature tier; everything else → the node's spawn-zone `region_tier` (mirrors `_wild_battle`'s existing region resolution at line 3961-3967).

- [ ] **Step 1: Write the failing test**

Add to `infrastructure/lambda/tests/test_undercity_db.py` (near the other `_wild_battle` tests, after `test_depths_wild_is_tier2` ~line 1730):

```python
def test_battle_payload_carries_spawn_zone_tier(table):
    # Enemy size-tier = its spawn zone's difficulty tier (cavern=1, depths=2).
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')

    ev1 = db._wild_battle(table, sid, doc, elite=False, region='cavern')
    assert ev1['type'] == 'battle_start'
    assert ev1['npc']['tier'] == 1

    ev2 = db._wild_battle(table, sid, doc, elite=False, region='depths')
    assert ev2['npc']['tier'] == 2


def test_boss_battle_is_tier3(table, monkeypatch):
    # Bosses are always T3 regardless of where they sit.
    act(table, 'join', starter='pest')
    sid, _ = db._active_season(table)
    doc = db._get_player(table, sid, 'user-alex')
    act(table, 'boss-awaken', hostKey='swampking')
    doc['position'] = 'boss'
    out = db._boss(table, sid, doc, 'boss', 'isl_ossuary')
    assert out['type'] == 'battle_start' and out['kind'] == 'boss'
    assert out['npc']['tier'] == 3
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py::test_battle_payload_carries_spawn_zone_tier tests/test_undercity_db.py::test_boss_battle_is_tier3 -q`
Expected: FAIL with `KeyError: 'tier'` (payload has no `tier` yet).

- [ ] **Step 3: Add the `_battle_tier` helper**

Insert directly above `def _start_battle(` (~line 773) in `undercity_db.py`:

```python
def _battle_tier(table, sid, kind, npc, node):
    """Size-tier (1-3) of the foe for relative sprite scaling. Bosses/lairs/world
    beasts are always apex (3); a PvP clone carries its own creature tier; every
    other foe takes its spawn-zone difficulty tier (mirrors _wild_battle)."""
    if kind in ('boss', 'lair', 'world'):
        return 3
    if kind == 'pvp':
        return int(npc.get('tier') or 1)
    n = _season_map(table, sid).get(node) if node else None
    region = n.get('region') if n else None
    if region is None and node and data.dungeon_biome(node):
        region = 'depths'
    return data.region_tier(region)
```

- [ ] **Step 4: Store the tier in the battle record and the payload**

In `_start_battle`, after `player_snap = _bt_snapshot(player_c)` (~line 786) and before `rec = {`, add:

```python
    npc_tier = _battle_tier(table, sid, kind, npc, node)
```

Add `'npcTier': npc_tier,` to the `rec = { ... }` dict (so a reopened fight can recover it), e.g. right after `'kind': kind, 'node': node, 'round': 1,`:

```python
    rec = {
        'kind': kind, 'node': node, 'round': 1,
        'npcTier': npc_tier,
        'player': player_snap,
        'npc': npc_snap,
        'npcMeta': npc,          # full spec for reward resolution
        'ctx': ctx or {},        # kind-specific (lair slain flag, boss hp pool, ...)
        'strikes': [],
        'readChance': _read_chance(doc),  # frozen for the fight
    }
```

Then add `'tier': npc_tier,` to the returned payload's `'npc'` dict (~line 800-806), after the `'level': ...` entry:

```python
    return {'type': 'battle_start', 'kind': kind,
            'npc': {'name': npc['name'], 'id': npc.get('id'),
                    'spriteId': npc.get('spriteId') or npc.get('sprite'),
                    'hp': npc_snap['hp'], 'maxHp': npc_snap['maxHp'],
                    'atk': npc_snap['atk'], 'def': npc_snap['dfn'],
                    'spd': npc_snap['spd'],
                    'level': data.enemy_level(npc_snap['atk'], npc_snap['dfn'],
                                              npc_snap['spd'], npc_snap['maxHp']),
                    'tier': npc_tier},
            'telegraph': shown, 'round': 1,
            'frenzyFrom': _frenzy_from(kind),
            'fleeChance': _flee_pct(rec),
            'playerStatus': _battle_status(rec['player']),
            'npcStatus': _battle_status(rec['npc']),
            'text': f'A {npc["name"]} bars your path!'}
```

- [ ] **Step 5: Surface the tier on the resume view**

In `_battle_resume` (~line 4441), add `'tier': rec.get('npcTier'),` to the returned `'npc'` dict, after the `'personality': ...` entry:

```python
        'npc': {
            'id': (rec.get('npcMeta') or {}).get('id'),
            'spriteId': ((rec.get('npcMeta') or {}).get('spriteId')
                         or (rec.get('npcMeta') or {}).get('sprite')),
            'name': npc.get('name'),
            'hp': npc.get('hp'),
            'maxHp': npc.get('maxHp', npc.get('hp')),
            'atk': npc.get('atk'),
            'def': npc.get('dfn'),
            'spd': npc.get('spd'),
            'level': data.enemy_level(npc.get('atk', 0), npc.get('dfn', 0),
                                      npc.get('spd', 0),
                                      npc.get('maxHp', npc.get('hp', 0))),
            'personality': npc.get('personality'),
            'tier': rec.get('npcTier'),
        },
```

- [ ] **Step 6: Run the new tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py::test_battle_payload_carries_spawn_zone_tier tests/test_undercity_db.py::test_boss_battle_is_tier3 -q`
Expected: PASS (2 passed).

- [ ] **Step 7: Run the full lambda suite to confirm nothing regressed**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: all pass (existing green count + 2).

- [ ] **Step 8: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): stamp enemy size-tier onto interactive battle payload"
```

---

## Task 2: Client — add `tier` to the battle types

**Files:**
- Modify: `src/app/undercity/tabs/battle-playback.component.ts` (`BattleSide` ~line 15-27)
- Modify: `src/app/undercity/services/undercity-models.ts` (`SpaceEvent.npc` ~line 701-722; `BattleResume.npc` ~line 486-500)

No client test runner exists — these are type-only additions, verified by the production build in Task 5.

- [ ] **Step 1: Add `tier` to `BattleSide`**

In `src/app/undercity/tabs/battle-playback.component.ts`, inside `export interface BattleSide { ... }`, add after the `level?: number;` line:

```typescript
  /** Derived power level shown beside a foe's name (NPCs only). */
  level?: number;
  /** Size tier (1-3) driving relative sprite scaling in the arena: player =
   *  evolution tier, foe = spawn-zone difficulty tier (bosses always 3). */
  tier?: number;
```

- [ ] **Step 2: Add `tier` to `SpaceEvent.npc`**

In `src/app/undercity/services/undercity-models.ts`, inside the `SpaceEvent` interface's `npc?: { ... }` block (~line 701), add after `level?: number;`:

```typescript
    /** Derived opponent power level shown in the battle screen. */
    level?: number;
    /** Size tier (1-3) for relative arena sprite scaling (server-stamped). */
    tier?: number;
```

- [ ] **Step 3: Add `tier` to `BattleResume.npc`**

In the same file, inside the resume interface's `npc: { ... }` block (~line 486), add after `personality?: string;`:

```typescript
    personality?: string;
    /** Size tier (1-3) for relative arena sprite scaling (server-stamped). */
    tier?: number;
```

- [ ] **Step 4: Commit**

```bash
git add src/app/undercity/tabs/battle-playback.component.ts src/app/undercity/services/undercity-models.ts
git commit -m "feat(undercity): carry size-tier on battle side + event types"
```

---

## Task 3: Client — set tier on both fighters when opening the interactive battle

**Files:**
- Modify: `src/app/undercity/tabs/board-tab.component.ts` (`openLiveBattle` ~line 2635-2650; `resumeLiveBattle` ~line 2680-2694)

- [ ] **Step 1: Set tier in `openLiveBattle`**

In `openLiveBattle`, the `this.liveBattle.set({ attacker: {...}, defender: {...} })` block. Add `tier:` to each. Attacker:

```typescript
      attacker: {
        name: this.youBattleName(),
        spriteUrl: this.youSpriteUrl(),
        startHp: preHp,
        maxHp: you?.maxHp ?? preHp,
        level: you?.level,
        tier: you?.tier,
      },
```

Defender (add after `level: ev.npc!.level,`):

```typescript
        level: ev.npc!.level,
        tier: ev.npc!.tier,
        vestige: this.isVestigeFoe(ev.npc!.name),
```

- [ ] **Step 2: Set tier in `resumeLiveBattle`**

In `resumeLiveBattle`, the reopened-fight `this.liveBattle.set(...)`. Attacker:

```typescript
      attacker: {
        name: this.youBattleName(),
        spriteUrl: this.youSpriteUrl(),
        startHp: pb.playerHp,
        maxHp: you?.maxHp ?? pb.playerHp,
        level: you?.level,
        tier: you?.tier,
      },
```

Defender (add after `level: pb.npc.level,`):

```typescript
        level: pb.npc.level,
        tier: pb.npc.tier,
        vestige: this.isVestigeFoe(pb.npc.name),
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run build`
Expected: build succeeds (development build to `docs/`), no TS errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/undercity/tabs/board-tab.component.ts
git commit -m "feat(undercity): pass player + foe tier into the interactive battle"
```

---

## Task 4: Client — compute per-side scale and apply it to the sprites

**Files:**
- Modify: `src/app/undercity/tabs/interactive-battle.component.ts` (pure helper + two getters)
- Modify: `src/app/undercity/tabs/interactive-battle.component.html` (bind `--sprite-scale` on the two `.body` spans, ~line 73-84 and ~line 126-137)
- Modify: `src/app/undercity/tabs/interactive-battle.component.scss` (`.sprite` ~line 104-112, `.sprite-icon` ~line 116-124)

- [ ] **Step 1: Add the scale helper and getters**

In `interactive-battle.component.ts`, add a top-level pure function next to `ACTION_WORD` (~line 39):

```typescript
/** Relative arena sprite scale for a fighter given its tier and its foe's tier.
 *  Symmetric: +12.5% per tier of advantage, clamped so a 2-tier gap lands at
 *  ±25% (e.g. a T1 pest vs a T3 apex → 0.75 vs 1.25). Missing either tier → 1
 *  (no scaling), so any tier-less path renders unchanged. */
export function spriteScale(mine?: number, theirs?: number): number {
  if (!mine || !theirs) return 1;
  const s = 1 + 0.125 * (mine - theirs);
  return Math.min(1.25, Math.max(0.75, s));
}
```

Then add two getters inside the component class (near the other `protected` members, e.g. after `defenderSpriteFailed`):

```typescript
  protected attackerScale(): number {
    return spriteScale(this.attacker.tier, this.defender.tier);
  }
  protected defenderScale(): number {
    return spriteScale(this.defender.tier, this.attacker.tier);
  }
```

- [ ] **Step 2: Bind the scale var on the attacker `.body`**

In `interactive-battle.component.html`, on the attacker `<span class="body drop-in" ...>` (~line 73-77), add the `--sprite-scale` style binding alongside the existing `--uc-sprite`:

```html
          <span
            class="body drop-in"
            [class.vestige]="attacker.vestige"
            [style.--sprite-scale]="attackerScale()"
            [style.--uc-sprite]="attacker.spriteUrl && !attackerSpriteFailed() ? 'url(\'' + attacker.spriteUrl + '\')' : null"
          >
```

- [ ] **Step 3: Bind the scale var on the defender `.body`**

On the defender `<span class="body drop-in" ...>` (~line 126-130), add the same binding:

```html
          <span
            class="body drop-in"
            [class.vestige]="defender.vestige"
            [style.--sprite-scale]="defenderScale()"
            [style.--uc-sprite]="defender.spriteUrl && !defenderSpriteFailed() ? 'url(\'' + defender.spriteUrl + '\')' : null"
          >
```

- [ ] **Step 4: Size the sprite off the var**

In `interactive-battle.component.scss`, change `.sprite` (~line 104-112) width/height to scale off the var (leave `max-width: 100%` so a shrinking side still can't overflow):

```scss
  .sprite {
    width: calc(96px * var(--sprite-scale, 1));
    max-width: 100%; // scale down with a shrinking side instead of overflowing
    height: calc(96px * var(--sprite-scale, 1));
    object-fit: contain;
    image-rendering: pixelated;
    filter: drop-shadow(0 6px 8px rgba(0, 0, 0, 0.55));
    transition: transform 0.4s ease, width 0.4s ease, height 0.4s ease;
  }
```

And the icon fallback `.sprite-icon` (~line 116-124) so wild NPCs with no art scale too:

```scss
  .sprite-icon {
    font-size: calc(68px * var(--sprite-scale, 1));
    width: calc(96px * var(--sprite-scale, 1));
    max-width: 100%;
    height: calc(96px * var(--sprite-scale, 1));
    line-height: calc(96px * var(--sprite-scale, 1));
    color: #d8b5b5;
    filter: drop-shadow(0 6px 8px rgba(0, 0, 0, 0.55));
    transition: transform 0.4s ease, font-size 0.4s ease;
  }
```

Note: `.side` is `display: flex; align-items: flex-end`, so both `.body` children stay bottom-anchored — a larger sprite grows upward and keeps standing on the platform (which is absolutely pinned at `bottom: -14px`). No extra anchoring code needed; confirm visually in Task 5.

- [ ] **Step 5: Verify it compiles**

Run: `npm run build`
Expected: build succeeds, no TS/SCSS errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/undercity/tabs/interactive-battle.component.ts src/app/undercity/tabs/interactive-battle.component.html src/app/undercity/tabs/interactive-battle.component.scss
git commit -m "feat(undercity): scale arena sprites by relative tier"
```

---

## Task 5: Verify end-to-end in the browser

**Files:** none (verification only)

The change has no client unit coverage, so drive it live. Use the `run-undercity` skill for the dev-server + live-AWS-backend setup and how to reach a battle. Note the server tier is only live after a Lambda deploy — until then the foe sends no `tier` and renders at 1.0 next to a normally-scaled player (harmless); the player-vs-player relative check still works once the deploy lands.

- [ ] **Step 1: Production build passes**

Run: `npm run build:prod`
Expected: build + `flatten-build` complete with no errors.

- [ ] **Step 2: Drive a battle and observe**

Invoke the `run-undercity` skill and reach the interactive combat arena. Confirm:
- Even matchup (player tier == region tier) → both sprites ~96px (equal).
- Under-tiered: a tier-1 creature fighting in a T2/T3 zone → player visibly smaller, foe visibly larger; the gap widens with tier distance.
- A boss fight → the boss renders at the T3 size relative to the player.
- Sprites stay planted on their platforms (no floating/clipping); flip + struck/lunge animations still play correctly on the scaled sprites.

- [ ] **Step 3: Note deploy requirement**

Task 1 changes the Python Lambda. Per repo convention the user runs deploys. End the work with the lambda suite green and the frontend built, and note that a `cdk deploy` from `infrastructure/` is required for enemy-side scaling to appear in production.

---

## Self-review notes

- **Spec coverage:** tier sources (player `you().tier`; enemy region tier via server; boss=3) → Task 1 + Task 3; formula `1 + 0.125×gap` clamped → Task 4 `spriteScale`; width/height (not transform) so it composes with flip/struck → Task 4 Step 4; interactive-only, replay untouched → only `interactive-battle.*` + `openLiveBattle`/`resumeLiveBattle` touched; unknown tier → 1.0 → `spriteScale` guard; verification via `run-undercity` → Task 5.
- **Type consistency:** `spriteScale(mine, theirs)` defined in Task 4 and called by `attackerScale`/`defenderScale`; `tier` added to `BattleSide` (Task 2) before it is read in Task 4 and written in Task 3; `npcTier` written in `rec` (Task 1 Step 4) and read in `_battle_resume` (Step 5).
- **No placeholders:** every code + command step is concrete.
