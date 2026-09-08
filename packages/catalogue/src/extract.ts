/**
 * Extracts the catalogue into a compact payload for the browsable artifact.
 *
 * The artifact is search-first (DESIGN.md decision 18), so the payload has to
 * carry enough vocabulary to search offline while staying inside the 16MB page
 * limit. Measured against the real catalogue:
 *
 *   flows (1,227)                    ~0.22MB
 *   dimensions (7,944)               ~0.56MB
 *   codes in codelists <=5,000       ~3.7MB   covers 491 of 497 (98.8%)
 *
 * The six excluded codelists are the giant geography and SEIFA lists
 * (CL_ASGS_SA1_2021 alone has 61,845 codes); those are searched live instead.
 *
 * Encoding is columnar and id-interned rather than an array of objects, which
 * roughly halves the JSON for the same content.
 */
import type { Database } from "better-sqlite3";

/** Codelists at or below this size are embedded whole. */
export const EMBED_CODELIST_MAX = 5_000;

export interface ArtifactPayload {
  generatedAt: string;
  totals: {
    flows: number;
    flowsWithData: number;
    flowsEmpty: number;
    flowsUnprobed: number;
    declaredKeys: number;
    observedSeries: number;
    codelists: number;
    codes: number;
    embeddedCodelists: number;
    embeddedCodes: number;
    families: number;
    findings: number;
  };
  /** Interned codelist ids, referenced by index from dimensions. */
  codelistIds: string[];
  codelists: Array<{
    /** index into codelistIds */
    i: number;
    name: string | null;
    size: number;
    /** true when codes are embedded below */
    embedded: boolean;
  }>;
  /** codelistIndex -> [codeId, name, parentCodeId|null][] */
  codes: Record<string, Array<[string, string | null, string | null]>>;
  flows: Array<{
    id: string;
    name: string | null;
    /** observed series count; null when not yet probed */
    series: number | null;
    declared: number | null;
    density: number | null;
    freqs: string | null;
    from: string | null;
    to: string | null;
    /** probe status: ok | empty | partial | error | unprobed */
    status: string;
    categories: string[];
    family: string | null;
    geography: string | null;
    /** [dimensionId, position, codelistIndex|-1, declaredCodelistSize] */
    dims: Array<[string, number, number, number | null]>;
  }>;
  families: Array<{ id: string; members: Array<[string, string | null]> }>;
  findings: Array<{
    kind: string;
    severity: string;
    flowId: string | null;
    summary: string;
  }>;
  endpoints: Array<{
    label: string;
    verdict: string;
    httpStatus: number | null;
    documented: string;
    detail: string;
  }>;
}

