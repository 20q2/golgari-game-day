# Undercity balance simulation — results

## 1. Progression (full-game driver, 24 seeds each)

Turns are per roll+move; rolls are free in-sim so this is the raw power curve, independent of roll income. See the economy overlay note below.


**pest/city — rusher**  (median deaths 32, max 39)
- milestone turns: level2=5, level3=8, level5=16, evolve_t2=16, level8=23, level10=30, evolve_t3=30, level12=34
- power@turn: 10:56, 25:91, 50:117, 100:120, 150:120, 200:121
- winrate: wild[1-4]=88%(n17), wild[5-9]=92%(n66), wild[10-12]=97%(n1081), elite[1-4]=21%(n293), elite[5-9]=78%(n238), elite[10-12]=91%(n3898)

**saproling/cavern — rusher**  (median deaths 9, max 22)
- milestone turns: level2=5, level3=9, level5=16, evolve_t2=16, level8=26, level10=29, evolve_t3=29, level12=34
- power@turn: 10:63, 25:93, 50:127, 100:127, 150:129, 200:129
- winrate: wild[1-4]=77%(n90), wild[5-9]=95%(n73), wild[10-12]=100%(n1014), elite[1-4]=15%(n225), elite[5-9]=76%(n162), elite[10-12]=100%(n4036)

**pest/city — farmer**  (median deaths 16, max 26)
- milestone turns: level2=11, level3=28, level5=51, evolve_t2=51, level8=71, level10=90, evolve_t3=90, level12=100
- power@turn: 10:50, 25:56, 50:74, 100:122, 150:126, 200:125
- winrate: wild[1-4]=62%(n202), wild[5-9]=90%(n246), wild[10-12]=97%(n1131), elite[1-4]=10%(n156), elite[5-9]=61%(n157), elite[10-12]=90%(n689)

**saproling/cavern — farmer**  (median deaths 10, max 18)
- milestone turns: level2=9, level3=21, level5=38, evolve_t2=38, level8=50, level10=60, evolve_t3=60, level12=68
- power@turn: 10:58, 25:66, 50:99, 100:132, 150:132, 200:133
- winrate: wild[1-4]=61%(n201), wild[5-9]=96%(n215), wild[10-12]=100%(n1901), elite[1-4]=16%(n128), elite[5-9]=85%(n107), elite[10-12]=100%(n1007)

**pest/city — speedster**  (median deaths 0, max 4)
- milestone turns: level2=50, level3=90, level5=146, evolve_t2=146, level8=238
- power@turn: 10:48, 25:49, 50:53, 100:64, 150:66, 200:74
- winrate: wild[1-4]=80%(n54), wild[5-9]=97%(n37), elite[1-4]=40%(n5)

**saproling/cavern — speedster**  (median deaths 0, max 2)
- milestone turns: level2=42, level3=82, level5=162, evolve_t2=162, level8=200, level10=225, evolve_t3=225, level12=221
- power@turn: 10:53, 25:55, 50:61, 100:68, 150:73, 200:84
- winrate: wild[1-4]=85%(n46), wild[5-9]=100%(n88), wild[10-12]=100%(n28), elite[1-4]=50%(n6), elite[5-9]=91%(n11)

**pest/city — tank**  (median deaths 12, max 19)
- milestone turns: level2=11, level3=23, level5=42, evolve_t2=42, level8=70, level10=86, evolve_t3=86, level12=100
- power@turn: 10:50, 25:60, 50:88, 100:121, 150:126, 200:128
- winrate: wild[1-4]=65%(n239), wild[5-9]=92%(n266), wild[10-12]=99%(n1105), elite[1-4]=8%(n107), elite[5-9]=75%(n147), elite[10-12]=94%(n523)

**saproling/cavern — tank**  (median deaths 7, max 21)
- milestone turns: level2=6, level3=14, level5=30, evolve_t2=30, level8=46, level10=52, evolve_t3=52, level12=61
- power@turn: 10:58, 25:70, 50:106, 100:130, 150:131, 200:132
- winrate: wild[1-4]=62%(n239), wild[5-9]=98%(n220), wild[10-12]=100%(n1767), elite[1-4]=17%(n102), elite[5-9]=84%(n95), elite[10-12]=99%(n842)

## 2. Starter × level (arena, 300 fights/cell, neutral skilled player)


### Level 1

| build | drudge_beetle | myconid | fetid_imp | rot_shambler | cinder_wolf | bramble_horror | embermaw_alpha | thornclad_revenant | Savra dmg/att |
|---|---|---|---|---|---|---|---|---|---|
| pest |   96% |   78% |    6% |    9% |    0% |    3% |    0% |    0% | 3/400 (0%) |
| kraul |   89% |   92% |   28% |   18% |    2% |   18% |    0% |    3% | 5/400 (0%) |
| saproling |  100% |   92% |    8% |   24% |    0% |    1% |    0% |    0% | 4/400 (0%) |
| zombie |   91% |   73% |    2% |    5% |    0% |    3% |    0% |    0% | 2/400 (0%) |

