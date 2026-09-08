/**
 * Local SQLite client. The same Drizzle schema also drives D1 in the Worker
 * (DESIGN.md decision 10) — only the driver differs.
 *
 * Pragmas are tuned for bulk ingest: the observed probe inserts tens of
 * millions of rows, where the default synchronous/journal settings dominate
 * runtime.
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./tables/index.ts";

export type CatalogueDb = ReturnType<typeof openCatalogue>["db"];

export interface OpenOptions {
  /** Path to the SQLite file. */
  path: string;
  /** Apply bulk-ingest pragmas. Off for read-only consumers. */
  bulk?: boolean;
  readonly?: boolean;
}

export function openCatalogue({ path, bulk = false, readonly = false }: OpenOptions) {
  const sqlite = new Database(path, { readonly });

  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  if (bulk) {
    // Durability is expendable here: the crawl is resumable and the raw
    // responses are archived, so a lost write is re-derivable.
    sqlite.pragma("synchronous = OFF");
    sqlite.pragma("cache_size = -262144"); // 256MB
    sqlite.pragma("temp_store = MEMORY");
    sqlite.pragma("mmap_size = 1073741824"); // 1GB
  }

  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}
