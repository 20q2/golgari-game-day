# Undercity balance simulation — results

## 1. Progression (full-game driver, 24 seeds each)

Turns are per roll+move; rolls are free in-sim so this is the raw power curve, independent of roll income. See the economy overlay note below.


**pest/city — rusher**  (median deaths 36, max 51)
- milestone turns: level2=4, level3=7, level5=17, evolve_t2=17, level8=27, level10=42, evolve_t3=42, level12=62
- power@turn: 10:58, 25:88, 50:122, 100:132, 150:132, 200:132
- winrate: wild[1-4]=62%(n45), wild[5-9]=88%(n145), wild[10-12]=94%(n1171), elite[1-4]=19%(n206), elite[5-9]=78%(n361), elite[10-12]=87%(n3390)

**saproling/cavern — rusher**  (median deaths 18, max 31)
- milestone turns: level2=5, level3=12, level5=27, evolve_t2=27, level8=41, level10=58, evolve_t3=58, level12=74
- power@turn: 10:51, 25:63, 50:94, 100:123, 150:123, 200:123
- winrate: wild[1-4]=44%(n143), wild[5-9]=86%(n273), wild[10-12]=100%(n1146), elite[1-4]=1%(n218), elite[5-9]=50%(n222), elite[10-12]=100%(n2956)

**pest/city — farmer**  (median deaths 31, max 44)
- milestone turns: level2=8, level3=21, level5=43, evolve_t2=43, level8=69, level10=110, evolve_t3=110, level12=153
- power@turn: 10:56, 25:63, 50:96, 100:116, 150:153, 200:157
- winrate: wild[1-4]=23%(n190), wild[5-9]=77%(n383), wild[10-12]=84%(n957), elite[1-4]=6%(n164), elite[5-9]=67%(n251), elite[10-12]=86%(n568)

**saproling/cavern — farmer**  (median deaths 30, max 39)
- milestone turns: level2=12, level3=25, level5=55, evolve_t2=55, level8=102, level10=146, evolve_t3=146, level12=192
- power@turn: 10:53, 25:61, 50:70, 100:102, 150:147, 200:156
- winrate: wild[1-4]=19%(n230), wild[5-9]=72%(n436), wild[10-12]=90%(n666), elite[1-4]=0%(n168), elite[5-9]=40%(n212), elite[10-12]=83%(n368)

**pest/city — speedster**  (median deaths 2, max 7)
- milestone turns: level2=13, level3=30, level5=102, evolve_t2=102, level8=187
- power@turn: 10:50, 25:56, 50:62, 100:69, 150:84, 200:90
- winrate: wild[1-4]=29%(n49), wild[5-9]=90%(n21), elite[1-4]=0%(n10), elite[5-9]=100%(n1)

**saproling/cavern — speedster**  (median deaths 0, max 2)
- milestone turns: level2=19, level3=63, level5=128, evolve_t2=128, level8=186, level10=243, evolve_t3=243
- power@turn: 10:47, 25:52, 50:58, 100:69, 150:82, 200:90
- winrate: wild[1-4]=72%(n32), wild[5-9]=96%(n24), wild[10-12]=100%(n1), elite[1-4]=0%(n2), elite[10-12]=100%(n1)

**pest/city — tank**  (median deaths 18, max 27)
- milestone turns: level2=8, level3=20, level5=48, evolve_t2=48, level8=79, level10=150, evolve_t3=150, level12=209
- power@turn: 10:56, 25:66, 50:82, 100:111, 150:131, 200:151
- winrate: wild[1-4]=22%(n172), wild[5-9]=82%(n393), wild[10-12]=96%(n427), elite[1-4]=9%(n143), elite[5-9]=77%(n256), elite[10-12]=97%(n257)

**saproling/cavern — tank**  (median deaths 32, max 40)
- milestone turns: level2=7, level3=19, level5=56, evolve_t2=56, level8=143, level10=208, evolve_t3=208
- power@turn: 10:56, 25:61, 50:69, 100:95, 150:105, 200:110
- winrate: wild[1-4]=14%(n223), wild[5-9]=71%(n456), wild[10-12]=98%(n44), elite[1-4]=0%(n213), elite[5-9]=22%(n265), elite[10-12]=85%(n26)

## 2. Starter × level (arena, 300 fights/cell, neutral skilled player)


### Level 1

| build | sewer_shambler | thallid | ravenous_squirrel | canker_abomination | large_bear | loleth_troll | infested_thrinax | sluiceway_scorpion | molderhulk | putrid_leech | Savra dmg/att |
|---|---|---|---|---|---|---|---|---|---|---|---|
| pest |   64% |   72% |   67% |   58% |   10% |   73% |   11% |    5% |    0% |    0% | 7/560 (0%) |
| kraul |   80% |   81% |   87% |   60% |   15% |   90% |   27% |   19% |    0% |    0% | 12/560 (0%) |
| saproling |   65% |   73% |   68% |   61% |   10% |   76% |   12% |    6% |    0% |    0% | 7/560 (0%) |
| zombie |   74% |   83% |   71% |   80% |   16% |   79% |   17% |   10% |    0% |    0% | 8/560 (0%) |
| squirrel |   61% |   67% |   65% |   52% |    9% |   73% |   11% |    5% |    0% |    0% | 7/560 (0%) |
| elf |   82% |   87% |   77% |   85% |   21% |   84% |   23% |   13% |    0% |    0% | 9/560 (0%) |

