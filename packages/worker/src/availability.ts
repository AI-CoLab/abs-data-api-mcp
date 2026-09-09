/**
 * Live existence check against ABS `availableconstraint` (DESIGN.md 2.8, 24).
 *
 * Conditioned on a partial key it returns what remains available per
 * dimension; at full key depth it is exact and agrees with the data endpoint's
 * 200/404 — and the cartography showed its marginals agree with our 621M-key
 * probe on every dimension of every flow. So this is an empirical source, not
 * declared metadata, and it is the combination check for every call.
 *
 * `references=none` triggers a 500 on this endpoint — never pass it.
 */
import { ABS_BASE } from "./env.ts";

const STRUCTURE_JSON = "application/vnd.sdmx.structure+json;version=1.0";
const CACHE_TTL_SECONDS = 3600;

export interface Availability {
  exists: boolean;
  /** Remaining available codes per dimension given the supplied key. */
  available: Record<string, string[]>;
  /** Product of remaining cardinalities: an upper bound on matching series. */
  upperBound: number;
  url: string;
}

interface ConstraintPayload {
  data?: {
    contentConstraints?: Array<{
      cubeRegions?: Array<{ keyValues?: Array<{ id: string; values?: string[] }> }>;
    }>;
  };
}

export function availabilityUrl(table: string, key: string): string {
  return `${ABS_BASE}/availableconstraint/${encodeURIComponent(table)}/${key}/ABS`;
}

export async function checkAvailability(table: string, key: string): Promise<Availability> {
  const url = availabilityUrl(table, key);
  const request = new Request(url, { headers: { accept: STRUCTURE_JSON, "accept-encoding": "gzip" } });

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

  if (!response.ok) return { exists: false, available: {}, upperBound: 0, url };

  const payload = (await response.json()) as ConstraintPayload;
  const keyValues = payload.data?.contentConstraints?.[0]?.cubeRegions?.[0]?.keyValues ?? [];

  const available: Record<string, string[]> = {};
  let upperBound = 1;
  let dims = 0;
  for (const kv of keyValues) {
    if (kv.id === "TIME_PERIOD") continue; // always present, never a dimension constraint
    const values = kv.values ?? [];
    available[kv.id] = values;
    if (values.length > 0) {
      upperBound *= values.length;
      dims += 1;
    }
  }
  return { exists: dims > 0, available, upperBound: dims > 0 ? upperBound : 0, url };
}
