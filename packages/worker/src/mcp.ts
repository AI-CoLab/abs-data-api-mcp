/**
 * The MCP door: four fixed verbs over the observed catalogue.
 *
 * Nothing here changes when ABS changes — the tools query the catalogue at
 * request time, so alignment with the other doors is automatic (decision 21).
 * Built on MCP 2026-07-28 via SDK v2: stateless, one server per request.
 *
 * Invalid selections use the Multi Round-Trip Request pattern: instead of an
 * error, `get_data` returns `input_required` carrying the observed valid
 * options for the offending dimension; the client answers and retries the same
 * call. That turns "wrong option" into a one-step correction.
 */
import {
  CLIENT_CAPABILITIES_META_KEY,
  McpServer,
  acceptedContent,
  inputRequired,
} from "@modelcontextprotocol/server";
import {
  MANIFEST,
  describeTableInputSchema,
  describeTableOutputSchema,
  getDataInputSchema,
  getDataOutputSchema,
  searchOptionsInputSchema,
  searchOptionsOutputSchema,
  searchTablesInputSchema,
  searchTablesOutputSchema,
  type InvalidSelection,
  type Selection,
} from "@abs/contract";
import { Catalogue } from "./catalogue.ts";
import { resolveSelection } from "./resolve.ts";
import { fetchData } from "./abs-data.ts";

const NAME = "abs-data";
const VERSION = MANIFEST.runId;

function jsonResult<T>(value: T) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: value as Record<string, unknown>,
  };
}

function errorResult(error: InvalidSelection) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify(error, null, 2) }],
    structuredContent: error as unknown as Record<string, unknown>,
  };
}

export function buildMcpServer(d1: D1Database): McpServer {
  const catalogue = new Catalogue(d1);
  // Cache hints for the 2026-07-28 cacheable results: the surface changes only
  // per crawl, so shared caches may hold tools/list for a day (decision 22).
  const server = new McpServer({ name: NAME, version: VERSION }, { cacheHints: MCP_CACHE_HINTS });

  server.registerTool(
    "search_tables",
    {
      title: "Search ABS tables",
      description:
        "Find ABS statistical tables (dataflows) by topic words, geography level or frequency. " +
        "Every result is confirmed to serve data — nothing here comes from documentation alone. " +
        "Start here, then describe_table to see how to select within one.",
      inputSchema: searchTablesInputSchema,
      outputSchema: searchTablesOutputSchema,
    },
    async (input) => jsonResult(catalogue.searchTables(input)),
  );

  server.registerTool(
    "describe_table",
    {
      title: "Describe a table",
      description:
        "A table's dimensions in key order, its coverage dates, and its observed options. Dimensions with up to " +
        "64 options list them inline with labels; larger ones (geography, occupations) say how many and are " +
        "searchable with search_options.",
      inputSchema: describeTableInputSchema,
      outputSchema: describeTableOutputSchema,
    },
    async (input) => {
      const described = await catalogue.describeTable(input.table);
      if (!described) {
        return errorResult({
          table: input.table,
          dimension: null,
          given: null,
          reason: "unknown_table",
          message: `No table "${input.table}" serves data. Use search_tables.`,
        });
      }
      return jsonResult(described);
    },
  );

  server.registerTool(
    "search_options",
    {
      title: "Search a dimension's options",
      description:
        "Find option codes by label text within one dimension of one table — e.g. a suburb name in a geography " +
        "dimension. Returns codes to use in get_data's select.",
      inputSchema: searchOptionsInputSchema,
      outputSchema: searchOptionsOutputSchema,
    },
    async (input) => jsonResult(await catalogue.searchOptions(input.table, input.dimension, input.query, input.limit)),
  );

  server.registerTool(
    "get_data",
    {
      title: "Get data",
      description:
        "Fetch observations. `select` maps dimension ids to option codes or labels (several allowed); omitted " +
        "dimensions match everything. The selection is verified live against ABS before fetching, so a call " +
        "that succeeds always returns real data. Returns up to maxRows observations (default 500, most recent " +
        "12 periods per series unless a period range is given), a summary, and the URL for the complete pull. " +
        "If an option or combination does not exist you are asked to choose from the valid ones.",
      inputSchema: getDataInputSchema,
      outputSchema: getDataOutputSchema,
    },
    async (input, ctx) => {
      // Fold in any correction the client supplied on a retry.
      const select: Selection = { ...input.select };
      for (const dimension of Object.keys(input.select)) {
        const answer = acceptedContent<{ value: string }>(ctx.mcpReq.inputResponses, dimension);
        if (answer?.value) select[dimension] = answer.value;
      }
      const resolved = await resolveSelection(catalogue, input.table, select);
      if (resolved.ok) return jsonResult(await fetchData(resolved.value, { ...input, select }));

      const err = resolved.error;
      // Correctable in one round trip: ask for a valid option for the dimension —
      // but only if the client can take an input request. A client without form
      // elicitation gets the same facts as a typed error instead of a protocol
      // error (the SDK rejects input_required for such clients).
      // The SDK lifts the envelope keys out of _meta into mcpReq.envelope, keyed
      // by their raw meta names — the same place its own capability check reads.
      type Caps = { elicitation?: { form?: unknown } } | undefined;
      const envelope = ctx.mcpReq.envelope as Record<string, unknown> | undefined;
      const caps = envelope?.[CLIENT_CAPABILITIES_META_KEY] as Caps;
      const canElicit = caps?.elicitation?.form !== undefined;
      const correctable =
        err.reason === "unknown_option" ||
        err.reason === "ambiguous_option" ||
        err.reason === "no_data_for_combination";
      if (canElicit && err.dimension && correctable) {
        const codes = (err.validOptions ?? []).map((o) => o.code);
        const labels = (err.validOptions ?? []).map((o) => (o.label ? `${o.code} = ${o.label}` : o.code));
        return inputRequired({
          inputRequests: {
            [err.dimension]: inputRequired.elicit({
              message:
                `${err.message}\n\nChoose a value for ${err.dimension}` +
                (labels.length ? `:\n${labels.join("\n")}` : "."),
              requestedSchema: {
                type: "object",
                properties: {
                  value: {
                    type: "string",
                    title: err.dimension,
                    description: `Option code for ${err.dimension} in ${err.table}`,
                    ...(codes.length > 0 ? { enum: codes } : {}),
                  },
                },
                required: ["value"],
              },
            }),
          },
        });
      }
      return errorResult(err);
    },
  );

  return server;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MCP_CACHE_HINTS = {
  "tools/list": { ttlMs: DAY_MS, cacheScope: "public" as const },
  "server/discover": { ttlMs: DAY_MS, cacheScope: "public" as const },
};
