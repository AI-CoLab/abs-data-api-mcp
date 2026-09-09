# ABS Data API — Cartography & Catalogue Design

**Status:** design agreed, no implementation yet
**Date:** 2026-09-08

## 1. Purpose

The ABS Data API exposes a large, genuinely valuable statistical corpus, but its
published metadata and OpenAPI specification are materially inaccurate. Declared
availability overstates real availability, several documented endpoints do not
exist, and the one endpoint designed to answer "what series exist?" is broken.

This project performs **cartography**: empirically discovering, mapping and
documenting what the API *actually* serves, storing that as a queryable catalogue,
and exposing it through a browsable interface and a typed MCP server that acts as
a live front door to the upstream API.

**Governing principle: only empirically-confirmed series are treated as real.**
Declared metadata is stored separately and never mixed into the canonical view.
The gap between the two is derived automatically and published as a defect report.

## 2. Verified API findings

All findings below were confirmed against the live API on 2026-09-08.

### 2.1 Scale

| Thing | Count |
|---|---|
| Dataflows | 1,227 |
| Categorised dataflows | 1,226 (in 143 categories) |
| Codelists | 573 |
| Codes | 301,722 |
| Codes with a `parent` (hierarchical) | 232,200 (77%) |
| Concept schemes | 59 |
| Code annotation types | 17 |

Census 2021/2016 accounts for roughly 558 dataflows — near-identical tables
replicated across nine geography levels, i.e. ~45% of the corpus is Census
boilerplate.

### 2.2 What works well

- **No authentication, no API key, no observed rate limiting.** Eight-way parallel
  requests ran clean at ~2s each; 20 flows fetched in 6.7s wall clock.
- **`GET /rest/dataflow/ABS/{id}?references=all&detail=full`** is the key
  discovery call: one ~100KB request returns the dataflow, its DSD, all its
  codelists, concept schemes, categorisation and content constraints.
  Full structural crawl of all 1,227 flows ≈ 7 minutes.
- **Bulk metadata pulls that do work:** `codelist/ABS` (49MB, 36s),
  `categorisation/ABS` (617KB, 16s), `conceptscheme/ABS` (991KB, 7s),
  `categoryscheme/ABS` (30KB, 1.3s).
- **gzip is supported and dramatic:** CPI full history is 38.5MB identity,
  **4.4MB gzipped** (8.7×).
- **HTTP Range requests are supported:** `206`, `accept-ranges: bytes`, with
  `Content-Length` known upfront on the identity representation. This allows a
  large flow to be split into byte-range chunks across separate Worker
  invocations.
- **CSV with `labels=both`** returns code and label inline — ideal for mapping.
- **Query key syntax** all works: wildcards (`1..10.50.Q`), OR (`1+2.`),
  `lastNObservations`, `firstNObservations`, `updatedAfter`.
- Served behind CloudFront/Varnish with `cache-control: no-cache`.

### 2.3 Documentation and specification defects

The user guide and the OpenAPI spec both diverge from reality. Verified by the
automated conformance suite (`packages/crawler/src/endpoints.ts`), which records
the documented claim alongside live behaviour.

| Documented / specified | Actual behaviour |
|---|---|
| `/rest/structures/{type}/{agency}` | **400** `Invalid structure: structures` — only `/rest/{type}/{agency}/{id}` works |
| `agencyscheme` | **404** `Could not find requested structures` |
| `hierarchicalcodelist` | **404** |
| `actualconstraint/ABS` | Works once warm; **times out** at 120s on a cold cache, like the endpoints below |
| `detail=serieskeysonly` | **Broken.** HTTP 200 with malformed JSON (`"dataSets":[0]}]}"errors":[]`); CSV returns a header row and zero data rows |
| Any agency other than `ABS` | **404** — `agencyId` is parameterised but only one agency exists |
| OpenAPI parameter enums | Stale — omits `lastNObservations`, `firstNObservations`, `updatedAfter`, all of which work |
| Example URL in user guide | Contains a typo: `data.api..abs.gov.au` |

**Correction to an earlier reading of this API.** Four endpoints were initially
recorded as broken and are not:

