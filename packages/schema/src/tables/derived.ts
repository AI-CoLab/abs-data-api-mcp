/**
 * DERIVED findings — the declared-vs-observed delta.
 *
 * Regenerated from scratch on every crawl and never hand-edited. This is the
 * mechanism that keeps the observed store clean while still documenting what
 * ABS's published metadata gets wrong (DESIGN.md decisions 2 and 19).
 */
import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";

/**
 * A single defect or discrepancy. `kind` is a stable machine-readable slug so
 * the report and the artifact can group findings without string matching on
 * prose.
 */
export const deltaFinding = sqliteTable(
  "delta_finding",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: text("run_id").notNull(),
    /** See DELTA_FINDING_KINDS. */
    kind: text("kind").notNull(),
    /** "critical" | "major" | "minor" | "info". */
    severity: text("severity").notNull(),
    /** Nullable: endpoint-level findings are not flow-specific. */
    flowId: text("flow_id"),
    dimensionId: text("dimension_id"),
    summary: text("summary").notNull(),
    /** Structured evidence: counts, URLs, HTTP statuses, response excerpts. */
    evidence: text("evidence", { mode: "json" }),
    declaredValue: real("declared_value"),
    observedValue: real("observed_value"),
    detectedAt: text("detected_at").notNull(),
  },
  (t) => [
    index("delta_finding_kind_idx").on(t.kind),
    index("delta_finding_flow_idx").on(t.flowId),
    index("delta_finding_severity_idx").on(t.severity),
  ],
);

/**
 * Endpoint-level conformance results: does the documented surface actually
 * behave as the user guide and OpenAPI spec claim?
 */
export const endpointCheck = sqliteTable(
  "endpoint_check",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: text("run_id").notNull(),
    /** What the docs/spec say this should be. */
    label: text("label").notNull(),
    url: text("url").notNull(),
    documentedBehaviour: text("documented_behaviour").notNull(),
    httpStatus: integer("http_status"),
    /** "conforms" | "broken" | "missing" | "timeout" | "malformed". */
    verdict: text("verdict").notNull(),
    detail: text("detail"),
    durationMs: integer("duration_ms"),
    checkedAt: text("checked_at").notNull(),
  },
  (t) => [index("endpoint_check_verdict_idx").on(t.verdict)],
);

export const DELTA_FINDING_KINDS = {
  /** Declared constraint marginals imply far more series than exist. */
  CONSTRAINT_OVERSTATEMENT: "constraint-overstatement",
  /** Flow is published but serves no data at all. */
  EMPTY_FLOW: "empty-flow",
  /** Flow exists in the dataflow listing but has no categorisation. */
  UNCATEGORISED_FLOW: "uncategorised-flow",
  /** A documented endpoint that does not work. */
  BROKEN_ENDPOINT: "broken-endpoint",
  /** A response that parsed as the wrong shape, e.g. serieskeysonly. */
  MALFORMED_RESPONSE: "malformed-response",
  /** A code declared in a constraint that appears in no observed series. */
  UNUSED_DECLARED_CODE: "unused-declared-code",
  /** A code observed in data but absent from the declared constraint. */
  UNDECLARED_OBSERVED_CODE: "undeclared-observed-code",
  /** Metadata inconsistency, e.g. both ORDER and order annotation types. */
  METADATA_INCONSISTENCY: "metadata-inconsistency",
  /**
   * Positive corpus-level finding: declared per-dimension marginals match
   * observed exactly (no unused declared codes, no undeclared observed codes),
   * so the entire availability overstatement is combinatorial. Doubles as an
   * independent completeness check on the crawl.
   */
  MARGINALS_EXACT: "marginals-exact",
  /** OpenAPI spec omits a parameter that works, or lists one that does not. */
  SPEC_DRIFT: "spec-drift",
  /** Flow named or shaped like a test fixture in production. */
  TEST_ARTEFACT: "test-artefact",
} as const;

export type DeltaFindingKind = (typeof DELTA_FINDING_KINDS)[keyof typeof DELTA_FINDING_KINDS];

export const SEVERITIES = ["critical", "major", "minor", "info"] as const;
export type Severity = (typeof SEVERITIES)[number];
