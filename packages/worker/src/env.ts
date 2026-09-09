export interface Env {
  CATALOGUE: D1Database;
  RAW_ARCHIVE: R2Bucket;
  /** Worker Loader (Dynamic Workers, open beta). Absent when the account lacks it. */
  LOADER?: WorkerLoader;
  /** Rate Limiting bindings, one per tier (limits.ts). Absent = unlimited (local dev). */
  READS?: RateLimit;
  UPSTREAM?: RateLimit;
  EXECUTE?: RateLimit;
}

export const ABS_BASE = "https://data.api.abs.gov.au/rest";

/**
 * Headers for every upstream call. ABS sits behind CloudFront, which answers
 * 403 to requests without a User-Agent — and workerd sends none by default, so
 * the first Worker-originated oracle checks all failed closed. Identify
 * ourselves explicitly, always.
 */
export function absHeaders(accept: string): Record<string, string> {
  return {
    accept,
    "user-agent": "abs-data-front-door/0.1 (+https://github.com/AI-CoLab/abs-data-api-mcp)",
  };
}
