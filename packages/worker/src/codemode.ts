/**
 * Code Mode: two tools that let a model write JavaScript instead of chaining
 * tool calls (DESIGN.md decision 21, mirroring Cloudflare's own API server).
 *
 *   search   — the model's JS runs against the catalogue document in an isolate
 *              with NO network: grep-with-a-brain over 1,227 tables.
 *   execute  — the model's JS runs in an isolate whose only capability is `abs`,
 *              our contract-validated client, injected as a WorkerEntrypoint
 *              stub. Network is blocked; multi-series analysis happens inside
 *              the sandbox and only the computed result returns to the model.
 *
 * Observed-only survives intact: the injected client is the same validated
 * core the fixed verbs use, so model-written code can only see and touch what
 * observation confirmed. Budgets apply from day one (decision 22): CPU,
 * subrequests, wall clock, code size, result size.
 */
import { WorkerEntrypoint } from "cloudflare:workers";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  BRANDED_CODELISTS,
  LITERAL_CODELISTS,
  MANIFEST,
  TABLES,
  describeTableInputSchema,
  getDataInputSchema,
  searchOptionsInputSchema,
  searchTablesInputSchema,
} from "@abs/contract";
import * as generated from "@abs/contract/generated";
import type { Env } from "./env.ts";
import { Catalogue } from "./catalogue.ts";
import { resolveSelection } from "./resolve.ts";
import { fetchData } from "./abs-data.ts";

const BUDGET = {
  cpuMs: 10_000,
  subRequests: 50,
  wallMs: 25_000,
  maxCodeChars: 20_000,
  maxResultChars: 200_000,
} as const;

/**
 * The capability handed to the sandbox. Every method validates its input with
 * the contract's Zod schema and answers exactly as the fixed verbs do; an
 * invalid selection throws an Error whose message is the InvalidSelection JSON,
 * so model code can catch and correct.
 */
export class AbsToolsEntrypoint extends WorkerEntrypoint<Env> {
  private get catalogue(): Catalogue {
    return new Catalogue(this.env.CATALOGUE);
  }
  async searchTables(input: unknown) {
    return this.catalogue.searchTables(searchTablesInputSchema.parse(input ?? {}));
  }
  async describeTable(table: unknown) {
    const { table: id } = describeTableInputSchema.parse(typeof table === "string" ? { table } : table);
    const d = await this.catalogue.describeTable(id);
    if (!d) throw new Error(JSON.stringify({ reason: "unknown_table", table: id, message: `No table "${id}" serves data.` }));
    return d;
  }
  async searchOptions(input: unknown) {
    const i = searchOptionsInputSchema.parse(input);
    return this.catalogue.searchOptions(i.table, i.dimension, i.query, i.limit);
  }
  async getData(input: unknown) {
    const i = getDataInputSchema.parse(input);
    const resolved = await resolveSelection(this.catalogue, i.table, i.select);
    if (!resolved.ok) throw new Error(JSON.stringify(resolved.error));
    return fetchData(resolved.value, i);
  }
}

