/**
 * ABS Data API front door — NOT YET IMPLEMENTED.
 *
 * Per DESIGN.md decision 21 the MCP tool surface is deferred until cartography
 * is complete, and then designed from what the observed data actually looks
 * like. Cartography is not complete: the observed probe has covered part of the
 * corpus, so there is nothing legitimate to serve yet.
 *
 * An earlier version of this file served dimension order out of
 * `declared_dimension`. That was wrong and has been removed. Declared metadata
 * is unverified by definition — ABS's content constraints overstate CPI's real
 * series count by 5.7x — and the governing principle is that declared data
 * never enters the canonical view. A front door that offered declared dimension
 * values to callers would hand them combinations that do not exist, which is
 * the precise failure this project exists to correct.
 *
 * When the surface is designed, it answers from:
 *   - `observed_flow` / `series` / `observed_dimension_code` — empirically
 *     confirmed, canonical (decision 7);
 *   - `availableconstraint` at call time as a belt-and-braces check (2.8);
 *   - `codelist` / `code` for labels and hierarchy only, which are structural
 *     descriptions of what a code *means*, never claims that it is available.
 *
 * Flows confirmed to serve no data are excluded entirely (decision 5).
 */

export interface Env {
  CATALOGUE: D1Database;
  RAW_ARCHIVE: R2Bucket;
}

const NOT_READY = {
  service: "abs-data-front-door",
  status: "not_implemented",
  reason:
    "The MCP tool surface is deferred until the observed catalogue is complete " +
    "(DESIGN.md decision 21). Nothing is served from declared ABS metadata.",
} as const;

export default {
  async fetch(): Promise<Response> {
    return new Response(JSON.stringify(NOT_READY, null, 2), {
      status: 501,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  },
} satisfies ExportedHandler<Env>;
