# ABS Data API — declared vs observed

Generated 2026-09-09T03:08:01.417Z (run `delta-2026-09-09T03-08-01-416Z`).

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
| Documented behaviours checked | 14 (6 non-conforming) |

> Content constraints overstate the size of the corpus by roughly **23.8x**. The cube regions published for each dataflow are per-dimension marginals, not the set of real key combinations, so multiplying them out does not describe what can be retrieved.

## Endpoint conformance

| Endpoint | Verdict | HTTP | Documented behaviour | Observed |
| --- | --- | --- | --- | --- |
| agency other than ABS | **missing** | 404 | Spec exposes agencyId as a parameter, implying multiple agencies | HTTP 404: Could not find requested structures |
| agencyscheme | **missing** | 404 | Spec lists agencyscheme as a valid structureType | HTTP 404: Could not find requested structures |
| detail=serieskeysonly (CSV) | **broken** | 200 | detail=serieskeysonly should enumerate every series key | HTTP 200 but only 0 data row(s); header-only response |
| detail=serieskeysonly (JSON) | **malformed** | 200 | Spec lists detail=serieskeysonly: series keys without observations | HTTP 200 but body is not valid JSON (SyntaxError: Unexpected non-whitespace character after JSON at position 42742 (l); tail: "er and the unit of measure.\"}}],\"dataSets\":[0]}]}\"errors\":[]" |
| documented /structures/ path | **broken** | 400 | User guide documents /structures/{structureType}/{agencyId}/{structureId} | HTTP 400: Invalid structure: structures |
| hierarchicalcodelist | **missing** | 404 | Spec lists hierarchicalcodelist as a valid structureType | HTTP 404: Could not find requested structures |
| actualconstraint | ok | 200 | Spec lists actualconstraint as a valid structureType | HTTP 200, valid JSON |
| availableconstraint | ok | 200 | SDMX-REST defines availableconstraint for actual data availability | HTTP 200, valid JSON |
| bulk contentconstraint | ok | 200 | Spec: GET /contentconstraint/ABS returns all content constraints | data.contentConstraints: 2433 items |
| bulk datastructure | ok | 200 | Spec: GET /datastructure/ABS returns all data structures | data.dataStructures: 1229 items |
| categoryscheme with references | ok | 200 | Spec lists references=parentsandsiblings as a valid value | data.categorySchemes: 25 items |
| dataflow listing | ok | 200 | Spec: GET /{structureType}/{agencyId} returns all structures of a type | data.dataflows: 1227 items |
| firstNObservations (absent from spec) | ok | 200 | Added 2024-11-29 per the user guide; absent from the OpenAPI enum | 1 data row(s) |
| lastNObservations (absent from spec) | ok | 200 | Added 2024-11-29 per the user guide; absent from the OpenAPI enum | 1 data row(s) |

## Findings

### Malformed responses (HTTP 200 with an invalid body) (1)

- detail=serieskeysonly (JSON): malformed — HTTP 200 but body is not valid JSON (SyntaxError: Unexpected non-whitespace character after JSON at position 42742 (l); tail: "er and the unit of measure.\"}}],\"dataSets\":[0]}]}\"errors\":[]"

### Documented endpoints that do not work (2)

- documented /structures/ path: broken — HTTP 400: Invalid structure: structures
- detail=serieskeysonly (CSV): broken — HTTP 200 but only 0 data row(s); header-only response

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

### Metadata inconsistencies (1)

- Code annotation type casing is inconsistent upstream: both ORDER and order are emitted

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