| Endpoint | First observation | Actual |
|---|---|---|
| Bulk `datastructure/ABS` | 504 at 120s | **Works** — 3.4MB, 1,229 DSDs |
| Bulk `contentconstraint/ABS` | timed out | **Works** — 27.6MB, 2,433 constraints |
| `categoryscheme/ABS?references=parentsandsiblings` | 504 at 120s | **Works** — 25 schemes |
| `availableconstraint` | 500 | **Works** — see 2.8 |

The cause is caching, not capability: the service sits behind CloudFront and
Varnish with `cache-control: no-cache`, and only the first *uncached* request for
these large payloads is slow enough to hit the 120s gateway limit. With
retry-and-backoff they return in well under a second. The `availableconstraint`
500 was narrower still — it is triggered by passing `references=none`, and the
endpoint works when that parameter is omitted.

This matters twice over. It collapses the structural crawl from 1,227 per-flow
requests (~120MB) to **seven bulk requests, 86MB, 68 seconds**. And it means the
API is more capable than its documentation suggests, which is worth telling ABS
alongside the defects.

### 2.4 The core problem: declared vs actual availability

Content constraints are **per-dimension marginals**, not real key sets. For CPI:

- Declared: `MEASURE(7) × INDEX(161) × TSEST(2) × REGION(9) × FREQ(2)` = **40,572** series
- Observed: **7,168** distinct series
- Density: **17.7%** — declared overstates by ~5.7×

With `serieskeysonly` broken, the only way to establish truth is to pull data.
This is the entire justification for the observed-only approach.

### 2.8 `availableconstraint` is an exact existence oracle

The single most consequential finding, and it contradicts the claim in 2.4 that
pulling data is the only way to establish truth.

`GET /rest/availableconstraint/{flow}/{key}/ABS` returns availability
**conditioned on a partial key**, not a fixed marginal:

| Query | Returned cardinalities |
|---|---|
| `CPI/all` | `MEASURE=7 INDEX=161 TSEST=2 REGION=9 FREQ=2` |
| `CPI/1...1.` (MEASURE=1, REGION=1) | `MEASURE=1 INDEX=154 TSEST=1 REGION=1 FREQ=2` |

Conditioning genuinely narrows the space — `TSEST` collapses from 2 to 1 and
`INDEX` from 161 to 154. At full key depth it becomes exact:

| Fully-specified key | `availableconstraint` | `data` endpoint |
|---|---|---|
| `1.10001.10.50.Q` (real) | all dimensions at 1 | 200 |
| `1.99999.10.50.Q` (fake code) | empty cube region | 404 |
| `1.10001.20.1.M` (impossible combination) | empty cube region | 404 |

It agrees with the data endpoint exactly, in ~170ms and ~2.4KB.

**Consequences, stated narrowly.** For *cartography* it is not a substitute for
data pulls: enumerating a 609k-series flow by conditioning would need hundreds of
thousands of requests, where one data pull costs 42MB.

For the front door it removes the **D1 sizing** obstacle in decision 7a — keys
can be validated against ABS at call time, so D1 need not carry 20–100M keys.

**It does not amend decision 7.** The observed key set is still stored and is
still what the MCP server answers existence from; this endpoint is a
belt-and-braces check at call time, not a replacement for the map. Nor does it
license serving *declared* dimension values or code lists to callers: those are
unverified by definition, and offering them would reintroduce ABS's own 5.7×
overstatement one level up. An earlier proposal to do exactly that was rejected.

### 2.9 Declared key space

Measured across all 1,227 flows after the structural crawl:

| Bucket (declared keys) | Flows | Declared keys |
|---|---|---|
| <1k | 70 | 24,265 |
| <10k | 65 | 285,421 |
| <100k | 135 | 5,720,720 |
| <1M | 354 | 153,091,519 |
| <10M | 299 | 1,012,750,608 |
| >10M | 304 | 13,589,685,285 |
| **Total** | **1,227** | **14,761,557,818** |

Largest single flow: `ABS_C16_T07_SA` at 545,138,220 declared keys. Flows carry
2–9 dimensions (mean 5.47).

Observed density varies far too widely to extrapolate from — 4.6%
(`BA_SA2_201116`) to 100% (`POP_PROJ_REGION`) — which is why the probe is
preceded by an exact `Range: bytes=0-0` sizing pass rather than an estimate.

