# Undercity Special Paints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four Dino-Party-ported "special paints" (Prismatic, Rainbow, Metallic, Starry) as whole-creature animated cosmetic effects, sold in the renown shop for 500 renown each and equipped like normal hue paints.

**Architecture:** A new `effect` field on a creature (owned in `perm['effects']`) rides alongside the existing `paint`/`hat`/`shiny` cosmetics through the same server handlers, serializers, and client hops. Rendering adds a cached per-sprite silhouette mask plus one pooled scratch canvas; a `drawCreatureEffect` helper paints a time-driven overlay clipped to the silhouette in ~3 canvas ops per creature per frame — no per-frame `getImageData` or recolor. The board/plaza RAF loops (which already animate `shiny`) call it after the sprite draw.

**Tech Stack:** Python 3.11 Lambda (pytest, in-memory FakeTable suite), Angular 20 standalone components, HTML5 canvas 2D. Design spec: [specs/2026-07-22-undercity-special-paints-design.md](2026-07-22-undercity-special-paints-design.md).

**Notes for the implementer:**
- Backend is TDD with `cd infrastructure/lambda && python -m pytest tests -q`.
- Frontend has **no test runner** (CLAUDE.md). Verify frontend tasks with `npm run build` from the repo root (must exit 0). Do not run `ng test`.
- The user runs deploys; end with tests/build green and note a deploy is needed. Do not run `cdk deploy`.
- `undercity_db.py`, `undercity_data.py`, and `test_undercity_db.py` may have uncommitted user edits — always read current file state before editing; do not revert unrelated changes.

---

### Task 1: Server special-paint manifest + price

**Files:**
- Modify: `infrastructure/lambda/undercity_data.py` (near the `# ── Renown shop` block, after `PAINT_PRICE` around line 726)

- [ ] **Step 1: Add the manifest and price**

In `undercity_data.py`, immediately after the `PAINT_PRICE = 40` line, add:

```python
# ── Special paints (animated whole-creature effects; Dino Party port) ─────────
# Distinct from hue paints: a special paint sets a creature's `effect`, an
# animated overlay drawn client-side on top of its hues. Bought/owned like hats.
SPECIAL_PAINTS = [
    {'id': 'prismatic', 'name': 'Prismatic'},
    {'id': 'rainbow',   'name': 'Rainbow'},
    {'id': 'metallic',  'name': 'Metallic'},
    {'id': 'starry',    'name': 'Starry'},
]
SPECIAL_PAINT_MAP = {p['id']: p for p in SPECIAL_PAINTS}
SPECIAL_PAINT_PRICE = 500  # renown, per special paint
```

- [ ] **Step 2: Verify import**

Run: `cd infrastructure/lambda && python -c "import undercity_data as d; print(d.SPECIAL_PAINT_PRICE, list(d.SPECIAL_PAINT_MAP))"`
Expected: `500 ['prismatic', 'rainbow', 'metallic', 'starry']`

- [ ] **Step 3: Commit**

```bash
git add infrastructure/lambda/undercity_data.py
git commit -m "feat(undercity): special-paint manifest + 500-renown price"
```

---

### Task 2: Server perm `effects` list + creature `effect` default

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` — `_get_perm` (~379) and `_new_player_doc` (~1751)
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/test_undercity_db.py` (follow the file's existing helper style for building a table/session; reuse whatever `join`/state helpers the suite already provides):

```python
def test_new_perm_has_empty_effects_and_creature_effect_none():
    table = FakeTable()
    sid = _make_session(table)                     # existing suite helper
    _join(table, sid, 'u1', 'Alice', starter='pest', home='city')  # existing helper
    perm = undercity_db._get_perm(table, 'u1')
    assert perm['effects'] == []
    you = _state(table, sid, 'u1')['you']          # existing helper returning the own creature
    assert you['effect'] is None
```

If the suite has no `_make_session`/`_join`/`_state` helpers by those names, use the equivalents already used by neighbouring tests in the file (read the top of the file first).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k effects -q`
Expected: FAIL (`KeyError: 'effects'` or `assert ... == []`).

- [ ] **Step 3: Add `effects` to the perm doc**

In `_get_perm`, add `'effects': []` to the freshly-built doc dict and backfill existing docs. The block becomes:

```python
def _get_perm(table, user_id):
    doc = _get(table, f'UNDERCITYUSER#{user_id}', 'META')
    if not doc:
        doc = {'pk': f'UNDERCITYUSER#{user_id}', 'sk': 'META',
               'seals': 0, 'hats': [], 'paints': list(data.DEFAULT_PAINTS),
               'effects': [],
               'nights': 0, 'lifetimePvpWins': 0, 'apexReached': 0,
               'renown': data.SHOP_START_RENOWN}
    doc.setdefault('renown', data.SHOP_START_RENOWN)  # backfill existing perm docs
    doc.setdefault('effects', [])                     # backfill existing perm docs
    for p in data.DEFAULT_PAINTS:
        if p not in doc['paints']:
            doc['paints'].append(p)
    return doc
```

- [ ] **Step 4: Default `effect` on new creatures**

In `_new_player_doc`, in the doc dict, add `'effect': None` right after the `'hat': None,` entry:

```python
        'paint': {'body': body_hue, 'belly': 50, 'stripes': body_hue},
        'hat': None, 'effect': None, 'joinedAt': _now(), 'ver': 0,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k effects -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): perm effects list + creature effect field"
