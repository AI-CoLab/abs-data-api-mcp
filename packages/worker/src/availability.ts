/**
 * Live availability checks against ABS `availableconstraint`.
 *
 * This is the piece that lets the front door be a front door rather than a
 * mirror. `availableconstraint` returns availability *conditioned on a partial
 * key*: supplying MEASURE=1 and REGION=1 for CPI narrows INDEX from 161 to 154
 * and TSEST from 2 to 1. At full key depth it is exact — a real key returns
 * every dimension at cardinality 1, a non-existent one returns a cube region
 * with no dimension values at all, matching the data endpoint's 200/404 exactly.
 *
 * So key validation does not need a stored key set. The catalogue supplies
 * names, labels, hierarchy and coverage; ABS supplies existence, in ~170ms and
 * ~2.4KB per check.
 *
 * Note `references=none` triggers a 500 on this endpoint — omit it.
 */

const ABS_BASE = "https://data.api.abs.gov.au/rest";
const STRUCTURE_JSON = "application/vnd.sdmx.structure+json;version=1.0";

/** Cache upstream availability aggressively: abuse should be cheap, not blocked. */
const CACHE_TTL_SECONDS = 3600;

export interface AvailabilityResult {
  /** False when the key matches nothing — the cube region has no dimensions. */
  exists: boolean;
  /** Remaining available codes per dimension, given the supplied partial key. */
  available: Record<string, string[]>;
  /** Product of remaining cardinalities: an upper bound on matching series. */
  upperBound: number;
  upstreamUrl: string;
  cached: boolean;
}

interface ConstraintPayload {
  data?: {
    contentConstraints?: Array<{
      cubeRegions?: Array<{
        keyValues?: Array<{ id: string; values?: string[] }>;
      }>;
    }>;
  };
}

export async function checkAvailability(
  flowId: string,
  dataKey: string,
  cache: Cache | undefined,
): Promise<AvailabilityResult> {
  const upstreamUrl = `${ABS_BASE}/availableconstraint/${encodeURIComponent(flowId)}/${dataKey}/ABS`;
  const request = new Request(upstreamUrl, {
    headers: { accept: STRUCTURE_JSON, "accept-encoding": "gzip" },
  });

  let response = await cache?.match(request);
  const cached = response !== undefined;

  if (!response) {
    response = await fetch(request);
    if (response.ok && cache) {
      const toCache = new Response(response.clone().body, response);
      toCache.headers.set("cache-control", `public, max-age=${CACHE_TTL_SECONDS}`);
      await cache.put(request, toCache);
    }
  }

  if (!response.ok) {
    return { exists: false, available: {}, upperBound: 0, upstreamUrl, cached };
  }

  const payload = (await response.json()) as ConstraintPayload;
  const keyValues = payload.data?.contentConstraints?.[0]?.cubeRegions?.[0]?.keyValues ?? [];

  const available: Record<string, string[]> = {};
  let upperBound = 1;
  let dimensionCount = 0;

  for (const kv of keyValues) {
    // TIME_PERIOD is always present with zero values; it is not a dimension
    // constraint and must not zero the product.
    if (kv.id === "TIME_PERIOD") continue;
    const values = kv.values ?? [];
    available[kv.id] = values;
    if (values.length > 0) {
      upperBound *= values.length;
      dimensionCount += 1;
    }
  }

  return {
    exists: dimensionCount > 0,
    available,
    upperBound: dimensionCount > 0 ? upperBound : 0,
    upstreamUrl,
    cached,
  };
}

/**
 * Builds an SDMX dataKey from named dimension values.
 * Unspecified dimensions become empty segments (wildcards).
 */
export function buildDataKey(
  dimensionOrder: readonly string[],
  values: Readonly<Record<string, string | undefined>>,
): string {
  if (dimensionOrder.length === 0) return "all";
  const segments = dimensionOrder.map((d) => values[d] ?? "");
  return segments.every((s) => s === "") ? "all" : segments.join(".");
}
