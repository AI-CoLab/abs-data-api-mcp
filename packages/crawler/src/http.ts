/**
 * HTTP client for the ABS Data API.
 *
 * Measured characteristics this is built around (see DESIGN.md section 2):
 *   - No auth, no API key, no observed rate limiting. 8-way parallel ran clean.
 *   - gzip is supported and worth 8.7x on CSV: always ask for it.
 *   - Range requests work (206, accept-ranges: bytes) with Content-Length known
 *     upfront, so oversized responses can be chunked.
 *   - Heavy structural queries gateway-timeout at 120s, so timeouts must be
 *     explicit and treated as a signal to split rather than as a hard failure.
 *   - Errors are plain text, not SDMX: an unknown flow or an empty key both
 *     return `404 NoRecordsFound`.
 */

export const ABS_BASE = "https://data.api.abs.gov.au/rest";

export const ACCEPT = {
  structureJson: "application/vnd.sdmx.structure+json;version=1.0",
  dataCsv: "application/vnd.sdmx.data+csv",
  dataCsvLabels: "application/vnd.sdmx.data+csv;labels=both",
  dataJson: "application/vnd.sdmx.data+json",
} as const;

export interface AbsClientOptions {
  concurrency?: number;
  /** Per-request timeout. The gateway gives up at 120s. */
  timeoutMs?: number;
  maxAttempts?: number;
  baseUrl?: string;
  userAgent?: string;
}

export interface AbsRequest {
  path: string;
  accept: string;
  query?: Record<string, string | number | undefined> | undefined;
  /** Inclusive byte range, for chunking oversized responses. */
  range?: { start: number; end: number } | undefined;
  timeoutMs?: number;
}

export interface AbsResponse {
  status: number;
  ok: boolean;
  url: string;
  headers: Headers;
  body: ReadableStream<Uint8Array> | null;
  /** Total size of the underlying representation, from Content-Range or Length. */
  totalBytes: number | undefined;
  durationMs: number;
  attempts: number;
}

/** Distinguishes "ABS said no such thing" from "the request fell over". */
export class AbsHttpError extends Error {
  constructor(
    override readonly message: string,
    readonly status: number | undefined,
    readonly url: string,
    readonly kind: "timeout" | "network" | "status",
    readonly attempts: number,
  ) {
    super(message);
    this.name = "AbsHttpError";
  }
}

/** Minimal counting semaphore; keeps concurrency at the measured sweet spot. */
class Semaphore {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async acquire(): Promise<() => void> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      this.waiting.shift()?.();
    };
  }
}

export interface RequestStats {
  requests: number;
  retries: number;
  bytes: number;
  timeouts: number;
}

export class AbsClient {
  private readonly semaphore: Semaphore;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly baseUrl: string;
  private readonly userAgent: string;
  readonly stats: RequestStats = { requests: 0, retries: 0, bytes: 0, timeouts: 0 };

  constructor(opts: AbsClientOptions = {}) {
    this.semaphore = new Semaphore(opts.concurrency ?? 8);
    this.timeoutMs = opts.timeoutMs ?? 120_000;
    this.maxAttempts = opts.maxAttempts ?? 4;
    this.baseUrl = opts.baseUrl ?? ABS_BASE;
    this.userAgent =
      opts.userAgent ??
      "abs-data-api-cartography/0.1 (+https://github.com/sambide/abs-data-api-exploration)";
  }

  buildUrl(path: string, query?: AbsRequest["query"]): string {
    const url = new URL(`${this.baseUrl}/${path.replace(/^\/+/, "")}`);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    return url.toString();
  }

  /**
   * Issues a request with retry and backoff, returning the raw streaming
   * response. The caller owns the body and must consume or cancel it.
   *
   * A 404 is returned rather than thrown: for this API it is a legitimate
   * "no records" answer that the probe needs to record, not an error.
   */
  async request(req: AbsRequest): Promise<AbsResponse> {
    const release = await this.semaphore.acquire();
    const url = this.buildUrl(req.path, req.query);
    const timeoutMs = req.timeoutMs ?? this.timeoutMs;

    try {
      let lastError: unknown;

      for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const started = performance.now();

        try {
          this.stats.requests += 1;
          const headers: Record<string, string> = {
            accept: req.accept,
            "accept-encoding": "gzip",
            "user-agent": this.userAgent,
          };
          if (req.range) headers["range"] = `bytes=${req.range.start}-${req.range.end}`;

          const res = await fetch(url, { headers, signal: controller.signal, redirect: "follow" });
          clearTimeout(timer);
          const durationMs = performance.now() - started;

          // 5xx and 429 are worth retrying; 4xx is a real answer.
          if (res.status >= 500 || res.status === 429) {
            await res.body?.cancel();
            lastError = new AbsHttpError(
              `HTTP ${res.status} from ${url}`,
              res.status,
              url,
              "status",
              attempt,
            );
            if (attempt < this.maxAttempts) {
              this.stats.retries += 1;
              await backoff(attempt);
              continue;
            }
            throw lastError;
          }

          return {
            status: res.status,
            ok: res.ok,
            url,
            headers: res.headers,
            body: res.body,
            totalBytes: totalBytesFrom(res.headers),
            durationMs,
            attempts: attempt,
          };
        } catch (err) {
          clearTimeout(timer);
          const aborted = controller.signal.aborted;
          if (aborted) this.stats.timeouts += 1;

          lastError = new AbsHttpError(
            aborted ? `timeout after ${timeoutMs}ms: ${url}` : `network error: ${String(err)}`,
            undefined,
            url,
            aborted ? "timeout" : "network",
            attempt,
          );

          // A timeout means the response is too big to generate in time. Retrying
          // it identically will time out again, so surface it for splitting.
          if (aborted || attempt >= this.maxAttempts) throw lastError;
          this.stats.retries += 1;
          await backoff(attempt);
        }
      }

      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    } finally {
      release();
    }
  }

  /** Convenience wrapper for the structure endpoints, which return small JSON. */
  async getJson(path: string, query?: AbsRequest["query"]): Promise<{
    status: number;
    json: unknown | undefined;
    text: string | undefined;
    url: string;
    durationMs: number;
  }> {
    const res = await this.request({ path, accept: ACCEPT.structureJson, query });
    const text = res.body ? await new Response(res.body).text() : undefined;
    this.stats.bytes += text ? Buffer.byteLength(text) : 0;

    if (!res.ok) {
      return { status: res.status, json: undefined, text, url: res.url, durationMs: res.durationMs };
    }

    try {
      return {
        status: res.status,
        json: text ? (JSON.parse(text) as unknown) : undefined,
        text,
        url: res.url,
        durationMs: res.durationMs,
      };
    } catch {
      // Real case, not defensive: detail=serieskeysonly returns HTTP 200 with a
      // malformed body. Surface it as unparseable rather than crashing.
      return { status: res.status, json: undefined, text, url: res.url, durationMs: res.durationMs };
    }
  }
}

function totalBytesFrom(headers: Headers): number | undefined {
  const range = headers.get("content-range");
  if (range) {
    const total = range.split("/")[1];
    const n = total ? Number(total) : NaN;
    if (Number.isFinite(n)) return n;
  }
  const len = headers.get("content-length");
  const n = len ? Number(len) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function backoff(attempt: number): Promise<void> {
  const base = Math.min(1000 * 2 ** (attempt - 1), 8000);
  const jitter = Math.random() * 250;
  return new Promise((resolve) => setTimeout(resolve, base + jitter));
}
