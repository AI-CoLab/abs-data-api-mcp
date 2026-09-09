# ABS Data API — declared vs observed

Generated 2026-09-09T05:27:17.286Z (run `delta-2026-09-09T05-27-17-286Z`).

This report is derived automatically. Declared metadata comes from the ABS structure endpoints; observed availability was established by pulling data, because `detail=serieskeysonly` does not work. Only empirically-confirmed series are treated as real, and this document is the difference between the two.

## Corpus

| Measure | Value |
| --- | --- |
| Dataflows published | 1,227 |
| Dataflows probed | 1,227 |
| Dataflows serving data | 1,227 |
| Dataflows serving nothing | 0 |
| Series implied by content constraints | 14,761,557,818 |
| Series that actually exist | 621,536,714 |
| Overall density | 4.21% |
| Documented behaviours checked | 15 (8 non-conforming) |

> Content constraints overstate the size of the corpus by roughly **23.8x**. The cube regions published for each dataflow are per-dimension marginals, not the set of real key combinations, so multiplying them out does not describe what can be retrieved.

## Endpoint conformance

| Endpoint | Verdict | HTTP | Documented behaviour | Observed |
| --- | --- | --- | --- | --- |
| agency other than ABS | **missing** | 404 | Spec exposes agencyId as a parameter, implying multiple agencies | HTTP 404: Could not find requested structures |
| agencyscheme | **missing** | 404 | Spec lists agencyscheme as a valid structureType | HTTP 404: Could not find requested structures |
| categoryscheme with references | **timeout** | — | Spec lists references=parentsandsiblings as a valid value | timeout after 125000ms: https://data.api.abs.gov.au/rest/categoryscheme/ABS?detail=full&references=parentsandsiblings |
| detail=serieskeysonly (CSV) | **broken** | 200 | detail=serieskeysonly should enumerate every series key | HTTP 200 but only 0 data row(s); header-only response |
| detail=serieskeysonly (JSON) | **malformed** | 200 | Spec lists detail=serieskeysonly: series keys without observations | HTTP 200 but body is not valid JSON (SyntaxError: Unexpected non-whitespace character after JSON at position 42742 (l); tail: "er and the unit of measure.\"}}],\"dataSets\":[0]}]}\"errors\":[]" |
| documented /structures/ path | **broken** | 400 | User guide documents /structures/{structureType}/{agencyId}/{structureId} | HTTP 400: Invalid structure: structures |
| hierarchicalcodelist | **missing** | 404 | Spec lists hierarchicalcodelist as a valid structureType | HTTP 404: Could not find requested structures |
| request without User-Agent | **broken** | 403 | No User-Agent requirement is documented; the API is described as open and keyless | HTTP 403 with a CloudFront HTML error page (not an SDMX error) when User-Agent is absent |
| actualconstraint | ok | 200 | Spec lists actualconstraint as a valid structureType | HTTP 200, valid JSON |
| availableconstraint | ok | 200 | SDMX-REST defines availableconstraint for actual data availability | HTTP 200, valid JSON |
| bulk contentconstraint | ok | 200 | Spec: GET /contentconstraint/ABS returns all content constraints | data.contentConstraints: 2433 items |
| bulk datastructure | ok | 200 | Spec: GET /datastructure/ABS returns all data structures | data.dataStructures: 1229 items |
| dataflow listing | ok | 200 | Spec: GET /{structureType}/{agencyId} returns all structures of a type | data.dataflows: 1227 items |
| firstNObservations (absent from spec) | ok | 200 | Added 2024-11-29 per the user guide; absent from the OpenAPI enum | 1 data row(s) |
| lastNObservations (absent from spec) | ok | 200 | Added 2024-11-29 per the user guide; absent from the OpenAPI enum | 1 data row(s) |

## Findings

### Malformed responses (HTTP 200 with an invalid body) (1)

- detail=serieskeysonly (JSON): malformed — HTTP 200 but body is not valid JSON (SyntaxError: Unexpected non-whitespace character after JSON at position 42742 (l); tail: "er and the unit of measure.\"}}],\"dataSets\":[0]}]}\"errors\":[]"

### Documented endpoints that do not work (4)

- documented /structures/ path: broken — HTTP 400: Invalid structure: structures
- categoryscheme with references: timeout — timeout after 125000ms: https://data.api.abs.gov.au/rest/categoryscheme/ABS?detail=full&references=parentsandsiblings
- detail=serieskeysonly (CSV): broken — HTTP 200 but only 0 data row(s); header-only response
- request without User-Agent: broken — HTTP 403 with a CloudFront HTML error page (not an SDMX error) when User-Agent is absent

### Content constraints overstate availability (500)

| Dataflow | Declared | Observed | Detail |
| --- | --- | --- | --- |
| `ABS_C16_T07_SA` | 545,138,220 | 9,085,637 | ABS_C16_T07_SA: content constraint implies 545,138,220 series, 9,085,637 exist (1.7% dense, overstated 60.0x) |
| `ABS_C16_T05_SA` | 325,763,640 | 5,429,394 | ABS_C16_T05_SA: content constraint implies 325,763,640 series, 5,429,394 exist (1.7% dense, overstated 60.0x) |
| `C21_G09_SA2` | 284,387,400 | 4,739,790 | C21_G09_SA2: content constraint implies 284,387,400 series, 4,739,790 exist (1.7% dense, overstated 60.0x) |
| `ABS_C16_T09_SA` | 256,247,100 | 4,270,785 | ABS_C16_T09_SA: content constraint implies 256,247,100 series, 4,270,785 exist (1.7% dense, overstated 60.0x) |
| `C21_G09_SAL` | 219,687,120 | 24,409,680 | C21_G09_SAL: content constraint implies 219,687,120 series, 24,409,680 exist (11.1% dense, overstated 9.0x) |
| `C21_G47_SA2` | 203,558,400 | 3,392,640 | C21_G47_SA2: content constraint implies 203,558,400 series, 3,392,640 exist (1.7% dense, overstated 60.0x) |
| `ABS_C16_G44_SA` | 194,849,280 | 3,247,488 | ABS_C16_G44_SA: content constraint implies 194,849,280 series, 3,247,488 exist (1.7% dense, overstated 60.0x) |
| `ABS_C16_T13_SA` | 163,896,660 | 2,731,611 | ABS_C16_T13_SA: content constraint implies 163,896,660 series, 2,731,611 exist (1.7% dense, overstated 60.0x) |
| `C21_G47_SAL` | 159,076,224 | 17,675,136 | C21_G47_SAL: content constraint implies 159,076,224 series, 17,675,136 exist (11.1% dense, overstated 9.0x) |
| `C21_G13_SA2` | 151,315,560 | 2,521,926 | C21_G13_SA2: content constraint implies 151,315,560 series, 2,521,926 exist (1.7% dense, overstated 60.0x) |
| `ABS_C16_T06_SA` | 148,674,060 | 2,477,901 | ABS_C16_T06_SA: content constraint implies 148,674,060 series, 2,477,901 exist (1.7% dense, overstated 60.0x) |
| `C21_G11_SA2` | 137,722,200 | 2,295,370 | C21_G11_SA2: content constraint implies 137,722,200 series, 2,295,370 exist (1.7% dense, overstated 60.0x) |
| `C21_G13_SAL` | 116,890,128 | 12,987,792 | C21_G13_SAL: content constraint implies 116,890,128 series, 12,987,792 exist (11.1% dense, overstated 9.0x) |
| `C21_G54_SA2` | 112,681,800 | 1,878,030 | C21_G54_SA2: content constraint implies 112,681,800 series, 1,878,030 exist (1.7% dense, overstated 60.0x) |
| `C21_G55_SA2` | 112,681,800 | 1,878,030 | C21_G55_SA2: content constraint implies 112,681,800 series, 1,878,030 exist (1.7% dense, overstated 60.0x) |
| `ABS_C16_G51_SA` | 106,558,200 | 1,775,970 | ABS_C16_G51_SA: content constraint implies 106,558,200 series, 1,775,970 exist (1.7% dense, overstated 60.0x) |
| `ABS_C16_G52_SA` | 106,558,200 | 1,775,970 | ABS_C16_G52_SA: content constraint implies 106,558,200 series, 1,775,970 exist (1.7% dense, overstated 60.0x) |
| `C21_G11_SAL` | 106,389,360 | 11,821,040 | C21_G11_SAL: content constraint implies 106,389,360 series, 11,821,040 exist (11.1% dense, overstated 9.0x) |
| `C21_G10_SA2` | 105,885,120 | 1,764,752 | C21_G10_SA2: content constraint implies 105,885,120 series, 1,764,752 exist (1.7% dense, overstated 60.0x) |
| `ABS_C16_G56_SA` | 98,101,200 | 1,635,020 | ABS_C16_G56_SA: content constraint implies 98,101,200 series, 1,635,020 exist (1.7% dense, overstated 60.0x) |
| `C21_G21_SA2` | 95,153,520 | 1,585,892 | C21_G21_SA2: content constraint implies 95,153,520 series, 1,585,892 exist (1.7% dense, overstated 60.0x) |
| `C21_G17_SA2` | 91,218,600 | 1,520,310 | C21_G17_SA2: content constraint implies 91,218,600 series, 1,520,310 exist (1.7% dense, overstated 60.0x) |
| `C21_T33_SA2` | 90,145,440 | 1,502,424 | C21_T33_SA2: content constraint implies 90,145,440 series, 1,502,424 exist (1.7% dense, overstated 60.0x) |
| `ABS_C16_T08_SA` | 89,305,920 | 1,488,432 | ABS_C16_T08_SA: content constraint implies 89,305,920 series, 1,488,432 exist (1.7% dense, overstated 60.0x) |
| `ABS_C16_T08_TS_SA` | 89,305,920 | 1,488,432 | ABS_C16_T08_TS_SA: content constraint implies 89,305,920 series, 1,488,432 exist (1.7% dense, overstated 60.0x) |

_475 further constraint-overstatement findings in the JSON._

### Specification drift (documented but absent) (3)

- agencyscheme: missing — HTTP 404: Could not find requested structures
- hierarchicalcodelist: missing — HTTP 404: Could not find requested structures
- agency other than ABS: missing — HTTP 404: Could not find requested structures

### Metadata inconsistencies (171)

- Code annotation type casing is inconsistent upstream: both ORDER and order are emitted
- CL_ANA_SECTOR: label "Public non-financial corporations" is shared by 3 codes (GTS, PKS, GKS) — label-based selection is ambiguous
- CL_C16_MTWP: label "Other" is shared by 3 codes (11, 21, BO) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Accommodation" is shared by 3 codes (44, 440, 4400) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Air and Space Transport" is shared by 3 codes (49, 490, 4900) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Coal Mining" is shared by 3 codes (06, 060, 0600) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Commission-Based Wholesaling" is shared by 3 codes (38, 380, 3800) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Computer System Design and Related Services" is shared by 3 codes (70, 700, 7000) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Defence" is shared by 3 codes (76, 760, 7600) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Fuel Retailing" is shared by 3 codes (40, 400, 4000) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Gas Supply" is shared by 3 codes (27, 270, 2700) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Internet Publishing and Broadcasting" is shared by 3 codes (57, 570, 5700) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Oil and Gas Extraction" is shared by 3 codes (07, 070, 0700) — label-based selection is ambiguous
- CL_SSC_2011: label "Robinvale Irrigation District Secti" is shared by 3 codes (21153, 21154, 21155) — label-based selection is ambiguous
- CL_AGE: label "0 - 14" is shared by 2 codes (T0, 0014) — label-based selection is ambiguous
- CL_AGE: label "15 - 19" is shared by 2 codes (A15, 1519) — label-based selection is ambiguous
- CL_AGE: label "15 - 24" is shared by 2 codes (T15, 1524) — label-based selection is ambiguous
- CL_AGE: label "25 - 34" is shared by 2 codes (T25, 2534) — label-based selection is ambiguous
- CL_AGE: label "35 - 44" is shared by 2 codes (T35, 3544) — label-based selection is ambiguous
- CL_AGE: label "45 - 54" is shared by 2 codes (T45, 4554) — label-based selection is ambiguous
- CL_AGE: label "5 - 14" is shared by 2 codes (T5, 0514) — label-based selection is ambiguous
- CL_AGE: label "55 - 64" is shared by 2 codes (T55, 5564) — label-based selection is ambiguous
- CL_AGE: label "65 - 74" is shared by 2 codes (T65, 6574) — label-based selection is ambiguous
- CL_AGE: label "75 and over" is shared by 2 codes (7599, 75OVER) — label-based selection is ambiguous
- CL_ANA_SECTOR: label "Non-financial corporations" is shared by 2 codes (NFS, SKS) — label-based selection is ambiguous
- CL_ANA_SECTOR: label "Non-residents" is shared by 2 codes (SOS, SOC) — label-based selection is ambiguous
- CL_ANA_SECTOR: label "Other sectors" is shared by 2 codes (OSS, SES) — label-based selection is ambiguous
- CL_ANA_SFD: label "Final consumption expenditure" is shared by 2 codes (FCEH, FCE) — label-based selection is ambiguous
- CL_ANA_SFD: label "Final demand" is shared by 2 codes (GFD, PFD) — label-based selection is ambiguous
- CL_ASGS_2011: label "Unknown Australia" is shared by 2 codes (10UNKN, 10) — label-based selection is ambiguous
- CL_ASGS_2011: label "Migratory - Offshore - Shipping (NSW)" is shared by 2 codes (197, 19799) — label-based selection is ambiguous
- CL_ASGS_2011: label "Migratory - Offshore - Shipping (Vic.)" is shared by 2 codes (297, 29799) — label-based selection is ambiguous
- CL_ASGS_2011: label "Migratory - Offshore - Shipping (Qld)" is shared by 2 codes (397, 39799) — label-based selection is ambiguous
- CL_ASGS_2011: label "Migratory - Offshore - Shipping (SA)" is shared by 2 codes (497, 49799) — label-based selection is ambiguous
- CL_ASGS_2011: label "Migratory - Offshore - Shipping (WA)" is shared by 2 codes (597, 59799) — label-based selection is ambiguous
- CL_ASGS_2011: label "Migratory - Offshore - Shipping (Tas.)" is shared by 2 codes (697, 69799) — label-based selection is ambiguous
- CL_ASGS_2011: label "Migratory - Offshore - Shipping (NT)" is shared by 2 codes (797, 79799) — label-based selection is ambiguous
- CL_ASGS_2011: label "Australian Capital Territory" is shared by 2 codes (801, 8ACTE) — label-based selection is ambiguous
- CL_ASGS_2011: label "Migratory - Offshore - Shipping (ACT)" is shared by 2 codes (897, 89799) — label-based selection is ambiguous
- CL_ASGS_2011: label "Migratory - Offshore - Shipping (OT)" is shared by 2 codes (997, 99799) — label-based selection is ambiguous
- CL_ASGS_2011: label "Other Territories" is shared by 2 codes (901, 9OTER) — label-based selection is ambiguous
- CL_ASGS_2016: label "Migratory - Offshore - Shipping (OT)" is shared by 2 codes (99797, 99799) — label-based selection is ambiguous
- CL_C11_ASGS: label "Unknown Australia" is shared by 2 codes (10UNKN, 10) — label-based selection is ambiguous
- CL_C11_ASGS: label "Migratory - Offshore - Shipping (NSW)" is shared by 2 codes (197, 19799) — label-based selection is ambiguous
- CL_C11_ASGS: label "Migratory - Offshore - Shipping (Vic.)" is shared by 2 codes (297, 29799) — label-based selection is ambiguous
- CL_C11_ASGS: label "Migratory - Offshore - Shipping (Qld)" is shared by 2 codes (397, 39799) — label-based selection is ambiguous
- CL_C11_ASGS: label "Migratory - Offshore - Shipping (SA)" is shared by 2 codes (497, 49799) — label-based selection is ambiguous
- CL_C11_ASGS: label "Migratory - Offshore - Shipping (WA)" is shared by 2 codes (597, 59799) — label-based selection is ambiguous
- CL_C11_ASGS: label "Migratory - Offshore - Shipping (Tas.)" is shared by 2 codes (697, 69799) — label-based selection is ambiguous
- CL_C11_ASGS: label "Migratory - Offshore - Shipping (NT)" is shared by 2 codes (797, 79799) — label-based selection is ambiguous
- CL_C11_ASGS: label "Australian Capital Territory" is shared by 2 codes (801, 8ACTE) — label-based selection is ambiguous
- CL_C11_ASGS: label "Migratory - Offshore - Shipping (ACT)" is shared by 2 codes (897, 89799) — label-based selection is ambiguous
- CL_C11_ASGS: label "Migratory - Offshore - Shipping (OT)" is shared by 2 codes (997, 99799) — label-based selection is ambiguous
- CL_C11_ASGS: label "Other Territories" is shared by 2 codes (901, 9OTER) — label-based selection is ambiguous
- CL_C11_LANP_TS: label "Overseas visitors" is shared by 2 codes (V, VIS) — label-based selection is ambiguous
- CL_C11_MTWP: label "Car, as driver" is shared by 2 codes (016, 025) — label-based selection is ambiguous
- CL_C11_MTWP: label "Car, as passenger" is shared by 2 codes (017, 026) — label-based selection is ambiguous
- CL_C11_MTWP: label "Ferry" is shared by 2 codes (013, 022) — label-based selection is ambiguous
- CL_C11_MTWP: label "Other" is shared by 2 codes (021, BO) — label-based selection is ambiguous
- CL_C11_MTWP: label "Tram (includes light rail)" is shared by 2 codes (014, 023) — label-based selection is ambiguous
- CL_C11_PUR1P: label "Different SA2  Total" is shared by 2 codes (2_0, 2_D) — label-based selection is ambiguous
- CL_C11_SPCT: label "Total persons" is shared by 2 codes (TT, AGEG) — label-based selection is ambiguous
- CL_C11_TISP: label "Six or more children" is shared by 2 codes (06OVER, 06_8) — label-based selection is ambiguous
- CL_C11_YARRP: label "2001-2005" is shared by 2 codes (8, 12) — label-based selection is ambiguous
- CL_C16_AGE: label "15 - 19" is shared by 2 codes (1519, A15) — label-based selection is ambiguous
- CL_C16_AGE: label "15 - 24" is shared by 2 codes (1524, T15) — label-based selection is ambiguous
- CL_C16_AGE: label "25 - 34" is shared by 2 codes (2534, T25) — label-based selection is ambiguous
- CL_C16_AGE: label "35 - 44" is shared by 2 codes (3544, T35) — label-based selection is ambiguous
- CL_C16_AGE: label "45 - 54" is shared by 2 codes (4554, T45) — label-based selection is ambiguous
- CL_C16_AGE: label "5 - 14" is shared by 2 codes (0514, T5) — label-based selection is ambiguous
- CL_C16_AGE: label "55 - 64" is shared by 2 codes (5564, T55) — label-based selection is ambiguous
- CL_C16_AGE: label "65 - 74" is shared by 2 codes (6574, T65) — label-based selection is ambiguous
- CL_C16_AGE: label "75 and over" is shared by 2 codes (7599, 75OVER) — label-based selection is ambiguous
- CL_C16_LANP: label "Djinba" is shared by 2 codes (826, 8262) — label-based selection is ambiguous
- CL_C16_LANP: label "Nhangu" is shared by 2 codes (828, 8281) — label-based selection is ambiguous
- CL_C16_REGION_TYPE: label "Other" is shared by 2 codes (O, OT) — label-based selection is ambiguous
- CL_ERP_COB: label "Inadequately Described" is shared by 2 codes (0000, X_0000) — label-based selection is ambiguous
- CL_MODELLERS_DB: label "Households ; Secondary income receivable - Social assistance benefits (Current prices)" is shared by 2 codes (AC_TCB$, UC_BTCB$) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Adult, Community and Other Education" is shared by 2 codes (82, 821) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Advertising Services" is shared by 2 codes (694, 6940) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Airport Operations and Other Air Transport Support Services" is shared by 2 codes (522, 5220) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Aquaculture" is shared by 2 codes (02, 020) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Auxiliary Insurance Services" is shared by 2 codes (642, 6420) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Central Banking" is shared by 2 codes (621, 6210) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Central Government Administration" is shared by 2 codes (751, 7510) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Child Care Services" is shared by 2 codes (871, 8710) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Cigarette and Tobacco Product Manufacturing" is shared by 2 codes (122, 1220) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Clubs (Hospitality)" is shared by 2 codes (453, 4530) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Creative and Performing Arts Activities" is shared by 2 codes (90, 900) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Dairy Cattle Farming" is shared by 2 codes (016, 0160) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Deer Farming" is shared by 2 codes (018, 0180) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Department Stores" is shared by 2 codes (426, 4260) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Educational Support Services" is shared by 2 codes (822, 8220) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Electricity Distribution" is shared by 2 codes (263, 2630) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Electricity Transmission" is shared by 2 codes (262, 2620) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Farm Animal and Bloodstock Leasing" is shared by 2 codes (662, 6620) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Financial Asset Investing" is shared by 2 codes (624, 6240) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Forestry Support Services" is shared by 2 codes (051, 0510) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Forestry and Logging" is shared by 2 codes (03, 030) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Fruit and Vegetable Processing" is shared by 2 codes (114, 1140) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Funeral, Crematorium and Cemetery Services" is shared by 2 codes (952, 9520) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Gambling Activities" is shared by 2 codes (92, 920) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Glass and Glass Product Manufacturing" is shared by 2 codes (201, 2010) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Grocery, Liquor and Tobacco Product Wholesaling" is shared by 2 codes (36, 360) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Heavy and Civil Engineering Construction" is shared by 2 codes (31, 310) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Hospitals" is shared by 2 codes (84, 840) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Hunting and Trapping" is shared by 2 codes (042, 0420) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Internet Service Providers and Web Search Portals" is shared by 2 codes (591, 5910) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Iron and Steel Forging" is shared by 2 codes (221, 2210) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Justice" is shared by 2 codes (754, 7540) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Knitted Product Manufacturing" is shared by 2 codes (134, 1340) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Leather Tanning, Fur Dressing and Leather Product Manufacturing" is shared by 2 codes (132, 1320) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Libraries and Archives" is shared by 2 codes (601, 6010) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Life Insurance" is shared by 2 codes (631, 6310) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Local Government Administration" is shared by 2 codes (753, 7530) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Market Research and Statistical Services" is shared by 2 codes (695, 6950) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Metal Ore Mining" is shared by 2 codes (08, 080) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Motor Vehicle and Motor Vehicle Parts Wholesaling" is shared by 2 codes (35, 350) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Museum Operation" is shared by 2 codes (891, 8910) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Natural Rubber Product Manufacturing" is shared by 2 codes (192, 1920) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Non-Depository Financing" is shared by 2 codes (623, 6230) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Non-Financial Intangible Assets (Except Copyrights) Leasing" is shared by 2 codes (664, 6640) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Non-Residential Building Construction" is shared by 2 codes (302, 3020) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Non-Store Retailing" is shared by 2 codes (431, 4310) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Oil and Fat Manufacturing" is shared by 2 codes (115, 1150) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "On Selling Electricity and Electricity Market Operation" is shared by 2 codes (264, 2640) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Other Information Services" is shared by 2 codes (602, 6020) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Other Mining Support Services" is shared by 2 codes (109, 1090) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Other Non-Metallic Mineral Mining and Quarrying" is shared by 2 codes (099, 0990) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Other Non-Metallic Mineral Product Manufacturing" is shared by 2 codes (209, 2090) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Other Social Assistance Services" is shared by 2 codes (879, 8790) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Packaging Services" is shared by 2 codes (732, 7320) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Pathology and Diagnostic Imaging Services" is shared by 2 codes (852, 8520) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Petroleum and Coal Product Manufacturing" is shared by 2 codes (17, 170) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Pharmaceutical and Toiletry Goods Wholesaling" is shared by 2 codes (372, 3720) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Postal and Courier Pick-up and Delivery Services" is shared by 2 codes (51, 510) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Preschool Education" is shared by 2 codes (801, 8010) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Private Households Employing Staff and Undifferentiated Goods- and Service-Producing Activities of Households for Own Use" is shared by 2 codes (96, 960) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Pubs, Taverns and Bars" is shared by 2 codes (452, 4520) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Pulp, Paper and Paperboard Manufacturing" is shared by 2 codes (151, 1510) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Radio Broadcasting" is shared by 2 codes (561, 5610) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Rail Freight Transport" is shared by 2 codes (471, 4710) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Rail Passenger Transport" is shared by 2 codes (472, 4720) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Real Estate Services" is shared by 2 codes (672, 6720) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Regulatory Services" is shared by 2 codes (772, 7720) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Religious Services" is shared by 2 codes (954, 9540) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Reproduction of Recorded Media" is shared by 2 codes (162, 1620) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Residential Care Services" is shared by 2 codes (86, 860) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Retail Commission-Based Buying and/or Selling" is shared by 2 codes (432, 4320) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Road Freight Transport" is shared by 2 codes (461, 4610) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Scenic and Sightseeing Transport" is shared by 2 codes (501, 5010) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Scientific Research Services" is shared by 2 codes (691, 6910) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Seafood Processing" is shared by 2 codes (112, 1120) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Sheet Metal Product Manufacturing (except Metal Structural and Container Products)" is shared by 2 codes (224, 2240) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Software Publishing" is shared by 2 codes (542, 5420) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "State Government Administration" is shared by 2 codes (752, 7520) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Superannuation Funds" is shared by 2 codes (633, 6330) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Supermarket and Grocery Stores" is shared by 2 codes (411, 4110) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Telecommunications Services" is shared by 2 codes (58, 580) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Tertiary Education" is shared by 2 codes (81, 810) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Travel Agency and Tour Arrangement Services" is shared by 2 codes (722, 7220) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Veterinary Services" is shared by 2 codes (697, 6970) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Warehousing and Storage Services" is shared by 2 codes (53, 530) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Water Freight Transport" is shared by 2 codes (481, 4810) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Water Passenger Transport" is shared by 2 codes (482, 4820) — label-based selection is ambiguous
- CL_PPI_FD_ITEM: label "Water Supply, Sewerage and Drainage Services" is shared by 2 codes (28, 281) — label-based selection is ambiguous
- CL_REGIONAL_LGA2017_MEASURE: label "Estimated Resident Population - Persons" is shared by 2 codes (ERP_5, ERP_P_1) — label-based selection is ambiguous
- CL_SERVICES_COUNTRY: label "Czechoslovakia, nfd" is shared by 2 codes (CZEC, CZEX) — label-based selection is ambiguous
- CL_SERVICES_COUNTRY: label "Former USSR, nfd" is shared by 2 codes (USSR, USSX) — label-based selection is ambiguous
- CL_SERVICES_COUNTRY: label "Netherlands Antilles, nfd" is shared by 2 codes (ANTI, NANX) — label-based selection is ambiguous
- CL_SERVICES_COUNTRY: label "Serbia and Montenegro, nfd" is shared by 2 codes (YUGO, SMOX) — label-based selection is ambiguous

### Test fixtures in production (1)

| Dataflow | Declared | Observed | Detail |
| --- | --- | --- | --- |
| `TEST` | — | — | TEST: test fixture published in the production dataflow listing |

### Dataflows missing from the topic tree (2)

| Dataflow | Declared | Observed | Detail |
| --- | --- | --- | --- |
| `BA_SA2_201116` | — | — | BA_SA2_201116: present in the dataflow listing but absent from every category scheme |
| `TEST` | — | — | TEST: present in the dataflow listing but absent from every category scheme |

### Per-dimension metadata is exact — the overstatement is purely combinatorial (1)

- Across all 1227 dataflows, declared per-dimension code sets match observed exactly — every advertised option exists in real data and no real code is unadvertised. The availability overstatement is therefore entirely combinatorial: the metadata implies a cross-product, and only a fraction of it exists.

## Method

- Structural metadata: seven bulk requests against `dataflow`, `datastructure`, `contentconstraint`, `codelist`, `conceptscheme`, `categoryscheme` and `categorisation`.
- Observed availability: per dataflow, `lastNObservations=1` to enumerate real series keys and `firstNObservations=1` to establish coverage start. Oversized responses are split recursively along the highest-cardinality dimension.
- Payload sizing: `Range: bytes=0-0`, which returns the full length in `Content-Range` without transferring the body.
- Raw responses are archived gzipped, so every figure here is reproducible from the captured payloads.

