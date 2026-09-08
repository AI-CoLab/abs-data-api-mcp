/**
 * Observed probe entrypoint.
 *
 *   pnpm crawl:probe                     # every flow, resuming past work
 *   pnpm crawl:probe -- CPI LF ALC       # named flows only
 *   pnpm crawl:probe -- --force          # re-probe flows already done
 *   pnpm crawl:probe -- --key-values     # also populate series_key_value
 *   pnpm crawl:probe -- --limit=30       # smallest-first slice, for a test run
 *
 * Resumable by default: a flow already recorded as ok/empty in any run is
 * skipped, so an interrupted crawl can simply be re-run.
 */
import { asc, sql } from "drizzle-orm";
import { declaredFlow, flowProbe } from "@abs/schema";
import { bootstrap } from "../runtime.ts";
import {
  closeProbeRun,
  fillDerivedObsCounts,
  openProbeRun,
  probeFlow,
  recordFlowProbe,
  type ProbeDeps,
} from "../probe.ts";

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const named = argv.filter((a) => !a.startsWith("-"));
const limitArg = argv.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : undefined;

const force = flags.has("--force");
const keyValues = flags.has("--key-values");

const rt = bootstrap({
  runKind: "probe",
  concurrency: Number(process.env["ABS_CONCURRENCY"] ?? 6),
});

const deps: ProbeDeps = {
  db: rt.db,
  sqlite: rt.sqlite,
  client: rt.client,
  archive: rt.archive,
  runId: rt.runId,
  log: rt.log,
  keyValues,
  maxSplitDepth: Number(process.env["ABS_MAX_SPLIT_DEPTH"] ?? 3),
  passTimeoutMs: Number(process.env["ABS_PASS_TIMEOUT_MS"] ?? 110_000),
};

try {
  openProbeRun(deps, JSON.stringify({ force, keyValues, limit, named }));

  const alreadyDone = force
    ? new Set<string>()
    : new Set(
        rt.db
          .selectDistinct({ flowId: flowProbe.flowId })
          .from(flowProbe)
          .where(sql`${flowProbe.status} in ('ok','empty')`)
          .all()
          .map((r) => r.flowId),
      );

  let flows = rt.db
    .select({
      id: declaredFlow.id,
      agencyId: declaredFlow.agencyId,
      version: declaredFlow.version,
      name: declaredFlow.name,
      declaredKeyCount: declaredFlow.declaredKeyCount,
    })
    .from(declaredFlow)
    .orderBy(asc(declaredFlow.id))
    .all();

  if (named.length > 0) flows = flows.filter((f) => named.includes(f.id));
  if (!force) flows = flows.filter((f) => !alreadyDone.has(f.id));

  // --limit takes the smallest declared flows first: a cheap, broad slice.
  if (limit !== undefined && Number.isFinite(limit)) {
    flows = [...flows]
      .sort((a, b) => (a.declaredKeyCount ?? Infinity) - (b.declaredKeyCount ?? Infinity))
      .slice(0, limit);
  }

  rt.log(
    `probing ${flows.length} flows (${alreadyDone.size} already done, keyValues=${keyValues})`,
  );

  const tally = { ok: 0, empty: 0, partial: 0, error: 0 };
  let seriesTotal = 0;
  let done = 0;

  const concurrency = Number(process.env["ABS_FLOW_CONCURRENCY"] ?? 6);
  const queue = [...flows];

  const workers = Array.from({ length: concurrency }, async () => {
    for (;;) {
      const flow = queue.shift();
      if (!flow) return;

      const result = await probeFlow(deps, flow.id);
      recordFlowProbe(deps, flow, result, flow.declaredKeyCount ?? null);
      if (result.seriesFound > 0) fillDerivedObsCounts(rt.sqlite, flow.id);

      tally[result.status] += 1;
      seriesTotal += result.seriesFound;
      done += 1;

      const density =
        flow.declaredKeyCount && flow.declaredKeyCount > 0
          ? ` density=${((result.seriesFound / flow.declaredKeyCount) * 100).toFixed(1)}%`
          : "";
      rt.log(
        `  [${done}/${flows.length}] ${flow.id}: ${result.status} ` +
          `series=${result.seriesFound}${density} reqs=${result.requestCount} ` +
          `split=${result.splitDepth} ${(result.durationMs / 1000).toFixed(1)}s` +
          (result.reason ? ` (${result.reason})` : ""),
      );
    }
  });

  await Promise.all(workers);

  closeProbeRun(deps, {
    attempted: flows.length,
    succeeded: tally.ok,
    notes: { tally, seriesTotal, http: rt.client.stats },
  });

  rt.log("--- probe complete ---");
  rt.log(`tally: ${JSON.stringify(tally)}`);
  rt.log(`series observed: ${seriesTotal}`);
  rt.log(`http: ${JSON.stringify(rt.client.stats)}`);
} finally {
  rt.sqlite.close();
}
