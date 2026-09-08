/**
 * Derives the declared-vs-observed delta (DESIGN.md decisions 2 and 19).
 *
 * This is the mechanism that keeps the observed store clean while still
 * documenting what ABS's published metadata gets wrong. It reads both halves of
 * the catalogue and writes findings to `delta_finding`; it never writes back
 * into the observed tables, so the truth store cannot be contaminated by a
 * declared claim.
 *
 * Regenerated from scratch on every run — findings are derived, never edited.
 */
import type { Database } from "better-sqlite3";
import { DELTA_FINDING_KINDS, type Severity } from "@abs/schema";

export interface Finding {
  kind: string;
  severity: Severity;
  flowId: string | null;
  dimensionId: string | null;
  summary: string;
  evidence: unknown;
  declaredValue: number | null;
  observedValue: number | null;
}

export interface DeltaOptions {
  runId: string;
  /** Report at most this many per-flow findings of each kind. */
  perKindLimit?: number;
}

export interface DeltaSummary {
  findings: number;
  byKind: Record<string, number>;
  bySeverity: Record<string, number>;
  /** Corpus-level roll-ups quoted in the report narrative. */
  totals: {
    flows: number;
    flowsProbed: number;
    flowsWithData: number;
    flowsEmpty: number;
    declaredKeys: number;
    observedSeries: number;
    overallDensity: number | null;
    endpointsChecked: number;
    endpointsNonConforming: number;
  };
}

