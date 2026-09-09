/**
 * Regenerates the contract package and the D1 import from the observed catalogue.
 *
 *   pnpm generate:contract
 */
import Database from "better-sqlite3";
import { resolve } from "node:path";
import { generateContract } from "../contract-gen.ts";

const dbPath = resolve(process.env["ABS_DB_PATH"] ?? "data/abs-catalogue.sqlite");
const sqlite = new Database(dbPath, { readonly: true });
sqlite.pragma("busy_timeout = 10000");

const started = Date.now();
const log = (m: string) => process.stdout.write(`[${((Date.now() - started) / 1000).toFixed(1)}s] ${m}\n`);

try {
  const summary = generateContract(sqlite, {
    contractDir: resolve("packages/contract"),
    d1Dir: resolve(process.env["ABS_D1_DIR"] ?? "data/d1"),
    migrationsDir: resolve("packages/schema/migrations"),
    log,
  });
  log(`run: ${summary.runId}`);
  log(`tables ${summary.tables}, dimensions ${summary.dimensions}`);
  log(`literal codelists ${summary.literalCodelists} (${summary.literalCodes} codes), branded ${summary.brandedCodelists}`);
  log(`d1: ${summary.d1Files.length} files, ${summary.d1Rows.toLocaleString()} rows`);
} finally {
  sqlite.close();
}