### Level 5

| build | sewer_shambler | thallid | ravenous_squirrel | canker_abomination | large_bear | loleth_troll | infested_thrinax | sluiceway_scorpion | molderhulk | putrid_leech | Savra dmg/att |
|---|---|---|---|---|---|---|---|---|---|---|---|
| pest |   99% |  100% |   98% |  100% |   90% |  100% |   79% |   57% |    3% |    7% | 28/560 (0%) |
| kraul |  100% |  100% |   99% |  100% |   88% |  100% |   92% |   84% |   11% |   21% | 61/560 (0%) |
| saproling |   99% |   99% |   99% |  100% |   91% |  100% |   80% |   58% |    5% |   12% | 29/560 (0%) |
| zombie |   99% |  100% |   97% |  100% |   93% |  100% |   77% |   55% |    4% |    9% | 28/560 (0%) |
| squirrel |   99% |  100% |   98% |  100% |   84% |   99% |   76% |   57% |    2% |    7% | 28/560 (0%) |
| elf |  100% |  100% |   99% |  100% |   88% |  100% |   90% |   77% |    7% |   14% | 46/560 (0%) |

### Level 10

| build | sewer_shambler | thallid | ravenous_squirrel | canker_abomination | large_bear | loleth_troll | infested_thrinax | sluiceway_scorpion | molderhulk | putrid_leech | Savra dmg/att |
|---|---|---|---|---|---|---|---|---|---|---|---|
| pest |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% |   98% |  100% | 207/560 (0%) |
| kraul |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% |   96% |   98% | 276/560 (3%) |
| saproling |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% | 296/560 (16%) |
| zombie |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% | 277/560 (10%) |
| squirrel |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% |   97% |  100% | 200/560 (0%) |
| elf |  100% |  100% |  100% |  100% |  100% |  100% |   99% |   94% |   43% |   54% | 113/560 (0%) |

## 3. Stat allocation (arena, pest L10, no gear)


### pest L10 stat spreads

| build | sewer_shambler | thallid | ravenous_squirrel | canker_abomination | large_bear | loleth_troll | infested_thrinax | sluiceway_scorpion | molderhulk | putrid_leech | Savra dmg/att |
|---|---|---|---|---|---|---|---|---|---|---|---|
| pure-ATK (a29/d7/s5) |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% |   92% |   89% | 389/560 (28%) |
| pure-DEF (a10/d26/s6) |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% | 296/560 (0%) |
| pure-SPD (a8/d6/s28) |  100% |  100% |  100% |  100% |   93% |  100% |   99% |   99% |   26% |   38% | 143/560 (1%) |
| balanced (a20/d16/s5) |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% |   99% | 432/560 (37%) |
| ATK/SPD (a20/d7/s14) |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% |   67% |   81% | 315/560 (11%) |
| DEF/ATK (a19/d17/s6) |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% |   99% |  100% | 215/560 (1%) |

## 4. Equipment archetype (arena, pest L10 balanced stats)


### pest L10 loadouts

| build | sewer_shambler | thallid | ravenous_squirrel | canker_abomination | large_bear | loleth_troll | infested_thrinax | sluiceway_scorpion | molderhulk | putrid_leech | Savra dmg/att |
|---|---|---|---|---|---|---|---|---|---|---|---|
| none |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% |   98% |  100% | 207/560 (0%) |
| T1 fang (aggro) |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% |   98% |  100% | 240/560 (5%) |
| T3 fang (aggro) |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% |   99% |  100% | 252/560 (2%) |
| T3 carapace (tank) |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% | 327/560 (3%) |
| T3 charm (feint) |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% |   98% |  100% | 226/560 (1%) |
| T3 full mixed |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% | 468/560 (45%) |

## 5. Evolution path (arena, saproling L12, balanced stats)


### saproling apex lines

| line | sewer_shambler | thallid | ravenous_squirrel | canker_abomination | large_bear | loleth_troll | infested_thrinax | sluiceway_scorpion | molderhulk | putrid_leech | Savra dmg/att |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Slitherhead→Swarm Lord |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% |   98% |   99% | 251/560(1%) |
| Slitherhead→Primeval Warden |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% | 281/560(2%) |
| Sporeback Skirmisher→Grave Titan |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% | 332/560(1%) |
| Sporeback Skirmisher→Primeval Warden |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% | 249/560(0%) |
| Jungle Creeper→Golgari Lich Lord |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% | 351/560(24%) |
| Jungle Creeper→Primeval Warden |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% |  100% | 245/560(0%) |