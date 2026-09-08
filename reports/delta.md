# ABS Data API — declared vs observed

Generated 2026-09-08T08:35:27.737Z (run `delta-2026-09-08T08-35-27-736Z`).

This report is derived automatically. Declared metadata comes from the ABS structure endpoints; observed availability was established by pulling data, because `detail=serieskeysonly` does not work. Only empirically-confirmed series are treated as real, and this document is the difference between the two.

## Corpus

| Measure | Value |
| --- | --- |
| Dataflows published | 1,227 |
| Dataflows probed | 0 |
| Dataflows serving data | 0 |
| Dataflows serving nothing | 0 |
| Series implied by content constraints | 14,761,557,818 |
| Series that actually exist | 0 |
| Overall density | n/a |
| Documented behaviours checked | 14 (6 non-conforming) |

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

## Method

- Structural metadata: seven bulk requests against `dataflow`, `datastructure`, `contentconstraint`, `codelist`, `conceptscheme`, `categoryscheme` and `categorisation`.
- Observed availability: per dataflow, `lastNObservations=1` to enumerate real series keys and `firstNObservations=1` to establish coverage start. Oversized responses are split recursively along the highest-cardinality dimension.
- Payload sizing: `Range: bytes=0-0`, which returns the full length in `Content-Range` without transferring the body.
- Raw responses are archived gzipped, so every figure here is reproducible from the captured payloads.