export function generateDelta(sqlite: Database, opts: DeltaOptions): DeltaSummary {
  const limit = opts.perKindLimit ?? 500;
  const now = new Date().toISOString();
  const findings: Finding[] = [];

  const all = <T>(sql: string, ...params: unknown[]): T[] =>
    sqlite.prepare(sql).all(...params) as T[];
  const one = <T>(sql: string, ...params: unknown[]): T =>
    sqlite.prepare(sql).get(...params) as T;

  // ------------------------------------------------- endpoint non-conformance
  const checks = all<{
    label: string;
    url: string;
    documented_behaviour: string;
    verdict: string;
    detail: string;
    http_status: number | null;
  }>(
    `SELECT label, url, documented_behaviour, verdict, detail, http_status
     FROM endpoint_check
     WHERE run_id = (SELECT run_id FROM endpoint_check ORDER BY checked_at DESC LIMIT 1)`,
  );

  for (const c of checks) {
    if (c.verdict === "conforms") continue;
    const kind =
      c.verdict === "malformed"
        ? DELTA_FINDING_KINDS.MALFORMED_RESPONSE
        : c.verdict === "missing"
          ? DELTA_FINDING_KINDS.SPEC_DRIFT
          : DELTA_FINDING_KINDS.BROKEN_ENDPOINT;

    findings.push({
      kind,
      // A malformed 200 is worse than an honest 404: it corrupts consumers
      // silently rather than failing loudly.
      severity: c.verdict === "malformed" ? "critical" : "major",
      flowId: null,
      dimensionId: null,
      summary: `${c.label}: ${c.verdict} — ${c.detail}`,
      evidence: {
        url: c.url,
        documented: c.documented_behaviour,
        httpStatus: c.http_status,
        verdict: c.verdict,
      },
      declaredValue: null,
      observedValue: null,
    });
  }

  // ------------------------------------------------- constraint overstatement
  const overstated = all<{
    id: string;
    declared_key_count: number;
    series_count: number;
    density: number;
  }>(
    `SELECT d.id, d.declared_key_count, o.series_count,
            CAST(o.series_count AS REAL) / d.declared_key_count AS density
     FROM declared_flow d
     JOIN observed_flow o ON o.id = d.id
     WHERE d.declared_key_count > 0
       AND o.series_count > 0
       AND CAST(o.series_count AS REAL) / d.declared_key_count < 0.95
     ORDER BY (d.declared_key_count - o.series_count) DESC
     LIMIT ?`,
    limit,
  );

  for (const f of overstated) {
    const factor = f.declared_key_count / f.series_count;
    findings.push({
      kind: DELTA_FINDING_KINDS.CONSTRAINT_OVERSTATEMENT,
      severity: factor >= 10 ? "major" : "minor",
      flowId: f.id,
      dimensionId: null,
      summary:
        `${f.id}: content constraint implies ${f.declared_key_count.toLocaleString()} series, ` +
        `${f.series_count.toLocaleString()} exist (${(f.density * 100).toFixed(1)}% dense, ` +
        `overstated ${factor.toFixed(1)}x)`,
      evidence: {
        declaredKeyCount: f.declared_key_count,
        observedSeries: f.series_count,
        overstatementFactor: Number(factor.toFixed(2)),
        cause:
          "cube region key values are per-dimension marginals, not the set of real key combinations",
      },
      declaredValue: f.declared_key_count,
      observedValue: f.series_count,
    });
  }

  // ------------------------------------------------------------- empty flows
  const empty = all<{ id: string; reason: string | null; http_status: number | null }>(
    `SELECT o.id, p.reason, p.http_status
     FROM observed_flow o
     LEFT JOIN flow_probe p ON p.flow_id = o.id
     WHERE o.series_count = 0
     GROUP BY o.id
     ORDER BY o.id
     LIMIT ?`,
    limit,
  );

  for (const f of empty) {
    findings.push({
      kind: DELTA_FINDING_KINDS.EMPTY_FLOW,
      severity: "major",
      flowId: f.id,
      dimensionId: null,
      summary: `${f.id}: published as a dataflow but serves no data (${f.reason ?? "no rows"})`,
      evidence: { httpStatus: f.http_status, reason: f.reason },
      declaredValue: null,
      observedValue: 0,
    });
  }

  // ------------------------------------------------------- uncategorised flows
  const uncategorised = all<{ id: string }>(
    `SELECT d.id FROM declared_flow d
     LEFT JOIN categorisation c ON c.flow_id = d.id
     WHERE c.flow_id IS NULL ORDER BY d.id`,
  );
  for (const f of uncategorised) {
    findings.push({
      kind: DELTA_FINDING_KINDS.UNCATEGORISED_FLOW,
      severity: "minor",
      flowId: f.id,
      dimensionId: null,
      summary: `${f.id}: present in the dataflow listing but absent from every category scheme`,
      evidence: { note: "not discoverable by topic browsing" },
      declaredValue: null,
      observedValue: null,
    });
  }

  // --------------------------------------------------------- test artefacts
  const testish = all<{ id: string; name: string | null }>(
    `SELECT id, name FROM declared_flow
     WHERE id = 'TEST' OR id LIKE 'TEST/_%' ESCAPE '/' OR id LIKE '%/_TEST' ESCAPE '/'`,
  );
  for (const f of testish) {
    findings.push({
      kind: DELTA_FINDING_KINDS.TEST_ARTEFACT,
      severity: "minor",
      flowId: f.id,
      dimensionId: null,
      summary: `${f.id}: test fixture published in the production dataflow listing`,
      evidence: { name: f.name },
      declaredValue: null,
      observedValue: null,
    });
  }

  // ------------------------------------------------------ declared vs observed codes
  // Codes a constraint declares that appear in no confirmed series. Reported per
  // flow+dimension rather than per code to keep the finding count meaningful.
  const unusedCodes = all<{
    flow_id: string;
    dimension_id: string;
    declared: number;
    observed: number;
  }>(
    `SELECT c.flow_id, v.dimension_id,
            COUNT(DISTINCT v.code_id) AS declared,
            COUNT(DISTINCT o.code_id)  AS observed
     FROM declared_constraint c
     JOIN declared_constraint_value v ON v.constraint_id = c.id
     JOIN observed_flow f ON f.id = c.flow_id AND f.series_count > 0
     LEFT JOIN observed_dimension_code o
            ON o.flow_id = c.flow_id AND o.dimension_id = v.dimension_id AND o.code_id = v.code_id
     GROUP BY c.flow_id, v.dimension_id
     HAVING declared > observed
     ORDER BY (declared - observed) DESC
     LIMIT ?`,
    limit,
  );

  for (const r of unusedCodes) {
    findings.push({
      kind: DELTA_FINDING_KINDS.UNUSED_DECLARED_CODE,
      severity: "minor",
      flowId: r.flow_id,
      dimensionId: r.dimension_id,
      summary:
        `${r.flow_id}.${r.dimension_id}: ${r.declared - r.observed} of ${r.declared} ` +
        `declared codes appear in no confirmed series`,
      evidence: { declaredCodes: r.declared, observedCodes: r.observed },
      declaredValue: r.declared,
      observedValue: r.observed,
    });
  }

  // Codes observed in real data that the constraint never declared. This is the
  // more serious direction: consumers trusting the constraint would miss them.
  const undeclared = all<{
    flow_id: string;
    dimension_id: string;
    n: number;
  }>(
    `SELECT o.flow_id, o.dimension_id, COUNT(*) AS n
     FROM observed_dimension_code o
     WHERE NOT EXISTS (
       SELECT 1 FROM declared_constraint c
       JOIN declared_constraint_value v ON v.constraint_id = c.id
       WHERE c.flow_id = o.flow_id AND v.dimension_id = o.dimension_id AND v.code_id = o.code_id
     )
     AND EXISTS (SELECT 1 FROM declared_constraint c2 WHERE c2.flow_id = o.flow_id)
     GROUP BY o.flow_id, o.dimension_id
     ORDER BY n DESC
     LIMIT ?`,
    limit,
  );

  for (const r of undeclared) {
    findings.push({
      kind: DELTA_FINDING_KINDS.UNDECLARED_OBSERVED_CODE,
      severity: "major",
      flowId: r.flow_id,
      dimensionId: r.dimension_id,
      summary:
        `${r.flow_id}.${r.dimension_id}: ${r.n} code(s) present in real data but absent ` +
        `from the content constraint`,
      evidence: { undeclaredCodeCount: r.n },
      declaredValue: null,
      observedValue: r.n,
    });
  }

  // --------------------------------------------------- metadata inconsistencies
  const casing = all<{ variants: number }>(
    `SELECT COUNT(DISTINCT type) AS variants FROM code_annotation WHERE UPPER(type) = 'ORDER'`,
  );
  const rawCasing = one<{ n: number }>(
    `SELECT COUNT(*) AS n FROM code_annotation WHERE type = 'ORDER'`,
  );
  if ((casing[0]?.variants ?? 0) >= 1 && rawCasing.n > 0) {
    // The crawler normalises to upper case on ingest; the finding records that
    // the upstream payload is inconsistent.
    findings.push({
      kind: DELTA_FINDING_KINDS.METADATA_INCONSISTENCY,
      severity: "minor",
      flowId: null,
      dimensionId: null,
      summary:
        "Code annotation type casing is inconsistent upstream: both ORDER and order are emitted",
      evidence: {
        note: "normalised to upper case on ingest; consumers matching case-sensitively will miss some",
      },
      declaredValue: null,
      observedValue: null,
    });
  }

  const flowsWithoutDims = all<{ id: string }>(
    `SELECT d.id FROM declared_flow d
     LEFT JOIN declared_dimension dd ON dd.flow_id = d.id
     WHERE dd.flow_id IS NULL ORDER BY d.id LIMIT ?`,
    limit,
  );
  for (const f of flowsWithoutDims) {
    findings.push({
      kind: DELTA_FINDING_KINDS.METADATA_INCONSISTENCY,
      severity: "major",
      flowId: f.id,
      dimensionId: null,
      summary: `${f.id}: no dimensions resolvable from its data structure definition`,
      evidence: { note: "flow cannot be queried without a dimension order" },
      declaredValue: null,
      observedValue: null,
    });
  }

  // ------------------------------------------------------------------- persist
  sqlite.prepare(`DELETE FROM delta_finding WHERE run_id = ?`).run(opts.runId);
  const insert = sqlite.prepare(
    `INSERT INTO delta_finding
       (run_id, kind, severity, flow_id, dimension_id, summary, evidence,
        declared_value, observed_value, detected_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  sqlite.transaction(() => {
    for (const f of findings) {
      insert.run(
        opts.runId,
        f.kind,
        f.severity,
        f.flowId,
        f.dimensionId,
        f.summary,
        JSON.stringify(f.evidence),
        f.declaredValue,
        f.observedValue,
        now,
      );
    }
  })();

  // -------------------------------------------------------------------- totals
  const t = one<{
    flows: number;
    declared_keys: number;
  }>(`SELECT COUNT(*) AS flows, COALESCE(SUM(declared_key_count),0) AS declared_keys FROM declared_flow`);

  const o = one<{
    probed: number;
    with_data: number;
    empty: number;
    series: number;
  }>(
    `SELECT COUNT(*) AS probed,
            SUM(CASE WHEN series_count > 0 THEN 1 ELSE 0 END) AS with_data,
            SUM(CASE WHEN series_count = 0 THEN 1 ELSE 0 END) AS empty,
            COALESCE(SUM(series_count),0) AS series
     FROM observed_flow`,
  );

  const byKind: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  for (const f of findings) {
    byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;
    bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
  }

  return {
    findings: findings.length,
    byKind,
    bySeverity,
    totals: {
      flows: t.flows,
      flowsProbed: o.probed ?? 0,
      flowsWithData: o.with_data ?? 0,
      flowsEmpty: o.empty ?? 0,
      declaredKeys: t.declared_keys,
      observedSeries: o.series ?? 0,
      overallDensity:
        t.declared_keys > 0 && (o.series ?? 0) > 0 ? (o.series ?? 0) / t.declared_keys : null,
      endpointsChecked: checks.length,
      endpointsNonConforming: checks.filter((c) => c.verdict !== "conforms").length,
    },
  };
}