### 2.10 Final corpus measurements (crawl completed 2026-09-09)

All 1,227 dataflows probed to completion; none partial, none empty.

| Measure | Value |
|---|---|
| Series confirmed | **621,536,714** |
| Series implied by constraints | 14,761,557,818 |
| Overall density | **4.21% — overstated 23.8×** |
| Flows ≥95% dense | 155 |
| Flows at 10–50% (census 11.1% band dominates) | 685 |
| Flows <2% dense | 180 |
| Flows serving no data | **0** (even `TEST` serves 3 series) |
| Local database | 399GB incl. 3.4B-row dimension index |

**The strongest single finding: declared per-dimension marginals are exact.**
Across every dimension of every flow, the constraint's code set equals the
observed code set — no advertised option lacks data, no real code is
unadvertised. The entire 23.8× overstatement is therefore **combinatorial**:
the metadata implies a cross-product and only 4.21% of it exists. Two
consequences: (a) the defect to report to ABS is precisely "your marginals are
trustworthy, the cross-product they imply is not"; (b) it independently
corroborates crawl completeness — ABS's constraint pipeline and this probe
measured the same corpus by different routes and agree everywhere.

### 2.5 Data volume and shape

Sampled series counts per flow (`lastNObservations=1`) vary by four orders of
magnitude:

| Flow | Series | Payload |
|---|---|---|
| `ALC` | 49 | 2KB |
| `WPI` | 395 | 23KB |
| `LF` | 743 | 47KB |
| `ABS_LABOUR_ACCT` | 4,352 | 319KB |
| `CPI` | 7,168 | 473KB |
| `ABS_ANNUAL_ERP_LGA2024` | 31,748 | 2.4MB |
| `C21_G01_LGA` | 60,965 | 3.4MB |
| `ABS_C16_G43_LGA` | 202,679 | 13.8MB |
| `POP_PROJ_REGION` | 494,207 | 30.8MB |
| `BA_SA2_201116` | 609,389 | 42.8MB |

Full-history pulls are larger again (`ABS_ANNUAL_ERP_LGA2024` is 58MB).

**No silent truncation.** Two full CPI pulls were byte-identical
(38,567,159 bytes, 748,157 rows, 7,168 distinct series), and every series
returned by `lastNObservations=1` is present in the full pull.

### 2.6 Parsing hazards

- **`OBS_COMMENT` contains embedded newlines.** Naive line counting overcounts
  CPI series by ~18%. A real CSV parser is mandatory.
- **CSV column sets are per-flow, not fixed.** `ABS_LABOUR_ACCT` carries
  `UNIT_MULT` and dimensions `ASGS_2016`/`LABOURACCT_IND`; CPI carries neither.
  Headers must be parsed dynamically.
- **`TIME_PERIOD` formats vary** by frequency: `2025-Q3`, `2022`, monthly forms.
- Labels are **English only** (`names: { en }`) — no multilingual handling needed.
- Annotation type casing is inconsistent: both `ORDER` and `order` appear.
- Errors are plain text, not SDMX: unknown flow or empty key → `404 NoRecordsFound`.

### 2.7 Code annotations worth preserving

`AREA_ALBERS_SQKM`, `ASGS_LOCI_URI` (linked-data URIs), `LEVEL`, `ORDER`,
`FULL_NAME`, `ALTERNATIVE_TITLES`, `CONTEXT`, `FURTHER_INFORMATION`, `LINK`,
and for ANZSCO occupations `SKILL_LEVEL`, `INDICATIVE_SKILL_LEVEL`,
`TASKS_INCLUDE`, `MAIN_TASKS`, `SPECIALISATIONS`,
`OCCUPATIONS_IN_THIS_GROUP_INCLUDE`, `REGISTRATION_AND_LICENSING`.

## 3. Agreed decisions

### Scope and truth model

1. **Crawl depth:** structure + cheap probe. Full `references=all` structural
   fetch for all 1,227 flows, plus data probes sufficient to confirm real series.
2. **Truth model:** observed-only is canonical. Declared metadata is stored in
   separate tables and never joined into the canonical view. The
   declared-vs-observed delta is **derived automatically**.
