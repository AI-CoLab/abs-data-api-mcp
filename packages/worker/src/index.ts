/**
 * ABS Data API front door — one Worker, several doors, one observed contract.
 *
 *   POST /mcp                 MCP 2026-07-28 (stateless), four fixed verbs
 *   GET  /api/...             HTTP door (oRPC): /api/tables, /api/tables/{id}, ...
 *   GET  /api/docs            Scalar reference
 *   GET  /api/openapi.json    the corrected OpenAPI document
 *   GET  /                    landing: provenance and links
 *
 * Every door answers from the same observed catalogue; none hardcodes the
 * surface. Availability is always empirical: observed options from D1, exact
 * combination checks live against ABS (decision 24). Cache-first (decision 22).
 */
import { createMcpHandler } from "@modelcontextprotocol/server";
import { BRANDED_CODELISTS, LITERAL_CODELISTS, MANIFEST, TABLES } from "@abs/contract";
import * as options from "@abs/contract/generated";
import type { Env } from "./env.ts";
import { Catalogue } from "./catalogue.ts";
import cataloguePage from "../../../artifact/abs-cartography.html";
import { buildMcpServer } from "./mcp.ts";
import { httpHandler } from "./http.ts";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;

function json(body: unknown, status = 200, cacheSeconds = 300): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...JSON_HEADERS, "cache-control": `public, max-age=${cacheSeconds}` },
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/mcp") {
      // The SDK's own Web-standard handler (it ships a workerd provider): one
      // McpServer per request, no session.
      const handler = createMcpHandler(() => buildMcpServer(env.CATALOGUE));
      const response = await handler.fetch(request);
      ctx.waitUntil(handler.close());
      return response;
    }

    // The menu as one document — the equivalent of the OpenAPI spec in
    // Cloudflare's two-tool Code Mode: every table, its key structure and
    // coverage, and every small-dimension option with labels (~2MB). Humans grep
    // it; the planned Code Mode `search` tool will read it in a no-network
    // isolate. Large dimensions list their codelist and size; their options are
    // reached through search_options. Cached for a day: it changes per crawl.
    // Must precede the generic /api branch, which would otherwise claim it.
    if (url.pathname === "/api/catalogue.json") {
      const literal: Record<string, unknown> = {};
      for (const id of LITERAL_CODELISTS) {
        literal[id] = (options as Record<string, unknown>)[id.replace(/[^A-Za-z0-9_]/g, "_")];
      }
      return json(
        {
          provenance: { runId: MANIFEST.runId, observedAt: MANIFEST.observedAt },
          corpus: MANIFEST.corpus,
          verbs: `${url.origin}/api/openapi.json`,
          tables: TABLES,
          options: { literal, branded: BRANDED_CODELISTS },
        },
        200,
        86_400,
      );
    }

    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      const { matched, response } = await httpHandler.handle(request, {
        prefix: "/api",
        context: { catalogue: new Catalogue(env.CATALOGUE) },
      });
      if (matched && response) {
        if (request.method === "GET" && response.ok && !response.headers.has("cache-control")) {
          const cached = new Response(response.body, response);
          cached.headers.set("cache-control", "public, max-age=300");
          return cached;
        }
        return response;
      }
      return json({ error: "not found" }, 404, 0);
    }

    if (url.pathname === "/healthz") return json({ ok: true, runId: MANIFEST.runId }, 200, 0);

    // The browsable catalogue, live on this origin (it detects it can call /api).
    if (url.pathname === "/catalogue") {
      return new Response(cataloguePage, {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600" },
      });
    }

    if (url.pathname === "/") {
      return json({
        service: "abs-data-front-door",
        description:
          "The ABS Data API as it actually behaves. Every table and option offered is confirmed to serve data; " +
          "every selection is verified live before fetching.",
        provenance: { runId: MANIFEST.runId, observedAt: MANIFEST.observedAt },
        corpus: MANIFEST.corpus,
        doors: {
          mcp: `${url.origin}/mcp`,
          api: `${url.origin}/api/tables`,
          docs: `${url.origin}/api/docs`,
          openapi: `${url.origin}/api/openapi.json`,
          catalogue: `${url.origin}/api/catalogue.json`,
          browse: `${url.origin}/catalogue`,
        },
      });
    }

    return json({ error: "not found" }, 404, 0);
  },
} satisfies ExportedHandler<Env>;
