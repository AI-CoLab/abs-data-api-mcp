/**
 * Endpoint conformance checks.
 *
 * Every case here is a claim made by the ABS user guide or the published
 * OpenAPI spec, checked against live behaviour. The results are the evidence
 * base for the defect report (DESIGN.md decision 19), so each check records the
 * documented expectation alongside what actually happened.
 */
import type { CatalogueDb } from "@abs/schema/client";
import { endpointCheck } from "@abs/schema";
import { AbsClient, ACCEPT, AbsHttpError } from "./http.ts";

export interface EndpointCase {
  label: string;
  path: string;
  query?: Record<string, string | number>;
  accept?: string;
  documentedBehaviour: string;
  /** What a conforming response looks like. */
  expect:
    | { kind: "json-with"; key: string }
    | { kind: "status"; status: number }
    | { kind: "csv-rows"; atLeast: number }
    | { kind: "parseable-json" };
  timeoutMs?: number;
}

/**
 * The documented surface. Sourced from the user guide and
 * apigovau/api-descriptions/abs/DataAPI.openapi.yaml.
 */
export const ENDPOINT_CASES: EndpointCase[] = [
  {
    label: "dataflow listing",
    path: "dataflow/ABS",
    query: { detail: "allstubs" },
    documentedBehaviour: "Spec: GET /{structureType}/{agencyId} returns all structures of a type",
    expect: { kind: "json-with", key: "dataflows" },
  },
  {
    label: "documented /structures/ path",
    path: "structures/dataflow/ABS/CPI",
    documentedBehaviour:
      "User guide documents /structures/{structureType}/{agencyId}/{structureId}",
    expect: { kind: "status", status: 200 },
  },
  {
    label: "agencyscheme",
    path: "agencyscheme/ABS",
    documentedBehaviour: "Spec lists agencyscheme as a valid structureType",
    expect: { kind: "json-with", key: "agencySchemes" },
  },
  {
    label: "hierarchicalcodelist",
    path: "hierarchicalcodelist/ABS",
    documentedBehaviour: "Spec lists hierarchicalcodelist as a valid structureType",
    expect: { kind: "parseable-json" },
  },
  {
    label: "actualconstraint",
    path: "actualconstraint/ABS",
    documentedBehaviour: "Spec lists actualconstraint as a valid structureType",
    expect: { kind: "parseable-json" },
  },
  {
    label: "availableconstraint",
    path: "availableconstraint/CPI/all/ABS",
    documentedBehaviour: "SDMX-REST defines availableconstraint for actual data availability",
    expect: { kind: "parseable-json" },
  },
  {
    label: "bulk datastructure",
    path: "datastructure/ABS",
    documentedBehaviour: "Spec: GET /datastructure/ABS returns all data structures",
    expect: { kind: "json-with", key: "dataStructures" },
    timeoutMs: 125_000,
  },
  {
    label: "bulk contentconstraint",
    path: "contentconstraint/ABS",
    documentedBehaviour: "Spec: GET /contentconstraint/ABS returns all content constraints",
    expect: { kind: "json-with", key: "contentConstraints" },
    timeoutMs: 125_000,
  },
  {
    label: "categoryscheme with references",
    path: "categoryscheme/ABS",
    query: { detail: "full", references: "parentsandsiblings" },
    documentedBehaviour: "Spec lists references=parentsandsiblings as a valid value",
    expect: { kind: "json-with", key: "categorySchemes" },
    timeoutMs: 125_000,
  },
  {
    label: "detail=serieskeysonly (JSON)",
    path: "data/ABS,CPI/all",
    query: { detail: "serieskeysonly" },
    accept: ACCEPT.dataJson,
    documentedBehaviour: "Spec lists detail=serieskeysonly: series keys without observations",
    expect: { kind: "parseable-json" },
  },
  {
    label: "detail=serieskeysonly (CSV)",
    path: "data/ABS,CPI/all",
    query: { detail: "serieskeysonly" },
    accept: ACCEPT.dataCsv,
    documentedBehaviour: "detail=serieskeysonly should enumerate every series key",
    expect: { kind: "csv-rows", atLeast: 1 },
  },
  {
    label: "lastNObservations (absent from spec)",
    path: "data/ABS,CPI/1.10001.10.50.Q",
    query: { lastNObservations: 1 },
    accept: ACCEPT.dataCsv,
    documentedBehaviour: "Added 2024-11-29 per the user guide; absent from the OpenAPI enum",
    expect: { kind: "csv-rows", atLeast: 1 },
  },
  {
    label: "firstNObservations (absent from spec)",
    path: "data/ABS,CPI/1.10001.10.50.Q",
    query: { firstNObservations: 1 },
    accept: ACCEPT.dataCsv,
    documentedBehaviour: "Added 2024-11-29 per the user guide; absent from the OpenAPI enum",
    expect: { kind: "csv-rows", atLeast: 1 },
  },
  {
    label: "agency other than ABS",
    path: "dataflow/SPC",
    documentedBehaviour: "Spec exposes agencyId as a parameter, implying multiple agencies",
    expect: { kind: "json-with", key: "dataflows" },
  },
];

