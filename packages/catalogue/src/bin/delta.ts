/**
 * Delta report entrypoint.
 *
 *   pnpm report:delta
 *
 * Writes reports/delta.md and reports/delta.json, and refreshes delta_finding.
 */
import Database from "better-sqlite3";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateDelta } from "../delta.ts";
import { buildJsonReport, buildMarkdownReport } from "../report.ts";

const dbPath = resolve(process.env["ABS_DB_PATH"] ?? "data/abs-catalogue.sqlite");
const outDir = resolve(process.env["ABS_REPORT_DIR"] ?? "reports");
const runId = `delta-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const generatedAt = new Date().toISOString();

mkdirSync(outDir, { recursive: true });

const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");

try {
  const summary = generateDelta(sqlite, { runId });

  const md = buildMarkdownReport(sqlite, { runId, generatedAt, summary });
  const json = buildJsonReport(sqlite, { runId, generatedAt, summary });

  writeFileSync(resolve(outDir, "delta.md"), `${md}\n`, "utf8");
  writeFileSync(resolve(outDir, "delta.json"), `${JSON.stringify(json, null, 2)}\n`, "utf8");

  process.stdout.write(`findings: ${summary.findings}\n`);
  process.stdout.write(`by severity: ${JSON.stringify(summary.bySeverity)}\n`);
  process.stdout.write(`by kind: ${JSON.stringify(summary.byKind, null, 2)}\n`);
  process.stdout.write(`totals: ${JSON.stringify(summary.totals, null, 2)}\n`);
  process.stdout.write(`wrote ${outDir}/delta.md and ${outDir}/delta.json\n`);
} finally {
  sqlite.close();
}
