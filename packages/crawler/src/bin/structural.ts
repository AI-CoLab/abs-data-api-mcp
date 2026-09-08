/**
 * Structural crawl entrypoint. Seven bulk requests cover all 1,227 flows.
 *
 *   pnpm crawl:structural
 */
import { bootstrap } from "../runtime.ts";
import { crawlStructural } from "../structural.ts";

const rt = bootstrap({ runKind: "structural" });

try {
  const summary = await crawlStructural({
    db: rt.db,
    client: rt.client,
    archive: rt.archive,
    runId: rt.runId,
    log: rt.log,
  });

  rt.log("--- structural crawl complete ---");
  const { anomalies, ...counts } = summary;
  for (const [k, v] of Object.entries(counts)) rt.log(`${k}: ${String(v)}`);

  rt.log("--- anomalies (feed the delta report) ---");
  for (const [k, v] of Object.entries(anomalies)) {
    const shown = Array.isArray(v)
      ? `${v.length}${v.length > 0 ? ` -> ${JSON.stringify(v.slice(0, 8))}` : ""}`
      : String(v);
    rt.log(`${k}: ${shown}`);
  }
  rt.log(`http: ${JSON.stringify(rt.client.stats)}`);
} finally {
  rt.sqlite.close();
}
