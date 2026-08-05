# Undercity balance simulation — results

## 1. Progression (full-game driver, 24 seeds each)

Turns are per roll+move; rolls are free in-sim so this is the raw power curve, independent of roll income. See the economy overlay note below.


**pest/city — rusher**  (median deaths 10, max 21)
- milestone turns: level2=5, level3=8, level5=16, evolve_t2=16, level8=24, level10=34, evolve_t3=34, level12=46
- power@turn: 10:54, 25:86, 50:118, 100:122, 150:122, 200:122
- winrate: wild[1-4]=62%(n47), wild[5-9]=95%(n91), wild[10-12]=100%(n1225), elite[1-4]=20%(n212), elite[5-9]=80%(n290), elite[10-12]=100%(n3532)

**saproling/cavern — rusher**  (median deaths 32, max 45)
- milestone turns: level2=5, level3=12, level5=22, evolve_t2=22, level8=36, level10=51, evolve_t3=51, level12=65
- power@turn: 10:46, 25:70, 50:98, 100:116, 150:117, 200:117
- winrate: wild[1-4]=43%(n130), wild[5-9]=92%(n264), wild[10-12]=96%(n1579), elite[1-4]=9%(n192), elite[5-9]=66%(n230), elite[10-12]=82%(n1996)

**pest/city — farmer**  (median deaths 28, max 40)
- milestone turns: level2=8, level3=17, level5=40, evolve_t2=40, level8=63, level10=92, evolve_t3=92, level12=114
- power@turn: 10:52, 25:58, 50:90, 100:139, 150:146, 200:147
- winrate: wild[1-4]=34%(n207), wild[5-9]=85%(n313), wild[10-12]=94%(n1100), elite[1-4]=2%(n181), elite[5-9]=57%(n236), elite[10-12]=87%(n711)

**saproling/cavern — farmer**  (median deaths 23, max 41)
- milestone turns: level2=9, level3=24, level5=56, evolve_t2=56, level8=93, level10=130, evolve_t3=130, level12=168
- power@turn: 10:51, 25:56, 50:64, 100:100, 150:121, 200:141
- winrate: wild[1-4]=26%(n249), wild[5-9]=82%(n417), wild[10-12]=96%(n800), elite[1-4]=3%(n149), elite[5-9]=57%(n194), elite[10-12]=87%(n399)

**pest/city — speedster**  (median deaths 2, max 6)
- milestone turns: level2=19, level3=42, level5=105, evolve_t2=105, level8=208
- power@turn: 10:46, 25:53, 50:61, 100:68, 150:77, 200:84
- winrate: wild[1-4]=24%(n37), wild[5-9]=83%(n29), elite[1-4]=0%(n18), elite[5-9]=100%(n1)

**saproling/cavern — speedster**  (median deaths 1, max 2)
- milestone turns: level2=20, level3=44, level5=122, evolve_t2=122, level8=215, level10=220, evolve_t3=220
- power@turn: 10:43, 25:48, 50:56, 100:66, 150:79, 200:83
- winrate: wild[1-4]=64%(n33), wild[5-9]=94%(n18), wild[10-12]=100%(n2), elite[1-4]=0%(n2), elite[10-12]=100%(n1)

**pest/city — tank**  (median deaths 18, max 31)
- milestone turns: level2=8, level3=22, level5=51, evolve_t2=51, level8=96, level10=167, evolve_t3=167, level12=192
- power@turn: 10:53, 25:59, 50:66, 100:102, 150:107, 200:142
- winrate: wild[1-4]=38%(n191), wild[5-9]=82%(n366), wild[10-12]=98%(n482), elite[1-4]=8%(n135), elite[5-9]=60%(n220), elite[10-12]=98%(n256)

**saproling/cavern — tank**  (median deaths 30, max 40)
- milestone turns: level2=7, level3=18, level5=50, evolve_t2=50, level8=150, level10=212, evolve_t3=212, level12=200
- power@turn: 10:51, 25:56, 50:69, 100:82, 150:96, 200:104
- winrate: wild[1-4]=17%(n243), wild[5-9]=64%(n397), wild[10-12]=97%(n125), elite[1-4]=2%(n181), elite[5-9]=32%(n266), elite[10-12]=88%(n69)

## 2. Starter × level (arena, 300 fights/cell, neutral skilled player)


### Level 1

