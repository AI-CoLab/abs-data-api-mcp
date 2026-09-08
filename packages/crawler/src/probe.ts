/**
 * Observed probe: establishes which series actually exist.
 *
 * `detail=serieskeysonly` is broken upstream (HTTP 200 with malformed JSON; the
 * CSV variant returns a header row and nothing else), so existence has to be
 * established by pulling data. Two passes per flow:
 *   - `lastNObservations=1` -> every series key, its frequency, its attributes,
 *     and its most recent period.
 *   - `firstNObservations=1` -> the earliest period for those keys.
 *
 * Oversized flows are handled by recursive dimension splitting (DESIGN.md
 * decision 6). Declared metadata is used only to choose *what to ask for* — a
 * search strategy, never a truth claim. A declared code that yields no rows
 * simply contributes nothing.
 */
import type { Database } from "better-sqlite3";
import { and, asc, eq, ne } from "drizzle-orm";
import type { CatalogueDb } from "@abs/schema/client";
import {
  code as codeTable,
  declaredConstraint,
  declaredConstraintValue,
  declaredDimension,
  derivedObsCount,
  flowProbe,
  maxPeriod,
  minPeriod,
  observedFlow,
  probeRun,
} from "@abs/schema";
import { AbsClient, ACCEPT, AbsHttpError, Semaphore } from "./http.ts";
import { archiveKey, teeBody, type RawArchive } from "./archive.ts";
import { readCsvTable } from "./csv.ts";
import { SeriesWriter, type ObservedSeries } from "./writer.ts";

export interface ProbeDeps {
  db: CatalogueDb;
  sqlite: Database;
  client: AbsClient;
  archive: RawArchive;
  runId: string;
  log: (msg: string) => void;
  /** Populate series_key_value (opt-in; see writer.ts). */
  /**
   * Flows for which to materialise `series_key_value`.
   *
   * Deliberately per-flow rather than a global switch. The decomposition holds
   * no information that `series.key_string` does not — no ABS code contains the
   * "." separator, so the key string splits back to the same tuple — but it is
   * the only thing that can *index* a per-dimension predicate, because a
   * dimension sits at a different key position in every flow.
   *
   * At ~6 rows per series it is 300M+ rows corpus-wide, so it is built for the
   * flows someone actually wants to analyse. "*" opts everything in.
   */
  keyValueFlows?: ReadonlySet<string> | undefined;
  /** Give up splitting beyond this depth and record the flow as partial. */
  maxSplitDepth?: number;
  /**
   * In-flight split slices per flow, across all recursion depths. Slices are
   * disjoint key subspaces, so they parallelise safely; without this the
   * recursion was strictly sequential, which put hours of dead timeout-waiting
   * on the largest flows exactly where total parallelism had collapsed to one.
   * A single per-flow gate (not per recursion level) keeps deep recursion from
   * multiplying concurrent response streams.
   */
  sliceConcurrency?: number;
  /** Shorter than the 120s gateway limit, so a split is tried sooner. */
  passTimeoutMs?: number;
}

export interface FlowProbeResult {
  flowId: string;
  status: "ok" | "empty" | "partial" | "error";
  reason: string | undefined;
  httpStatus: number | undefined;
  seriesFound: number;
  bytesReceived: number;
  requestCount: number;
  splitDepth: number;
  durationMs: number;
  frequencies: string[];
  earliestPeriod: string | undefined;
  latestPeriod: string | undefined;
}

interface FlowDimension {
  dimensionId: string;
  position: number;
  codelistId: string | null;
}

interface HeaderPlan {
  dimensionColumns: Array<{ dimensionId: string; index: number }>;
  timeIndex: number;
  obsValueIndex: number;
  freqIndex: number | undefined;
  attributeColumns: Array<{ attributeId: string; index: number }>;
}

/** Columns that are structural rather than dimensions or attributes. */
const STRUCTURAL_COLUMNS = new Set(["DATAFLOW", "TIME_PERIOD", "OBS_VALUE"]);