3. **Observed store records:** series key and its dimension code values, first
   and last `TIME_PERIOD`, observation count, and observed attributes actually
   present (`UNIT_MEASURE`, `UNIT_MULT`, `OBS_STATUS`, `DECIMALS`, `BASE_PERIOD`).
   Requires both a `firstNObservations=1` and a `lastNObservations=1` pass.
4. **Census flows:** probe all of them for real observed keys, but model the
   table × geography factorisation so the catalogue reads as "G01 × 9 geographies"
   rather than 558 flat rows.
5. **Empty flows:** flows that exist structurally but serve no data (including the
   literal `TEST` flow and the uncategorised orphan `BA_SA2_201116`) are
   catalogued with a probe status and reason, feed the delta report, and are
   **excluded from the MCP surface**.
6. **Oversized flows:** on timeout or a size threshold, recursively split the
   query along the highest-cardinality dimension and recombine, so every flow
   yields complete observed keys. Byte-range chunking is available as a
   complementary mechanism.

### Storage and schema

7. **Key existence:** store the **full observed key set**. The MCP server can
   then answer existence questions exactly and never emit a query that returns
   `NoRecordsFound`.
7a. **Storage encoding is deliberately deferred.** Build the clean normalised
   relational model against **local SQLite** first. A normalised key-value table
   at ~6 rows per series would exceed D1's 10GB ceiling. That is an
   **optimisation to solve once everything before it works** — options at that
   point include packed key strings plus observed marginals, sharding across D1
   databases, or compressed key sets in R2. Do not let it block the
   pre-deployment work. Note that `availableconstraint` (section 2.8) has since
   made the D1 side of this largely moot: the front door validates keys live.

7b. **Store every observed key, and build the per-dimension index for all
   flows.** Reaffirmed after the real numbers came in: measured average is 8,543
   series per flow, so the corpus is tens of millions of series. Both
   `series` (one row per series) and `series_key_value` (~6 rows per series,
   hundreds of millions) are built corpus-wide in the local SQLite build.

   `series_key_value` carries **no information** that `series.key_string` lacks
   — verified that no ABS code contains the `.` separator, so a key string
   splits back to exactly the same tuple. Its sole purpose is indexing: a
   dimension sits at a different key position in every flow, so no index over
   `key_string` can serve a predicate like `REGION=1GSYD`, whereas
   `(dimension_id, code_id)` can.

   **Sourced from the API, never derived.** An offline backfill that split
   `key_string` was proposed and **rejected**: it would have manufactured rows
   in the observed store from a concatenation this code had itself produced,
   which is exactly the local inference the governing principle forbids. The
   API returns one CSV column per dimension, so the probe writes those values
   as it parses them. Populating this table therefore requires a probe run, not
   a post-processing pass.

### 3a. Provisional, NOT settled

**Observation counts are derived, and this is a stopgap.** A two-pass probe
(`firstNObservations=1` + `lastNObservations=1`) yields exact first and last
periods but not true observation counts. `series.derived_obs_count` is computed
from frequency and extent: exact for gap-free series, an upper bound where gaps
exist. `series.actual_obs_count` is deliberately left NULL.

This was accepted **for now only, and explicitly not endorsed as the final
answer.** It must not be cited later as a settled decision. Getting true counts
and gap detection requires pulling full history, which is the
hundreds-of-GB path deferred in decision 1. Revisit when the rest works.
8. **Codelists:** keep everything, normalised. Codes with `parent`, plus all
   annotations in a typed key-value table.
9. **Hierarchy:** adjacency list **plus a closure table** of ancestor-descendant
   pairs, for fast arbitrary hierarchy queries.
10. **D1 ingest:** build a SQLite file and load it via `wrangler d1 import` /
    the D1 import API for the initial bulk load; incremental refresh goes through
    batched D1 writes. One shared Zod/Drizzle schema across both paths.
11. **Raw archive:** every raw ABS response archived to **R2, gzipped**, keyed by
    flow and fetch time (~5–10GB). Enables re-deriving the catalogue and the
    delta report without re-crawling, and provides evidence for the ABS report.

### Implementation

12. **Stack:** all TypeScript, `git init`. Fully typesafe with Zod; no
    cross-language context switching. Rationale: the pipeline must ultimately run
    from a Cloudflare Worker with no reliance on local scripts or containers.
