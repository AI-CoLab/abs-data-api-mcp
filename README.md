# ABS Data API — cartography and front door

The Australian Bureau of Statistics Data API is valuable and badly described.
This project measured what it actually serves — every dataflow, by retrieval —
and exposes the result as a typed front door: an MCP server and an HTTP API
that only ever offer what exists.

| | |
|---|---|
| Front door | <https://abs-data-front-door.aicolab.workers.dev> |
| MCP (2026-07-28, stateless) — 4 fixed verbs + Code Mode `search`/`execute`, resources, prompts | `https://abs-data-front-door.aicolab.workers.dev/mcp` |
| RPC door (Cap'n Web; what `@abs/sdk` speaks — HTTP batch or WebSocket) | `https://abs-data-front-door.aicolab.workers.dev/rpc` |
| HTTP API | `https://abs-data-front-door.aicolab.workers.dev/api/tables` |
| Scalar reference | <https://abs-data-front-door.aicolab.workers.dev/api/docs> |
| Corrected OpenAPI | <https://abs-data-front-door.aicolab.workers.dev/api/openapi.json> |
| The menu as one document | <https://abs-data-front-door.aicolab.workers.dev/api/catalogue.json> |
| Live browsable catalogue | <https://abs-data-front-door.aicolab.workers.dev/catalogue> |
| Static snapshot (claude.ai artifact) | <https://claude.ai/code/artifact/d0635dee-5cce-40dd-bfa2-7ab7dd03e5bd> |

## What was found

- **621,536,714 series** exist across 1,227 dataflows. ABS's metadata implies
  14,761,557,818 — a density of **4.21%**, overstated **23.8×**.
- The per-dimension metadata is **exact**: every advertised option exists, and
  nothing real is unadvertised. The entire overstatement is combinatorial.
- **81.0%** of series sit in flows whose sparsity is principled and verified in
  the keys — almost entirely hierarchical geography encoded as separate
  dimensions (`STATE` is a function of `REGION` in 664 flows). The remaining
  19% is not reducible to a single-dimension dependency.
- `detail=serieskeysonly` — the endpoint that should answer "what exists" — is
  broken (HTTP 200, malformed JSON). Eight of fifteen documented behaviours do
  not conform. See `reports/`.

`DESIGN.md` is the full record: verified API findings, every decision and why,
and the corrections made along the way.

## Layout

```
packages/schema      Drizzle schema (declared vs observed, never joined), shared CSV/period parsing
packages/crawler     structural crawl, observed probe, conformance suite, sizing
packages/catalogue   delta report, sparsity analysis, contract generator, OpenAPI emitter, artifact
packages/contract    the corrected contract: stable Zod verbs + generated tables/options (per crawl)
packages/worker      the front door: MCP door (SDK v2) + HTTP door (oRPC + Scalar) + RPC door (Cap'n Web) on one Worker
packages/sdk         @abs/sdk — typed TypeScript client over the RPC door (connect(), invalidSelectionFromError())
reports/             delta.md/json, sparsity.md/json, openapi.json, abs-report-draft.md
data/                local SQLite catalogue (~400GB), raw archive, D1 import SQL — not committed
```

## Running it

```sh
pnpm install
pnpm db:migrate                       # local SQLite at data/abs-catalogue.sqlite

pnpm crawl:structural                 # 7 bulk requests, ~1 minute
pnpm crawl:probe -- '--key-values=*'  # every dataflow by retrieval; ~24h, 20GB heap for the giants
pnpm report:delta && pnpm report:sparsity
pnpm generate:contract                # -> packages/contract/src/generated, data/d1/*.sql
pnpm --filter @abs/catalogue emit:openapi

cd packages/worker
npx wrangler d1 execute abs-catalogue --local --file=../../data/d1/00-schema.sql   # then each data file
npx wrangler dev
ABS_MCP_URL=http://localhost:8787/mcp npx tsx test/protocol.ts                     # ~50 checks, all doors
pnpm --filter @abs/sdk example                                                     # the SDK against production
ABS_URL=http://localhost:8787 npx tsx test/limits.ts                               # rate limits (spends a minute's budget)
```

Rate limits, per client address: 600 requests/min overall; 120/min for data
pulls (each is a live ABS call); 20/min for Code Mode `execute`. Over the limit,
HTTP doors answer 429 with `Retry-After`; an MCP tool call gets a tool error.

Using the SDK from TypeScript:

```ts
import { connect, invalidSelectionFromError } from "@abs/sdk";

const abs = connect(); // https://abs-data-front-door.aicolab.workers.dev/rpc
const [hits, cpi] = await Promise.all([          // one HTTP batch
  abs.searchTables({ query: "cpi rent", limit: 3 }),
  abs.describeTable("CPI"),
]);
try {
  const data = await abs.getData({ table: "CPI", select: { REGION: "Sydney", INDEX: "10001" }, lastN: 4 });
} catch (err) {
  const invalid = invalidSelectionFromError(err); // typed: reason, dimension, validOptions from observation
}
```

The probe is resumable: rerunning skips flows already recorded as complete. For
the largest census flows run with `NODE_OPTIONS=--max-old-space-size=20480`.

Gotcha: wrangler keys the *local* D1 state by `database_id`. Changing the id in
`wrangler.toml` (e.g. after `d1 create`) gives `wrangler dev` a fresh, empty
local database — re-run the local import.

## Principles

- **Observed-only.** Declared metadata steers the crawler and feeds the defect
  report; it never enters what a caller sees. Availability is empirical: observed
  options from the catalogue, exact combination checks live against ABS's
  `availableconstraint` (which agrees with the probe on every dimension of every
  flow).
- **One contract, derived doors.** Every crawl regenerates one contract; the MCP
  verbs, the HTTP routes, the OpenAPI document and the docs all read or render
  it. Nothing hardcodes the surface, so nothing drifts.
- **Only calls that return data.** A selection is verified before it is
  forwarded; an invalid one comes back with the observed valid options — as an
  MRTR `input_required` on MCP, a typed 422 on HTTP.
