/**
 * Renders the delta report: Markdown for people, JSON for machines.
 *
 * This is the artefact intended for ABS (api.data@abs.gov.au). It states the
 * documented behaviour, what actually happens, and the evidence, so each item
 * is actionable without needing this repo.
 */
import type { Database } from "better-sqlite3";
import type { DeltaSummary } from "./delta.ts";

export interface ReportInputs {
  runId: string;
  generatedAt: string;
  summary: DeltaSummary;
}

interface FindingRow {
  kind: string;
  severity: string;
  flow_id: string | null;
  dimension_id: string | null;
  summary: string;
  evidence: string | null;
  declared_value: number | null;
  observed_value: number | null;
}

const SEVERITY_ORDER = ["critical", "major", "minor", "info"] as const;

const KIND_TITLES: Record<string, string> = {
  "malformed-response": "Malformed responses (HTTP 200 with an invalid body)",
  "broken-endpoint": "Documented endpoints that do not work",
  "spec-drift": "Specification drift (documented but absent)",
  "constraint-overstatement": "Content constraints overstate availability",
  "empty-flow": "Dataflows that serve no data",
  "uncategorised-flow": "Dataflows missing from the topic tree",
  "unused-declared-code": "Declared codes that appear in no real series",
  "undeclared-observed-code": "Real codes missing from the content constraint",
  "metadata-inconsistency": "Metadata inconsistencies",
  "test-artefact": "Test fixtures in production",
};

export function buildJsonReport(sqlite: Database, inputs: ReportInputs): unknown {
  const findings = sqlite
    .prepare(
      `SELECT kind, severity, flow_id, dimension_id, summary, evidence,
              declared_value, observed_value
       FROM delta_finding WHERE run_id = ?
       ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'major' THEN 1
                              WHEN 'minor' THEN 2 ELSE 3 END, kind, flow_id`,
    )
    .all(inputs.runId) as FindingRow[];

  const endpoints = sqlite
    .prepare(
      `SELECT label, url, documented_behaviour, http_status, verdict, detail, duration_ms
       FROM endpoint_check
       WHERE run_id = (SELECT run_id FROM endpoint_check ORDER BY checked_at DESC LIMIT 1)
       ORDER BY CASE verdict WHEN 'conforms' THEN 1 ELSE 0 END, label`,
    )
    .all() as Array<Record<string, unknown>>;

  return {
    report: "ABS Data API — declared vs observed delta",
    generatedAt: inputs.generatedAt,
    runId: inputs.runId,
    method:
      "Declared metadata was read from the ABS structure endpoints. Observed availability was " +
      "established by pulling data (detail=serieskeysonly is broken). Only empirically-confirmed " +
      "series are treated as real; this report is the derived difference between the two.",
    totals: inputs.summary.totals,
    findingCounts: { byKind: inputs.summary.byKind, bySeverity: inputs.summary.bySeverity },
    endpointConformance: endpoints,
    findings: findings.map((f) => ({
      kind: f.kind,
      severity: f.severity,
      flowId: f.flow_id,
      dimensionId: f.dimension_id,
      summary: f.summary,
      declaredValue: f.declared_value,
      observedValue: f.observed_value,
      evidence: f.evidence ? (JSON.parse(f.evidence) as unknown) : null,
    })),
  };
}

