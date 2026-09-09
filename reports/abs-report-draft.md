# The ABS Data API as it actually behaves — findings from a complete empirical crawl

**DRAFT for review — not sent.** Intended recipient: api.data@abs.gov.au.

## Summary

Between 8 and 9 September 2026 we measured every one of the 1,227 dataflows the
ABS Data API (beta) publishes, by retrieving data rather than reading metadata.
The API is fast, open, and considerably more capable than its documentation
suggests. But its published metadata materially misdescribes what it serves, and
several documented behaviours do not exist. This report sets out what we found,
with evidence and reproduction steps, in the hope it is useful.

Headline numbers:

| Measure | Value |
|---|---|
| Dataflows published | 1,227 |
| Dataflows that serve data | 1,227 (none empty) |
| Series confirmed to exist, by retrieval | **621,536,714** |
| Series implied by content constraints | 14,761,557,818 |
| Overall density | **4.21%** — metadata overstates availability **23.8×** |
| Documented behaviours checked | 15, of which **8 do not conform** |

Everything below is reproducible from the raw responses we archived and the
open-source tooling at the end of this document.

## 1. Content constraints overstate availability 23.8× — but the marginals are exact

Each dataflow's `contentconstraint` (type `Actual`) lists, per dimension, the
codes that appear. A consumer multiplying those lists together — which is what
"actual constraint" invites — arrives at 14.76 billion series. 621.5 million
exist.

The per-dimension lists themselves are **perfect**: across every dimension of
every one of the 1,227 flows, the set of declared codes equals the set of codes
observed in real data. Nothing advertised is missing; nothing real is
unadvertised. The error is entirely in the implied cross-product.

Example — `CPI`: declared `MEASURE(7) × INDEX(161) × TSEST(2) × REGION(9) ×
FREQ(2)` = 40,572 combinations; 8,467 exist (20.9%).

## 2. The missing combinations are 96% principled — hierarchical geography encoded as separate dimensions

Testing each flow's real key set against the cross-product of its options:

| | Flows |
|---|---|
| Exact cross-product (every combination exists) | 130 |
| Cross-product once dimensions that are *functions of another* are removed — each dependency verified in the key set | 809 |
| Not reducible to a single-dimension dependency | 288 |

81.0% of all confirmed series sit in flows whose sparsity is fully explained
and verified. The mechanism is almost entirely geographic: `STATE` is
determined by the region code in 776 flows (`REGION`, `LGA_2016`,
`ASGS_2016`), `REGION_TYPE` likewise in 291, often both at once. The remaining
288 flows (19% of series) do not follow a single-dimension rule; their
sparsity has some other cause we cannot infer from the outside.

Example — `C21_G09_SAL`: 220 million combinations implied; 24,409,680 exist —
which is exactly `AGEP(10) × BPLP(53) × SEXP(3) × REGION(15,352)` once `STATE`
(a function of the suburb) is dropped.

**Suggestion.** The metadata does not need different marginals; it needs to
*declare the dependency*. SDMX offers hierarchical codelists for exactly this —
and `hierarchicalcodelist` is listed in the OpenAPI specification but returns
404 (§4). Alternatively, publishing constraints per `REGION_TYPE` would make the
implied product honest for the census families.

## 3. `detail=serieskeysonly` is broken

This is the one endpoint designed to answer "which series exist?", and the
reason the measurement above had to be made by retrieving data.

- `GET /rest/data/ABS,CPI/all?detail=serieskeysonly` with `Accept:
  application/vnd.sdmx.data+json` returns **HTTP 200 with malformed JSON**. The
  body ends `…"dataSets":[0]}]}"errors":[]` — a stray `"errors":[]` appended
  after the document closes, and the dataset itself reduced to `[0]`.
- With `Accept: application/vnd.sdmx.data+csv` it returns HTTP 200 with a
  header row and **zero data rows**.

Because both responses are `200`, a consumer sees success and silently receives
no keys.

## 4. Documented structures and paths that do not exist

| Documented | Observed |
|---|---|
| `/rest/structures/{structureType}/{agencyId}/{structureId}` (user guide) | `400 Invalid structure: structures` — only `/rest/{structureType}/{agencyId}/{structureId}` works |
| `agencyscheme` (OpenAPI `structureType` enum) | `404 Could not find requested structures` |
| `hierarchicalcodelist` (OpenAPI enum) | `404` |
| `agencyId` as a parameter | only `ABS` exists; any other value is `404` |
| Example URL in the user guide | contains a typo: `data.api..abs.gov.au` |

## 5. Undocumented behaviours consumers need to know

- **Requests without a `User-Agent` header receive `403` with a CloudFront HTML
  error page** — not an SDMX error, and not mentioned anywhere. Runtimes that
  send no default UA (Cloudflare Workers, some fetch implementations) fail
  closed with no useful message.
- **First requests for large structures time out.** `datastructure/ABS`,
  `contentconstraint/ABS`, `actualconstraint/ABS` and
  `categoryscheme/ABS?references=parentsandsiblings` all exceed the 120-second
  gateway limit when uncached (`504`), then return in well under a second once
  cached. They *work*, but a first-time consumer concludes they do not.
- **`availableconstraint` works and is excellent** — it returns availability
  conditioned on a partial key, and at full key depth agrees exactly with the
  data endpoint's 200/404. It is undocumented in the user guide, and returns
  `500` if `references=none` is passed.
- **The OpenAPI specification omits parameters that work**:
  `lastNObservations`, `firstNObservations`, `updatedAfter` (added November 2024
  per the user guide).

## 6. Minor metadata inconsistencies

- Code annotation types appear as both `ORDER` and `order`.
- A dataflow named `TEST` is published in production (it serves 3 series).
- Two dataflows (`BA_SA2_201116`, `TEST`) belong to no category and are
  therefore invisible to topic browsing.

## 7. What works well

In fairness — much does, and better than documented:

- No authentication, no observed rate limiting; 8-way parallel retrieval ran
  clean for 621 million series.
- `gzip` is honoured (a 38.5 MB CSV compresses to 4.4 MB).
- HTTP `Range` requests are honoured (`206`, `Accept-Ranges: bytes`), with
  `Content-Length` known upfront — invaluable for large pulls.
- OR-syntax in keys (`code1+code2+…`) works with segments of 120+ codes.
- Large responses are **not truncated**: two 38.5 MB pulls were byte-identical.
- The per-dimension marginals in every content constraint are exact (§1).

## Reproducibility

- Method: seven bulk structure requests; then, per dataflow, `lastNObservations=1`
  and `firstNObservations=1` retrievals to enumerate real series, splitting
  oversized flows recursively along dimension OR-groups. Every raw response was
  archived.
- Machine-readable findings: `reports/delta.json` (513 findings) and
  `reports/sparsity.json`; endpoint conformance results with URLs and response
  excerpts are included.
- A corrected OpenAPI 3.1 document describing the API as observed:
  `reports/openapi.json`, also served live at
  <https://abs-data-front-door.aicolab.workers.dev/api/openapi.json>.
- Tooling (TypeScript, open source): the crawler, conformance suite and report
  generators in this repository.

We would be glad to share the raw archive or walk through any finding.