/**
 * Derives the column layout from the response itself.
 *
 * Necessary because column sets differ per flow: ABS_LABOUR_ACCT carries
 * UNIT_MULT and dimensions ASGS_2016/LABOURACCT_IND where CPI carries neither.
 * Dimensions are the columns between DATAFLOW and TIME_PERIOD, in key order.
 */
export function planHeader(header: readonly string[]): HeaderPlan | undefined {
  const timeIndex = header.indexOf("TIME_PERIOD");
  const obsValueIndex = header.indexOf("OBS_VALUE");
  if (timeIndex === -1) return undefined;

  const start = header[0] === "DATAFLOW" ? 1 : 0;
  const dimensionColumns: Array<{ dimensionId: string; index: number }> = [];
  for (let i = start; i < timeIndex; i += 1) {
    const name = header[i];
    if (name && !STRUCTURAL_COLUMNS.has(name)) dimensionColumns.push({ dimensionId: name, index: i });
  }

  const attributeColumns: Array<{ attributeId: string; index: number }> = [];
  for (let i = timeIndex + 1; i < header.length; i += 1) {
    const name = header[i];
    if (!name || STRUCTURAL_COLUMNS.has(name)) continue;
    attributeColumns.push({ attributeId: name, index: i });
  }

  const freqCol = dimensionColumns.find(
    (d) => d.dimensionId === "FREQ" || d.dimensionId === "FREQUENCY",
  );

  return {
    dimensionColumns,
    timeIndex,
    obsValueIndex,
    freqIndex: freqCol?.index,
    attributeColumns,
  };
}

function flowDimensions(db: CatalogueDb, flowId: string): FlowDimension[] {
  return db
    .select({
      dimensionId: declaredDimension.dimensionId,
      position: declaredDimension.position,
      codelistId: declaredDimension.codelistId,
    })
    .from(declaredDimension)
    .where(
      and(eq(declaredDimension.flowId, flowId), ne(declaredDimension.dimensionType, "TimeDimension")),
    )
    .orderBy(asc(declaredDimension.position))
    .all();
}

/**
 * Candidate codes for splitting a dimension.
 *
 * Prefers the declared constraint (a smaller, more targeted set) and falls back
 * to the full codelist. Both are search hints, not availability claims.
 */
function splitCandidates(db: CatalogueDb, flowId: string, dim: FlowDimension): string[] {
  const fromConstraint = db
    .select({ codeId: declaredConstraintValue.codeId })
    .from(declaredConstraintValue)
    .innerJoin(declaredConstraint, eq(declaredConstraint.id, declaredConstraintValue.constraintId))
    .where(
      and(
        eq(declaredConstraint.flowId, flowId),
        eq(declaredConstraintValue.dimensionId, dim.dimensionId),
      ),
    )
    .all()
    .map((r) => r.codeId);

  if (fromConstraint.length > 0) return [...new Set(fromConstraint)];

  if (!dim.codelistId) return [];
  return db
    .select({ codeId: codeTable.codeId })
    .from(codeTable)
    .where(eq(codeTable.codelistId, dim.codelistId))
    .all()
    .map((r) => r.codeId);
}

/** Fan-out bounds per split level: enough chunks to get under the timeout,
 *  few enough that we do not issue thousands of requests for one flow. */
const SPLIT_MIN_FANOUT = 8;
const SPLIT_MAX_FANOUT = 64;

/**
 * Picks which dimension to split on.
 *
 * Splitting on the highest-cardinality dimension minimises chunk size but is
 * badly wasteful: `ABS_C16_T07_SA`'s geography codelist has 4,302 codes, so that
 * choice would issue 4,302 requests where ~30 would do. Instead prefer the
 * smallest dimension that still yields a useful number of chunks, and only fall
 * back to the largest when nothing is in range.
 */
