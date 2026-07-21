# Undercity balance simulation — findings

Generated from the headless simulator in this directory
(`python -m sim.sweep` → `out/results.md`, plus targeted diagnostics).
See `specs/2026-07-20-undercity-balance-sim-design.md` for the design.

## How to read this

- **Full-game driver** plays whole games via the real action dispatcher with a
  bot policy. Rolls are free in-sim (`data.DEBUG`), so a "turn" = one roll+move
  and the curve is the *raw* power curve, independent of roll income. Convert to
  real time with the economy overlay below.
- **Arena** builds a creature at a controlled level/evolution/gear and runs the
  faithful interactive fight (NPC telegraph + player read→counter) many times
  vs each enemy tier, incl. lair-class wilderness enemies and Savra.
- Bots play at a consistent "reasonable" skill: counter the foe's intent when
  the engine grants a read, else play a preferred stance.

**Caveats (don't over-read):** the arena enters every fight at full HP (it
measures per-fight strength, not attrition across a dungeon run); the boss is a
shared 400-HP pool, so "Savra dmg/att" is damage per single attempt and the win%
is a single-attempt kill — a lone player realistically fells her over ~2
attempts. Bot skill is fixed; a weaker/stronger player shifts absolute numbers
but not the relative gaps.

---

## 1. Progression pacing

Median turn to reach each milestone (24 seeds, baseline builds):

| playstyle | L5 / evolve T2 | L10 / apex | L12 | median deaths (over 250 turns) |
|---|---|---|---|---|
| Rusher (fight everything) | ~16 | ~30 | ~34 | 32 |
| Tank | ~42 | ~86 | ~100 | 12 |
| Farmer | ~51 | ~90 | ~100 | 16 |
| Speedster (flee everything) | ~146 | rarely | rarely | 0 |

**Economy overlay.** Roll income ≈ regen 3/30 min (cap 6) ≈ ~6 rolls/hr, plus
board-game claims (+2, +1 if won). A ~4-hour game night ≈ **30–45 turns**.

**Conclusions**

1. **An aggressive player solves the whole power curve in one night.** Rusher
   hits apex + L12 by ~34 turns — inside a single night's roll budget. After
   that, every non-boss encounter is ~100% (see §2), so the back half of the
   night has no PvE challenge left except the boss. Fine if "max in one night"
   is intended for a party game; a problem if you want a multi-night chase.
2. **XP is gated entirely behind combat wins**, so avoiding fights self-stalls
   progression. The Speedster (flees at 55% HP) barely reaches L5 and never
   reliably evolves. A cautious/evasive playstyle isn't a slow path to the same
   place — it's a dead end. If evasion is meant to be viable, it needs a
   non-combat XP source.
3. **Early elites are death traps.** At levels 1–4 the win rate vs elite spaces
   is ~8–21% (full-game data). With 28 elite spaces on the board, a fresh
   hatchling that lands on one almost certainly composts. Deaths are cheap
   (respawn at 50% HP, no XP loss), so this reads as swingy rather than
   punishing — but it's the dominant early death source.

---

## 2. Content difficulty curve

Arena win rate, neutral skilled player, by level (from §2 of results.md):

- **L1:** basic wilds ~80–100%; elites ~2–28% (coin-flip to death); wilderness
  tier ~0% (correctly gated as the T2+ frontier).
- **L5 (T2):** normal board trivial; wilderness 47–84%; wilderness-elites still
  threatening (embermaw ~6–20%).
- **L10 (T3 apex):** the **entire** normal + wilderness ladder is ~95–100%. The
  only non-trivial fight left in the game is Savra.

**Conclusion.** Difficulty is essentially binary: content is either a real
threat (below your tier) or fully solved (at/above L10). There is no "tuned
mid-game" band — you outrun all board content by apex, and then the boss is the
sole remaining challenge. Consider scaling some wild/elite spawns with player
tier so the board stays live late.

---

## 3. Build balance

### Stat allocation — ATK+Aggress dominates; Guard/DEF is the weak axis

Isolating stat from stance (pest L10, dmg to Savra per attempt):

| stat build | best stance dmg | via Aggress | via Guard | via Feint |
|---|---|---|---|---|
| pure-ATK | 359 (aggress) | **359** | 129 | 213 |
| pure-SPD | 236 (feint) | 202 | 169 | **236** |
| pure-DEF | 256 (aggress) | **256** | 139 | 127 |

- **Aggress is the best damage stance for every stat build** — even a pure-DEF
  creature does more boss damage aggressing (256) than a pure-ATK creature
  guarding (129).
- **Guard is the weak stance.** Its big swing only lands on Guard-beats-Aggress
  exchanges; the trickster boss and feint-heavy elites rarely aggress, so Guard
  stalls. This is the mechanical root of "DEF builds can't close fights."
- Therefore **DEF is a survival-only stat with no offensive conversion** in
  practice. Against the one HP-race that matters (the boss) a pure-DEF build
  can't win (0–2% at L10). This directly misses the build-diversity bar: a
  dedicated tank doesn't "feel good" offensively.
- **SPD/Feint is a legitimate second identity** (feint is pure-SPD's best
  stance). So the gap is specifically **Guard↔DEF**, not "everything but ATK."

**Suggested lever:** make Guard's payoff less enemy-conditional (e.g. a chip on
stall, or DEF contributing a small flat amount to Aggress/Feint swings) so a
DEF investment converts to offense the way SPD does. `STANCE_SIG_WEIGHT` /
`STANCE_STALL_MULT` in `undercity_config.py` are the knobs.

### Starters — kraul strongest, zombie weakest

At equal level/skill, **kraul** (glass cannon, high ATK+SPD) leads on the metric
that matters late (boss dmg: 240 at L10 vs pest 164, saproling 205, zombie 140);
**zombie** trails everywhere (its drift/flee passive does nothing in a fight).
saproling's Regrowth makes it the most forgiving survivor. None is unplayable,
but zombie needs a combat-relevant hook.

### Evolution — Izoni (extra strike) is the best finisher; Grave Titan the worst

All saproling apex lines clear the normal+wilderness ladder at 100%; they only
separate on the boss:

| apex | passive | Savra dmg/att |
|---|---|---|
| Izoni, Thousand-Eyed | extra strike/round | **~336–343** |
| Golgari Lich Lord | drain 50% | ~251–255 |
| Grave Titan | pierce 3 DEF | **~200** |

**Izoni's Swarm (an extra strike every round) is the dominant apex** — a flat
+strike scales harder than pierce or lifedrain against a high-HP boss. **Grave
Titan underperforms** despite being the "apex tank" — pierce-3 is nearly wasted
on content you already beat, and it's the weakest finisher. Tanky apexes are
the trap tier, consistent with the DEF finding above.

### Equipment — meaningful, correctly ordered, boss-focused

Gear barely moves already-trivial content but roughly **doubles** boss
performance: no gear = 164 dmg (1% kill), a full T3 set = 373 dmg (75% kill).
Single T3 pieces add ~40–100 boss dmg each; aggro (fang) gives the most damage,
carapace the most survival. This axis looks healthy.

---

## Headline takeaways

1. Power curve is **fully solved in ~1 night** by an aggressive player; the
   board has **no late-game challenge** except the boss.
2. **Guard/DEF is the underpowered axis** — Aggress+ATK (and to a lesser extent
   Feint+SPD) are the only reliable damage identities, so tank builds and the
   tanky apex (Grave Titan) don't pull their weight offensively.
3. **Evasive play is a progression dead end** because XP is combat-gated.
4. **Early elites are the main death source**; difficulty is binary (threat vs
   trivial) with no tuned mid-band.
