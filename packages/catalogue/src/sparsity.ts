/**
 * Structured-sparsity analysis.
 *
 * Question: when a flow's observed key set is smaller than the cross-product of
 * its observed options, is the sparsity *principled* (explainable by a rule) or
 * *arbitrary*? The answer determines whether exact compact static types can be
 * generated for the flow, and it is a novel finding for the report.
 *
 * Three levels, cheapest first:
 *
 *  0. Cross-product test, O(flows): observed keys are a subset of the product
 *     of observed per-dimension option sets by construction, so
 *     `series_count == product` means the key set IS the product. Exact and
 *     free — no key scan.
 *
 *  1. Functional-dependency inference, arithmetic only: if
 *     `series_count == product / (n_a * n_b ...)` exactly for some small set of
 *     dimensions {a, b, ...}, each of those dimensions contributes no
 *     independent choice — it is determined by another dimension. The census
 *     signature: STATE (9) is a function of REGION (15,352 suburbs), giving
 *     exactly 1/9. Integer arithmetic throughout so equality is exact.
 *
 *  2. Verification against the actual keys, for every level-1 candidate: for an
 *     inferred dependent dimension, every code of some driving dimension must
 *     co-occur with exactly one code of the dependent one. Only what passes is
 *     counted as explained; a level-1 match that fails is a divisor coincidence.
 */
import type { Database } from "better-sqlite3";

export interface FlowSparsity {
  flowId: string;
  seriesCount: number;
  dimensions: Array<{ id: string; cardinality: number }>;
  /** Product of observed per-dimension cardinalities. */
  observedProduct: bigint;
  /** series / observedProduct. */
  fill: number;
  /**
   * exact-product: level 0. dependent-dimensions: level 1 inferred AND level 2
   * verified against the keys. arithmetic-candidate: level 1 inferred, not yet
   * verified (only when verification is bounded). unexplained: neither, or a
   * level-1 inference that level 2 rejected as a divisor coincidence.
   */
  classification: "exact-product" | "dependent-dimensions" | "arithmetic-candidate" | "unexplained";
  /** Dimensions inferred to be functions of others (level 1). */
  dependentDimensions: string[];
  /** Level-2 result when verified: driving dimension per dependent one. */
  verified?: Array<{ dependent: string; drivenBy: string; ok: boolean }> | undefined;
}

export interface SparsitySummary {
  flows: number;
  exactProduct: number;
  dependentDimensions: number;
  arithmeticCandidates: number;
  unexplained: number;
  /** Series in exact-product or verified dependent-dimension flows, as a share of all series. */
  seriesExplainedShare: number;
  /** Verified dependency patterns, e.g. STATE←REGION, and how often each occurs. */
  patterns: Array<{ dependent: string[]; flows: number; series: number }>;
  verifiedFlows: number;
  verifiedOk: number;
  results: FlowSparsity[];
}

const MAX_DEPENDENT_SET = 3;

function* subsets<T>(items: readonly T[], maxSize: number): Generator<T[]> {
  const n = items.length;
  for (let size = 1; size <= Math.min(maxSize, n); size += 1) {
    const idx = Array.from({ length: size }, (_, i) => i);
    for (;;) {
      yield idx.map((i) => items[i] as T);
      let k = size - 1;
      while (k >= 0 && idx[k] === n - size + k) k -= 1;
      if (k < 0) break;
      idx[k] = (idx[k] as number) + 1;
      for (let j = k + 1; j < size; j += 1) idx[j] = (idx[j - 1] as number) + 1;
    }
  }
}

