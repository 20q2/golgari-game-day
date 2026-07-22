# Undercity balance simulation — results

## 1. Progression (full-game driver, 24 seeds each)

Turns are per roll+move; rolls are free in-sim so this is the raw power curve, independent of roll income. See the economy overlay note below.


**pest/city — rusher**  (median deaths 44, max 53)
- milestone turns: level2=4, level3=7, level5=13, evolve_t2=13, level8=20, level10=26, evolve_t3=26, level12=30
- power@turn: 10:61, 25:98, 50:113, 100:113, 150:113, 200:113
- winrate: wild[1-4]=76%(n17), wild[5-9]=89%(n57), wild[10-12]=91%(n911), elite[1-4]=26%(n246), elite[5-9]=75%(n232), elite[10-12]=83%(n4309)

**saproling/cavern — rusher**  (median deaths 9, max 17)
- milestone turns: level2=5, level3=8, level5=16, evolve_t2=16, level8=22, level10=26, evolve_t3=26, level12=30
- power@turn: 10:63, 25:106, 50:122, 100:122, 150:122, 200:122
- winrate: wild[1-4]=79%(n67), wild[5-9]=98%(n56), wild[10-12]=100%(n998), elite[1-4]=14%(n218), elite[5-9]=82%(n138), elite[10-12]=100%(n4030)

**pest/city — farmer**  (median deaths 77, max 105)
- milestone turns: level2=14, level3=30, level5=64, evolve_t2=64, level8=92, level10=118, evolve_t3=118, level12=130
- power@turn: 10:48, 25:53, 50:63, 100:93, 150:119, 200:119
- winrate: wild[1-4]=45%(n206), wild[5-9]=81%(n275), wild[10-12]=30%(n947), elite[1-4]=6%(n224), elite[5-9]=43%(n215), elite[10-12]=19%(n809)

**saproling/cavern — farmer**  (median deaths 18, max 24)
- milestone turns: level2=13, level3=32, level5=74, evolve_t2=74, level8=86, level10=89, evolve_t3=89, level12=96
- power@turn: 10:53, 25:58, 50:63, 100:124, 150:126, 200:126
- winrate: wild[1-4]=28%(n271), wild[5-9]=94%(n143), wild[10-12]=100%(n1402), elite[1-4]=2%(n200), elite[5-9]=89%(n91), elite[10-12]=100%(n1118)

**pest/city — speedster**  (median deaths 2, max 5)
- milestone turns: level2=31, level3=51, level5=154, evolve_t2=154, level8=225
- power@turn: 10:46, 25:48, 50:54, 100:60, 150:70, 200:75
- winrate: wild[1-4]=51%(n70), wild[5-9]=91%(n64), elite[1-4]=17%(n12), elite[5-9]=57%(n7)

**saproling/cavern — speedster**  (median deaths 2, max 3)
- milestone turns: level2=36, level3=72, level5=133, evolve_t2=133, level8=213, level10=215, evolve_t3=215
- power@turn: 10:53, 25:54, 50:59, 100:65, 150:82, 200:87
- winrate: wild[1-4]=64%(n58), wild[5-9]=98%(n122), wild[10-12]=100%(n12), elite[1-4]=60%(n10), elite[5-9]=80%(n20), elite[10-12]=100%(n4)

**pest/city — tank**  (median deaths 40, max 64)
- milestone turns: level2=8, level3=18, level5=45, evolve_t2=45, level8=88, level10=117, evolve_t3=117, level12=134
- power@turn: 10:53, 25:58, 50:76, 100:91, 150:119, 200:119
- winrate: wild[1-4]=61%(n231), wild[5-9]=81%(n315), wild[10-12]=34%(n577), elite[1-4]=10%(n141), elite[5-9]=51%(n213), elite[10-12]=35%(n340)

**saproling/cavern — tank**  (median deaths 16, max 63)
- milestone turns: level2=8, level3=18, level5=42, evolve_t2=42, level8=56, level10=66, evolve_t3=66, level12=78
- power@turn: 10:58, 25:63, 50:86, 100:124, 150:126, 200:126
- winrate: wild[1-4]=38%(n288), wild[5-9]=95%(n216), wild[10-12]=97%(n1225), elite[1-4]=4%(n161), elite[5-9]=85%(n79), elite[10-12]=97%(n448)

## 2. Starter × level (arena, 300 fights/cell, neutral skilled player)


### Level 1

