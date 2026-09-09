/**
 * Rate-limit check, run separately from the protocol suite because it spends
 * the caller's own budget for a minute:
 *
 *   ABS_URL=http://localhost:8787 npx tsx packages/worker/test/limits.ts
 *
 * Drives the UPSTREAM tier (120/min) with cheap requests — GET /api/data for a
 * table that does not exist short-circuits in D1 without touching ABS — and
 * expects the 121st to be a 429 with Retry-After; then that an MCP get_data
 * call answers as a tool error rather than a transport failure; then that
 * catalogue reads are still served (READS is a separate tier).
 */
const BASE = process.env["ABS_URL"] ?? "http://localhost:8787";
const LIMIT = 120;

let first429 = -1;
for (let i = 1; i <= LIMIT + 5 && first429 === -1; i += 1) {
  const res = await fetch(`${BASE}/api/data?table=NOPE`);
  if (res.status === 429) {
    first429 = i;
    const body: any = await res.json();
    process.stdout.write(`  ${res.status} after ${i} requests; retry-after ${res.headers.get("retry-after")}s; tier ${body.tier}\n`);
  }
}
const ok = first429 > 0 && first429 <= LIMIT + 1;
process.stdout.write(`  ${ok ? "ok  " : "FAIL"} UPSTREAM tier trips at request ${first429} (limit ${LIMIT})\n`);

const mcp = await fetch(`${BASE}/mcp`, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "Mcp-Method": "tools/call", "Mcp-Name": "get_data" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "get_data", arguments: { table: "CPI" } } }),
});
const mcpJson: any = await mcp.json();
const mcpOk = mcp.status === 200 && mcpJson.id === 7 && mcpJson.result?.isError === true && mcpJson.result?.structuredContent?.reason === "rate_limited";
process.stdout.write(`  ${mcpOk ? "ok  " : "FAIL"} MCP get_data while limited -> tool error the model can read (${mcp.status}, ${mcpJson.result?.structuredContent?.reason})\n`);

const reads = await fetch(`${BASE}/api/tables?query=cpi&limit=1`);
process.stdout.write(`  ${reads.status === 200 ? "ok  " : "FAIL"} catalogue reads still served while UPSTREAM is exhausted (${reads.status})\n`);

process.exit(ok && mcpOk && reads.status === 200 ? 0 : 1);