export function extractPayload(sqlite: Database): ArtifactPayload {
  const all = <T>(sql: string, ...p: unknown[]): T[] => sqlite.prepare(sql).all(...p) as T[];
  const one = <T>(sql: string, ...p: unknown[]): T => sqlite.prepare(sql).get(...p) as T;

  // ------------------------------------------------------------- codelists
  const usedCodelists = all<{ id: string; name: string | null; code_count: number }>(
    `SELECT c.id, c.name, c.code_count FROM codelist c
     WHERE c.id IN (SELECT DISTINCT codelist_id FROM declared_dimension WHERE codelist_id IS NOT NULL)
     ORDER BY c.id`,
  );

  const codelistIds = usedCodelists.map((c) => c.id);
  const codelistIndex = new Map(codelistIds.map((id, i) => [id, i] as const));

  const codes: ArtifactPayload["codes"] = {};
  let embeddedCodelists = 0;
  let embeddedCodes = 0;

  const codeStmt = sqlite.prepare(
    `SELECT code_id, name, parent_code_id FROM code WHERE codelist_id = ?
     ORDER BY COALESCE(sort_order, 999999), code_id`,
  );

  for (const cl of usedCodelists) {
    if (cl.code_count > EMBED_CODELIST_MAX) continue;
    const rows = codeStmt.all(cl.id) as Array<{
      code_id: string;
      name: string | null;
      parent_code_id: string | null;
    }>;
    const idx = codelistIndex.get(cl.id);
    if (idx === undefined) continue;
    codes[String(idx)] = rows.map((r) => [r.code_id, r.name, r.parent_code_id]);
    embeddedCodelists += 1;
    embeddedCodes += rows.length;
  }

  // ----------------------------------------------------------------- flows
  const flowRows = all<{
    id: string;
    name: string | null;
    declared_key_count: number | null;
    series_count: number | null;
    density_ratio: number | null;
    frequencies: string | null;
    earliest_period: string | null;
    latest_period: string | null;
    probe_status: string | null;
  }>(
    `SELECT d.id, d.name, d.declared_key_count,
            o.series_count, o.density_ratio, o.frequencies,
            o.earliest_period, o.latest_period,
            (SELECT p.status FROM flow_probe p WHERE p.flow_id = d.id
              ORDER BY p.fetched_at DESC LIMIT 1) AS probe_status
     FROM declared_flow d
     LEFT JOIN observed_flow o ON o.id = d.id
     ORDER BY d.id`,
  );

  const dimRows = all<{
    flow_id: string;
    dimension_id: string;
    position: number;
    codelist_id: string | null;
    codelist_size: number | null;
  }>(
    `SELECT flow_id, dimension_id, position, codelist_id, codelist_size
     FROM declared_dimension
     WHERE dimension_type <> 'TimeDimension'
     ORDER BY flow_id, position`,
  );

  const dimsByFlow = new Map<string, ArtifactPayload["flows"][number]["dims"]>();
  for (const d of dimRows) {
    const list = dimsByFlow.get(d.flow_id) ?? [];
    list.push([
      d.dimension_id,
      d.position,
      d.codelist_id ? (codelistIndex.get(d.codelist_id) ?? -1) : -1,
      d.codelist_size,
    ]);
    dimsByFlow.set(d.flow_id, list);
  }

  const catRows = all<{ flow_id: string; category_path: string }>(
    `SELECT flow_id, category_path FROM categorisation ORDER BY flow_id`,
  );
  const catsByFlow = new Map<string, string[]>();
  for (const c of catRows) {
    const list = catsByFlow.get(c.flow_id) ?? [];
    list.push(c.category_path);
    catsByFlow.set(c.flow_id, list);
  }

  const famRows = all<{ family_id: string; flow_id: string; geography_level: string | null }>(
    `SELECT family_id, flow_id, geography_level FROM flow_family_member ORDER BY family_id`,
  );
  const famByFlow = new Map<string, { family: string; geography: string | null }>();
  const familyMembers = new Map<string, Array<[string, string | null]>>();
  for (const f of famRows) {
    famByFlow.set(f.flow_id, { family: f.family_id, geography: f.geography_level });
    const list = familyMembers.get(f.family_id) ?? [];
    list.push([f.flow_id, f.geography_level]);
    familyMembers.set(f.family_id, list);
  }

  const flows: ArtifactPayload["flows"] = flowRows.map((f) => {
    const fam = famByFlow.get(f.id);
    return {
      id: f.id,
      name: f.name,
      series: f.series_count,
      declared: f.declared_key_count,
      density: f.density_ratio,
      freqs: f.frequencies,
      from: f.earliest_period,
      to: f.latest_period,
      status: f.probe_status ?? "unprobed",
      categories: catsByFlow.get(f.id) ?? [],
      family: fam?.family ?? null,
      geography: fam?.geography ?? null,
      dims: dimsByFlow.get(f.id) ?? [],
    };
  });

  // -------------------------------------------------------------- findings
  const latestDeltaRun = one<{ run_id: string | null }>(
    `SELECT run_id FROM delta_finding ORDER BY detected_at DESC LIMIT 1`,
  );
  const findings: ArtifactPayload["findings"] = (
    latestDeltaRun?.run_id
      ? all<{ kind: string; severity: string; flow_id: string | null; summary: string }>(
          `SELECT kind, severity, flow_id, summary FROM delta_finding
           WHERE run_id = ?
           ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'major' THEN 1
                                  WHEN 'minor' THEN 2 ELSE 3 END, kind`,
          latestDeltaRun.run_id,
        )
      : []
  ).map((f) => ({
    kind: f.kind,
    severity: f.severity,
    flowId: f.flow_id,
    summary: f.summary,
  }));

  const endpoints = all<{
    label: string;
    verdict: string;
    http_status: number | null;
    documented_behaviour: string;
    detail: string;
  }>(
    `SELECT label, verdict, http_status, documented_behaviour, detail
     FROM endpoint_check
     WHERE run_id = (SELECT run_id FROM endpoint_check ORDER BY checked_at DESC LIMIT 1)
     ORDER BY CASE verdict WHEN 'conforms' THEN 1 ELSE 0 END, label`,
  );

  const counts = one<{
    flows: number;
    declared: number;
  }>(
    `SELECT COUNT(*) AS flows, COALESCE(SUM(declared_key_count),0) AS declared FROM declared_flow`,
  );
  const obs = one<{ with_data: number; empty: number; series: number; probed: number }>(
    `SELECT SUM(CASE WHEN series_count > 0 THEN 1 ELSE 0 END) AS with_data,
            SUM(CASE WHEN series_count = 0 THEN 1 ELSE 0 END) AS empty,
            COALESCE(SUM(series_count),0) AS series,
            COUNT(*) AS probed
     FROM observed_flow`,
  );
  const codeTotals = one<{ lists: number; codes: number }>(
    `SELECT COUNT(*) AS lists, COALESCE(SUM(code_count),0) AS codes FROM codelist`,
  );

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      flows: counts.flows,
      flowsWithData: obs.with_data ?? 0,
      flowsEmpty: obs.empty ?? 0,
      flowsUnprobed: counts.flows - (obs.probed ?? 0),
      declaredKeys: counts.declared,
      observedSeries: obs.series ?? 0,
      codelists: codeTotals.lists,
      codes: codeTotals.codes,
      embeddedCodelists,
      embeddedCodes,
      families: familyMembers.size,
      findings: findings.length,
    },
    codelistIds,
    codelists: usedCodelists.map((c, i) => ({
      i,
      name: c.name,
      size: c.code_count,
      embedded: c.code_count <= EMBED_CODELIST_MAX,
    })),
    codes,
    flows,
    families: [...familyMembers.entries()]
      .map(([id, members]) => ({ id, members }))
      .sort((a, b) => b.members.length - a.members.length),
    findings,
    endpoints: endpoints.map((e) => ({
      label: e.label,
      verdict: e.verdict,
      httpStatus: e.http_status,
      documented: e.documented_behaviour,
      detail: e.detail,
    })),
  };
}