export function analyseSparsity(
  sqlite: Database,
  opts: { verifyUpToSeries?: number; verifyMaxFlows?: number; log?: (m: string) => void } = {},
): SparsitySummary {
  const log = opts.log ?? (() => undefined);

  const flows = sqlite
    .prepare(`SELECT id, series_count FROM observed_flow WHERE series_count > 0 ORDER BY id`)
    .all() as Array<{ id: string; series_count: number }>;

  const dimStmt = sqlite.prepare(
    `SELECT dimension_id, COUNT(*) AS n FROM observed_dimension_code
     WHERE flow_id = ? GROUP BY dimension_id ORDER BY n DESC`,
  );

  const results: FlowSparsity[] = [];

  for (const f of flows) {
    const dims = (dimStmt.all(f.id) as Array<{ dimension_id: string; n: number }>).map((d) => ({
      id: d.dimension_id,
      cardinality: d.n,
    }));
    if (dims.length === 0) continue;

    const product = dims.reduce((acc, d) => acc * BigInt(d.cardinality), 1n);
    const series = BigInt(f.series_count);
    const fill = Number(series) / Number(product);

    const entry: FlowSparsity = {
      flowId: f.id,
      seriesCount: f.series_count,
      dimensions: dims,
      observedProduct: product,
      fill,
      classification: "unexplained",
      dependentDimensions: [],
    };

    if (product === series) {
      entry.classification = "exact-product";
    } else {
      // Level 1: find the smallest dimension subset whose cardinalities divide
      // the product down to exactly the series count.
      let found: string[] | undefined;
      for (const subset of subsets(dims, MAX_DEPENDENT_SET)) {
        const divisor = subset.reduce((acc, d) => acc * BigInt(d.cardinality), 1n);
        if (product % divisor === 0n && product / divisor === series) {
          found = subset.map((d) => d.id);
          break; // subsets yield smallest-first
        }
      }
      if (found) {
        entry.classification = "arithmetic-candidate";
        entry.dependentDimensions = found;
      }
    }

    results.push(entry);
  }

  // Level 2: verify functional dependency against the actual keys.
  //
  // Streams one flow's key strings (indexed by flow) and splits them at the
  // dimension positions in code, instead of joining the 3.4B-row key-value
  // table twice, which the first attempt did and never finished. For a
  // dependent dimension D driven by X, no X code may pair with more than one
  // D code. Every candidate is verified by default (the whole corpus streams in
  // well under an hour); the bounds exist for quick partial runs, in which case
  // unverified flows keep the arithmetic-candidate class and are not counted
  // as explained. The first bounded run showed why this is necessary: 9 of 40
  // level-1 inferences held — all the geography ones — and the rest (AGE, OCCP,
  // MEASURE, BEDRD, …) were divisor coincidences.
  const verifyUpTo = opts.verifyUpToSeries ?? Number.POSITIVE_INFINITY;
  const verifyMax = opts.verifyMaxFlows ?? Number.POSITIVE_INFINITY;
  const candidates = results
    .filter((r) => r.classification === "arithmetic-candidate" && r.seriesCount <= verifyUpTo)
    .sort((a, b) => a.seriesCount - b.seriesCount)
    .slice(0, Number.isFinite(verifyMax) ? verifyMax : undefined);

  const dimOrderStmt = sqlite.prepare(
    `SELECT dimension_id FROM declared_dimension
     WHERE flow_id = ? AND dimension_type <> 'TimeDimension' ORDER BY position`,
  );
  const keysStmt = sqlite.prepare(`SELECT key_string FROM series WHERE flow_id = ?`);

  let verifiedFlows = 0;
  let verifiedOk = 0;
  for (const r of candidates) {
    const order = (dimOrderStmt.all(r.flowId) as Array<{ dimension_id: string }>).map((d) => d.dimension_id);
    const depIdx = r.dependentDimensions.map((dep) => [dep, order.indexOf(dep)] as const);
    if (depIdx.some(([, i]) => i === -1)) continue;
    // Every non-dependent dimension is a candidate driver: a dependent
    // dimension may be a function of geography, or of some other dimension.
    const drivers = r.dimensions
      .filter((d) => !r.dependentDimensions.includes(d.id))
      .map((d) => [d.id, order.indexOf(d.id)] as const)
      .filter(([, i]) => i !== -1);

    // One pass over the keys: for each (driver, dependent) pair, driver code ->
    // set of dependent codes; the dependency holds when every set has size 1.
    // A set that grows past 1 is disqualified immediately to bound memory.
    const seen = new Map<string, Map<string, Set<string>>>();
    const disqualified = new Set<string>();
    for (const [x] of drivers) for (const [dep] of depIdx) seen.set(`${x}|${dep}`, new Map());
    for (const row of keysStmt.iterate(r.flowId) as IterableIterator<{ key_string: string }>) {
      const parts = row.key_string.split(".");
      for (const [x, xi] of drivers) {
        const xv = parts[xi] ?? "";
        for (const [dep, di] of depIdx) {
          const key = `${x}|${dep}`;
          if (disqualified.has(key)) continue;
          const m = seen.get(key)!;
          const set = m.get(xv) ?? new Set<string>();
          set.add(parts[di] ?? "");
          if (set.size > 1) disqualified.add(key);
          m.set(xv, set);
        }
      }
    }
    const checks: NonNullable<FlowSparsity["verified"]> = [];
    for (const [dep] of depIdx) {
      const driverFound = drivers.find(([x]) => !disqualified.has(`${x}|${dep}`));
      checks.push({ dependent: dep, drivenBy: driverFound ? driverFound[0] : "(none)", ok: driverFound !== undefined });
    }
    r.verified = checks;
    verifiedFlows += 1;
    const allOk = checks.length > 0 && checks.every((c) => c.ok);
    if (allOk) verifiedOk += 1;
    r.classification = allOk ? "dependent-dimensions" : "unexplained"; // a failed check is a coincidence, not structure
    if (verifiedFlows % 50 === 0 || !allOk) {
      log(`  verified ${r.flowId} (${r.seriesCount.toLocaleString()} series): ${checks.map((c) => `${c.dependent}←${c.drivenBy}:${c.ok ? "ok" : "FAIL"}`).join(" ")}`);
    }
  }

  const totalSeries = results.reduce((n, r) => n + r.seriesCount, 0);
  const explainedSeries = results
    .filter((r) => r.classification === "exact-product" || r.classification === "dependent-dimensions")
    .reduce((n, r) => n + r.seriesCount, 0);

  const patternMap = new Map<string, { dependent: string[]; flows: number; series: number }>();
  for (const r of results) {
    if (r.classification !== "dependent-dimensions" || !r.verified) continue;
    const labels = r.verified.map((v) => `${v.dependent}←${v.drivenBy}`).sort();
    const key = labels.join("+");
    const p = patternMap.get(key) ?? { dependent: labels, flows: 0, series: 0 };
    p.flows += 1;
    p.series += r.seriesCount;
    patternMap.set(key, p);
  }

  return {
    flows: results.length,
    exactProduct: results.filter((r) => r.classification === "exact-product").length,
    dependentDimensions: results.filter((r) => r.classification === "dependent-dimensions").length,
    arithmeticCandidates: results.filter((r) => r.classification === "arithmetic-candidate").length,
    unexplained: results.filter((r) => r.classification === "unexplained").length,
    seriesExplainedShare: totalSeries > 0 ? explainedSeries / totalSeries : 0,
    patterns: [...patternMap.values()].sort((a, b) => b.flows - a.flows),
    verifiedFlows,
    verifiedOk,
    results,
  };
}