| build | drudge_beetle | myconid | fetid_imp | rot_shambler | large_bear | loleth_troll | embermaw_alpha | thornclad_revenant | Savra dmg/att |
|---|---|---|---|---|---|---|---|---|---|
| pest |   92% |   77% |   27% |   28% |    3% |   11% |    0% |    2% | 11/400 (0%) |
| kraul |   91% |   91% |   51% |   33% |    7% |   28% |    0% |    9% | 19/400 (0%) |
| saproling |   93% |   80% |   29% |   30% |    4% |   13% |    0% |    3% | 11/400 (0%) |
| zombie |   97% |   83% |   33% |   42% |    6% |   13% |    0% |    3% | 13/400 (0%) |
| squirrel |   90% |   77% |   28% |   25% |    4% |   12% |    0% |    3% | 11/400 (0%) |
| elf |   98% |   88% |   38% |   48% |    9% |   18% |    0% |    4% | 15/400 (0%) |

### Level 5

| build | drudge_beetle | myconid | fetid_imp | rot_shambler | large_bear | loleth_troll | embermaw_alpha | thornclad_revenant | Savra dmg/att |
|---|---|---|---|---|---|---|---|---|---|
| pest |  100% |  100% |   79% |   99% |   69% |   76% |   26% |   45% | 45/400 (0%) |
| kraul |  100% |  100% |   91% |   96% |   69% |   90% |   36% |   64% | 76/400 (0%) |
| saproling |  100% |  100% |   81% |   99% |   72% |   84% |   29% |   52% | 48/400 (0%) |
| zombie |  100% |  100% |   78% |   99% |   73% |   75% |   29% |   42% | 44/400 (0%) |
| squirrel |  100% |  100% |   79% |   97% |   62% |   76% |   22% |   46% | 47/400 (0%) |
| elf |  100% |  100% |   92% |   98% |   71% |   90% |   34% |   65% | 72/400 (0%) |

### Level 10

| build | drudge_beetle | myconid | fetid_imp | rot_shambler | large_bear | loleth_troll | embermaw_alpha | thornclad_revenant | Savra dmg/att |
|---|---|---|---|---|---|---|---|---|---|
| pest |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% | 347/400 (58%) |
| kraul |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% | 371/400 (76%) |
| saproling |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% | 286/400 (21%) |
| zombie |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% | 353/400 (61%) |
| squirrel |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% | 278/400 (18%) |
| elf |  100% |  100% |   96% |  100% |   92% |   99% |   75% |   97% | 197/400 (7%) |

## 3. Stat allocation (arena, pest L10, no gear)


### pest L10 stat spreads

| build | drudge_beetle | myconid | fetid_imp | rot_shambler | large_bear | loleth_troll | embermaw_alpha | thornclad_revenant | Savra dmg/att |
|---|---|---|---|---|---|---|---|---|---|
| pure-ATK (a30/d5/s5) |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% | 399/400 (99%) |
| pure-DEF (a10/d25/s5) |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% | 383/400 (60%) |
| pure-SPD (a10/d5/s29) |  100% |  100% |  100% |   99% |   84% |  100% |   64% |   98% | 239/400 (22%) |
| balanced (a21/d14/s5) |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% | 400/400 (100%) |
| ATK/SPD (a21/d5/s14) |  100% |  100% |  100% |  100% |  100% |  100% |   99% |  100% | 395/400 (95%) |
| DEF/ATK (a19/d16/s5) |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% | 297/400 (23%) |

## 4. Equipment archetype (arena, pest L10 balanced stats)


### pest L10 loadouts

| build | drudge_beetle | myconid | fetid_imp | rot_shambler | large_bear | loleth_troll | embermaw_alpha | thornclad_revenant | Savra dmg/att |
|---|---|---|---|---|---|---|---|---|---|
| none |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% | 347/400 (58%) |
| T1 fang (aggro) |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% | 337/400 (53%) |
| T3 fang (aggro) |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% | 362/400 (69%) |
| T3 carapace (tank) |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% | 398/400 (96%) |
| T3 charm (feint) |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% | 368/400 (72%) |
| T3 full mixed |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% | 400/400 (100%) |

## 5. Evolution path (arena, saproling L12, balanced stats)


### saproling apex lines

| line | drudge_beetle | myconid | fetid_imp | rot_shambler | large_bear | loleth_troll | embermaw_alpha | thornclad_revenant | Savra dmg/att |
|---|---|---|---|---|---|---|---|---|---|
| Slitherhead→Swamp Dragon |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% | 334/400(36%) |
| Slitherhead→Primeval Warden |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% | 365/400(56%) |
| Sporeback Skirmisher→Swamp Dragon |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% | 312/400(20%) |
| Sporeback Skirmisher→Primeval Warden |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% | 345/400(31%) |
| Jungle Creeper→Swamp Dragon |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% | 308/400(22%) |
| Jungle Creeper→Primeval Warden |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% | 342/400(33%) |
| Jungle Creeper→Calamity Beast |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% | 290/400(15%) |