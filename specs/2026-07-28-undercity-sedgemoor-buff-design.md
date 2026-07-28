# The Undercity — Sedgemoor (bog) start buff

**Status:** design + implemented · 2026-07-28
**Origin:** host feedback — the bog / **The Sedgemoor** start (Mirefoot perk) is weak: its
only edge was "hazards cost half," and its innate spell **Bog Snare** ("curse a rival: their
next roll is halved") is a PvP-only curse that — unlike the other biome curses — can't touch
bosses or gate guardians. Goal: make the Sedgemoor native harder to grief and give it a
useful self-utility spell.

## 1. Change

**Mirefoot perk — add evasion.** Keep "hazards cost you half," add a flat **+12% spell-dodge**
against rival field spells/curses (`MIREFOOT_SPELL_DODGE`). Bog natives are now genuinely
hard to mess with — Bog Snare, Scrap Toss, Rot Surge, etc. miss them more often. Wired into
`undercity_db._spell_dodge_pct` (bonus when `target.homeBiome == 'bog'`), stacking on the
existing SPD-based dodge before the Squirrel-Mage penetration multiplier.

**New innate spell — Sinkstep (replaces Bog Snare as the bog innate).** A self-utility fate
spell: **your next roll is a guaranteed 1** — "plant one sure step in the mire." Reuses the
existing `fate_die` effect (the Skitter Step machinery) with `maxValue: 1`. Tier 1, 25-min
cooldown, traversal. Usable anytime, no target — a precision tool to land exactly on an
adjacent lair/shop/claim or avoid overshooting into a hazard.

`bog_snare` is **not** deleted — it stays available in the Hexweaver's Codex grimoire; only
the bog *innate* (`BIOME_SPELLS['bog']`) is repointed to `sinkstep`.

## 2. Naming

The perk keeps the name **Mirefoot** (host's call); the new spell is **Sinkstep**.

## 3. Files

- `undercity_data.py` — `MIREFOOT_SPELL_DODGE=12`; `SPELLS['sinkstep']`;
  `BIOME_SPELLS['bog']='sinkstep'`; Mirefoot `perkBlurb` updated.
- `undercity_db.py::_spell_dodge_pct` — Mirefoot dodge bonus.
- `sync_spells.py` → regenerated `src/app/undercity/data/spells.generated.ts` (client mirror;
  not hand-edited).
- `src/app/undercity/hatch/hatch-flow.component.ts` — client copy of the Mirefoot blurb.

## 4. Tests

`test_undercity_spells.py`: bog innate is Sinkstep (fate_die maxValue 1, Bog Snare still
exists); Sinkstep forces a 1 and rejects other values; Mirefoot adds exactly
`MIREFOOT_SPELL_DODGE` to a bog target's dodge. Full suite: only the host's in-flight
map/witch WIP is red; this change adds no new failures. Client build green.

## 5. Rollout

Backend needs a `cdk deploy` (host runs it); the spell mirror + hatch blurb ship with the
next site build. Design note: Sinkstep (guaranteed 1) is a strict subset of Skitter Step
(choose 1–3); if the Sedgemoor should *propel*, revisit as a "choose 1–N" fate spell — but
the intent here is precision, not distance.