/**
 * Undocumented gate discovered when the Worker first called upstream: requests
 * without a User-Agent are answered 403 with a CloudFront HTML page — not an
 * SDMX error, not mentioned anywhere in the user guide or the OpenAPI spec.
 * Checked outside AbsClient because the client always identifies itself.
 */
export async function checkUserAgentGate(): Promise<CheckResult> {
  const url = "https://data.api.abs.gov.au/rest/availableconstraint/CPI/all/ABS";
  const started = performance.now();
  const res = await fetch(url, {
    headers: { accept: ACCEPT.structureJson, "user-agent": "" },
  });
  const text = await res.text();
  const durationMs = Math.round(performance.now() - started);
  const isHtml403 = res.status === 403 && /<!DOCTYPE HTML/i.test(text);
  return {
    label: "request without User-Agent",
    url,
    documentedBehaviour: "No User-Agent requirement is documented; the API is described as open and keyless",
    httpStatus: res.status,
    verdict: res.ok ? "conforms" : "broken",
    detail: isHtml403
      ? "HTTP 403 with a CloudFront HTML error page (not an SDMX error) when User-Agent is absent"
      : `HTTP ${res.status}`,
    durationMs,
  };
}

export interface CheckResult {
  label: string;
  url: string;
  documentedBehaviour: string;
  httpStatus: number | undefined;
  verdict: "conforms" | "broken" | "missing" | "timeout" | "malformed";
  detail: string;
  durationMs: number;
}

export async function runEndpointChecks(
  client: AbsClient,
  cases: readonly EndpointCase[] = ENDPOINT_CASES,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  for (const c of cases) {
    const started = performance.now();
    const url = client.buildUrl(c.path, c.query);

    try {
      const res = await client.request({
        path: c.path,
        accept: c.accept ?? ACCEPT.structureJson,
        query: c.query,
        ...(c.timeoutMs === undefined ? {} : { timeoutMs: c.timeoutMs }),
      });
      const text = res.body ? await new Response(res.body).text() : "";
      const durationMs = Math.round(performance.now() - started);

      results.push({
        label: c.label,
        url,
        documentedBehaviour: c.documentedBehaviour,
        httpStatus: res.status,
        ...judge(c, res.status, text),
        durationMs,
      });
    } catch (err) {
      const durationMs = Math.round(performance.now() - started);
      const timedOut = err instanceof AbsHttpError && err.kind === "timeout";
      results.push({
        label: c.label,
        url,
        documentedBehaviour: c.documentedBehaviour,
        httpStatus: err instanceof AbsHttpError ? err.status : undefined,
        verdict: timedOut ? "timeout" : "broken",
        detail: err instanceof Error ? err.message : String(err),
        durationMs,
      });
    }
  }

  results.push(await checkUserAgentGate());
  return results;
}

function judge(
  c: EndpointCase,
  status: number,
  text: string,
): { verdict: CheckResult["verdict"]; detail: string } {
  if (status === 404) {
    return { verdict: "missing", detail: `HTTP 404: ${text.slice(0, 120).trim()}` };
  }
  if (status >= 500) {
    return { verdict: "broken", detail: `HTTP ${status}` };
  }
  if (status >= 400) {
    return { verdict: "broken", detail: `HTTP ${status}: ${text.slice(0, 120).trim()}` };
  }

  switch (c.expect.kind) {
    case "status":
      return status === c.expect.status
        ? { verdict: "conforms", detail: `HTTP ${status}` }
        : { verdict: "broken", detail: `expected HTTP ${c.expect.status}, got ${status}` };

    case "parseable-json":
    case "json-with": {
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch (err) {
        return {
          verdict: "malformed",
          detail: `HTTP ${status} but body is not valid JSON (${String(err).slice(0, 80)}); tail: ${JSON.stringify(text.slice(-60))}`,
        };
      }
      if (c.expect.kind === "parseable-json") {
        return { verdict: "conforms", detail: `HTTP ${status}, valid JSON` };
      }
      const data = (json as { data?: Record<string, unknown> }).data;
      const value = data?.[c.expect.key];
      return Array.isArray(value) && value.length > 0
        ? { verdict: "conforms", detail: `data.${c.expect.key}: ${value.length} items` }
        : {
            verdict: "broken",
            detail: `HTTP ${status} but data.${c.expect.key} is absent or empty`,
          };
    }

    case "csv-rows": {
      // Count real rows, not lines: OBS_COMMENT contains embedded newlines.
      const lines = text.split("\n").filter((l) => l.trim().length > 0);
      const dataRows = Math.max(0, lines.length - 1);
      return dataRows >= c.expect.atLeast
        ? { verdict: "conforms", detail: `${dataRows} data row(s)` }
        : {
            verdict: "broken",
            detail: `HTTP ${status} but only ${dataRows} data row(s); header-only response`,
          };
    }
  }
}

export function recordEndpointChecks(
  db: CatalogueDb,
  runId: string,
  results: readonly CheckResult[],
): void {
  const now = new Date().toISOString();
  for (const r of results) {
    db.insert(endpointCheck)
      .values({
        runId,
        label: r.label,
        url: r.url,
        documentedBehaviour: r.documentedBehaviour,
        httpStatus: r.httpStatus ?? null,
        verdict: r.verdict,
        detail: r.detail,
        durationMs: r.durationMs,
        checkedAt: now,
      })
      .run();
  }
}
