# Structured sparsity in the ABS Data API

Is the gap between advertised and real combinations *principled* or *arbitrary*? Tested per dataflow against the observed key set.

| Classification | Flows | Meaning |
| --- | --- | --- |
| Exact cross-product | 130 | Every combination of observed options exists |
| Dependent dimensions (verified) | 809 | Key set is the cross-product once dimensions that are functions of another are removed; each dependency verified against the actual keys (e.g. STATE determined by REGION) |
| Unexplained | 288 | Sparsity not reducible to a functional dependency — including arithmetic coincidences the level-1 test flagged and level 2 rejected |

**81.0% of all confirmed series** sit in flows whose sparsity is fully explained and verified.

Level-2 verification against the actual keys: 809 of 936 candidate flows confirmed (every code of some driving dimension maps to exactly one code of the dependent dimension); the remainder were arithmetic coincidences and are counted as unexplained.

## Dependent-dimension patterns

_Only verified dependencies are listed: for each, every code of the driving dimension maps to exactly one code of the dependent dimension in the actual key set._

| Dependency (dependent ← driver) | Flows | Series |
| --- | --- | --- |
| `STATE←REGION` | 503 | 317,919,515 |
| `REGION_TYPE←REGION` + `STATE←REGION` | 110 | 61,549,394 |
| `STATE←LGA_2016` | 62 | 14,539,361 |
| `REGIONTYPE←REGION` + `STATE←REGION` | 51 | 20,112,737 |
| `REGIONTYPE←ASGS_2016` + `STATE←ASGS_2016` | 50 | 53,196,610 |
| `REGION_TYPE←REGION` | 15 | 98,630 |
| `REGION_TYPE←ASGS_2021` | 2 | 168,722 |
| `REGION_TYPE←ASGS_2011` | 1 | 2,697 |
| `REGION_TYPE←LGA_2022` | 1 | 31,749 |
| `REGION_TYPE←LGA_2023` | 1 | 31,749 |
| `REGION_TYPE←LGA_2024` | 1 | 31,749 |
| `REGION_TYPE←LGA_2025` | 1 | 31,806 |
| `REGIONTYPE←ASGS_2011` | 1 | 153,729 |
| `REGIONTYPE←LGA_2018` | 1 | 5,510 |
| `REGIONTYPE←ASGS_2016` | 1 | 32,820 |
| `REGION_TYPE←AEC_FED_2017` | 1 | 2,240 |
| `EXP_IMP←DATA_ITEM` | 1 | 430 |
| `REGION_TYPE←ASGS_2016` | 1 | 160,683 |
| `TSEST←MODELLERS_DB` | 1 | 119 |
| `REGIONTYPE←LGA_2011` | 1 | 1,716 |
| `REGION_TYPE←ASGS_2011_STATE_GCCSA_SA4_SA3_SA2` | 1 | 7,899 |
| `REGION_TYPE←ASGS_2011_SA34_GCCSA_STE` | 1 | 23,760 |
| `TSEST←MEASURE` | 1 | 3 |

## Level-1 inferences rejected at level 2 (largest first)

_The dimension cardinalities divide the option product down to the exact series count, but no single dimension determines the supposedly dependent one in the actual keys — a coincidence._

| Dataflow | Series | Supposed dependency |
| --- | --- | --- |
| `C21_G50_SAL` | 6,217,560 | `AGEP` |
| `ABS_C16_T05_SA` | 5,429,394 | `BPPP_CENSUS2016` |
| `C21_G09_SA2` | 4,739,790 | `AGEP` |
| `C21_G49_SAL` | 4,559,544 | `AGEP` |
| `C21_G22_SAL` | 2,901,528 | `AGEP` |
| `C21_G13_SA2` | 2,521,926 | `ENGLP` |
| `C21_G11_SA2` | 2,295,370 | `AGEP` |
| `C21_G54_SA2` | 1,878,030 | `AGEP` |
| `C21_G55_SA2` | 1,878,030 | `HRSP` |
| `C21_G41_SAL` | 1,795,131 | `BEDD` |
| `ABS_C16_G51_SA` | 1,775,970 | `AGE` |
| `ABS_C16_G52_SA` | 1,775,970 | `HRSP_C16` |
| `ABS_CENSUS2011_B43` | 1,689,030 | `AGE` |
| `C21_G17_SA2` | 1,520,310 | `AGEP` |
| `C21_G52_SA2` | 1,430,880 | `OCCP` |
| `ABS_C16_G49_SA` | 1,353,120 | `OCCP_C16` |
| `C21_G51_SA2` | 1,341,450 | `OCCP` |
| `C21_T32_SA2` | 1,341,450 | `AGEP` |
| `ABS_C16_G48_SA` | 1,268,550 | `OCCP_C16` |
| `ABS_C16_T32_TS_SA` | 1,268,550 | `AGE` |
| `C21_G19_SA2` | 1,252,020 | `AGEP` |
| `ABS_CENSUS2011_T31` | 1,194,300 | `MEASURE` |
| `ABS_C16_T04_SA` | 1,116,324 | `INGP_2016` |
| `ABS_C16_T04_TS_SA` | 1,116,324 | `INGP_2016` |
| `C21_G27_SA2` | 1,073,160 | `AGEP` |
| `C21_G46_SA2` | 1,073,160 | `AGEP` |
| `C21_G50_POA` | 1,070,415 | `AGEP` |
| `ABS_CENSUS2011_B17` | 1,045,590 | `MEASURE` |
| `ABS_C16_G43_SA` | 1,014,840 | `AGE` |
| `C21_T31_SA2` | 983,730 | `AGEP` |

