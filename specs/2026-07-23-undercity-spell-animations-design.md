# Undercity — Spell cast & hit animations

Status: approved 2026-07-23

## Goal

Give every spell cast a small visual payoff on the board, and make "getting hit
by a spell" read on your own token. Today only `self_buff` sparkles
(`board.burstBuff`); every other cast just shows a toast, and an incoming hit
from another player only surfaces as a text away-note.

All effects are canvas particles in `board-canvas.ts`, triggered from
`castSpell()` in `board-tab.component.ts`. Both caster and target tokens live in
world space (`tokenAnims`, keyed by `userId`); the existing `sparkles` / `heals`
particle arrays are the pattern being extended. **No backend changes.**

## FX primitives (new, board-canvas)

The render loop draws everything inside the world transform and already resolves
per-token live positions into a `placed[]` list each frame. A queue is resolved
against `placed[]` mid-frame — mirroring the existing `pendingHealPops` pattern —
so a caller only needs `userId`s, not coordinates.

- `bolts: Bolt[]` — a glowing mote that travels `from → to` over a short
  duration, drawn with a short trail, firing `onArrive` once on landing.
- `impactAt(x, y, color, glow)` — radial spark burst (extends `Sparkle` with an
  optional `vx` so sparks fly outward, not just up).
- `puffAt(x, y, color, glow, mode)` — sparkle pop; `mode: 'burst'` (outward, the
  existing burstBuff shape) or `'implode'` (spawned on a ring, drifting inward)
  for teleport/recall/curse.
- `floatNumber(x, y, text, color)` — generalizes the heal-number renderer to
  take a colour (red `-N` for damage, or `miss`). `HealNumber` gains an optional
  `color`.
- Per-token hit reaction: `TokenAnim` gains `hitLife` / `hitMax`, decayed in
  `updateHealFx`. `drawToken` reads them to (a) shake the sprite horizontally and
  (b) overlay an additive red radial flash. No per-pixel sprite tinting.

## Cast dispatcher

`castSpellFx(spell, casterId, targetId?, targetNode?)` queues a request resolved
against `placed[]` in `draw()`. Category → primitives + palette:

| effect | visual |
|---|---|
| `self_buff` | existing tinted sparkle burst at caster (unchanged) |
| `self_heal` | green upward sparkles + `+HP` number (existing heal path) |
| `field_damage` | red/orange bolt caster→target, then impact + flash/shake + `-dmg` |
| `field_curse` | purple bolt → target, implode puff + flash |
| `teleport` | blue implode puff at origin, burst puff at destination node |
| `recall` | teal inward-spiral puff at caster |
| `fate_die` | gold shimmer burst at caster |
| `boss_strike` | big gold/red bolt → boss node (found via `type:'boss'`), heavy impact |
| `wish` | prismatic burst at caster, then the wished spell's own effect |

Dodged targeted spells → the `miss` float + a small neutral puff, no damage
number, no flash.

## Getting hit by others

The `awayEvents` effect in `board-tab` already toasts a new `spell_hit` /
`spell_dodged`. Alongside the toast, call `board.spellHitFx(ownUserId, dodged,
dmg)`:
- hit → flash + shake + red `-dmg` float on your own token.
- dodged → `miss` float only.

## Testing

No frontend test runner. Verify with `npm run build` staying green; the particle
layer is visual-only and self-contained. Ready to run/deploy after that (the user
runs deploys).