12a. **Drizzle ORM** for schema definition, migrations and queries. One Drizzle
    schema is the single source of truth, driving both the local SQLite build and
    D1 (`drizzle-orm/sqlite-core`, with `drizzle-kit` for migrations). Zod
    schemas for API-boundary validation are derived from it via
    `drizzle-zod` where they overlap, so the crawler, catalogue and MCP server
    share one set of types end to end.
13. **Orchestration:** **Cloudflare Workflows** for durable multi-step execution
    with built-in retries and state.
14. **Bootstrap:** write Worker-compatible TypeScript, but run the first full
    crawl via a local Node/tsx entrypoint against local SQLite for fast
    iteration, then deploy the identical code paths.
15. **Refresh:** weekly cheap structural/constraint diff to detect new or changed
    flows; full observed re-probe monthly. `updatedAfter` is available for change
    detection.
16. **Pipeline is re-runnable and cached** — resumable, incremental, not a
    one-off snapshot.

### Outputs

17. **Primary output:** a browsable web artifact backed by a database, so it can
    exceed the 16MB page limit and stay searchable. SQLite is the target format,
    hosted on Cloudflare D1.
18. **Artifact UX:** search-first discovery — fast full-text search across flows,
    dimensions and codes, drilling into a flow's real dimensions, observed
    coverage, and a copyable working API URL.
19. **Delta report:** auto-generated each crawl, published as an artifact plus
    machine-readable JSON in the repo. Covers broken endpoints, the
    `serieskeysonly` defect, per-flow constraint overstatement, empty flows and
    metadata inconsistencies. To be shared with ABS (`api.data@abs.gov.au`) —
    nothing sent without explicit approval.
20. **MCP server:** a **live front door** to the ABS API, not a data warehouse.
    D1 holds catalogue and validation metadata only; observations are fetched
    from ABS at call time. Deployed **public and unauthenticated**, mirroring the
    upstream API.
