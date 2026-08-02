# Undercity — Evolution Cutscene

**Date:** 2026-08-02
**Status:** Approved design

## Goal

When a player evolves their creature, replace the instant "overlay closes, toast
appears" transition with a short Pokémon-style evolution cutscene: the creature
turns into a silhouette, strobe-flickers between its old and new shapes, then
blooms from silhouette back into full color as the new form.

## Scope

- Client-only. No server, engine, or balance changes — evolution already resolves
  server-side via the existing `evolve` action.
- Lives entirely in the creature tab
  (`src/app/undercity/tabs/creature-tab.component.{ts,html,scss}`).
- Approach **A**: two stacked `<img>` layers + CSS keyframes. No new canvas
  engine. Reuses the existing recolored-sprite data-URL rendering the hero
  portrait already uses (`spriteUrl` / `formSpriteUrl`).

## Flow

Current `evolve(form)` ([creature-tab.component.ts:618]):

1. `await store.action('evolve', { form: form.id })`
2. `showEvolve.set(false)`
3. `showToast('You are now a …! Fully healed.')`

New flow:

1. **Snapshot old sprite** — capture the current hero sprite data URL (old form,
   with the player's paint/variant) *before* the action, from `spriteUrl()`.
2. `await store.action('evolve', { form: form.id })` — `store.you().form` is now
   the new form.
3. **Snapshot new sprite** — capture the new form's sprite data URL (same
   paint/variant), computed the same way the hero portrait computes it.
4. `showEvolve.set(false)` and set `evolveCutscene.set({ from, to })`. The
   cutscene overlay mounts and plays.
5. On animation end **or** tap-to-skip: `evolveCutscene.set(null)` and show the
   existing toast.

If either snapshot is missing (null sprite), skip the cutscene and fall back to
the current instant behavior + toast, so evolution never gets stuck.

### State

- `evolveCutscene = signal<{ from: string; to: string } | null>(null)` — data
  URLs for the old and new sprites. Non-null drives the overlay.
- A single completion timer (`setTimeout`) clears the signal at the end of the
  reveal; tapping the overlay clears it early (and cancels the timer).

## The overlay

A full-screen fixed overlay (same z-layer / styling family as `evolve-overlay`),
dark backdrop, centered. Contains:

- **Layer A** — old-form `<img>` (silhouette).
- **Layer B** — new-form `<img>` (silhouette, then colored on reveal).
- **Flash veil** — a full-screen white div that blows out on strobe beats and the
  final burst.

Silhouette is `filter: brightness(0)` (keeps alpha shape, fills it black —
identical to the "Who's that Pokémon?" look). Reveal animates `filter` from
`brightness(0)` up to `brightness(1)` (full color).

### Timeline (~2.7s total, tap to skip)

| Phase | ~Duration | What happens |
|-------|-----------|--------------|
| Charge | 0.5s | Old sprite snaps to black silhouette over darkened backdrop; gentle pulse/scale + ambient glow. |
| Strobe-swap | 1.2s | Old ↔ new silhouettes cross-flash, **accelerating** (~450ms/beat → ~110ms/beat, ~6–8 beats), each beat kicked by a quick white flash. |
| Burst | 0.3s | Full-screen white veil flashes and settles on the **new** silhouette. |
| Reveal | 0.7s | New sprite fades `brightness(0) → brightness(1)` (silhouette → color); scale eases from slightly large to normal. |

Implementation of the accelerating strobe: CSS keyframes on the two layers'
opacity with a non-linear beat schedule (either hand-authored keyframe stops or a
short JS-driven interval that shortens each beat). Prefer pure CSS keyframes for
determinism; fall back to a timed opacity toggle only if the acceleration curve
is hard to express in keyframes.

`prefers-reduced-motion`: skip the strobe/spin, just cross-fade old → new colored
sprite over ~0.4s, then toast.

## Testing / verification

No unit runner in this repo. Verify by:

- `npm run build` stays green.
- Manually via the `run-undercity` skill: reach an evolve-ready creature, pick a
  form, and confirm the cutscene plays (silhouette → strobe → color reveal),
  tap-to-skip works, and the hero portrait shows the new form afterward.

## Out of scope

- Particle/shader flair (approach B).
- Any change to what forms are offered or the server evolve rules.
- Reusing the cutscene for hatch or other transformations.
