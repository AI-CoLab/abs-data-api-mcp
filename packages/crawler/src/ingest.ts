/**
 * Bulk-write helpers.
 *
 * Two write paths, deliberately:
 *   - `insertChunked` for reference and declared data (hundreds of thousands of
 *     rows), where Drizzle's typing is worth the overhead.
 *   - raw prepared statements for the observed hot path (tens of millions of
 *     rows), where per-row Drizzle overhead would dominate runtime.
 *
 * SQLite caps bound parameters per statement (32,766 on modern builds), so
 * multi-row inserts must be chunked by column count, not by a fixed row count.
 */
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { getTableColumns } from "drizzle-orm";
import type { CatalogueDb } from "@abs/schema/client";

const PARAM_BUDGET = 20_000;

export function chunkSizeFor(columnCount: number): number {
  return Math.max(1, Math.floor(PARAM_BUDGET / Math.max(1, columnCount)));
}

/**
 * Inserts rows in parameter-budgeted chunks. `onConflictDoNothing` is the right
 * default here: crawls are resumable and re-runnable, so re-inserting a row the
 * previous run already wrote must be a no-op rather than a failure.
 */
export function insertChunked<T extends SQLiteTable>(
  db: CatalogueDb,
  table: T,
  rows: Array<T["$inferInsert"]>,
  opts: { ignoreConflicts?: boolean } = {},
): number {
  if (rows.length === 0) return 0;

  const columnCount = Object.keys(getTableColumns(table)).length;
  const size = chunkSizeFor(columnCount);
  const ignore = opts.ignoreConflicts ?? true;

  let written = 0;
  for (let i = 0; i < rows.length; i += size) {
    const slice = rows.slice(i, i + size);
    const stmt = db.insert(table).values(slice as never);
    if (ignore) stmt.onConflictDoNothing().run();
    else stmt.run();
    written += slice.length;
  }
  return written;
}

/**
 * Deduplicates rows by a composite key before insert.
 *
 * ABS metadata contains genuine duplicates — the same codelist arrives in many
 * per-flow `references=all` payloads, and constraint cube regions repeat values
 * — so a primary-key collision inside a single multi-row INSERT would abort the
 * whole chunk even with onConflictDoNothing.
 */
export function dedupeBy<T>(rows: T[], key: (row: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    const k = key(row);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(row);
  }
  return out;
}
