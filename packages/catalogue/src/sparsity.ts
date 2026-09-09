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
 *  2. Verification against the key index for a bounded sample: for an inferred
 *     dependent dimension, every code of the driving dimension must co-occur
 *     with exactly one code of the dependent one.
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
  classification: "exact-product" | "dependent-dimensions" | "unexplained";
  /** Dimensions inferred to be functions of others (level 1). */
  dependentDimensions: string[];
  /** Level-2 result when verified: driving dimension per dependent one. */
  verified?: Array<{ dependent: string; drivenBy: string; ok: boolean }> | undefined;
}

export interface SparsitySummary {
  flows: number;
  exactProduct: number;
  dependentDimensions: number;
  unexplained: number;
  /** Series explained by levels 0+1, as a share of all series. */
  seriesExplainedShare: number;
  /** How often each dependent-dimension pattern occurs. */
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
        entry.classification = "dependent-dimensions";
        entry.dependentDimensions = found;
      }
    }

    results.push(entry);
  }

  // Level 2: verify functional dependency on the key index for a bounded set.
  const verifyUpTo = opts.verifyUpToSeries ?? 2_000_000;
  const verifyMax = opts.verifyMaxFlows ?? 40;
  const candidates = results
    .filter((r) => r.classification === "dependent-dimensions" && r.seriesCount <= verifyUpTo)
    .sort((a, b) => b.seriesCount - a.seriesCount)
    .slice(0, verifyMax);

  // For a dependent dimension D driven by dimension X: the number of distinct
  // (X, D) pairs must equal the number of distinct X codes.
  const pairStmt = sqlite.prepare(
    `SELECT COUNT(*) AS pairs FROM (
       SELECT DISTINCT x.code_id AS xc, d.code_id AS dc
       FROM series s
       JOIN series_key_value x ON x.series_id = s.id AND x.dimension_id = ?
       JOIN series_key_value d ON d.series_id = s.id AND d.dimension_id = ?
       WHERE s.flow_id = ?
     )`,
  );

  let verifiedFlows = 0;
  let verifiedOk = 0;
  for (const r of candidates) {
    const checks: NonNullable<FlowSparsity["verified"]> = [];
    for (const dep of r.dependentDimensions) {
      // The driver is the highest-cardinality non-dependent dimension: in the
      // geography case, the region code determines state and region type.
      const driver = r.dimensions.find((d) => !r.dependentDimensions.includes(d.id));
      if (!driver) continue;
      const pairs = (pairStmt.get(driver.id, dep, r.flowId) as { pairs: number }).pairs;
      checks.push({ dependent: dep, drivenBy: driver.id, ok: pairs === driver.cardinality });
    }
    r.verified = checks;
    verifiedFlows += 1;
    if (checks.length > 0 && checks.every((c) => c.ok)) verifiedOk += 1;
    log(
      `  verified ${r.flowId}: ${checks.map((c) => `${c.dependent}←${c.drivenBy}:${c.ok ? "ok" : "FAIL"}`).join(" ")}`,
    );
  }

  const totalSeries = results.reduce((n, r) => n + r.seriesCount, 0);
  const explainedSeries = results
    .filter((r) => r.classification !== "unexplained")
    .reduce((n, r) => n + r.seriesCount, 0);

  const patternMap = new Map<string, { dependent: string[]; flows: number; series: number }>();
  for (const r of results) {
    if (r.classification !== "dependent-dimensions") continue;
    const key = [...r.dependentDimensions].sort().join("+");
    const p = patternMap.get(key) ?? { dependent: [...r.dependentDimensions].sort(), flows: 0, series: 0 };
    p.flows += 1;
    p.series += r.seriesCount;
    patternMap.set(key, p);
  }

  return {
    flows: results.length,
    exactProduct: results.filter((r) => r.classification === "exact-product").length,
    dependentDimensions: results.filter((r) => r.classification === "dependent-dimensions").length,
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
    `| Dependent dimensions | ${s.dependentDimensions} | Key set is the cross-product once dimensions that are functions of another are removed (e.g. STATE determined by REGION) |`,
  );
  out.push(`| Unexplained | ${s.unexplained} | Sparsity not reducible to a rule at this depth |`);
  out.push("");
  out.push(
    `**${pct(s.seriesExplainedShare)} of all confirmed series** sit in flows whose sparsity is fully explained by levels 0–1.`,
  );
  if (s.verifiedFlows > 0) {
    out.push("");
    out.push(
      `Level-2 verification against the key index: ${s.verifiedOk} of ${s.verifiedFlows} sampled ` +
        `dependent-dimension flows confirmed (each driving code maps to exactly one dependent code).`,
    );
  }
  out.push("");
  out.push("## Dependent-dimension patterns");
  out.push("");
  out.push("| Dependent dimension(s) | Flows | Series |");
  out.push("| --- | --- | --- |");
  for (const p of s.patterns.slice(0, 25)) {
    out.push(`| \`${p.dependent.join("` + `")}\` | ${p.flows} | ${p.series.toLocaleString("en-AU")} |`);
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
