/**
 * The weekly refresh check (decision 28), run daily on a rotating slice.
 *
 * Two questions, both cheap:
 *   1. Did the dataflow listing change? New, removed or re-versioned flows,
 *      from one 0.6MB request against declared_flow.
 *   2. Did any flow's options change? For this run's slice of flows, the live
 *      `availableconstraint` marginals versus the observed ones in D1. Section
 *      2.10 of DESIGN.md showed these agree exactly for the whole corpus, so a
 *      divergence is a real signal: ABS added or withdrew something and the
 *      flow should be re-probed in the next self-hosted run.
 *
 * Sliced because a Worker invocation may make ~1,000 subrequests and there are
 * 1,227 flows: seven daily slices give a full sweep every week.
 */
import { drizzle } from "drizzle-orm/d1";
import { sql } from "drizzle-orm";
import * as tables from "@abs/schema/tables";
import { TABLE_IDS } from "@abs/contract";
import { ABS_BASE, absHeaders, type Env } from "./env.ts";
import { checkAvailability } from "./availability.ts";

export const REFRESH_SLICES = 7;
const CONCURRENCY = 8;

export interface RefreshSummary {
  id: string;
  checkedAt: string;
  slice: number;
  slices: number;
  flowsListed: number;
  flowsChecked: number;
  newFlows: string[];
  removedFlows: string[];
  reversionedFlows: Array<{ flow: string; from: string; to: string }>;
  marginalChanges: Array<{ flow: string; dimension: string; observed: number; live: number }>;
  errors: Array<{ flow: string; error: string }>;
  durationMs: number;
  status: "clean" | "changes" | "errors";
}

/** Deterministic slice for a date: day-of-epoch modulo slices. */
export function sliceForDate(date: Date, slices = REFRESH_SLICES): number {
  return Math.floor(date.getTime() / 86_400_000) % slices;
}

export async function runRefreshCheck(env: Env, opts: { slice?: number; now?: Date } = {}): Promise<RefreshSummary> {
  const started = Date.now();
  const now = opts.now ?? new Date();
  const slice = opts.slice ?? sliceForDate(now);
  const db = drizzle(env.CATALOGUE, { schema: tables });

  // ------------------------------------------------------------ listing diff
  const res = await fetch(`${ABS_BASE}/dataflow/ABS?detail=allstubs`, {
    headers: absHeaders("application/vnd.sdmx.structure+json;version=1.0"),
  });
  if (!res.ok) throw new Error(`dataflow listing failed: HTTP ${res.status}`);
  const listing = (await res.json()) as { data?: { dataflows?: Array<{ id: string; version: string }> } };
  const live = new Map((listing.data?.dataflows ?? []).map((f) => [f.id, f.version] as const));

  const known = await db.select({ id: tables.declaredFlow.id, version: tables.declaredFlow.version }).from(tables.declaredFlow);
  const knownMap = new Map(known.map((f) => [f.id, f.version] as const));

  const newFlows = [...live.keys()].filter((id) => !knownMap.has(id)).sort();
  const removedFlows = [...knownMap.keys()].filter((id) => !live.has(id)).sort();
  const reversionedFlows = [...live]
    .filter(([id, v]) => knownMap.has(id) && knownMap.get(id) !== v)
    .map(([id, v]) => ({ flow: id, from: knownMap.get(id)!, to: v }))
    .sort((a, b) => a.flow.localeCompare(b.flow));

  // --------------------------------------------------------- marginals check
  const sliceFlows = TABLE_IDS.filter((_, i) => i % REFRESH_SLICES === slice);
  // One grouped query over all flows (≈6.7k groups) rather than an IN list:
  // D1 caps bound parameters at 100 and a slice holds ~175 flows.
  const observed = await db
    .select({
      flowId: tables.observedDimensionCode.flowId,
      dimensionId: tables.observedDimensionCode.dimensionId,
      n: sql<number>`count(*)`,
    })
    .from(tables.observedDimensionCode)
    .groupBy(tables.observedDimensionCode.flowId, tables.observedDimensionCode.dimensionId);
  const inSlice = new Set<string>(sliceFlows);
  const observedCounts = new Map(
    observed.filter((r) => inSlice.has(r.flowId)).map((r) => [`${r.flowId}|${r.dimensionId}`, r.n] as const),
  );

  const marginalChanges: RefreshSummary["marginalChanges"] = [];
  const errors: RefreshSummary["errors"] = [];
  const queue = [...sliceFlows];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (;;) {
        const flow = queue.shift();
        if (!flow) return;
        try {
          const a = await checkAvailability(flow, "all");
          if (!a.exists) {
            errors.push({ flow, error: "availableconstraint returned no dimensions" });
            continue;
          }
          for (const [dimension, codes] of Object.entries(a.available)) {
            const obs = observedCounts.get(`${flow}|${dimension}`) ?? 0;
            if (obs !== codes.length) marginalChanges.push({ flow, dimension, observed: obs, live: codes.length });
          }
        } catch (err) {
          errors.push({ flow, error: err instanceof Error ? err.message : String(err) });
        }
      }
    }),
  );
  marginalChanges.sort((a, b) => a.flow.localeCompare(b.flow) || a.dimension.localeCompare(b.dimension));

  const changed = newFlows.length + removedFlows.length + reversionedFlows.length + marginalChanges.length > 0;
  const summary: RefreshSummary = {
    id: `refresh-${now.toISOString().replace(/[:.]/g, "-")}`,
    checkedAt: now.toISOString(),
    slice,
    slices: REFRESH_SLICES,
    flowsListed: live.size,
    flowsChecked: sliceFlows.length,
    newFlows,
    removedFlows,
    reversionedFlows,
    marginalChanges,
    errors,
    durationMs: Date.now() - started,
    status: errors.length > 0 ? "errors" : changed ? "changes" : "clean",
  };

  await db.insert(tables.refreshCheck).values({
    id: summary.id,
    checkedAt: summary.checkedAt,
    slice: summary.slice,
    slices: summary.slices,
    flowsListed: summary.flowsListed,
    flowsChecked: summary.flowsChecked,
    newFlows: summary.newFlows,
    removedFlows: summary.removedFlows,
    reversionedFlows: summary.reversionedFlows,
    marginalChanges: summary.marginalChanges,
    errors: summary.errors,
    durationMs: summary.durationMs,
    status: summary.status,
  });

  return summary;
}

/** Latest checks, newest first, for /api/status. */
export async function recentChecks(env: Env, limit = 14) {
  const db = drizzle(env.CATALOGUE, { schema: tables });
  return db.select().from(tables.refreshCheck).orderBy(sql`${tables.refreshCheck.checkedAt} desc`).limit(limit);
}
