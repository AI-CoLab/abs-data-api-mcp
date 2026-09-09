/**
 * Worked example: the SDK against the live front door.
 *
 *   pnpm --filter @abs/sdk example
 *   ABS_RPC_URL=http://localhost:8787/rpc pnpm --filter @abs/sdk example
 */
import { connect, invalidSelectionFromError } from "../src/index.ts";

const url = process.env["ABS_RPC_URL"];

// One batch: both calls leave in a single HTTP request.
{
  const abs = connect(url);
  const [found, cpi] = await Promise.all([
    abs.searchTables({ query: "cpi rent", limit: 3 }),
    abs.describeTable("CPI"),
  ]);
  console.log(`search "cpi rent": ${found.results.map((t) => t.id).join(", ")}`);
  console.log(`CPI key format: ${cpi.keyFormat}; ${cpi.table.seriesCount.toLocaleString()} series ${cpi.table.coverage.from}..${cpi.table.coverage.to}`);
}

// Labels resolve server-side; the oracle confirms the combination before fetching.
{
  const abs = connect(url);
  const data = await abs.getData({
    table: "CPI",
    select: { MEASURE: "1", INDEX: "All groups CPI", TSEST: "10", REGION: "Australia", FREQ: "Q" },
    lastN: 4,
  });
  console.log(`key ${data.key}: ${data.rows.map((r) => `${r.period}=${r.value}`).join(" ")}`);
}

// A wrong option is rejected with the observed valid options, typed.
{
  const abs = connect(url);
  try {
    await abs.getData({ table: "CPI", select: { REGION: "Atlantis" } });
  } catch (err) {
    const invalid = invalidSelectionFromError(err);
    if (!invalid) throw err;
    console.log(`${invalid.reason} on ${invalid.dimension}: ${invalid.validOptions?.map((o) => o.label ?? o.code).join(", ")}`);
  }
}
