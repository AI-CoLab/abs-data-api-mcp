/**
 * The streaming CSV reader lives in @abs/schema so the Worker can share it —
 * it is Web-standard (ReadableStream + TextDecoder) with no Node dependency.
 * Re-exported here so existing crawler imports keep working.
 */
export { readCsvRows, readCsvTable, bareColumnName, normaliseHeader } from "@abs/schema";
export type { CsvTable } from "@abs/schema";