export function chooseSplitDimension<D>(
  candidates: ReadonlyArray<{ dim: D; codes: string[] }>,
): { dim: D; codes: string[] } | undefined {
  const usable = candidates.filter((c) => c.codes.length >= 2);
  if (usable.length === 0) return undefined;

  const inRange = usable
    .filter((c) => c.codes.length >= SPLIT_MIN_FANOUT && c.codes.length <= SPLIT_MAX_FANOUT)
    .sort((a, b) => b.codes.length - a.codes.length);
  if (inRange[0]) return inRange[0];

  // Nothing in range: prefer the smallest above the ceiling (fewest requests
  // that still splits meaningfully), else the largest below the floor.
  const aboveCeiling = usable
    .filter((c) => c.codes.length > SPLIT_MAX_FANOUT)
    .sort((a, b) => a.codes.length - b.codes.length);
  if (aboveCeiling[0]) return aboveCeiling[0];

  return [...usable].sort((a, b) => b.codes.length - a.codes.length)[0];
}

/** Builds an SDMX dataKey: codes in dimension order, empty segment = wildcard. */
export function buildDataKey(
  dimensions: readonly FlowDimension[],
  assignments: ReadonlyMap<string, string>,
): string {
  if (assignments.size === 0) return "all";
  return dimensions.map((d) => assignments.get(d.dimensionId) ?? "").join(".");
}

interface PassOutcome {
  status: number;
  rows: number;
  bytes: number;
  timedOut: boolean;
  /** Mid-stream failure: parsed rows are valid but the key set is incomplete. */
  retryable?: boolean;
  error?: string | undefined;
  earliest: string | undefined;
  latest: string | undefined;
}

/**
 * Streams one data pass, feeding rows to `onRow`.
 *
 * The body is tee'd so it can be archived and parsed in a single pass;
 * `tee()` propagates backpressure, keeping memory bounded on 42MB responses.
 */
async function streamPass(
  deps: ProbeDeps,
  flowId: string,
  dataKey: string,
  query: Record<string, string | number>,
  label: string,
  onRow: (row: string[], plan: HeaderPlan) => void,
): Promise<PassOutcome> {
  const outcome: PassOutcome = {
    status: 0,
    rows: 0,
    bytes: 0,
    timedOut: false,
    earliest: undefined,
    latest: undefined,
  };

  let res;
  try {
    res = await deps.client.request({
      path: `data/ABS,${encodeURIComponent(flowId)}/${dataKey}`,
      accept: ACCEPT.dataCsv,
      query,
      timeoutMs: deps.passTimeoutMs ?? 110_000,
    });
  } catch (err) {
    if (err instanceof AbsHttpError && err.kind === "timeout") {
      outcome.timedOut = true;
      return outcome;
    }
    throw err;
  }

  outcome.status = res.status;

  if (!res.body) return outcome;

  // 404 NoRecordsFound is a legitimate answer, not an error. Drain and report.
  if (res.status !== 200) {
    await res.body.cancel();
    return outcome;
  }

  const [toArchive, toParse] = teeBody(res.body);

  // The archive branch must be settled independently. If parsing throws first,
  // an unawaited rejection here takes the whole process down — which is exactly
  // what happened on ABS_SEIFA2016_SA2, where the upstream HTTP/2 stream died
  // mid-body (NGHTTP2_INTERNAL_ERROR) after 246 flows.
  let archiveError: unknown;
  const archiving = deps.archive
    .put(archiveKey({ kind: "data", flowId, label, runId: deps.runId }), toArchive)
    .catch((err: unknown) => {
      archiveError = err;
      return 0;
    });

  try {
    const table = await readCsvTable(toParse, (n) => {
      outcome.bytes += n;
    });

    if (table) {
      const plan = planHeader(table.header);
      if (plan) {
        for await (const row of table.rows) {
          if (row.length < plan.timeIndex + 1) continue;
          onRow(row, plan);
          outcome.rows += 1;
          const period = row[plan.timeIndex];
          if (period) {
            outcome.earliest = minPeriod(outcome.earliest, period);
            outcome.latest = maxPeriod(outcome.latest, period);
          }
        }
      }
    }
  } catch (err) {
    // A transport failure part-way through a large body. Rows already parsed
    // are still valid observations, but the pass is incomplete, so flag it as
    // retryable: the caller splits into smaller slices rather than trusting a
    // truncated key set.
    outcome.retryable = true;
    outcome.error = err instanceof Error ? err.message : String(err);
  } finally {
    await archiving;
  }

  if (archiveError !== undefined && outcome.error === undefined) {
    outcome.error = `archive failed: ${String(archiveError)}`;
  }

  return outcome;
}