```

---

### Task 3: Surface `effect` in serializers + wardrobe payload

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` — `_public_player` (~1253), wardrobe payload (~1227), standings block (~1711)

- [ ] **Step 1: Add `effect` to `_public_player`**

In `_public_player`, alongside `paint`/`hat`:

```python
        'paint': p.get('paint'), 'hat': p.get('hat'), 'effect': p.get('effect'),
        'shiny': p.get('shiny', False),
```

- [ ] **Step 2: Add `effects` to the wardrobe payload**

In the `out['wardrobe']` assignment (~1227):

```python
        out['wardrobe'] = {'hats': perm['hats'], 'paints': perm['paints'],
                           'effects': perm['effects'],
                           'seals': perm['seals'], 'nights': perm.get('nights', 0),
                           'renown': perm.get('renown', 0)}
```

- [ ] **Step 3: Add `effect` to the standings block**

In the standings dict (~1711), alongside `paint`/`hat`:

```python
            'spores': p.get('spores', 0), 'paint': p.get('paint'),
            'hat': p.get('hat'), 'effect': p.get('effect'),
```

- [ ] **Step 4: Verify existing suite still green**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS (no regressions).

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py
git commit -m "feat(undercity): surface effect in player/state/wardrobe payloads"
```

---

### Task 4: Server pre-spawn shop — buy & equip special paints

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` — `_apply_shop_purchases` (~1812)
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing tests**

Add to `tests/test_undercity_db.py` (adapt helper names to the suite; a player must have ≥500 renown banked — set `perm['renown']` directly via the table if the suite has no earn helper):

```python
def test_buy_and_equip_special_paint_via_shop():
    table = FakeTable()
    sid = _make_session(table)
    undercity_db._save_perm(table, {                      # or the suite's perm-write helper
        'pk': 'UNDERCITYUSER#u1', 'sk': 'META', 'seals': 1,
        'hats': [], 'paints': [], 'effects': [], 'renown': 600})
    _join(table, sid, 'u1', 'Alice', starter='pest', home='city',
          buyEffects=['metallic'], equipEffect='metallic')  # extend helper to pass payload
    perm = undercity_db._get_perm(table, 'u1')
    assert 'metallic' in perm['effects']
    assert perm['renown'] == 100                            # 600 - 500
    assert _state(table, sid, 'u1')['you']['effect'] == 'metallic'


def test_equip_unowned_special_paint_rejected():
    table = FakeTable()
    sid = _make_session(table)
    status, _ = undercity_db._apply_shop_purchases(
        {'hats': [], 'paints': [], 'effects': [], 'renown': 600},
        {'paint': {'body': 130, 'belly': 50, 'stripes': 130}, 'hat': None, 'effect': None,
         'bag': []},
        {'equipEffect': 'rainbow'}), None
    # _apply_shop_purchases returns an (status, body) tuple on error
    assert status is not None and status[0] == 409


def test_buy_special_paint_insufficient_renown_rejected():
    perm = {'hats': [], 'paints': [], 'effects': [], 'renown': 300}
    doc = {'paint': {'body': 130, 'belly': 50, 'stripes': 130}, 'hat': None,
           'effect': None, 'bag': []}
    err = undercity_db._apply_shop_purchases(perm, doc, {'buyEffects': ['starry']})
    assert err is not None and err[0] == 409
    assert perm['effects'] == [] and perm['renown'] == 300   # nothing mutated


def test_buy_unknown_special_paint_rejected():
    perm = {'hats': [], 'paints': [], 'effects': [], 'renown': 600}
    doc = {'paint': {'body': 130, 'belly': 50, 'stripes': 130}, 'hat': None,
           'effect': None, 'bag': []}
    err = undercity_db._apply_shop_purchases(perm, doc, {'buyEffects': ['nope']})
    assert err is not None
    assert perm['effects'] == []
```

