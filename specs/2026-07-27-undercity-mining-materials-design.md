# The Undercity — Mining feeds crafting materials (spore-sink fix)

**Status:** design + implemented · 2026-07-27
**Origin:** playtest findings (`specs/2026-07-26-undercity-playtest-findings-20260725.md` §4)
— 1,766 Spores sat unspent because the big sink (gear upgrades) was gated by Chrysalis
Ichor, whose ONLY source was salvaging rare tier-3+ gear (self-competing with equipping it).
7 of 8 players ended a night with 0 ichor, so upgrades never happened and Spores piled up.

## 1. Decision

Keep gear-upgrades as the flagship Spore sink; fix the **ichor supply** by making the two
mining minigames — the **crystal vein** and **excavation** — pay ichor + moltings. (Rejected
alternatives: demote ichor so Spores buy upgrades directly; add a Spore→ichor exchange. Both
flatten the material-hunt; the host chose the mining tap.)

Target (host calibration 2026-07-27): the game currently lets a dedicated player take **~1**
piece to Mythic a night (scraping ~4 ichor from salvage); aim for **2–3 pieces**. Mythic =
tier 4; base→mythic costs **4 ichor + 9 moltings + 270 Spores** end-to-end.

## 2. Change (backend, `undercity_db.py` + `undercity_data.py`)

- **Crystal vein** (`_vein_strike_once`): each surviving strike grants **+`VEIN_MOLTINGS_PER_STRIKE`
  molting** and **ichor on a depth-scaling roll** (`VEIN_ICHOR_BASE + level·VEIN_ICHOR_PER_LEVEL`
  = ~54% shallow → ~98% deep). The **Heartstone** (depth 12) adds **+`VEIN_HEARTSTONE_ICHOR`**.
- **Excavation** (`_dig`): fully clearing a dig site grants **+`EXCAVATION_CLEAR_ICHOR` ichor,
  +`EXCAVATION_CLEAR_MOLTINGS` moltings** alongside its Spore clear-bonus.
- New `_mine_materials(doc, ichor, moltings)` helper (mirrors the salvage grant path).
- Upgrade costs **unchanged** — supply does the work.

Scalars (in `undercity_data.py`, beside the vein/excavation tables):
`VEIN_MOLTINGS_PER_STRIKE=1`, `VEIN_ICHOR_BASE=0.5`, `VEIN_ICHOR_PER_LEVEL=0.04`,
`VEIN_HEARTSTONE_ICHOR=4`, `EXCAVATION_CLEAR_ICHOR=1`, `EXCAVATION_CLEAR_MOLTINGS=2`.

## 3. Client (`src/app/undercity/data/items.ts`)

Updated the `crystal_vein` and `excavation` space tooltips to tell players these spaces pay
Chrysalis Ichor + Moltings for gear upgrades (and corrected the dig count 4→6). Enemy/reward
payouts are server-sent, so no other mirror.

## 4. Calibration (sim, 24 seeds, controlled dedicated-mining night)

Ichor accrued per night by mining effort (on top of any salvage):

| effort | ichor | Mythic pieces |
|---|---|---|
| light (2 vein visits, 1 clear) | ~4 | ~1 |
| moderate (3 vein, 2 clears) | ~6 | ~1.5 |
| **dedicated (5 vein, 3 clears)** | **~10** | **~2.5** |

Hits the 2–3 target from mining alone at the dedicated end. The spore sink follows for free:
2–3 Mythic pieces = **450–810 Spores spent**, ~the hoard the playtest showed (Andrew sat on
638). Note: the *wandering* sim bot barely reaches the sparse vein tiles in a 50-roll night,
so casual players still won't mine much — mining is an opt-in grind, by design.

## 5. Tests

`test_undercity_db.py`: vein strike grants moltings (+ichor roll via a constant-RNG hit),
Heartstone grants its ichor jackpot, excavation clear grants the materials cache. All green;
the only red tests in the suite are the host's in-flight map/spell WIP, untouched by this.

## 5b. Rename: "Chrysalis Ichor" → "Gemstone" (player-facing, 2026-07-27)

So players intuit the material comes from the mines, the upgrade material is displayed as
**"Gemstone"** everywhere (event/error text, tooltips, the plaza material chip — whose icon
changed from `science` to `diamond`, matching the crystal-vein icon). The **internal key and
all constant names stay `ichor`** (`materials.ichor`, `SALVAGE_ICHOR`, `UPGRADE_ICHOR`,
`VEIN_*_ICHOR`, `EXCAVATION_CLEAR_ICHOR`) — a display-only change, so no player-doc migration.
If you grep for the material in code, it's `ichor`; on screen it's "Gemstone".

## 6. Rollout

Backend + one client tooltip file. Backend needs a `cdk deploy` (host runs it); the tooltip
ships with the next site build. Nothing changes for players until deployed.