## Unexplained flows (largest first)

| Dataflow | Series | Product of observed options | Fill |
| --- | --- | --- | --- |
| `C21_G50_SAL` | 6,217,560 | 55,958,040 | 11.1% |
| `ABS_C16_T05_SA` | 5,429,394 | 325,763,640 | 1.7% |
| `C21_G09_SA2` | 4,739,790 | 284,387,400 | 1.7% |
| `C21_G49_SAL` | 4,559,544 | 41,035,896 | 11.1% |
| `C21_G22_SAL` | 2,901,528 | 26,113,752 | 11.1% |
| `C21_G13_SA2` | 2,521,926 | 151,315,560 | 1.7% |
| `C21_G11_SA2` | 2,295,370 | 137,722,200 | 1.7% |
| `ABS_REGIONAL_ASGS2021` | 1,970,235 | 15,132,618 | 13.0% |
| `C21_G54_SA2` | 1,878,030 | 112,681,800 | 1.7% |
| `C21_G55_SA2` | 1,878,030 | 112,681,800 | 1.7% |
| `C21_G41_SAL` | 1,795,131 | 16,156,179 | 11.1% |
| `ABS_C16_G51_SA` | 1,775,970 | 106,558,200 | 1.7% |
| `ABS_C16_G52_SA` | 1,775,970 | 106,558,200 | 1.7% |
| `ABS_SEIFA2016_SA1` | 1,761,912 | 1,764,480 | 99.9% |
| `ABS_REGIONAL_ASGS2016` | 1,701,722 | 13,333,938 | 12.8% |
| `ABS_CENSUS2011_B43` | 1,689,030 | 84,451,500 | 2.0% |
| `SEIFA_SA1` | 1,683,344 | 1,685,696 | 99.9% |
| `C21_G01_SAL` | 1,657,962 | 14,922,144 | 11.1% |
| `C21_G17_SA2` | 1,520,310 | 91,218,600 | 1.7% |
| `C21_G52_SA2` | 1,430,880 | 85,852,800 | 1.7% |
| `ABS_C16_G49_SA` | 1,353,120 | 81,187,200 | 1.7% |
| `C21_G51_SA2` | 1,341,450 | 80,487,000 | 1.7% |
| `C21_T32_SA2` | 1,341,450 | 80,487,000 | 1.7% |
| `ABS_C16_G48_SA` | 1,268,550 | 76,113,000 | 1.7% |
| `ABS_C16_T32_TS_SA` | 1,268,550 | 76,113,000 | 1.7% |
| `C21_G19_SA2` | 1,252,020 | 75,121,200 | 1.7% |
| `ABS_CENSUS2011_T31` | 1,194,300 | 59,715,000 | 2.0% |
| `ABS_CENSUS2011_B23_SA1_SA` | 1,178,207 | 1,472,760 | 80.0% |
| `ABS_C16_T04_SA` | 1,116,324 | 66,979,440 | 1.7% |
| `ABS_C16_T04_TS_SA` | 1,116,324 | 66,979,440 | 1.7% |

## Why this matters

- For ABS: the content constraints are exact per dimension; the implied cross-product fails mainly because hierarchical geography is encoded as several dimensions (region, state, region type) that are not independent. Declaring the dependency would make the metadata honest.
- For the typed front door: flows classified here as exact-product or dependent-dimensions admit exact, compact static types — the valid key set is a cross-product over independent dimensions times the code hierarchy for dependent ones.

