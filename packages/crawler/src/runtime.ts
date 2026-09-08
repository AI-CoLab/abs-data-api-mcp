/**
 * Shared bootstrap for the CLI entrypoints.
 *
 * Per DESIGN.md decision 14 these run as local Node processes over the same
 * Worker-compatible code paths, so nothing here may reach for Node APIs that
 * the crawl logic itself depends on.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { openCatalogue } from "@abs/schema/client";
import { AbsClient } from "./http.ts";
import { LocalArchive, NullArchive, type RawArchive } from "./archive.ts";

export interface Runtime {
  db: ReturnType<typeof openCatalogue>["db"];
  sqlite: ReturnType<typeof openCatalogue>["sqlite"];
  client: AbsClient;
  archive: RawArchive;
  runId: string;
  log: (msg: string) => void;
}

export interface RuntimeOptions {
  runKind: string;
  concurrency?: number;
  timeoutMs?: number;
  archive?: boolean;
}

export function makeRunId(kind: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${kind}-${stamp}`;
}

export function bootstrap(opts: RuntimeOptions): Runtime {
  const dbPath = resolve(process.env["ABS_DB_PATH"] ?? "data/abs-catalogue.sqlite");
  const archiveRoot = resolve(process.env["ABS_ARCHIVE_DIR"] ?? "data/raw");
  const archiveEnabled = opts.archive ?? process.env["ABS_ARCHIVE"] !== "0";

  mkdirSync(archiveRoot, { recursive: true });

  const { db, sqlite } = openCatalogue({ path: dbPath, bulk: true });
  const runId = makeRunId(opts.runKind);

  const started = Date.now();
  const log = (msg: string) => {
    const secs = ((Date.now() - started) / 1000).toFixed(1).padStart(7);
    process.stdout.write(`[${secs}s] ${msg}\n`);
  };

  const client = new AbsClient({
    concurrency: opts.concurrency ?? Number(process.env["ABS_CONCURRENCY"] ?? 8),
    timeoutMs: opts.timeoutMs ?? Number(process.env["ABS_TIMEOUT_MS"] ?? 120_000),
  });

  const archive: RawArchive = archiveEnabled ? new LocalArchive(archiveRoot) : new NullArchive();

  log(`db=${dbPath}`);
  log(`archive=${archive.describe}`);
  log(`runId=${runId}`);

  return { db, sqlite, client, archive, runId, log };
}
