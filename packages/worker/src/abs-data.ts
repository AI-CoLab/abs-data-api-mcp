/**
 * Fetches observations from ABS for a verified key, capped (decision 26).
 *
 * Streams the CSV and stops reading at the cap, so a careless wide selection
 * costs at most `maxRows` rows of parsing rather than 40MB of context. The
 * complete pull is offered as a URL instead.
 */
import { comparePeriods, readCsvTable, maxPeriod, minPeriod } from "@abs/schema";
import type { GetDataInput, GetDataOutput, Observation } from "@abs/contract";
import { ABS_BASE, absHeaders } from "./env.ts";
import { availabilityUrl } from "./availability.ts";
import { provenance } from "./catalogue.ts";
import type { ResolvedSelection } from "./resolve.ts";

const DATA_CSV = "application/vnd.sdmx.data+csv";
const DEFAULT_LAST_N = 12;
const CACHE_TTL_SECONDS = 300;

function dataUrl(table: string, key: string, params: Record<string, string | number | undefined>): string {
  const url = new URL(`${ABS_BASE}/data/ABS,${encodeURIComponent(table)}/${key}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));
  return url.toString();
}

export async function fetchData(resolved: ResolvedSelection, input: GetDataInput): Promise<GetDataOutput> {
  const hasPeriod = input.startPeriod !== undefined || input.endPeriod !== undefined;
  const query: Record<string, string | number | undefined> = {
    startPeriod: input.startPeriod,
    endPeriod: input.endPeriod,
    firstNObservations: input.firstN,
    lastNObservations: input.lastN ?? (hasPeriod || input.firstN ? undefined : DEFAULT_LAST_N),
  };

  const url = dataUrl(resolved.table, resolved.key, query);
  const request = new Request(url, { headers: absHeaders(DATA_CSV) });

  const cache = caches.default;
  let response = await cache.match(request);
  if (!response) {
    response = await fetch(request);
    if (response.ok) {
      const cached = new Response(response.clone().body, response);
      cached.headers.set("cache-control", `public, max-age=${CACHE_TTL_SECONDS}`);
      await cache.put(request, cached);
    }
  }

  const rows: Observation[] = [];
  const series = new Set<string>();
  let truncated = false;
  let earliest: string | undefined;
  let latest: string | undefined;

  if (response.ok && response.body) {
    const table = await readCsvTable(response.body);
    if (table) {
      const h = table.header;
      const timeIdx = h.indexOf("TIME_PERIOD");
      const valueIdx = h.indexOf("OBS_VALUE");
      const unitIdx = h.indexOf("UNIT_MEASURE");
      const statusIdx = h.indexOf("OBS_STATUS");
      const start = h[0] === "DATAFLOW" ? 1 : 0;
      const dimIdx: number[] = [];
      for (let i = start; i < timeIdx; i += 1) dimIdx.push(i);

      for await (const row of table.rows) {
        if (rows.length >= input.maxRows) {
          truncated = true;
          break;
        }
        const key = dimIdx.map((i) => row[i] ?? "").join(".");
        const period = row[timeIdx] ?? "";
        const rawValue = row[valueIdx];
        const value = rawValue === undefined || rawValue === "" ? null : Number(rawValue);
        series.add(key);
        earliest = minPeriod(earliest, period);
        latest = maxPeriod(latest, period);
        rows.push({
          series: key,
          period,
          value: value !== null && Number.isFinite(value) ? value : null,
          unit: unitIdx >= 0 ? (row[unitIdx] ?? null) : undefined,
          status: statusIdx >= 0 ? (row[statusIdx] || null) : undefined,
        });
      }
      // Stop pulling bytes once capped; the body is ours to cancel.
      if (truncated) await response.body.cancel().catch(() => undefined);
    }
  }

  // ABS returns observations in no useful order (2024-Q1, 2025-Q3, 2025-Q2 …).
  // Guarantee series-then-period ascending so `rows[0]` and `rows.at(-1)` mean
  // what a reader — or model-written code — assumes they mean.
  rows.sort((a, b) => a.series.localeCompare(b.series) || comparePeriods(a.period, b.period));

  return {
    table: resolved.table,
    key: resolved.key,
    seriesMatched: series.size,
    rows,
    rowsReturned: rows.length,
    truncated,
    periodRange: { from: earliest ?? null, to: latest ?? null },
    fullDataUrl: dataUrl(resolved.table, resolved.key, {
      format: "csv",
      startPeriod: input.startPeriod,
      endPeriod: input.endPeriod,
    }),
    availabilityUrl: availabilityUrl(resolved.table, resolved.key),
    provenance,
  };
}
