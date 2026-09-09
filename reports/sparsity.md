# Structured sparsity in the ABS Data API

Is the gap between advertised and real combinations *principled* or *arbitrary*? Tested per dataflow against the observed key set.

| Classification | Flows | Meaning |
| --- | --- | --- |
| Exact cross-product | 130 | Every combination of observed options exists |
| Dependent dimensions | 936 | Key set is the cross-product once dimensions that are functions of another are removed (e.g. STATE determined by REGION) |
| Unexplained | 161 | Sparsity not reducible to a rule at this depth |

**96.4% of all confirmed series** sit in flows whose sparsity is fully explained by levels 0–1.

## Dependent-dimension patterns

_Level-1 inference is arithmetic (which dimension cardinalities divide the option product down to the exact series count). Geography patterns — `STATE`, `REGION_TYPE` determined by the region code — are structurally certain. Others listed here are candidates until level-2 verification against the key index confirms them individually._

| Dependent dimension(s) | Flows | Series |
| --- | --- | --- |
| `STATE` | 565 | 332,458,876 |
| `REGION_TYPE` + `STATE` | 110 | 61,549,394 |
| `REGIONTYPE` + `STATE` | 101 | 73,309,347 |
| `REGION_TYPE` | 26 | 591,684 |
| `AGEP` + `REGION_TYPE` | 23 | 24,024,537 |
| `AGEP` | 21 | 17,235,504 |
| `AGE` + `REGIONTYPE` | 15 | 11,892,500 |
| `BEDD` | 7 | 2,257,866 |
| `MEASURE` + `REGIONTYPE` | 6 | 5,144,630 |
| `AGE` | 4 | 800,280 |
| `MEASURE` + `STATE` | 4 | 785,360 |
| `REGIONTYPE` | 4 | 193,775 |
| `OCCP` + `REGION_TYPE` | 4 | 3,487,770 |
| `OCCP_C16` + `REGIONTYPE` | 3 | 3,213,660 |
| `OCCP` + `REGIONTYPE` | 3 | 727,200 |
| `HRSP_C16` + `REGIONTYPE` | 2 | 2,621,670 |
| `MSTP_2016` + `STATE` | 2 | 1,928,196 |
| `INGP_2016` + `STATE` | 2 | 2,232,648 |
| `CHCAREP_2016` + `STATE` | 2 | 1,928,196 |
| `HHCD_2016` | 2 | 89,748 |
| `BEDRD_2016` | 2 | 124,650 |
| `MEASURE` | 2 | 158,472 |
| `AGEP` + `INGP` | 2 | 1,073,160 |
| `BPPP` + `STATE` | 2 | 1,180,476 |
| `HHCD` + `STATE` | 2 | 157,950 |

## Unexplained flows (largest first)

| Dataflow | Series | Product of observed options | Fill |
| --- | --- | --- | --- |
| `ABS_REGIONAL_ASGS2021` | 1,970,235 | 15,132,618 | 13.0% |
| `ABS_SEIFA2016_SA1` | 1,761,912 | 1,764,480 | 99.9% |
| `ABS_REGIONAL_ASGS2016` | 1,701,722 | 13,333,938 | 12.8% |
| `SEIFA_SA1` | 1,683,344 | 1,685,696 | 99.9% |
| `C21_G01_SAL` | 1,657,962 | 14,922,144 | 11.1% |
| `ABS_CENSUS2011_B23_SA1_SA` | 1,178,207 | 1,472,760 | 80.0% |
| `ABS_CENSUS2011_B23` | 772,128 | 48,258,000 | 1.6% |
| `BA_SA2` | 662,796 | 14,389,650 | 4.6% |
| `BA_SA2_2016-21` | 662,796 | 14,389,650 | 4.6% |
| `BA_SA2_201116` | 609,390 | 13,176,000 | 4.6% |
| `ABS_CENSUS2011_T04` | 586,534 | 40,606,200 | 1.4% |
| `ABS_SEIFA2016_SSC` | 547,910 | 548,520 | 99.9% |
| `ABS_CENSUS2011_T05` | 384,830 | 27,070,800 | 1.4% |
| `ABS_REGIONAL_LGA2021` | 350,343 | 379,618 | 92.3% |
| `ABS_REGIONAL_LGA2020` | 339,346 | 362,848 | 93.5% |
| `SEIFA_SSC` | 330,120 | 330,520 | 99.9% |
| `ABS_C16_T28_SA` | 325,610 | 19,536,660 | 1.7% |
| `ABS_REGIONAL_LGA2019` | 322,308 | 344,352 | 93.6% |
| `C21_G01_SA2` | 321,732 | 19,316,880 | 1.7% |
| `ABS_REGIONAL_LGA2018` | 303,251 | 331,580 | 91.5% |
| `MERCH_EXP` | 296,115 | 922,746 | 32.1% |
| `C21_G01_POA` | 285,438 | 2,568,996 | 11.1% |
| `ABS_LAMPS` | 266,099 | 577,044 | 46.1% |
| `ABS_REGIONAL_LGA2017` | 244,458 | 269,920 | 90.6% |
| `ABS_C16_T01_LGA` | 234,768 | 2,112,939 | 11.1% |
| `ABS_LAMPS2014` | 217,748 | 585,468 | 37.2% |
| `MERCH_IMP` | 214,175 | 814,990 | 26.3% |
| `C21_G01_UCL` | 213,354 | 5,764,932 | 3.7% |
| `C21_T01_SA2` | 196,638 | 11,804,760 | 1.7% |
| `BA_LGA2019` | 195,624 | 849,420 | 23.0% |

## Why this matters

- For ABS: the content constraints are exact per dimension; the implied cross-product fails mainly because hierarchical geography is encoded as several dimensions (region, state, region type) that are not independent. Declaring the dependency would make the metadata honest.
- For the typed front door: flows classified here as exact-product or dependent-dimensions admit exact, compact static types — the valid key set is a cross-product over independent dimensions times the code hierarchy for dependent ones.