export function renderSparsityMarkdown(s: SparsitySummary): string {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const out: string[] = [];
  out.push("# Structured sparsity in the ABS Data API");
  out.push("");
  out.push(
    "Is the gap between advertised and real combinations *principled* or *arbitrary*? " +
      "Tested per dataflow against the observed key set.",
  );
  out.push("");
  out.push("| Classification | Flows | Meaning |");
  out.push("| --- | --- | --- |");
  out.push(`| Exact cross-product | ${s.exactProduct} | Every combination of observed options exists |`);
  out.push(
    `| Dependent dimensions (verified) | ${s.dependentDimensions} | Key set is the cross-product once dimensions that are functions of another are removed; each dependency verified against the actual keys (e.g. STATE determined by REGION) |`,
  );
  if (s.arithmeticCandidates > 0) {
    out.push(`| Arithmetic candidate (unverified) | ${s.arithmeticCandidates} | Level-1 divisor match not yet checked against the keys; not counted as explained |`);
  }
  out.push(`| Unexplained | ${s.unexplained} | Sparsity not reducible to a functional dependency — including arithmetic coincidences the level-1 test flagged and level 2 rejected |`);
  out.push("");
  out.push(
    `**${pct(s.seriesExplainedShare)} of all confirmed series** sit in flows whose sparsity is fully explained and verified.`,
  );
  if (s.verifiedFlows > 0) {
    out.push("");
    out.push(
      `Level-2 verification against the actual keys: ${s.verifiedOk} of ${s.verifiedFlows} candidate ` +
        `flows confirmed (every code of some driving dimension maps to exactly one code of the dependent dimension); ` +
        `the remainder were arithmetic coincidences and are counted as unexplained.`,
    );
  }
  out.push("");
  out.push("## Dependent-dimension patterns");
  out.push("");
  out.push(
    "_Only verified dependencies are listed: for each, every code of the driving dimension maps to exactly " +
      "one code of the dependent dimension in the actual key set._",
  );
  out.push("");
  out.push("| Dependency (dependent ← driver) | Flows | Series |");
  out.push("| --- | --- | --- |");
  for (const p of s.patterns.slice(0, 25)) {
    out.push(`| \`${p.dependent.join("` + `")}\` | ${p.flows} | ${p.series.toLocaleString("en-AU")} |`);
  }
  out.push("");
  out.push("## Level-1 inferences rejected at level 2 (largest first)");
  out.push("");
  out.push(
    "_The dimension cardinalities divide the option product down to the exact series count, but no " +
      "single dimension determines the supposedly dependent one in the actual keys — a coincidence._",
  );
  out.push("");
  out.push("| Dataflow | Series | Supposed dependency |");
  out.push("| --- | --- | --- |");
  for (const r of s.results
    .filter((r) => r.classification === "unexplained" && r.verified && r.verified.some((v) => !v.ok))
    .sort((a, b) => b.seriesCount - a.seriesCount)
    .slice(0, 30)) {
    out.push(
      `| \`${r.flowId}\` | ${r.seriesCount.toLocaleString("en-AU")} | ${r.verified!.filter((v) => !v.ok).map((v) => `\`${v.dependent}\``).join(", ")} |`,
    );
  }
  out.push("");
  out.push("## Unexplained flows (largest first)");
  out.push("");
  out.push("| Dataflow | Series | Product of observed options | Fill |");
  out.push("| --- | --- | --- | --- |");
  for (const r of s.results
    .filter((r) => r.classification === "unexplained")
    .sort((a, b) => b.seriesCount - a.seriesCount)
    .slice(0, 30)) {
    out.push(
      `| \`${r.flowId}\` | ${r.seriesCount.toLocaleString("en-AU")} | ${r.observedProduct.toLocaleString("en-AU")} | ${pct(r.fill)} |`,
    );
  }
  out.push("");
  out.push("## Why this matters");
  out.push("");
  out.push(
    "- For ABS: the content constraints are exact per dimension; the implied cross-product fails " +
      "mainly because hierarchical geography is encoded as several dimensions (region, state, region " +
      "type) that are not independent. Declaring the dependency would make the metadata honest.",
  );
  out.push(
    "- For the typed front door: flows classified here as exact-product or dependent-dimensions admit " +
      "exact, compact static types — the valid key set is a cross-product over independent dimensions " +
      "times the code hierarchy for dependent ones.",
  );
  out.push("");
  return out.join("\n");
}
