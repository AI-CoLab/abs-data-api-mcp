/**
 * Observed probe entrypoint.
 *
 *   pnpm crawl:probe                     # every flow, resuming past work
 *   pnpm crawl:probe -- CPI LF ALC       # named flows only
 *   pnpm crawl:probe -- --force          # re-probe flows already done
 *   pnpm crawl:probe -- --key-values=CPI,LF   # index those flows by dimension
 *   pnpm crawl:probe -- --key-values=*        # index everything (300M+ rows)
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

/**
 * --key-values=CPI,C21_G01_LGA   decompose those flows' keys
 * --key-values=*                 decompose everything (300M+ rows corpus-wide)
 *
 * series_key_value duplicates no information — key_string splits back to the
 * same tuple — but it is the only thing that can index a per-dimension
 * predicate, since a dimension's key position differs per flow. Scoped per
 * flow so that capability is available where wanted without materialising it
 * for the whole corpus.
 */
const kvArg = argv.find((a) => a.startsWith("--key-values"));
const keyValueFlows = kvArg
  ? new Set(
      (kvArg.includes("=") ? (kvArg.split("=")[1] ?? "") : "*")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    )
  : undefined;

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
  keyValueFlows,
  maxSplitDepth: Number(process.env["ABS_MAX_SPLIT_DEPTH"] ?? 3),
  passTimeoutMs: Number(process.env["ABS_PASS_TIMEOUT_MS"] ?? 110_000),
};

/**
 * Index management, not data: the lookup index over series_key_value is dropped
 * for the duration of a bulk run and rebuilt afterwards. Maintaining a
 * low-cardinality secondary index across hundreds of millions of inserts costs
 * far more than one rebuild. The rows themselves are written exactly as the
 * probe parses them from the API's own per-dimension CSV columns.
 */
const buildingKeyValues = keyValueFlows !== undefined;

function dropKeyValueIndex(): void {
  rt.sqlite.exec(`DROP INDEX IF EXISTS series_key_value_lookup_idx`);
  rt.log("dropped series_key_value_lookup_idx for the duration of this run");
}

function rebuildKeyValueIndex(): void {
  const started = Date.now();
  rt.sqlite.exec(
    `CREATE INDEX IF NOT EXISTS series_key_value_lookup_idx
     ON series_key_value (dimension_id, code_id)`,
  );
  rt.log(`rebuilt series_key_value_lookup_idx in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

try {
  if (buildingKeyValues) dropKeyValueIndex();

  openProbeRun(
    deps,
    JSON.stringify({ force, keyValueFlows: [...(keyValueFlows ?? [])], limit, named }),
  );

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

  // Smallest declared key space first. Alphabetical order would front-load the
  // ABS_C16_*/ABS_C21_* census blocks, which are the largest flows in the
  // corpus and need recursive splitting — hours of work before any flow
  // completes. Cheapest-first banks the tractable majority early, and since the
  // crawl is resumable that is also the most useful thing to have on disk if it
  // is interrupted.
  let flows = rt.db
    .select({
      id: declaredFlow.id,
      agencyId: declaredFlow.agencyId,
      version: declaredFlow.version,
      name: declaredFlow.name,
      declaredKeyCount: declaredFlow.declaredKeyCount,
    })
    .from(declaredFlow)
    .orderBy(asc(declaredFlow.declaredKeyCount), asc(declaredFlow.id))
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
    `probing ${flows.length} flows (${alreadyDone.size} already done, ` +
      `key-values: ${[...(keyValueFlows ?? [])].join(",") || "none"})`,
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

      const result = await probeFlow(deps, {
        id: flow.id,
        agencyId: flow.agencyId,
        version: flow.version,
        name: flow.name,
      });
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
  // Rebuild even on interruption, so the database is never left without the
  // index that queries depend on.
  if (buildingKeyValues) {
    try {
      rebuildKeyValueIndex();
    } catch (err) {
      rt.log(`WARNING: index rebuild failed: ${String(err)} — re-run to restore it`);
    }
  }
  rt.sqlite.close();
}
