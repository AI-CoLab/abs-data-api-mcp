/**
 * Endpoint conformance entrypoint: checks the documented surface against live
 * behaviour and records the evidence.
 *
 *   pnpm --filter @abs/crawler check:endpoints
 */
import { bootstrap } from "../runtime.ts";
import { recordEndpointChecks, runEndpointChecks } from "../endpoints.ts";

const rt = bootstrap({ runKind: "endpoints", concurrency: 2 });

try {
  rt.log("checking documented endpoints against live behaviour…");
  const results = await runEndpointChecks(rt.client);
  recordEndpointChecks(rt.db, rt.runId, results);

  const width = Math.max(...results.map((r) => r.label.length));
  for (const r of results) {
    const mark =
      r.verdict === "conforms" ? "OK  " : r.verdict === "missing" ? "404 " : "FAIL";
    rt.log(`${mark} ${r.label.padEnd(width)}  ${r.verdict.padEnd(9)} ${r.detail}`);
  }

  const broken = results.filter((r) => r.verdict !== "conforms");
  rt.log(`--- ${broken.length}/${results.length} documented behaviours do not conform ---`);
} finally {
  rt.sqlite.close();
}