function seriesFromRow(row: string[], plan: HeaderPlan): ObservedSeries {
  const dimensions: Array<{ dimensionId: string; codeId: string }> = [];
  const parts: string[] = [];
  for (const d of plan.dimensionColumns) {
    const codeId = row[d.index] ?? "";
    dimensions.push({ dimensionId: d.dimensionId, codeId });
    parts.push(codeId);
  }

  const attributes: Array<{ attributeId: string; value: string }> = [];
  for (const a of plan.attributeColumns) {
    const value = row[a.index];
    if (value !== undefined && value !== "") {
      attributes.push({ attributeId: a.attributeId, value });
    }
  }

  return {
    keyString: parts.join("."),
    freq: plan.freqIndex !== undefined ? row[plan.freqIndex] : undefined,
    dimensions,
    attributes,
  };
}

export interface ProbeTarget {
  id: string;
  agencyId: string;
  version: string;
  name: string | null;
}

/**
 * Probes one flow to completion, splitting when a whole-flow pass times out.
 *
 * The canonical `observed_flow` row is created before any series are written,
 * because `series` and `observed_dimension_code` both reference it. It starts
 * at zero series and ineligible, and is only promoted once data is confirmed —
 * so an interrupted probe leaves a flow marked as serving nothing rather than
 * as silently available.
 */