/** Strip markdown fences a model may wrap its code in. */
function normaliseCode(code: string): string {
  return code.replace(/^\s*```(?:js|javascript|ts|typescript)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
}

/** The sandbox module: captures console, runs the code, returns JSON. */
function sandboxModule(userCode: string, preamble: string): string {
  return `${preamble}
const __logs = [];
const console = {
  log: (...a) => __logs.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")),
  error: (...a) => __logs.push("[error] " + a.map(String).join(" ")),
  warn: (...a) => __logs.push("[warn] " + a.map(String).join(" ")),
  info: (...a) => __logs.push(a.map(String).join(" ")),
};
export default {
  async fetch(request, env) {
    const abs = env.abs;
    try {
      const result = await (async () => {
${userCode}
      })();
      return Response.json({ ok: true, result, logs: __logs });
    } catch (e) {
      return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e), stack: e instanceof Error ? e.stack : undefined, logs: __logs });
    }
  },
};`;
}

function catalogueDocument(): unknown {
  const literal: Record<string, unknown> = {};
  for (const id of LITERAL_CODELISTS) literal[id] = (generated as Record<string, unknown>)[id.replace(/[^A-Za-z0-9_]/g, "_")];
  return {
    provenance: { runId: MANIFEST.runId, observedAt: MANIFEST.observedAt },
    corpus: MANIFEST.corpus,
    tables: TABLES,
    options: { literal, branded: BRANDED_CODELISTS },
  };
}

async function runInSandbox(
  loader: WorkerLoader,
  code: string,
  opts: { env?: Record<string, unknown>; modules?: Record<string, WorkerLoaderModule | string>; preamble?: string },
): Promise<{ ok: boolean; result?: unknown; error?: string | undefined; logs: string[]; truncated?: boolean | undefined }> {
  const cleaned = normaliseCode(code);
  if (cleaned.length > BUDGET.maxCodeChars) {
    return { ok: false, error: `code exceeds ${BUDGET.maxCodeChars} characters`, logs: [] };
  }

  const worker = loader.load({
    compatibilityDate: "2026-09-01",
    mainModule: "main.js",
    modules: { "main.js": sandboxModule(cleaned, opts.preamble ?? ""), ...(opts.modules ?? {}) },
    env: opts.env ?? {},
    // No ambient network: the code reaches the world only through what env gives it.
    globalOutbound: null,
    limits: { cpuMs: BUDGET.cpuMs, subRequests: BUDGET.subRequests },
  });

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`execution exceeded ${BUDGET.wallMs / 1000}s wall clock`)), BUDGET.wallMs),
  );

  try {
    const response = await Promise.race([worker.getEntrypoint().fetch(new Request("https://sandbox/")), timeout]);
    const text = await response.text();
    const parsed = JSON.parse(text) as { ok: boolean; result?: unknown; error?: string; logs?: string[] };
    let truncated = false;
    let result = parsed.result;
    if (result !== undefined) {
      const serialised = JSON.stringify(result);
      if (serialised.length > BUDGET.maxResultChars) {
        result = `${serialised.slice(0, BUDGET.maxResultChars)}… [truncated: result was ${serialised.length} chars; return less]`;
        truncated = true;
      }
    }
    return { ok: parsed.ok, result, error: parsed.error, logs: parsed.logs ?? [], truncated };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), logs: [] };
  }
}

const sandboxOutputSchema = z.object({
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z.string().optional(),
  logs: z.array(z.string()),
  truncated: z.boolean().optional(),
});

const ABS_INTERFACE = `// The \`abs\` object available in execute():
interface Abs {
  searchTables(input: { query?: string; geography?: string; frequency?: "A"|"S"|"Q"|"M"|"W"|"D"; limit?: number }):
    Promise<{ results: TableSummary[]; total: number }>;
  describeTable(table: string):
    Promise<{ table: TableSummary; dimensions: { id: string; position: number; optionCount: number; options?: { code: string; label: string|null }[] }[]; keyFormat: string }>;
  searchOptions(input: { table: string; dimension: string; query: string; limit?: number }):
    Promise<{ options: { code: string; label: string|null; parent?: string|null }[]; total: number }>;
  getData(input: { table: string; select?: Record<string, string|string[]>; startPeriod?: string; endPeriod?: string; lastN?: number; firstN?: number; maxRows?: number }):
    Promise<{ key: string; rows: { series: string; period: string; value: number|null; unit?: string|null }[]; rowsReturned: number; truncated: boolean; seriesMatched: number; fullDataUrl: string }>;
}
interface TableSummary { id: string; name: string|null; seriesCount: number; frequencies: string[]; coverage: { from: string|null; to: string|null }; dimensions: string[]; family: string|null; geography: string|null; matchedOptions?: { dimension: string; code: string; label: string|null }[] }
// getData throws an Error whose message is JSON: { reason, dimension, message, validOptions?, alternatives? } — catch it, read validOptions, correct and retry.`;