21. **MCP tool surface — architecture settled 2026-09-08** (specific tool
    signatures still finalised against the finished probe):

    **Single source, derived doors.** The precedent is Cloudflare's own API:
    ~2,500 endpoints exposed over MCP as just two fixed tools (search +
    execute) reading the OpenAPI spec — the spec is the surface, the doors
    never change. Our equivalent single source is the **observed catalogue**;
    each crawl regenerates one contract artifact from it (Zod schemas, the
    corrected OpenAPI document, the D1 data). Every door either reads that
    artifact at runtime or is mechanically rendered from it. **No door
    hardcodes the surface, so nothing is manually kept in alignment.**

    - **MCP door:** a fixed set of generic verbs (search tables / describe
      table / get data) that query the catalogue at runtime; invalid or
      ambiguous selections answered with MRTR `input_required` carrying the
      observed valid options. Built on MCP spec 2026-07-28 (fully stateless,
      no sessions) via MCP TypeScript SDK v2 + `createMcpHandler` — a plain
      Worker, no Durable Objects. `tools/list` and describe responses served
      with `ttlMs`/`cacheScope: public` and deterministic ordering (decision
      22, cache-first). Per-table generated "headliner" tools are dropped:
      they were the only component carrying a manual-alignment burden.
    - **Calling verbs:** named selections (`{table, select: {REGION:
      "Melbourne", ...}}`), labels or codes in, server resolves and validates
      against the observed store. Validated selections may be returned as
      self-contained signed tokens (capability-style handles per the 2026
      spec's stateless-handle guidance) so later calls skip re-validation.
    - **HTTP/OpenAPI door:** chanfana (Cloudflare's Zod v4 OpenAPI 3.1
      generator/validator, Workers-first) or oRPC — routes generated from the
      contract, spec emitted from the same Zod. The emitted **corrected
      OpenAPI document is itself a cartography deliverable**, to sit beside
      ABS's inaccurate published spec in the defect report.
    - **Docs door:** Scalar renders the emitted spec. Scalar's hosted
      OpenAPI-to-MCP generation is noted and rejected for the MCP door itself
      (it cannot express observed-constrained options or MRTR narrowing).
    - **Planned later doors, same contract (committed 2026-09-08; sequenced
      after the core doors ship):**
      1. A Cap'n Web `RpcTarget` as the TypeScript SDK — pipelined
         validate-and-fetch in one round trip; no OpenAPI story, so it
         complements rather than replaces the HTTP door.
      2. A **Code Mode** flavour on the same MCP server, per Cloudflare's
         production pattern (their API: 2,500 endpoints as two tools, ~244K
         tokens of schemas collapsed to ~1K): a `search` tool where the model
         writes JS queries against our **corrected, pre-resolved OpenAPI
         spec** in a no-network isolate, and an `execute` tool running
         model-written JS in a fresh Worker Loader isolate whose only
         capability is our contract-validated client — `globalOutbound`
         pinned to our Worker, credentials in props, never inside the
         isolate. Especially apt for a statistics API: multi-series
         analytical work happens inside the sandbox and only computed results
         reach model context, so megabyte data payloads never occupy it.
         Observed-only is preserved because the injected client is the same
         validated core; invalid combinations throw typed errors the model
         fixes in code.

      These converge on one artifact: the sandbox's injected client and the
      Cap'n Web SDK are the same contract-generated typed client. One
      generator output, three consumers (developers, model-written code, our
      own UI). Classic fixed verbs remain alongside — per Cloudflare's own
      guidance, explicit tools win for frequent fixed lookups, Code Mode for
      broad coverage and analytical composition.
    - **Cloudflare Agents SDK:** used only for `createMcpHandler`. The rest of
      it is a stateful-agent runtime, which this deliberately stateless front
      door does not want.

    Combination validity remains runtime truth from the observed store
    (decision 7): no static schema can carry 300M+ arbitrary combinations —
    the schema would be the database. Where the observed key set proves to
    have compressible structure (census families landing at exactly 1/9
    density suggest rule-shaped sparsity), exact static types MAY be generated
    for those tables; measured from the key set, never assumed.
22. **Abuse protection: cache-first now, rate limiting last.** Aggressive use
    of the Cache API and D1 read caching so read abuse is cheap rather than
    blocked. **Amended 2026-09-08:** rate limiting WILL be added, as the final
    step once the system is fully functional — not before. The read surface may
    stay generous; the Code Mode `execute` tool is a different risk class
    (strangers running compute on our account) and is the primary reason a
    limiter is required at the end. Per-execution budgets (wall-clock, CPU,
    subrequests, output size) apply from the day that tool ships regardless.
23. **Repo layout: pnpm workspace, four packages.**
    - `packages/schema` — Drizzle + Zod, the shared source of truth
    - `packages/crawler` — structural crawl and observed probe
    - `packages/catalogue` — delta report and artifact build
    - `packages/worker` — MCP front door
    Keeps boundaries clean and stops the Worker bundling crawler code.

## 4. Destination

The agreed end-state (2026-09-08): one contract generated from the observed
catalogue per crawl, with five derived surfaces — fixed-verb MCP door, Code Mode
MCP flavour (search over the corrected spec + sandboxed execute against the
validated client), HTTP/OpenAPI door with Scalar docs, Cap'n Web TypeScript SDK,
and the browsable artifact. Sequencing: cartography completes first, then core
doors, then SDK + Code Mode, then rate limiting as the final step (decision 22,
amended).

## 5. Provisional schema sketch

Two independent groups, never joined into the canonical view.

**Declared** (from ABS metadata, may be wrong):
`declared_dataflow`, `declared_dimension`, `declared_constraint_value`

**Observed** (empirically confirmed, canonical):
`flow`, `flow_dimension`, `series`, `series_key_value`, `series_coverage`,
`series_attribute`, `probe_run`, `probe_status`

**Shared reference** (structural, not availability claims):
`codelist`, `code`, `code_annotation`, `code_closure`, `concept_scheme`,
`concept`, `category`, `categorisation`

**Derived:**
`delta_finding` (regenerated each crawl, never hand-edited)

## 6. Next steps

1. `git init`, scaffold the TypeScript project (crawler + Worker, shared schema).
2. Implement the schema with Zod/Drizzle and the structural crawler.
3. Full structural crawl (~7 min) — complete knowledge of the dimension space.
4. Implement the observed probe with dimension-splitting and streaming CSV parse.
5. Full observed probe, R2 archive, SQLite build.
6. Delta report generation.
7. Search-first artifact over the catalogue.
8. Design and build the MCP front door.