export async function probeFlow(
  deps: ProbeDeps,
  target: ProbeTarget,
): Promise<FlowProbeResult> {
  const started = performance.now();
  const flowId = target.id;
  const dimensions = flowDimensions(deps.db, flowId);

  deps.db
    .insert(observedFlow)
    .values({
      id: target.id,
      agencyId: target.agencyId,
      version: target.version,
      name: target.name,
      seriesCount: 0,
      mcpEligible: false,
      lastProbedAt: new Date().toISOString(),
    })
    .onConflictDoNothing()
    .run();

  // Observed marginals accumulate (series_count + excluded.series_count) so
  // that recursive splits sum correctly within one probe. That makes a re-probe
  // double-count, so the flow's marginals are cleared first. Matters for the
  // monthly refresh as much as for a forced re-run.
  deps.sqlite
    .prepare(`DELETE FROM observed_dimension_code WHERE flow_id = ?`)
    .run(flowId);

  const writer = new SeriesWriter(deps.sqlite, {
    flowId,
    runId: deps.runId,
    keyValues:
      deps.keyValueFlows !== undefined &&
      (deps.keyValueFlows.has("*") || deps.keyValueFlows.has(flowId)),
  });

  const result: FlowProbeResult = {
    flowId,
    status: "ok",
    reason: undefined,
    httpStatus: undefined,
    seriesFound: 0,
    bytesReceived: 0,
    requestCount: 0,
    splitDepth: 0,
    durationMs: 0,
    frequencies: [],
    earliestPeriod: undefined,
    latestPeriod: undefined,
  };

  const seenKeys = new Set<string>();
  const streamErrors: string[] = [];
  const sliceGate = new Semaphore(deps.sliceConcurrency ?? 6);
  let sawTimeout = false;
  let exhaustedSplits = false;

  /** Pass 1 over a key slice; returns false when it timed out. */
  const lastPass = async (
    dataKey: string,
    label: string,
    depth: number,
  ): Promise<boolean> => {
    const outcome = await streamPass(
      deps,
      flowId,
      dataKey,
      { lastNObservations: 1 },
      label,
      (row, plan) => {
        const series = seriesFromRow(row, plan);
        if (seenKeys.has(series.keyString)) return;
        seenKeys.add(series.keyString);
        writer.addObserved(series, row[plan.timeIndex]);
      },
    );

    result.requestCount += 1;
    result.bytesReceived += outcome.bytes;
    if (result.httpStatus === undefined || outcome.status === 200) {
      result.httpStatus = outcome.status;
    }
    result.latestPeriod = maxPeriod(result.latestPeriod, outcome.latest);
    if (depth > result.splitDepth) result.splitDepth = depth;

    // A mid-stream transport failure is treated like a timeout: the rows we got
    // are valid, but the key set is incomplete, so split rather than trust it.
    if (outcome.timedOut || outcome.retryable) {
      sawTimeout = true;
      if (outcome.error !== undefined) streamErrors.push(outcome.error);
      return false;
    }
    return true;
  };

  /** Recursively split on the highest-cardinality dimension still unassigned. */
  const splitAndProbe = async (
    assignments: Map<string, string>,
    depth: number,
  ): Promise<void> => {
    const maxDepth = deps.maxSplitDepth ?? 3;
    if (depth > maxDepth) {
      exhaustedSplits = true;
      return;
    }

    const remaining = dimensions.filter((d) => !assignments.has(d.dimensionId));
    if (remaining.length === 0) {
      exhaustedSplits = true;
      return;
    }

    const best = chooseSplitDimension(
      remaining.map((dim) => ({ dim, codes: splitCandidates(deps.db, flowId, dim) })),
    );

    if (!best) {
      exhaustedSplits = true;
      return;
    }

    deps.log(
      `    ${flowId}: splitting on ${best.dim.dimensionId} (${best.codes.length} codes) at depth ${depth}`,
    );

    // Slices are disjoint key subspaces — parallel-safe. The gate is shared
    // across recursion depths so nested splits cannot multiply concurrent
    // streams; parents awaiting children hold no slot. Shared state touched
    // from concurrent slices (seenKeys, the writer's batches, result counters)
    // is only ever mutated synchronously between awaits, so the single-threaded
    // event loop keeps it consistent.
    await Promise.all(
      best.codes.map(async (codeId) => {
        const next = new Map(assignments);
        next.set(best.dim.dimensionId, codeId);
        const key = buildDataKey(dimensions, next);

        const release = await sliceGate.acquire();
        let ok: boolean;
        try {
          ok = await lastPass(key, `last-d${depth}-${best.dim.dimensionId}-${codeId}`, depth);
        } finally {
          release();
        }
        if (!ok) await splitAndProbe(next, depth + 1);
      }),
    );
  };

  try {
    const wholeOk = await lastPass("all", "last-all", 0);
    if (!wholeOk) await splitAndProbe(new Map(), 1);

    writer.flushLast();
    result.seriesFound = seenKeys.size;

    // Pass 2 only makes sense once keys are known, and only if any exist.
    if (seenKeys.size > 0) {
      const firstOutcome = await streamPass(
        deps,
        flowId,
        "all",
        { firstNObservations: 1 },
        "first-all",
        (row, plan) => {
          const series = seriesFromRow(row, plan);
          const period = row[plan.timeIndex];
          if (period) writer.addFirstPeriod(series.keyString, period);
        },
      );
      result.requestCount += 1;
      result.bytesReceived += firstOutcome.bytes;
      result.earliestPeriod = firstOutcome.earliest;

      // A timed-out first pass costs extents, not keys: still "ok", flagged.
      if (firstOutcome.timedOut) {
        result.reason = "firstNObservations pass timed out; first_period incomplete";
      }
    }

    const finished = writer.finish();
    result.frequencies = finished.frequencies;

    if (result.seriesFound === 0) {
      result.status = "empty";
      result.reason = result.httpStatus === 404 ? "404 NoRecordsFound" : "no rows returned";
    } else if (sawTimeout && exhaustedSplits) {
      result.status = "partial";
      result.reason = `split exhausted at depth ${result.splitDepth}; key set may be incomplete`;
    } else {
      result.status = "ok";
    }
  } catch (err) {
    writer.finish();
    result.status = "error";
    result.reason = err instanceof Error ? err.message : String(err);
  }

  result.durationMs = Math.round(performance.now() - started);
  return result;
}