export function buildMarkdownReport(sqlite: Database, inputs: ReportInputs): string {
  const { summary } = inputs;
  const t = summary.totals;

  const findings = sqlite
    .prepare(
      `SELECT kind, severity, flow_id, dimension_id, summary, evidence,
              declared_value, observed_value
       FROM delta_finding WHERE run_id = ?`,
    )
    .all(inputs.runId) as FindingRow[];

  const endpoints = sqlite
    .prepare(
      `SELECT label, url, documented_behaviour, http_status, verdict, detail
       FROM endpoint_check
       WHERE run_id = (SELECT run_id FROM endpoint_check ORDER BY checked_at DESC LIMIT 1)
       ORDER BY CASE verdict WHEN 'conforms' THEN 1 ELSE 0 END, label`,
    )
    .all() as Array<{
    label: string;
    url: string;
    documented_behaviour: string;
    http_status: number | null;
    verdict: string;
    detail: string;
  }>;

  const out: string[] = [];
  const pct = (n: number | null) => (n === null ? "n/a" : `${(n * 100).toFixed(2)}%`);
  const num = (n: number) => n.toLocaleString("en-AU");

  out.push("# ABS Data API — declared vs observed");
  out.push("");
  out.push(`Generated ${inputs.generatedAt} (run \`${inputs.runId}\`).`);
  out.push("");
  out.push(
    "This report is derived automatically. Declared metadata comes from the ABS structure " +
      "endpoints; observed availability was established by pulling data, because " +
      "`detail=serieskeysonly` does not work. Only empirically-confirmed series are treated as " +
      "real, and this document is the difference between the two.",
  );
  out.push("");

  out.push("## Corpus");
  out.push("");
  out.push("| Measure | Value |");
  out.push("| --- | --- |");
  out.push(`| Dataflows published | ${num(t.flows)} |`);
  out.push(`| Dataflows probed | ${num(t.flowsProbed)} |`);
  out.push(`| Dataflows serving data | ${num(t.flowsWithData)} |`);
  out.push(`| Dataflows serving nothing | ${num(t.flowsEmpty)} |`);
  out.push(`| Series implied by content constraints | ${num(t.declaredKeys)} |`);
  out.push(`| Series that actually exist | ${num(t.observedSeries)} |`);
  out.push(`| Overall density | ${pct(t.overallDensity)} |`);
  out.push(
    `| Documented behaviours checked | ${num(t.endpointsChecked)} (${num(t.endpointsNonConforming)} non-conforming) |`,
  );
  out.push("");

  if (t.overallDensity !== null && t.overallDensity < 0.95) {
    const factor = 1 / t.overallDensity;
    out.push(
      `> Content constraints overstate the size of the corpus by roughly **${factor.toFixed(1)}x**. ` +
        "The cube regions published for each dataflow are per-dimension marginals, not the set of " +
        "real key combinations, so multiplying them out does not describe what can be retrieved.",
    );
    out.push("");
  }

  out.push("## Endpoint conformance");
  out.push("");
  out.push("| Endpoint | Verdict | HTTP | Documented behaviour | Observed |");
  out.push("| --- | --- | --- | --- | --- |");
  for (const e of endpoints) {
    out.push(
      `| ${e.label} | ${e.verdict === "conforms" ? "ok" : `**${e.verdict}**`} | ` +
        `${e.http_status ?? "—"} | ${e.documented_behaviour} | ${e.detail.replace(/\|/g, "\\|")} |`,
    );
  }
  out.push("");

  out.push("## Findings");
  out.push("");
  const byKind = new Map<string, FindingRow[]>();
  for (const f of findings) {
    const list = byKind.get(f.kind);
    if (list) list.push(f);
    else byKind.set(f.kind, [f]);
  }

  const kinds = [...byKind.keys()].sort((a, b) => {
    const sevA = SEVERITY_ORDER.indexOf(
      (byKind.get(a)?.[0]?.severity ?? "info") as (typeof SEVERITY_ORDER)[number],
    );
    const sevB = SEVERITY_ORDER.indexOf(
      (byKind.get(b)?.[0]?.severity ?? "info") as (typeof SEVERITY_ORDER)[number],
    );
    return sevA - sevB || a.localeCompare(b);
  });

  for (const kind of kinds) {
    const rows = byKind.get(kind) ?? [];
    out.push(`### ${KIND_TITLES[kind] ?? kind} (${num(rows.length)})`);
    out.push("");

    // Endpoint-level findings read as prose; per-flow findings as a table.
    const flowScoped = rows.filter((r) => r.flow_id !== null);
    if (flowScoped.length === 0) {
      for (const r of rows) out.push(`- ${r.summary}`);
      out.push("");
      continue;
    }

    const shown = flowScoped
      .sort((a, b) => (b.declared_value ?? 0) - (a.declared_value ?? 0))
      .slice(0, 25);

    out.push("| Dataflow | Declared | Observed | Detail |");
    out.push("| --- | --- | --- | --- |");
    for (const r of shown) {
      out.push(
        `| \`${r.flow_id}\`${r.dimension_id ? `.${r.dimension_id}` : ""} | ` +
          `${r.declared_value === null ? "—" : num(r.declared_value)} | ` +
          `${r.observed_value === null ? "—" : num(r.observed_value)} | ${r.summary} |`,
      );
    }
    if (flowScoped.length > shown.length) {
      out.push("");
      out.push(`_${num(flowScoped.length - shown.length)} further ${kind} findings in the JSON._`);
    }
    out.push("");
  }

  out.push("## Method");
  out.push("");
  out.push(
    "- Structural metadata: seven bulk requests against `dataflow`, `datastructure`, " +
      "`contentconstraint`, `codelist`, `conceptscheme`, `categoryscheme` and `categorisation`.",
  );
  out.push(
    "- Observed availability: per dataflow, `lastNObservations=1` to enumerate real series keys " +
      "and `firstNObservations=1` to establish coverage start. Oversized responses are split " +
      "recursively along the highest-cardinality dimension.",
  );
  out.push(
    "- Payload sizing: `Range: bytes=0-0`, which returns the full length in `Content-Range` " +
      "without transferring the body.",
  );
  out.push(
    "- Raw responses are archived gzipped, so every figure here is reproducible from the " +
      "captured payloads.",
  );
  out.push("");

  return out.join("\n");
}