Read the file's top and the existing `_apply_shop_purchases` tests first; match their exact calling convention (some call the helper directly with `perm`/`doc` dicts, as above). Keep whichever style the file already uses.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k "special_paint" -q`
Expected: FAIL (`buyEffects` unhandled — effect never bought/equipped).

- [ ] **Step 3: Implement buy + equip in `_apply_shop_purchases`**

At the top of `_apply_shop_purchases`, after the existing `buy_paints`/`equip_paint` reads:

```python
    buy_effects = list(dict.fromkeys(payload.get('buyEffects') or []))
    equip_effect = payload.get('equipEffect') or None
```

In the validation phase, after the `buy_paints` loop that accumulates `total`:

```python
    for eid in buy_effects:
        if eid not in data.SPECIAL_PAINT_MAP:
            return _err(f'Unknown special paint: {eid}')
        if eid in perm['effects']:
            return _err('You already own that special paint.')
        total += data.SPECIAL_PAINT_PRICE
```

In the ownership checks, alongside the `equip_paint` check:

```python
    owned_effects = set(perm['effects']) | set(buy_effects)
    if equip_effect and equip_effect not in owned_effects:
        return _err('You do not own that special paint.', 409)
```

In the commit phase, alongside `perm['paints'] = ...`:

```python
    perm['effects'] = perm['effects'] + buy_effects
```

And alongside the `if equip_paint:` block:

```python
    if equip_effect:
        doc['effect'] = equip_effect
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k "special_paint" -q`
Expected: PASS.

- [ ] **Step 5: Full suite green**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): buy + equip special paints in pre-spawn shop"
```

---

### Task 5: Server wardrobe swap — `effect` in `_customize`

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` — `_customize` (~4852)
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing tests**

```python
def test_customize_equip_and_clear_effect():
    table = FakeTable()
    sid = _make_session(table)
    _join(table, sid, 'u1', 'Alice', starter='pest', home='city')
    # grant ownership directly on the perm doc
    perm = undercity_db._get_perm(table, 'u1'); perm['effects'] = ['prismatic']
    undercity_db._save_perm(table, perm)                  # suite's perm-write helper
    _action(table, sid, 'u1', 'customize', {'effect': 'prismatic', 'hat': ''})
    assert _state(table, sid, 'u1')['you']['effect'] == 'prismatic'
    _action(table, sid, 'u1', 'customize', {'effect': '', 'hat': ''})
    assert _state(table, sid, 'u1')['you']['effect'] is None


def test_customize_equip_unowned_effect_rejected():
    table = FakeTable()
    sid = _make_session(table)
    _join(table, sid, 'u1', 'Alice', starter='pest', home='city')
    status, body = _action(table, sid, 'u1', 'customize', {'effect': 'rainbow', 'hat': ''})
    assert status == 409
```

Match the suite's real action/state helper names.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k "customize" -q`
Expected: FAIL (`effect` ignored by `_customize`).

- [ ] **Step 3: Implement in `_customize`**

In `_customize`, after the `paint` handling block and before `doc['hat'] = hat or None`:

```python
    effect = payload.get('effect')
    if effect is not None:
        if effect == '':
            doc['effect'] = None
        elif effect not in perm['effects']:
            return _err('You do not own that special paint.', 409)
        else:
            doc['effect'] = effect
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k "customize" -q`
Expected: PASS.

- [ ] **Step 5: Full suite green**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): equip/clear special paint via customize"
```

---

### Task 6: Client cosmetics mirror + model types

**Files:**
- Modify: `src/app/undercity/data/cosmetics.ts`
- Modify: `src/app/undercity/services/undercity-models.ts` (PublicPlayer ~10, the two other paint-bearing interfaces ~157/~182, Wardrobe ~199)

- [ ] **Step 1: Add the special-paint mirror to `cosmetics.ts`**

Append to `cosmetics.ts`:

```typescript
export interface SpecialPaintInfo {
  id: string;
  name: string;
}

/** Animated whole-creature effects (mirror SPECIAL_PAINTS in undercity_data.py). */
export const SPECIAL_PAINTS: SpecialPaintInfo[] = [
  { id: 'prismatic', name: 'Prismatic' },
  { id: 'rainbow', name: 'Rainbow' },
  { id: 'metallic', name: 'Metallic' },
  { id: 'starry', name: 'Starry' },
];

export const SPECIAL_PAINT_MAP: Record<string, SpecialPaintInfo> = Object.fromEntries(
  SPECIAL_PAINTS.map((p) => [p.id, p]),
);