/** Persists a flow's probe outcome and its canonical observed_flow row. */
export function recordFlowProbe(
  deps: ProbeDeps,
  flow: { id: string; agencyId: string; version: string; name: string | null },
  result: FlowProbeResult,
  declaredKeyCount: number | null,
): void {
  const now = new Date().toISOString();

  deps.db
    .insert(flowProbe)
    .values({
      flowId: result.flowId,
      runId: deps.runId,
      status: result.status,
      reason: result.reason ?? null,
      httpStatus: result.httpStatus ?? null,
      seriesFound: result.seriesFound,
      bytesReceived: result.bytesReceived,
      splitDepth: result.splitDepth,
      requestCount: result.requestCount,
      durationMs: result.durationMs,
      fetchedAt: now,
    })
    .onConflictDoNothing()
    .run();

  const density =
    declaredKeyCount && declaredKeyCount > 0 ? result.seriesFound / declaredKeyCount : null;

  deps.db
    .insert(observedFlow)
    .values({
      id: flow.id,
      agencyId: flow.agencyId,
      version: flow.version,
      name: flow.name,
      seriesCount: result.seriesFound,
      frequencies: result.frequencies.join(",") || null,
      earliestPeriod: result.earliestPeriod ?? null,
      latestPeriod: result.latestPeriod ?? null,
      densityRatio: density,
      mcpEligible: result.seriesFound > 0,
      lastProbedAt: now,
    })
    .onConflictDoUpdate({
      target: observedFlow.id,
      set: {
        seriesCount: result.seriesFound,
        frequencies: result.frequencies.join(",") || null,
        earliestPeriod: result.earliestPeriod ?? null,
        latestPeriod: result.latestPeriod ?? null,
        densityRatio: density,
        mcpEligible: result.seriesFound > 0,
        lastProbedAt: now,
      },
    })
    .run();
}

/** Backfills derived observation counts once extents are known. */
export function fillDerivedObsCounts(sqlite: Database, flowId: string): number {
  const rows = sqlite
    .prepare(
      `SELECT id, first_period, last_period FROM series
       WHERE flow_id = ? AND first_period IS NOT NULL AND last_period IS NOT NULL`,
    )
    .all(flowId) as Array<{ id: number; first_period: string; last_period: string }>;

  const update = sqlite.prepare(`UPDATE series SET derived_obs_count = ? WHERE id = ?`);
  let n = 0;
  sqlite.transaction(() => {
    for (const r of rows) {
      const count = derivedObsCount(r.first_period, r.last_period);
      if (count !== undefined) {
        update.run(count, r.id);
        n += 1;
      }
    }
  })();
  return n;
}

export function openProbeRun(deps: ProbeDeps, notes?: string): void {
  deps.db
    .insert(probeRun)
    .values({
      id: deps.runId,
      kind: "probe",
      startedAt: new Date().toISOString(),
      status: "running",
      notes: notes ?? null,
    })
    .onConflictDoNothing()
    .run();
}

export function closeProbeRun(
  deps: ProbeDeps,
  stats: { attempted: number; succeeded: number; notes: unknown },
): void {
  deps.db
    .update(probeRun)
    .set({
      finishedAt: new Date().toISOString(),
      status: "complete",
      flowsAttempted: stats.attempted,
      flowsSucceeded: stats.succeeded,
      notes: JSON.stringify(stats.notes),
    })
    .where(eq(probeRun.id, deps.runId))
    .run();
}