### Level 5

| build | drudge_beetle | myconid | fetid_imp | rot_shambler | cinder_wolf | bramble_horror | embermaw_alpha | thornclad_revenant | Savra dmg/att |
|---|---|---|---|---|---|---|---|---|---|
| pest |  100% |  100% |   77% |   99% |   47% |   66% |    6% |   20% | 34/400 (0%) |
| kraul |  100% |  100% |   89% |   94% |   52% |   84% |   20% |   48% | 60/400 (0%) |
| saproling |  100% |  100% |   83% |  100% |   67% |   75% |   14% |   28% | 44/400 (0%) |
| zombie |  100% |  100% |   79% |  100% |   47% |   70% |    5% |   16% | 30/400 (0%) |

### Level 10

| build | drudge_beetle | myconid | fetid_imp | rot_shambler | cinder_wolf | bramble_horror | embermaw_alpha | thornclad_revenant | Savra dmg/att |
|---|---|---|---|---|---|---|---|---|---|
| pest |  100% |  100% |   98% |  100% |   98% |   99% |   85% |   93% | 164/400 (1%) |
| kraul |  100% |  100% |   99% |  100% |   97% |  100% |   84% |   98% | 240/400 (12%) |
| saproling |  100% |  100% |   98% |  100% |  100% |  100% |  100% |   98% | 205/400 (14%) |
| zombie |  100% |  100% |  100% |  100% |  100% |  100% |   93% |   92% | 140/400 (1%) |

## 3. Stat allocation (arena, pest L10, no gear)


### pest L10 stat spreads

| build | drudge_beetle | myconid | fetid_imp | rot_shambler | cinder_wolf | bramble_horror | embermaw_alpha | thornclad_revenant | Savra dmg/att |
|---|---|---|---|---|---|---|---|---|---|
| pure-ATK (a28/d5/s7) |  100% |  100% |  100% |  100% |   98% |  100% |   90% |   99% | 369/400 (68%) |
| pure-DEF (a8/d25/s5) |  100% |  100% |  100% |  100% |  100% |  100% |   99% |   98% | 144/400 (0%) |
| pure-SPD (a8/d5/s29) |  100% |  100% |  100% |  100% |   85% |  100% |   69% |   98% | 226/400 (20%) |
| balanced (a19/d14/s7) |  100% |  100% |  100% |  100% |  100% |  100% |   99% |  100% | 369/400 (63%) |
| ATK/SPD (a19/d5/s16) |  100% |  100% |  100% |  100% |   99% |   99% |   83% |   95% | 302/400 (28%) |
| DEF/ATK (a17/d16/s5) |  100% |  100% |   98% |  100% |  100% |  100% |   90% |   89% | 144/400 (1%) |

## 4. Equipment archetype (arena, pest L10 balanced stats)


### pest L10 loadouts

| build | drudge_beetle | myconid | fetid_imp | rot_shambler | cinder_wolf | bramble_horror | embermaw_alpha | thornclad_revenant | Savra dmg/att |
|---|---|---|---|---|---|---|---|---|---|
| none |  100% |  100% |   98% |  100% |   98% |   99% |   85% |   93% | 164/400 (1%) |
| T1 fang (aggro) |  100% |  100% |   98% |  100% |   98% |  100% |   87% |   94% | 207/400 (13%) |
| T3 fang (aggro) |  100% |  100% |   98% |  100% |   98% |  100% |   91% |   97% | 267/400 (23%) |
| T3 carapace (tank) |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% | 253/400 (14%) |
| T3 charm (feint) |  100% |  100% |   99% |  100% |   99% |  100% |   90% |   99% | 226/400 (8%) |
| T3 full mixed |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% | 373/400 (75%) |

## 5. Evolution path (arena, saproling L12, balanced stats)


### saproling apex lines

| line | drudge_beetle | myconid | fetid_imp | rot_shambler | cinder_wolf | bramble_horror | embermaw_alpha | thornclad_revenant | Savra dmg/att |
|---|---|---|---|---|---|---|---|---|---|
| Slitherhead→Golgari Lich Lord |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% | 255/400(26%) |
| Slitherhead→Izoni, Thousand-Eyed |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% | 343/400(37%) |
| Myconid Sporetender→Grave Titan |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% | 200/400(5%) |
| Myconid Sporetender→Golgari Lich Lord |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% | 254/400(25%) |
| Corpsejack Menace→Golgari Lich Lord |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% | 251/400(28%) |
| Corpsejack Menace→Izoni, Thousand-Eyed |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% | 336/400(39%) |