| build | drudge_beetle | myconid | fetid_imp | rot_shambler | cinder_wolf | bramble_horror | embermaw_alpha | thornclad_revenant | Savra dmg/att |
|---|---|---|---|---|---|---|---|---|---|
| pest |   95% |   75% |   24% |   24% |    2% |    5% |    0% |    2% | 12/400 (0%) |
| kraul |   88% |   87% |   43% |   24% |    4% |   22% |    0% |    4% | 19/400 (0%) |
| saproling |   99% |   85% |   20% |   48% |    1% |    4% |    0% |    0% | 10/400 (0%) |
| zombie |   90% |   64% |    9% |    9% |    0% |    1% |    0% |    0% | 7/400 (0%) |

### Level 5

| build | drudge_beetle | myconid | fetid_imp | rot_shambler | cinder_wolf | bramble_horror | embermaw_alpha | thornclad_revenant | Savra dmg/att |
|---|---|---|---|---|---|---|---|---|---|
| pest |  100% |  100% |   76% |   98% |   60% |   67% |   16% |   32% | 40/400 (0%) |
| kraul |  100% |  100% |   88% |   93% |   57% |   80% |   21% |   48% | 63/400 (0%) |
| saproling |  100% |  100% |   80% |  100% |   77% |   72% |   32% |   39% | 46/400 (0%) |
| zombie |  100% |  100% |   77% |   99% |   64% |   65% |   14% |   27% | 37/400 (0%) |

### Level 10

| build | drudge_beetle | myconid | fetid_imp | rot_shambler | cinder_wolf | bramble_horror | embermaw_alpha | thornclad_revenant | Savra dmg/att |
|---|---|---|---|---|---|---|---|---|---|
| pest |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% | 231/400 (4%) |
| kraul |  100% |  100% |  100% |  100% |  100% |  100% |   94% |  100% | 249/400 (9%) |
| saproling |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% | 341/400 (53%) |
| zombie |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% | 240/400 (3%) |

## 3. Stat allocation (arena, pest L10, no gear)


### pest L10 stat spreads

| build | drudge_beetle | myconid | fetid_imp | rot_shambler | cinder_wolf | bramble_horror | embermaw_alpha | thornclad_revenant | Savra dmg/att |
|---|---|---|---|---|---|---|---|---|---|
| pure-ATK (a28/d5/s7) |  100% |  100% |  100% |  100% |   99% |  100% |   93% |   97% | 362/400 (61%) |
| pure-DEF (a8/d25/s5) |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% | 309/400 (10%) |
| pure-SPD (a8/d5/s29) |  100% |  100% |  100% |   99% |   83% |  100% |   61% |   98% | 236/400 (18%) |
| balanced (a19/d14/s7) |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% | 382/400 (70%) |
| ATK/SPD (a19/d5/s16) |  100% |  100% |  100% |  100% |   99% |  100% |   90% |   95% | 320/400 (37%) |
| DEF/ATK (a17/d16/s5) |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% | 234/400 (2%) |

## 4. Equipment archetype (arena, pest L10 balanced stats)


### pest L10 loadouts

| build | drudge_beetle | myconid | fetid_imp | rot_shambler | cinder_wolf | bramble_horror | embermaw_alpha | thornclad_revenant | Savra dmg/att |
|---|---|---|---|---|---|---|---|---|---|
| none |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% | 231/400 (4%) |
| T1 fang (aggro) |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% | 286/400 (31%) |
| T3 fang (aggro) |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% | 297/400 (28%) |
| T3 carapace (tank) |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% | 337/400 (32%) |
| T3 charm (feint) |  100% |  100% |  100% |  100% |  100% |  100% |   99% |  100% | 277/400 (13%) |
| T3 full mixed |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% | 388/400 (83%) |

## 5. Evolution path (arena, saproling L12, balanced stats)


### saproling apex lines

| line | drudge_beetle | myconid | fetid_imp | rot_shambler | cinder_wolf | bramble_horror | embermaw_alpha | thornclad_revenant | Savra dmg/att |
|---|---|---|---|---|---|---|---|---|---|
| Slitherhead→Golgari Lich Lord |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% | 386/400(78%) |
| Slitherhead→Izoni, Thousand-Eyed |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% | 378/400(61%) |
| Myconid Sporetender→Grave Titan |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% | 356/400(36%) |
| Myconid Sporetender→Golgari Lich Lord |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% | 389/400(82%) |
| Corpsejack Menace→Golgari Lich Lord |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% | 381/400(78%) |
| Corpsejack Menace→Izoni, Thousand-Eyed |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% | 368/400(52%) |