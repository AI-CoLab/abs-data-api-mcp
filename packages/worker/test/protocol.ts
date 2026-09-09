/**
 * Protocol tests for the MCP door (decision 31), run against a live server:
 *
 *   ABS_MCP_URL=http://localhost:8787/mcp npx tsx packages/worker/test/protocol.ts
 *
 * Exercises the 2026-07-28 surface as a client would: server/discover,
 * tools/list (with cache fields), every tool via tools/call, the MRTR
 * input_required path for an invalid option and for an empty combination, and
 * the HTTP door's typed 422. Fails loudly on the first broken expectation.
 */

const MCP_URL = process.env["ABS_MCP_URL"] ?? "http://localhost:8787/mcp";
const API_URL = MCP_URL.replace(/\/mcp$/, "/api");
const PROTOCOL_VERSION = "2026-07-28";

let nextId = 1;
const failures: string[] = [];

function check(condition: unknown, message: string): void {
  if (condition) {
    process.stdout.write(`  ok   ${message}\n`);
  } else {
    failures.push(message);
    process.stdout.write(`  FAIL ${message}\n`);
  }
}

async function rpc(method: string, params: Record<string, unknown> = {}): Promise<any> {
  const body = {
    jsonrpc: "2.0",
    id: nextId++,
    method,
    params: {
      ...params,
      _meta: {
        ...(params["_meta"] as Record<string, unknown> | undefined),
        "io.modelcontextprotocol/protocolVersion": PROTOCOL_VERSION,
        // Declare form elicitation so the server may answer with input_required
        // (MRTR). A client without it must get a typed error instead — tested below.
        "io.modelcontextprotocol/clientCapabilities": (params["_noElicitation"] ? {} : { elicitation: { form: {} } }),
        "io.modelcontextprotocol/clientInfo": { name: "abs-protocol-test", version: "0" },
      },
    },
  };
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "Mcp-Method": method,
      ...(typeof params["name"] === "string" ? { "Mcp-Name": params["name"] as string } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  // Streamable HTTP may answer as SSE; take the last data frame.
  const json = text.startsWith("event:") || text.startsWith("data:")
    ? JSON.parse(text.split("\n").filter((l) => l.startsWith("data:")).pop()!.slice(5))
    : JSON.parse(text);
  if (json.error) throw new Error(`${method}: ${JSON.stringify(json.error)}`);
  return json.result;
}

async function callTool(name: string, args: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  // `_noElicitation` is a harness flag, not a tool argument: hoist it to the
  // request level so the client capabilities are what change.
  const { _noElicitation, ...toolArgs } = args;
  return rpc("tools/call", { name, arguments: toolArgs, ...extra, ...(_noElicitation ? { _noElicitation: true } : {}) });
}

process.stdout.write(`MCP door at ${MCP_URL}\n\n`);

// ------------------------------------------------------------ discover/list
process.stdout.write("server/discover\n");
const discover = await rpc("server/discover");
check(Array.isArray(discover.protocolVersions ?? discover.supportedProtocolVersions ?? []) || discover.serverInfo, "returns discovery payload");
check(JSON.stringify(discover).includes("2026-07-28"), "advertises protocol 2026-07-28");

process.stdout.write("tools/list\n");
const list = await rpc("tools/list");
const names = (list.tools as Array<{ name: string }>).map((t) => t.name).sort();
check(JSON.stringify(names) === JSON.stringify(["describe_table", "get_data", "search_options", "search_tables"]), `exactly the four fixed verbs (${names.join(", ")})`);
check(typeof list.ttlMs === "number" && list.ttlMs > 0, `cacheable: ttlMs=${list.ttlMs}`);
check(list.cacheScope === "public", `cacheable: cacheScope=${list.cacheScope}`);
check(list.tools.every((t: any) => t.inputSchema && t.outputSchema), "every tool has input and output schemas");

// -------------------------------------------------------------- search
process.stdout.write("search_tables\n");
const search = await callTool("search_tables", { query: "consumer price index", limit: 5 });
const searchOut = search.structuredContent;
check(searchOut.results.length > 0, `finds tables (${searchOut.total} total)`);
check(searchOut.results.some((r: any) => r.id === "CPI"), "CPI ranks in the top results");
check(typeof searchOut.provenance?.runId === "string", "carries provenance");
check(searchOut.results.every((r: any) => r.seriesCount > 0), "every result serves data");

process.stdout.write("search_tables (option labels)\n");
// Census tables titled "Rent (weekly) by …" legitimately outrank CPI, whose
// "Rents" is one option among 161 — so assert presence on a page, not the top.
const rent = (await callTool("search_tables", { query: "rent", limit: 40 })).structuredContent;
const cpiHit = rent.results.find((r: any) => r.id === "CPI");
check(cpiHit !== undefined, `search 'rent' reaches CPI through its INDEX options (${rent.total} results)`);
check(Array.isArray(cpiHit?.matchedOptions) && cpiHit.matchedOptions.some((m: any) => m.dimension === "INDEX" && /rent/i.test(m.label ?? "")), `matchedOptions names the option (${JSON.stringify(cpiHit?.matchedOptions?.slice(0, 2))})`);
const familyHit = rent.results.find((r: any) => r.family);
check(!familyHit || Array.isArray(familyHit.familyGeographies), "census families collapse with familyGeographies");
const familyIds = rent.results.filter((r: any) => r.family).map((r: any) => r.family);
check(new Set(familyIds).size === familyIds.length, "no family appears twice in one result page");

// ------------------------------------------------------------ describe
process.stdout.write("describe_table\n");
const describe = (await callTool("describe_table", { table: "CPI" })).structuredContent;
check(describe.keyFormat === "MEASURE.INDEX.TSEST.REGION.FREQ", `key format ${describe.keyFormat}`);
const region = describe.dimensions.find((d: any) => d.id === "REGION");
check(region?.options?.length === 9, `REGION lists its 9 observed options inline (${region?.options?.length})`);
const index = describe.dimensions.find((d: any) => d.id === "INDEX");
check(index?.optionCount === 161 && index?.options === undefined, "INDEX (161) is not inlined");

process.stdout.write("describe_table unknown\n");
const unknown = await callTool("describe_table", { table: "NOT_A_TABLE" });
check(unknown.isError === true && unknown.structuredContent?.reason === "unknown_table", "unknown table is a typed error");

// ------------------------------------------------------- search options
process.stdout.write("search_options\n");
const opts = (await callTool("search_options", { table: "CPI", dimension: "INDEX", query: "rent", limit: 10 })).structuredContent;
check(opts.options.length > 0 && opts.options.every((o: any) => typeof o.code === "string"), `finds options by label (${opts.total} matching)`);

// ---------------------------------------------------------------- data
process.stdout.write("get_data (valid, labels in)\n");
const data = (await callTool("get_data", {
  table: "CPI",
  select: { MEASURE: "1", INDEX: "All groups CPI", TSEST: "10", REGION: "50", FREQ: "Q" },
  lastN: 4,
})).structuredContent;
check(data.key === "1.10001.10.50.Q", `label resolved to key ${data.key}`);
check(data.rows.length === 4 && data.rows.every((r: any) => typeof r.value === "number"), "returns 4 numeric observations");
check(data.fullDataUrl.startsWith("https://data.api.abs.gov.au/rest/data/ABS,CPI/1.10001.10.50.Q"), "full-pull URL is the working ABS URL");
check(data.truncated === false, "not truncated");

process.stdout.write("get_data (cap)\n");
const capped = (await callTool("get_data", { table: "CPI", select: { REGION: "50", FREQ: "Q" }, lastN: 4, maxRows: 20 })).structuredContent;
check(capped.rowsReturned === 20 && capped.truncated === true, `caps at maxRows and says so (${capped.rowsReturned}, truncated=${capped.truncated})`);

process.stdout.write("get_data (unknown option -> input_required)\n");
const bad = await callTool("get_data", { table: "CPI", select: { REGION: "Atlantis" } });
check(bad.resultType === "input_required", `MRTR input_required (${bad.resultType})`);
const req = bad.inputRequests?.REGION;
check(req && /Atlantis/.test(req.message ?? JSON.stringify(req)), "asks for REGION with the observed valid options");

process.stdout.write("get_data (impossible combination -> input_required)\n");
const impossible = await callTool("get_data", { table: "CPI", select: { MEASURE: "1", INDEX: "10001", TSEST: "20", REGION: "1", FREQ: "M" } });
check(impossible.resultType === "input_required", `MRTR input_required for empty combination (${impossible.resultType})`);

process.stdout.write("get_data (client without elicitation -> typed error, not protocol error)\n");
const noCap = await callTool("get_data", { table: "CPI", select: { REGION: "Atlantis" }, _noElicitation: true } as Record<string, unknown>);
check(noCap.isError === true && noCap.structuredContent?.reason === "unknown_option", `degrades to typed error (${noCap.structuredContent?.reason})`);
check(Array.isArray(noCap.structuredContent?.validOptions) && noCap.structuredContent.validOptions.length > 0, "typed error still carries the observed valid options");

process.stdout.write("get_data (MRTR retry with correction)\n");
const retried = (await callTool(
  "get_data",
  { table: "CPI", select: { REGION: "Atlantis" }, lastN: 1, maxRows: 5 },
  { inputResponses: { REGION: { action: "accept", content: { value: "50" } } } },
)).structuredContent;
check(retried?.key?.endsWith(".50.") || retried?.key?.includes(".50."), `retry with inputResponses resolves (${retried?.key})`);

// ------------------------------------------------------------ HTTP door
process.stdout.write("HTTP door\n");
const tables = await fetch(`${API_URL}/tables?query=labour%20force&limit=3`);
check(tables.ok && tables.headers.get("cache-control")?.includes("public"), `GET /api/tables ${tables.status}, ${tables.headers.get("cache-control")}`);
const spec = await fetch(`${API_URL}/openapi.json`);
const specJson: any = spec.ok ? await spec.json() : {};
check(spec.ok && specJson.paths?.["/data"] && specJson.paths?.["/tables/{table}"], "OpenAPI document lists the verbs");
const invalid = await fetch(`${API_URL}/data`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ table: "CPI", select: { REGION: "Atlantis" } }),
});
const invalidJson: any = await invalid.json();
check(invalid.status === 422 && invalidJson.data?.reason === "unknown_option", `POST /api/data invalid -> ${invalid.status} ${invalidJson.data?.reason}`);
const docs = await fetch(`${API_URL}/docs`);
check(docs.ok && (docs.headers.get("content-type") ?? "").includes("html"), "Scalar docs render");

// ------------------------------------------------------------------ done
process.stdout.write(`\n${failures.length === 0 ? "ALL PASSED" : `${failures.length} FAILED`}\n`);
for (const f of failures) process.stdout.write(`  - ${f}\n`);
process.exit(failures.length === 0 ? 0 : 1);