/** Renown price per special paint (mirror SPECIAL_PAINT_PRICE in undercity_data.py). */
export const SPECIAL_PAINT_PRICE = 500;
```

- [ ] **Step 2: Add `effect` to the model types**

In `undercity-models.ts`, add `effect?: string | null;` next to the `hat` field in each of the three creature-bearing interfaces (the `PublicPlayer` at ~37-38 and the two others at ~157-158 and ~182-183). For each, the pair becomes:

```typescript
  paint: Record<string, number>;
  hat: string | null;
  effect?: string | null;
```

In the `Wardrobe` interface (~199), add `effects`:

```typescript
export interface Wardrobe {
  hats: string[];
  paints: string[];
  effects: string[];
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: exit 0 (no type errors).

- [ ] **Step 4: Commit**

```bash
git add src/app/undercity/data/cosmetics.ts src/app/undercity/services/undercity-models.ts
git commit -m "feat(undercity): client special-paint mirror + effect model fields"
```

---

### Task 7: Ship the starry texture asset

**Files:**
- Create: `public/undercity/effects/starry.jpg` (copy of Dino Party's texture)

- [ ] **Step 1: Copy the texture**

Run (Git Bash):

```bash
mkdir -p public/undercity/effects
cp "a:/Coding/AlexBirthdayDinos/frontend/src/assets/effects/starry_night.jpg" public/undercity/effects/starry.jpg
```

- [ ] **Step 2: Verify it exists and is non-empty**

Run: `ls -l public/undercity/effects/starry.jpg`
Expected: a file listing with size > 0.

- [ ] **Step 3: Commit**

```bash
git add public/undercity/effects/starry.jpg
git commit -m "feat(undercity): add starry special-paint texture"
```

---

### Task 8: Sprite-engine silhouette mask + `drawCreatureEffect` + static variant

**Files:**
- Modify: `src/app/undercity/engine/sprite-engine.ts`

This is the performance core. The base recolor stays cached; the effect is a mask-clipped overlay using one pooled scratch canvas. No per-frame `getImageData`/recolor.

- [ ] **Step 1: Load the starry texture in `preloadAll`**

Near the top of `sprite-engine.ts`, after the other module-level image caches, add:

```typescript
let starryImage: HTMLImageElement | null = null;
export function getStarryTexture(): HTMLImageElement | null {
  return starryImage;
}
```

Inside `preloadAll`, add a fire-and-forget load (missing texture must not break preload) and include it in the awaited list:

```typescript
  const starry = loadImage('undercity/effects/starry.jpg')
    .then((img) => {
      starryImage = img;
    })
    .catch(() => {
      /* no starry texture — the starry effect simply skips its frames */
    });
```

Add `starry` to the `Promise.all([...])` array in `preloadAll`.

- [ ] **Step 2: Add the cached silhouette mask**

After the `regionMapFor` function, add:

```typescript
// Silhouette masks: opaque white where the sprite has any colored region, else
// transparent. Built once per sprite from its cached region map and reused for
// every effect frame — effects are clipped to this via source-in.
const silhouetteCache = new Map<string, HTMLCanvasElement>();

export function getSilhouetteMask(sprite: string): HTMLCanvasElement | null {
  const cached = silhouetteCache.get(sprite);
  if (cached) return cached;
  const img = rawImages[sprite];
  if (!img) return null;
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const map = regionMapFor(sprite, img);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.createImageData(w, h);
  const data = imageData.data;
  for (let p = 0; p < map.length; p++) {
    if (map[p] >= 0) {
      const i = p * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(imageData, 0, 0);
  silhouetteCache.set(sprite, canvas);
  return canvas;
}
```

- [ ] **Step 3: Add the pooled scratch canvas + `drawCreatureEffect`**

Add below `getSilhouetteMask`:

```typescript
// One reusable scratch canvas for all effect compositing — grown, never
// reallocated per frame. Effects are painted here (clipped to the silhouette)
// then blitted onto the destination canvas with plain source-over.
let effectScratch: HTMLCanvasElement | null = null;
function scratchOf(w: number, h: number): CanvasRenderingContext2D {
  if (!effectScratch) effectScratch = document.createElement('canvas');
  if (effectScratch.width < w || effectScratch.height < h) {
    effectScratch.width = Math.max(effectScratch.width, w);
    effectScratch.height = Math.max(effectScratch.height, h);
  }
  const ctx = effectScratch.getContext('2d')!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, effectScratch.width, effectScratch.height);
  return ctx;
}

/**
 * Paint an animated special-paint overlay for `effect` onto `ctx`, clipped to
 * the sprite's silhouette and confined to the destination box (dx,dy,dw,dh).
 * `timeMs` is a monotonic time (e.g. the RAF timestamp); pass 0 for a static
 * frame. Cheap: mask blit + one fill/texture draw + composite — no pixel reads.
 */
export function drawCreatureEffect(
  ctx: CanvasRenderingContext2D,
  sprite: string,
  effect: string,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  timeMs: number,
): void {
  const mask = getSilhouetteMask(sprite);
  if (!mask || dw <= 0 || dh <= 0) return;
  const w = Math.ceil(dw);
  const h = Math.ceil(dh);
  const sc = scratchOf(w, h);
  const now = timeMs / 1000;

  // 1) lay the silhouette, 2) clip the effect to it via source-in.
  sc.imageSmoothingEnabled = false;
  sc.drawImage(mask, 0, 0, w, h);
  sc.globalCompositeOperation = 'source-in';

  if (effect === 'metallic') {
    const shineX = (((now * 0.4) % 1.6) - 0.3) * w;
    const grad = sc.createLinearGradient(shineX - 0.12 * w, 0, shineX + 0.12 * w, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    sc.fillStyle = grad;
    sc.fillRect(0, 0, w, h);
  } else if (effect === 'rainbow') {
    const band = w * 0.5;
    const sweepX = (((now * 0.35) % 1.6) - 0.3) * w;
    const base = Math.floor((now * 50) % 360);
    const grad = sc.createLinearGradient(sweepX - band, 0, sweepX + band, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.2, `hsla(${base}, 100%, 65%, 0.35)`);
    grad.addColorStop(0.5, `hsla(${(base + 120) % 360}, 100%, 65%, 0.4)`);
    grad.addColorStop(0.8, `hsla(${(base + 240) % 360}, 100%, 65%, 0.35)`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    sc.fillStyle = grad;
    sc.fillRect(0, 0, w, h);
  } else if (effect === 'prismatic') {
    sc.globalAlpha = 0.12;
    const hue = Math.floor((now * 10 + 180) % 360);
    sc.fillStyle = `hsl(${hue}, 100%, 70%)`;
    sc.fillRect(0, 0, w, h);
    sc.globalAlpha = 1;
  } else if (effect === 'starry') {
    const tex = starryImage;
    if (!tex) return; // texture not loaded yet — skip this frame
    sc.imageSmoothingEnabled = true;
    sc.globalAlpha = 0.6;
    const texW = tex.naturalWidth;
    const texH = tex.naturalHeight;
    const range = texW * 0.08;
    const panX = texW * 0.25 + Math.sin(now * 0.15) * range;
    const panY = texH * 0.25 + Math.cos(now * 0.1) * range * 0.6;
    sc.drawImage(tex, panX, panY, texW * 0.4, texH * 0.4, 0, 0, w, h);
    sc.globalAlpha = 1;
  } else {
    return; // unknown effect id — draw nothing
  }

  // Blit the silhouette-clipped effect onto the destination.
  ctx.drawImage(effectScratch!, 0, 0, w, h, dx, dy, dw, dh);
}
```

- [ ] **Step 4: Add a static effect frame to portrait canvases**

Add an effect-aware static portrait helper that reuses `getRecoloredWithHat` and stamps one frame:

```typescript
const recolorHatEffectCache = new Map<string, HTMLCanvasElement>();

/**
 * A static portrait: recolored sprite + hat with a single (non-animated) frame
 * of `effect` composited on. Cached by sprite + hues + hat + effect. Falls back
 * to the plain hat portrait when there's no effect.
 */
export function getRecoloredWithHatEffect(
  sprite: string,
  colors: Record<string, number>,
  regions: string[],
  hatId: string | null | undefined,
  effect: string | null | undefined,
): HTMLCanvasElement | null {
  const base = getRecoloredWithHat(sprite, colors, regions, hatId);
  if (!base || !effect) return base;
  const hues = regions.map((r) => colors[r] ?? 120).join('-');
  const key = `${sprite}-${hues}-${hatId}-${effect}`;
  const cached = recolorHatEffectCache.get(key);
  if (cached) return cached;

  const out = document.createElement('canvas');
  out.width = base.width;
  out.height = base.height;
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(base, 0, 0);
  // The silhouette mask is in sprite-pixel space; the hat portrait pads the top
  // and sides. Draw the effect over the sprite's footprint within the portrait.
  const img = rawImages[sprite];
  if (img) {
    const sw = img.naturalWidth || img.width;
    const sh = img.naturalHeight || img.height;
    // The plain recolor is exactly sprite-sized and sits bottom-aligned,
    // horizontally centered within the (hat-)padded portrait. Draw the effect
    // over that footprint.
    const dx = (base.width - sw) / 2;
    const dy = base.height - sh;
    drawCreatureEffect(ctx, sprite, effect, dx, dy, sw, sh, 0);
  }
  recolorHatEffectCache.set(key, out);
  return out;
}

export function getRecoloredWithHatEffectDataUrl(
  sprite: string,
  colors: Record<string, number>,
  regions: string[],
  hatId: string | null | undefined,
  effect: string | null | undefined,
): string | null {
  return getRecoloredWithHatEffect(sprite, colors, regions, hatId, effect)?.toDataURL() ?? null;
}
```

> Note: `getRecoloredWithHat` pads the top (and sides) for tall hats and keeps the sprite bottom-aligned and horizontally centered (see its implementation ~553-580). `dx = (width - sw)/2`, `dy = height - sh` therefore lands the effect exactly over the sprite footprint. If a future hat pad makes this drift, prefer exposing the pad offsets from `getRecoloredWithHat` — but for the current implementation this is correct.

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/undercity/engine/sprite-engine.ts
git commit -m "feat(undercity): silhouette mask + drawCreatureEffect overlay engine"
```

---

### Task 9: Animate effects on board pawns

**Files:**
- Modify: `src/app/undercity/engine/board-canvas.ts` — `BoardPlayer` interface (~118), `drawPlayerToken` (~1988-2054)
- Modify: `src/app/undercity/tabs/board-tab.component.ts` — board-player construction (~1390)

- [ ] **Step 1: Add `effect` to the `BoardPlayer` interface**

In `board-canvas.ts`, next to `shiny?: boolean;` (~124):

```typescript
  /** Animated special paint — an overlay drawn over the token's silhouette. */
  effect?: string | null;
```

- [ ] **Step 2: Import and call `drawCreatureEffect` in `drawPlayerToken`**

Add `drawCreatureEffect` to the existing `sprite-engine` import (~12). Then, inside `drawPlayerToken`, immediately after the sprite `ctx.drawImage(sprite, x - spriteW / 2, top, spriteW, drawH);` and before the hat block (so the hat stays on top of the shimmer), add:

```typescript
      if (p.effect) {
        drawCreatureEffect(this.ctx, spr.sprite, p.effect, x - spriteW / 2, top, spriteW, drawH, this.effectClock);
      }
```

- [ ] **Step 3: Add an `effectClock` fed by the loop**

The class already accumulates `dt` for shiny (search `shinyAccum`). Add a monotonic clock field near those accumulators:

```typescript
  private effectClock = 0; // ms, monotonic; drives special-paint overlays
```

In the per-frame update where `dt` (seconds) is available (the same place `shinyAccum += dt` runs, ~1898-1909), add:

```typescript
    this.effectClock += dt * 1000;
```

- [ ] **Step 4: Pass `effect` when building board players**

In `board-tab.component.ts` (~1390), where the board player is built with `paint`/`shiny`:

```typescript
          paint: p.paint ?? {},
          // ...existing fields...
          shiny: p.shiny,
          effect: p.effect,
```

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/undercity/engine/board-canvas.ts src/app/undercity/tabs/board-tab.component.ts
git commit -m "feat(undercity): animate special paints on board pawns"
```

---

### Task 10: Animate effects on plaza pawns

**Files:**
- Modify: `src/app/undercity/engine/plaza-canvas.ts` — partner interface (~22-25), partner draw (~879 area), loop clock (~661)
- Modify: `src/app/undercity/tabs/plaza-tab.component.ts` — partner construction (~318)

- [ ] **Step 1: Add `effect` to the plaza partner interface**

In `plaza-canvas.ts`, next to `shiny?: boolean;` (~25):

```typescript
  /** Animated special paint — an overlay drawn over the sprite's silhouette. */
  effect?: string | null;
```

- [ ] **Step 2: Import + call `drawCreatureEffect` after the partner sprite draw**

Add `drawCreatureEffect` to the `sprite-engine` import (~11). After the partner `ctx.drawImage(d.spriteCanvas, -halfW, -halfH, spriteW, spriteH);` (~879) and before the hat draw, add:

```typescript
      if (d.partner.effect) {
        drawCreatureEffect(ctx, spr.sprite, d.partner.effect, -halfW, -halfH, spriteW, spriteH, this.effectClock);
      }
```

(`spr` is the resolved form sprite already in scope where `hatPlacement(spr.sprite, ...)` is called; if it isn't in scope at the draw point, compute it from the partner's form the same way the hat block does.)

- [ ] **Step 3: Add the `effectClock`**

Near `shinyAccum` (~144):

```typescript
  private effectClock = 0; // ms, monotonic; drives special-paint overlays
```

In the update where `dt` is available (the `shinyAccum += dt` region ~661):

```typescript
    this.effectClock += dt * 1000;
```

- [ ] **Step 4: Pass `effect` when building the partner**

In `plaza-tab.component.ts` (~318):

```typescript
      paint: p.paint ?? {},
      // ...existing fields...
      shiny: p.shiny,
      effect: p.effect,
```

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/undercity/engine/plaza-canvas.ts src/app/undercity/tabs/plaza-tab.component.ts
git commit -m "feat(undercity): animate special paints on plaza pawns"
```

---

### Task 11: Pre-spawn shop UI — buy & equip special paints

**Files:**
- Modify: `src/app/undercity/hatch/hatch-flow.component.ts` (signals + methods) and its template (`.html` or inline `template:`)

- [ ] **Step 1: Import the mirror**

Update the `cosmetics` import (~6):

```typescript
import { PAINTS, PAINT_MAP, HATS, HAT_MAP, HAT_PRICES, PAINT_PRICE,
         SPECIAL_PAINTS, SPECIAL_PAINT_PRICE } from '../data/cosmetics';
```

- [ ] **Step 2: Add signals, cost, ownership, toggle, wear, clear**

Alongside the existing paint members:

```typescript
  protected readonly allSpecialPaints = SPECIAL_PAINTS;
  protected readonly specialPaintPrice = SPECIAL_PAINT_PRICE;
  protected readonly cartEffects = signal<string[]>([]);
  protected readonly equipEffect = signal<string | null>(null);

  protected ownsEffect(id: string): boolean {
    return this.owned(this.store.wardrobe()?.effects, id, this.cartEffects());
  }

  toggleEffect(id: string): void {
    const cart = this.cartEffects();
    if (cart.includes(id)) {
      this.cartEffects.set(cart.filter((e) => e !== id));
      if (this.equipEffect() === id && !this.store.wardrobe()?.effects?.includes(id)) {
        this.equipEffect.set(null);
      }
    } else if (!this.ownsEffect(id) && this.canAfford(this.specialPaintPrice)) {
      this.cartEffects.set([...cart, id]);
    }
  }

  wearEffect(id: string | null): void {
    this.equipEffect.set(this.equipEffect() === id ? null : id);
  }
```

Extend `cartCost` (~118) to include effects:

```typescript
    sum += this.cartPaints().length * this.paintPrice;
    sum += this.cartEffects().length * this.specialPaintPrice;
    return sum;
```

Extend `clearCart` (~320):

```typescript
    this.cartPaints.set([]);
    this.cartEffects.set([]);
    this.equipPaint.set(null);
    this.equipEffect.set(null);
```

Extend the `join` payload in `hatch()` (~347):

```typescript
        buyPaints: this.cartPaints(),
        buyEffects: this.cartEffects(),
        buyItems: [],
        equipHat: this.equipHat(),
        equipPaint: this.equipPaint(),
        equipEffect: this.equipEffect(),
```

- [ ] **Step 3: Add the shop section to the template**

Find the paints section in the hatch-flow template and add a sibling "Special Paints" section modeled on it. Minimal version:

```html
<section class="shop-group">
  <h4>Special Paints <span class="price">{{ specialPaintPrice }} renown</span></h4>
  <div class="swatch-row">
    @for (sp of allSpecialPaints; track sp.id) {
      <button
        type="button"
        class="swatch effect-{{ sp.id }}"
        [class.owned]="ownsEffect(sp.id)"
        [class.equipped]="equipEffect() === sp.id"
        (click)="ownsEffect(sp.id) ? wearEffect(sp.id) : toggleEffect(sp.id)"
      >
        <span class="swatch-name">{{ sp.name }}</span>
      </button>
    }
  </div>
</section>
```

Match the existing paints section's class names/structure where they differ; the goal is one tappable chip per effect that buys when unowned and equips when owned, consistent with hats/paints.

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/app/undercity/hatch/
git commit -m "feat(undercity): buy/equip special paints in pre-spawn shop UI"
```

---

### Task 12: Wardrobe UI — equip/unequip special paints

**Files:**
- Modify: `src/app/undercity/tabs/creature-tab.component.ts` (imports ~25, `ownedEffects` computed, `setEffect` method) and its template

- [ ] **Step 1: Import the mirror**

Update the `cosmetics` import (~25):

```typescript
import { HATS, PAINTS, SPECIAL_PAINTS, HatInfo, PaintInfo, SpecialPaintInfo } from '../data/cosmetics';
```

- [ ] **Step 2: Add owned list + setter**

Alongside `ownedPaints` (~341):

```typescript
  protected readonly ownedEffects = computed<SpecialPaintInfo[]>(() => {
    const owned = new Set(this.store.wardrobe()?.effects ?? []);
    return SPECIAL_PAINTS.filter((e) => owned.has(e.id));
  });

  async setEffect(effect: string | null): Promise<void> {
    const you = this.store.you();
    if (!you) return;
    const next = you.effect === effect ? '' : (effect ?? '');
    await this.run(() =>
      this.store.action('customize', { effect: next, hat: you.hat ?? '' }).then(() => undefined),
    );
  }
```

- [ ] **Step 3: Add the wardrobe row to the template**

In the wardrobe subtab, after the paints group, add (only shows when the player owns at least one):

```html
@if (ownedEffects().length) {
  <div class="wardrobe-group">
    <h4>Special Paint</h4>
    <div class="swatch-row">
      <button type="button" class="swatch" [class.equipped]="!store.you()?.effect" (click)="setEffect(null)">None</button>
      @for (sp of ownedEffects(); track sp.id) {
        <button type="button" class="swatch effect-{{ sp.id }}"
                [class.equipped]="store.you()?.effect === sp.id"
                (click)="setEffect(sp.id)">{{ sp.name }}</button>
      }
    </div>
  </div>
}
```

Match the surrounding wardrobe group's real class names.

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/app/undercity/tabs/
git commit -m "feat(undercity): equip special paints from the wardrobe"
```

---

### Task 13: Static effect frames on portraits (creature-tab preview)

**Files:**
- Modify: `src/app/undercity/tabs/creature-tab.component.ts` — the portrait helpers (~228, ~349)

The creature-tab currently renders the own creature via `getRecoloredWithHatDataUrl` / `getRecoloredDataUrl`. Route these through the effect-aware static helper so the equipped effect shows on the preview (static frame).

- [ ] **Step 1: Import the effect-aware helper**

Add `getRecoloredWithHatEffectDataUrl` to the `sprite-engine` import in `creature-tab.component.ts`.

- [ ] **Step 2: Use it for the main portrait**

Replace the body of the main portrait getter (~228):

```typescript
    return getRecoloredWithHatEffectDataUrl(spr.sprite, you.paint ?? {}, spr.regions, you.hat, you.effect);
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/app/undercity/tabs/creature-tab.component.ts
git commit -m "feat(undercity): show equipped special paint on creature portrait"
```

---

### Task 14: Final verification

- [ ] **Step 1: Backend suite green**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS (including the new special-paint tests).

- [ ] **Step 2: Frontend build clean**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 3: Manual smoke (optional, uses the run-undercity skill)**

Drive the app to the pre-spawn shop with ≥500 renown, buy a special paint, equip it, hatch, and confirm the board pawn shimmers. Then swap it in the wardrobe. (The user runs deploys — the live AWS backend must have the new Lambda deployed for the shop path to work end-to-end; note this rather than deploying yourself.)

- [ ] **Step 4: Note deploy needed**

Report that backend changes require a `cdk deploy` (user runs deploys) and the frontend a `npm run deploy`, then stop.

---

## Self-review notes

- **Spec coverage:** manifest+price (T1), owned list + creature field (T2), serializers/wardrobe (T3), shop buy/equip (T4), wardrobe swap (T5), client mirror+models (T6), starry asset (T7), mask+overlay engine+static variant (T8), board animation (T9), plaza animation (T10), shop UI (T11), wardrobe UI (T12), portrait static frame (T13), verification (T14). All design sections mapped.
- **Performance:** cached silhouette mask (built once/sprite), single pooled scratch canvas, ~3 canvas ops per creature per frame, no per-frame pixel reads or recolor, RAF-timestamp clock (no `Date.now()`), static frames off the RAF elsewhere. Matches the design's explicit perf requirement.
- **Type consistency:** server `perm['effects']` / `doc['effect']`; payload keys `buyEffects`/`equipEffect` (shop) and `effect` (customize); client `Wardrobe.effects`, `*.effect`; engine `drawCreatureEffect` / `getSilhouetteMask` / `getRecoloredWithHatEffect(DataUrl)` — names used consistently across tasks.
- **Test-helper caveat:** the exact `test_undercity_db.py` helper names (`_make_session`/`_join`/`_state`/`_action`/`_save_perm`) must be reconciled with the suite's real helpers on first read; the assertions and payloads are the contract.
