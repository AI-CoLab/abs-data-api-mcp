/**
 * OBSERVED data — the canonical truth. Only empirically-confirmed series.
 *
 * Every row here is backed by an actual ABS response in which the series was
 * present. Nothing is inferred from declared metadata. This is the only half of
 * the catalogue the MCP front door is allowed to answer availability from.
 *
 * `detail=serieskeysonly` is broken upstream (malformed JSON; CSV returns a
 * header row only), so keys are established by pulling data: a
 * lastNObservations=1 pass and a firstNObservations=1 pass per flow.
 */
import { sqliteTable, text, integer, real, index, primaryKey, unique } from "drizzle-orm/sqlite-core";

/** One row per crawl execution, so results are attributable and resumable. */
export const probeRun = sqliteTable("probe_run", {
  id: text("id").primaryKey(),
  /** "structural" | "probe". */
  kind: text("kind").notNull(),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  /** "running" | "complete" | "failed" | "interrupted". */
  status: text("status").notNull(),
  flowsAttempted: integer("flows_attempted").notNull().default(0),
  flowsSucceeded: integer("flows_succeeded").notNull().default(0),
  notes: text("notes"),
});

/**
 * Per-flow probe outcome. Flows that exist structurally but serve no data are
 * recorded here with status "empty" (DESIGN.md decision 5) so they feed the
 * delta report, and are excluded from the MCP surface.
 */
export const flowProbe = sqliteTable(
  "flow_probe",
  {
    flowId: text("flow_id").notNull(),
    runId: text("run_id")
      .notNull()
      .references(() => probeRun.id),
    /** "ok" | "empty" | "partial" | "error" | "skipped". */
    status: text("status").notNull(),
    reason: text("reason"),
    httpStatus: integer("http_status"),
    seriesFound: integer("series_found").notNull().default(0),
    /** Wire bytes received (gzipped where the server compressed). */
    bytesReceived: integer("bytes_received"),
    /** How many recursive dimension splits were needed to complete this flow. */
    splitDepth: integer("split_depth").notNull().default(0),
    /** Number of HTTP requests this flow's probe consumed. */
    requestCount: integer("request_count").notNull().default(1),
    durationMs: integer("duration_ms"),
    fetchedAt: text("fetched_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.flowId, t.runId] }),
    index("flow_probe_status_idx").on(t.status),
  ],
);

/**
 * Exact payload size per flow per pass, measured with a `Range: bytes=0-0`
 * request: the server reports the full length in Content-Range while sending
 * one byte, so the whole corpus can be sized at near-zero bandwidth.
 *
 * Used to plan the probe — total volume, which flows need splitting, and which
 * are confirmed-empty before any bulk download happens.
 */
export const flowPayloadSize = sqliteTable(
  "flow_payload_size",
  {
    flowId: text("flow_id").notNull(),
    runId: text("run_id").notNull(),
    /** "last" | "first" | "full". */
    pass: text("pass").notNull(),
    httpStatus: integer("http_status"),
    /** Length of the identity (uncompressed) representation, in bytes. */
    totalBytes: integer("total_bytes"),
    /** Rough series estimate: totalBytes / mean row width. */
    estimatedSeries: integer("estimated_series"),
    durationMs: integer("duration_ms"),
    measuredAt: text("measured_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.flowId, t.runId, t.pass] }),
    index("flow_payload_size_bytes_idx").on(t.totalBytes),
  ],
);

/**
 * Canonical flow record, derived from probing rather than from ABS's dataflow
 * listing. `seriesCount` of 0 means confirmed-empty, not unknown.
 */
export const observedFlow = sqliteTable(
  "observed_flow",
  {
    id: text("id").primaryKey(),
    agencyId: text("agency_id").notNull(),
    version: text("version").notNull(),
    name: text("name"),
    seriesCount: integer("series_count").notNull().default(0),
    /** Distinct frequencies actually present, comma-joined (e.g. "M,Q"). */
    frequencies: text("frequencies"),
    earliestPeriod: text("earliest_period"),
    latestPeriod: text("latest_period"),
    /** observed / declared key count. NULL when no declared constraint exists. */
    densityRatio: real("density_ratio"),
    /** False for confirmed-empty flows: they are catalogued but not served. */
    mcpEligible: integer("mcp_eligible", { mode: "boolean" }).notNull().default(false),
    lastProbedAt: text("last_probed_at"),
  },
  (t) => [index("observed_flow_eligible_idx").on(t.mcpEligible)],
);

/**
 * A confirmed series. `keyString` is the ABS dataKey in dimension order
 * (e.g. "1.10001.10.50.Q") and is directly usable to build a working API URL.
 *
 * Observation counts: a two-pass probe yields exact first/last periods but NOT
 * true observation counts, which would require full history. `derivedObsCount`
 * is computed from frequency and extent and is exact only for gap-free series;
 * `actualObsCount` stays NULL unless a full pull has been done.
 */
export const series = sqliteTable(
  "series",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    flowId: text("flow_id")
      .notNull()
      .references(() => observedFlow.id),
    keyString: text("key_string").notNull(),
    freq: text("freq"),
    firstPeriod: text("first_period"),
    lastPeriod: text("last_period"),
    derivedObsCount: integer("derived_obs_count"),
    actualObsCount: integer("actual_obs_count"),
    firstSeenRunId: text("first_seen_run_id"),
    lastSeenRunId: text("last_seen_run_id"),
  },
  (t) => [
    unique("series_flow_key_uq").on(t.flowId, t.keyString),
    index("series_flow_idx").on(t.flowId),
  ],
);

/**
 * Normalised key components: ~6 rows per series.
 *
 * At an estimated 20-100M series this is 150-600M rows and will NOT fit D1's
 * 10GB ceiling. That is a known, deliberately deferred optimisation
 * (DESIGN.md decision 7a) — the local SQLite build carries it in full, and the
 * encoding for D1 is chosen later once the real row count is known.
 */
export const seriesKeyValue = sqliteTable(
  "series_key_value",
  {
    seriesId: integer("series_id")
      .notNull()
      .references(() => series.id),
    dimensionId: text("dimension_id").notNull(),
    codeId: text("code_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.seriesId, t.dimensionId] }),
    index("series_key_value_lookup_idx").on(t.dimensionId, t.codeId),
  ],
);

/** Attribute values actually present on observed series (UNIT_MEASURE, UNIT_MULT, ...). */
export const seriesAttribute = sqliteTable(
  "series_attribute",
  {
    seriesId: integer("series_id")
      .notNull()
      .references(() => series.id),
    attributeId: text("attribute_id").notNull(),
    value: text("value"),
  },
  (t) => [primaryKey({ columns: [t.seriesId, t.attributeId] })],
);

/**
 * Observed per-dimension code sets, derived from confirmed series only.
 *
 * This is NOT the same thing as a declared content constraint: every code here
 * appears in at least one series that actually exists. It makes capability
 * questions ("which flows carry SA2 geography?") cheap without scanning keys.
 */
export const observedDimensionCode = sqliteTable(
  "observed_dimension_code",
  {
    flowId: text("flow_id")
      .notNull()
      .references(() => observedFlow.id),
    dimensionId: text("dimension_id").notNull(),
    codeId: text("code_id").notNull(),
    seriesCount: integer("series_count").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.flowId, t.dimensionId, t.codeId] }),
    index("observed_dimension_code_reverse_idx").on(t.dimensionId, t.codeId),
  ],
);

