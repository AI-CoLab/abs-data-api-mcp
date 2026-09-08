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

The user guide and the OpenAPI spec both diverge from reality.

| Documented / specified | Actual behaviour |
|---|---|
| `/rest/structures/{type}/{agency}` | **400** — only `/rest/{type}/{agency}/{id}` works |
| `agencyscheme` | **404** |
| `hierarchicalcodelist` | **404** |
| `availableconstraint` | **500** |
| `detail=serieskeysonly` | **Broken.** Returns malformed JSON (`"dataSets":[0]}]}"errors":[]`); CSV returns header row only |
| Bulk `datastructure/ABS` | **504** at 120s |
| `categoryscheme/ABS?references=parentsandsiblings` | **504** at 120s |
| Bulk `contentconstraint/ABS` | Times out (>60s, no response) |
| OpenAPI parameter enums | Stale — omits `lastNObservations`, `firstNObservations`, `updatedAfter`, all of which work |
| Example URL in user guide | Contains a typo: `data.api..abs.gov.au` |

Only the `ABS` agency exists; `dataflow/all` returns the same as `dataflow/ABS`.

### 2.4 The core problem: declared vs actual availability

Content constraints are **per-dimension marginals**, not real key sets. For CPI:

- Declared: `MEASURE(7) × INDEX(161) × TSEST(2) × REGION(9) × FREQ(2)` = **40,572** series
- Observed: **7,168** distinct series
- Density: **17.7%** — declared overstates by ~5.7×

With `serieskeysonly` broken, the only way to establish truth is to pull data.
This is the entire justification for the observed-only approach.

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
   relational model against **local SQLite** first. Revised estimate is 20–100M
   series; a normalised key-value table at ~6 rows per series is 150–600M rows
   and would exceed D1's 10GB ceiling. That is an **optimisation to solve once
   everything before it works** — options at that point include packed key
   strings plus observed marginals, sharding across D1 databases, or compressed
   key sets in R2. Do not let it block the pre-deployment work.
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
21. **MCP tool surface:** deferred until cartography is complete, then designed
    from what the data actually looks like.
22. **Abuse protection: cache-first, no rate limiter.** Aggressive use of the
    Cache API and D1 read caching so abuse is cheap rather than blocked. Chosen
    deliberately in favour of legitimate users; accepts that there is no hard
    ceiling on cost.
23. **Repo layout: pnpm workspace, four packages.**
    - `packages/schema` — Drizzle + Zod, the shared source of truth
    - `packages/crawler` — structural crawl and observed probe
    - `packages/catalogue` — delta report and artifact build
    - `packages/worker` — MCP front door
    Keeps boundaries clean and stops the Worker bundling crawler code.

## 4. Resolved

Rate limiting was the one open recommendation; settled by decision 22
(cache-first, no limiter).

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