const CATALOGUE_INTERFACE = `// The \`catalogue\` object available in search():
interface Catalogue {
  provenance: { runId: string; observedAt: string };
  corpus: { tables: number; seriesConfirmed: number; seriesImpliedByMetadata: number; density: number };
  tables: Record<string, {           // keyed by table id, e.g. catalogue.tables.CPI
    id: string; name: string|null; description: string|null; seriesCount: number;
    frequencies: string[]; coverage: { from: string|null; to: string|null }; density: number|null;
    family: string|null; geography: string|null; topics: string[];
    dimensions: { id: string; position: number; codelist: string|null; optionCount: number; literal: boolean }[];
  }>;
  options: {
    literal: Record<string, Record<string, string|null>>;  // codelist id -> { code: label } for small codelists (<=64 options)
    branded: Record<string, number>;                        // large codelists -> option count (use abs.searchOptions in execute)
  };
}`;

export function registerCodeMode(server: McpServer, env: Env, ctx: ExecutionContext): void {
  const loader = env.LOADER;

  server.registerTool(
    "search",
    {
      title: "Search the catalogue by writing code",
      description:
        "Run JavaScript against the whole catalogue document — every table, its dimensions, coverage and small-dimension " +
        "options — in an isolated sandbox with no network. Use it to answer questions the fixed verbs make awkward: " +
        "'which tables have both an SA2 geography and a quarterly frequency?', 'list every dimension name and how often " +
        "it appears', 'find codelists whose labels mention rent'. Your code runs inside an async function with `catalogue` " +
        "in scope; `return` a JSON-serialisable value; console.log output is captured.\n\n" +
        CATALOGUE_INTERFACE,
      inputSchema: z.object({ code: z.string().min(1).max(BUDGET.maxCodeChars).describe("JavaScript. `catalogue` is in scope. Must return a value.") }),
      outputSchema: sandboxOutputSchema,
    },
    async ({ code }) => {
      if (!loader) return unavailable();
      const out = await runInSandbox(loader, code, {
        preamble: `import catalogue from "./catalogue.json";`,
        modules: { "catalogue.json": { json: catalogueDocument() } },
      });
      return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }], structuredContent: out, isError: !out.ok };
    },
  );

  server.registerTool(
    "execute",
    {
      title: "Fetch and analyse data by writing code",
      description:
        "Run JavaScript in an isolated sandbox whose only capability is `abs`, a client with the same four verbs as this " +
        "server (searchTables, describeTable, searchOptions, getData) and the same guarantees: every selection is verified " +
        "against ABS before fetching. Use it for multi-series or multi-table analysis — fetch several series, compute " +
        "growth rates, rank capitals, join tables — and `return` only the computed result, so large payloads never reach " +
        "the conversation. No network beyond `abs`. Budgets: 10s CPU, 50 calls, 25s wall clock, 200KB result. Your code " +
        "runs inside an async function; use `await`; console.log is captured.\n\n" +
        ABS_INTERFACE,
      inputSchema: z.object({ code: z.string().min(1).max(BUDGET.maxCodeChars).describe("JavaScript. `abs` is in scope. Must return a value.") }),
      outputSchema: sandboxOutputSchema,
    },
    async ({ code }) => {
      if (!loader) return unavailable();
      // ctx.exports (named self-bindings) postdates this workers-types release.
      const exportsAny = (ctx as unknown as { exports?: Record<string, (opts: { props?: unknown }) => unknown> }).exports;
      const abs = exportsAny?.["AbsToolsEntrypoint"]?.({});
      if (!abs) return unavailable("ctx.exports.AbsToolsEntrypoint is not available");
      const out = await runInSandbox(loader, code, { env: { abs } });
      return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }], structuredContent: out, isError: !out.ok };
    },
  );
}

function unavailable(detail = "the Worker Loader binding is not enabled on this deployment") {
  return {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: `Code Mode unavailable: ${detail}. Use the fixed verbs (search_tables, describe_table, search_options, get_data).` }) }],
  };
}