/**
 * Weekly refresh checks (decision 28), run daily on a rotating slice of flows
 * from the Worker. Each run diffs the live dataflow listing against
 * declared_flow and compares the live availableconstraint marginals with the
 * observed ones for its slice — which section 2.10 showed should agree exactly,
 * so any divergence means ABS changed something and the flow needs re-probing.
 */
export const refreshCheck = sqliteTable(
  "refresh_check",
  {
    id: text("id").primaryKey(),
    checkedAt: text("checked_at").notNull(),
    /** Which of the rotating slices this run covered (0..slices-1). */
    slice: integer("slice").notNull(),
    slices: integer("slices").notNull(),
    flowsListed: integer("flows_listed").notNull(),
    flowsChecked: integer("flows_checked").notNull(),
    /** JSON arrays of flow ids. */
    newFlows: text("new_flows", { mode: "json" }).notNull(),
    removedFlows: text("removed_flows", { mode: "json" }).notNull(),
    reversionedFlows: text("reversioned_flows", { mode: "json" }).notNull(),
    /** JSON: [{ flow, dimension, observed, live }] where live marginals differ. */
    marginalChanges: text("marginal_changes", { mode: "json" }).notNull(),
    /** JSON: flows whose live check failed (upstream error), for retry. */
    errors: text("errors", { mode: "json" }).notNull(),
    durationMs: integer("duration_ms").notNull(),
    /** "clean" | "changes" | "errors". */
    status: text("status").notNull(),
  },
  (t) => [index("refresh_check_time_idx").on(t.checkedAt)],
);

/**
 * Census factorisation (DESIGN.md decision 4). ~558 of 1,227 flows are the same
 * tables replicated across nine geography levels, so the catalogue presents
 * "G01 x 9 geographies" rather than 558 unrelated rows. Every member is still
 * probed independently.
 */
export const flowFamily = sqliteTable("flow_family", {
  id: text("id").primaryKey(),
  /** e.g. "C21_G01" — the census table, independent of geography. */
  tableCode: text("table_code").notNull(),
  label: text("label"),
  memberCount: integer("member_count").notNull().default(0),
});

export const flowFamilyMember = sqliteTable(
  "flow_family_member",
  {
    familyId: text("family_id")
      .notNull()
      .references(() => flowFamily.id),
    flowId: text("flow_id").notNull(),
    /** e.g. "LGA", "SA2", "POA", "ASGS". */
    geographyLevel: text("geography_level"),
  },
  (t) => [
    primaryKey({ columns: [t.familyId, t.flowId] }),
    index("flow_family_member_flow_idx").on(t.flowId),
  ],
);
