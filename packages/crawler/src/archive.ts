/**
 * Raw response archive (DESIGN.md decision 11).
 *
 * Every raw ABS response is kept, gzipped, keyed by flow and fetch time. This
 * is what lets the catalogue and the delta report be re-derived without
 * re-crawling, and it is the evidence base for the defect report to ABS.
 *
 * The interface is deliberately narrow so the R2 implementation can replace the
 * local one without touching callers.
 */
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

export interface RawArchive {
  /** Consumes `body` and stores it gzipped. Returns bytes written. */
  put(key: string, body: ReadableStream<Uint8Array>): Promise<number>;
  readonly describe: string;
}

/** Local filesystem archive, used for the bootstrap crawl. */
export class LocalArchive implements RawArchive {
  readonly describe: string;

  constructor(private readonly root: string) {
    this.describe = `local:${root}`;
  }

  async put(key: string, body: ReadableStream<Uint8Array>): Promise<number> {
    const path = join(this.root, `${key}.gz`);
    await mkdir(dirname(path), { recursive: true });

    let bytes = 0;
    const counter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytes += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });

    await pipeline(
      Readable.fromWeb(body.pipeThrough(counter) as never),
      createGzip({ level: 6 }),
      createWriteStream(path),
    );
    return bytes;
  }
}

/** Discards everything. For dry runs and tests. */
export class NullArchive implements RawArchive {
  readonly describe = "null";

  async put(_key: string, body: ReadableStream<Uint8Array>): Promise<number> {
    await body.cancel();
    return 0;
  }
}

/**
 * Splits a response body so it can be parsed and archived in one pass.
 *
 * `tee()` applies backpressure from the slower branch, so memory stays bounded
 * even on a 58MB response — important because the archive branch is disk-bound
 * while the parse branch is CPU-bound.
 */
export function teeBody(
  body: ReadableStream<Uint8Array>,
): [ReadableStream<Uint8Array>, ReadableStream<Uint8Array>] {
  const [a, b] = body.tee();
  return [a, b];
}

/** Stable, filesystem- and R2-safe archive keys. */
export function archiveKey(parts: {
  kind: "structure" | "data" | "bulk" | "endpoint";
  flowId?: string | undefined;
  label: string;
  runId: string;
}): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9._+-]/g, "_").slice(0, 120);
  const segments = [parts.kind, parts.runId];
  if (parts.flowId) segments.push(safe(parts.flowId));
  segments.push(safe(parts.label));
  return segments.join("/");
}
