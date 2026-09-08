/**
 * ABS Data API front door.
 *
 * Deliberately minimal for now: the MCP tool surface is designed after
 * cartography completes (DESIGN.md decision 21), so this exposes only the
 * primitives that the surface will be built from, and proves the architecture.
 *
 * Catalogue metadata comes from D1; existence comes live from ABS
 * `availableconstraint`, which is exact. Nothing here mirrors observations.
 */
import { checkAvailability, buildDataKey } from "./availability.ts";

export interface Env {
  CATALOGUE: D1Database;
  RAW_ARCHIVE: R2Bucket;
}

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  // Cache-first is the chosen abuse posture (decision 22).
  "cache-control": "public, max-age=300",
} as const;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), { status, headers: JSON_HEADERS });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const cache = caches.default;

    try {
      switch (url.pathname) {
        case "/":
          return json({
            service: "abs-data-front-door",
            note:
              "Catalogue of empirically-confirmed ABS dataflows. Availability is verified live " +
              "against ABS availableconstraint; only confirmed series are served.",
            endpoints: ["/flows", "/flows/:id", "/flows/:id/availability?KEY=VALUE"],
          });

        case "/flows": {
          const q = url.searchParams.get("q");
          const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);

          // mcp_eligible excludes confirmed-empty flows (decision 5).
          const stmt = q
            ? env.CATALOGUE.prepare(
                `SELECT id, name, series_count, frequencies, earliest_period, latest_period
                 FROM observed_flow
                 WHERE mcp_eligible = 1 AND (id LIKE ?1 OR name LIKE ?1)
                 ORDER BY series_count DESC LIMIT ?2`,
              ).bind(`%${q}%`, limit)
            : env.CATALOGUE.prepare(
                `SELECT id, name, series_count, frequencies, earliest_period, latest_period
                 FROM observed_flow WHERE mcp_eligible = 1
                 ORDER BY series_count DESC LIMIT ?1`,
              ).bind(limit);

          const { results } = await stmt.all();
          return json({ count: results.length, flows: results });
        }

        default: {
          const flowMatch = /^\/flows\/([^/]+)(\/availability)?$/.exec(url.pathname);
          if (!flowMatch) return json({ error: "not found" }, 404);

          const flowId = decodeURIComponent(flowMatch[1] ?? "");
          const wantsAvailability = flowMatch[2] !== undefined;

          const dims = await env.CATALOGUE.prepare(
            `SELECT dimension_id, position FROM declared_dimension
             WHERE flow_id = ?1 AND dimension_type <> 'TimeDimension'
             ORDER BY position`,
          )
            .bind(flowId)
            .all();
          const dimensionOrder = dims.results.map((r) => String(r["dimension_id"]));

          if (!wantsAvailability) {
            const flow = await env.CATALOGUE.prepare(
              `SELECT id, name, series_count, frequencies, earliest_period, latest_period,
                      density_ratio
               FROM observed_flow WHERE id = ?1 AND mcp_eligible = 1`,
            )
              .bind(flowId)
              .first();

            if (!flow) return json({ error: `no confirmed data for flow ${flowId}` }, 404);
            return json({ flow, dimensionOrder });
          }

          const values: Record<string, string | undefined> = {};
          for (const d of dimensionOrder) {
            const v = url.searchParams.get(d);
            if (v !== null) values[d] = v;
          }

          const dataKey = buildDataKey(dimensionOrder, values);
          const availability = await checkAvailability(flowId, dataKey, cache);

          return json({
            flowId,
            dataKey,
            dimensionOrder,
            ...availability,
            dataUrl: `https://data.api.abs.gov.au/rest/data/ABS,${flowId}/${dataKey}?format=csv`,
          });
        }
      }
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
