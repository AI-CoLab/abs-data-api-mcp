/**
 * Pre-flight sizing pass.
 *
 * `Range: bytes=0-0` makes the server report the full representation length in
 * Content-Range while transferring a single byte, so every flow's probe payload
 * can be measured exactly at near-zero bandwidth. That matters because the
 * declared key space totals 14.76 billion across the corpus and sample
 * densities run from 4.6% to 100%, making any extrapolated estimate useless.
 *
 * The result tells us the true probe volume, which flows will need dimension
 * splitting, and which are confirmed-empty before anything is downloaded.
 */
import { asc } from "drizzle-orm";
import type { CatalogueDb } from "@abs/schema/client";
import { declaredFlow, flowPayloadSize } from "@abs/schema";
import { AbsClient, ACCEPT, AbsHttpError } from "./http.ts";

/** Mean CSV row width, measured across sampled flows (bytes per series row). */
const MEAN_ROW_BYTES = 66;

export interface SizingDeps {
  db: CatalogueDb;
  client: AbsClient;
  runId: string;
  log: (msg: string) => void;
  pass?: "last" | "first" | "full";
  concurrency?: number;
  /** Per-flow budget; exceeding it marks the flow as needing a split. */
  timeoutMs?: number;
}

export interface FlowSize {
  flowId: string;
  httpStatus: number | undefined;
  totalBytes: number | undefined;
  estimatedSeries: number | undefined;
  durationMs: number;
  timedOut: boolean;
}

export async function measureFlow(
  client: AbsClient,
  flowId: string,
  pass: "last" | "first" | "full",
  timeoutMs = 20_000,
): Promise<FlowSize> {
  const started = performance.now();
  const query: Record<string, string | number> = {};
  if (pass === "last") query["lastNObservations"] = 1;
  if (pass === "first") query["firstNObservations"] = 1;

  try {
    // A short timeout is deliberate. The server must generate the whole response
    // to report its length, and the largest census flows cannot do that even in
    // 145s. A flow that cannot be sized quickly is a flow that needs splitting,
    // so the timeout is the signal rather than a failure worth waiting out.
    const res = await client.request({
      path: `data/ABS,${encodeURIComponent(flowId)}/all`,
      accept: ACCEPT.dataCsv,
      query,
      range: { start: 0, end: 0 },
      timeoutMs,
    });
    await res.body?.cancel();

    const totalBytes = res.totalBytes;
    return {
      flowId,
      httpStatus: res.status,
      totalBytes,
      estimatedSeries:
        totalBytes !== undefined ? Math.max(0, Math.round(totalBytes / MEAN_ROW_BYTES) - 1) : undefined,
      durationMs: Math.round(performance.now() - started),
      timedOut: false,
    };
  } catch (err) {
    const timedOut = err instanceof AbsHttpError && err.kind === "timeout";
    return {
      flowId,
      httpStatus: err instanceof AbsHttpError ? err.status : undefined,
      totalBytes: undefined,
      estimatedSeries: undefined,
      durationMs: Math.round(performance.now() - started),
      timedOut,
    };
  }
}

export interface SizingSummary {
  measured: number;
  empty404: number;
  timedOut: number;
  totalBytes: number;
  estimatedSeries: number;
  largest: FlowSize[];
}

export async function measureCorpus(deps: SizingDeps): Promise<SizingSummary> {
  const pass = deps.pass ?? "last";
  const flows = deps.db
    .select({ id: declaredFlow.id })
    .from(declaredFlow)
    .orderBy(asc(declaredFlow.id))
    .all()
    .map((r) => r.id);

  const results: FlowSize[] = [];
  const queue = [...flows];
  const concurrency = deps.concurrency ?? 8;
  let done = 0;

  /** Flush as we go: a run over 1,227 flows takes long enough to be
   *  interrupted, and deferring every write to the end loses all of it. */
  let pending: FlowSize[] = [];
  const flush = (): void => {
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    const now = new Date().toISOString();
    deps.db.transaction((tx) => {
      for (const r of batch) {
        tx.insert(flowPayloadSize)
          .values({
            flowId: r.flowId,
            runId: deps.runId,
            pass,
            httpStatus: r.httpStatus ?? null,
            totalBytes: r.totalBytes ?? null,
            estimatedSeries: r.estimatedSeries ?? null,
            durationMs: r.durationMs,
            measuredAt: now,
          })
          .onConflictDoNothing()
          .run();
      }
    });
  };

  const workers = Array.from({ length: concurrency }, async () => {
    for (;;) {
      const flowId = queue.shift();
      if (!flowId) return;
      const size = await measureFlow(deps.client, flowId, pass, deps.timeoutMs ?? 20_000);
      results.push(size);
      pending.push(size);
      done += 1;
      if (pending.length >= 25) flush();
      if (done % 100 === 0 || done === flows.length) {
        const soFar = results.reduce((n, r) => n + (r.totalBytes ?? 0), 0);
        deps.log(`  ${done}/${flows.length} measured, ${(soFar / 1e9).toFixed(2)}GB so far`);
      }
    }
  });
  await Promise.all(workers);
  flush();

  const ok = results.filter((r) => r.httpStatus === 200 || r.httpStatus === 206);
  return {
    measured: results.length,
    empty404: results.filter((r) => r.httpStatus === 404).length,
    timedOut: results.filter((r) => r.timedOut).length,
    totalBytes: ok.reduce((n, r) => n + (r.totalBytes ?? 0), 0),
    estimatedSeries: ok.reduce((n, r) => n + (r.estimatedSeries ?? 0), 0),
    largest: [...ok].sort((a, b) => (b.totalBytes ?? 0) - (a.totalBytes ?? 0)).slice(0, 15),
  };
}
