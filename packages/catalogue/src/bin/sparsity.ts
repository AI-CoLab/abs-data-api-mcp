/**
 * Structured-sparsity report.
 *
 *   pnpm --filter @abs/catalogue report:sparsity
 *
 * Writes reports/sparsity.md and reports/sparsity.json.
 */
import Database from "better-sqlite3";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { analyseSparsity, renderSparsityMarkdown } from "../sparsity.ts";

const dbPath = resolve(process.env["ABS_DB_PATH"] ?? "data/abs-catalogue.sqlite");
const outDir = resolve(process.env["ABS_REPORT_DIR"] ?? "reports");
mkdirSync(outDir, { recursive: true });

const sqlite = new Database(dbPath, { readonly: true });
sqlite.pragma("busy_timeout = 10000");

const started = Date.now();
const log = (m: string) => process.stdout.write(`[${((Date.now() - started) / 1000).toFixed(1)}s] ${m}\n`);

try {
  log("analysing…");
  // Unbounded by default: every level-1 candidate is verified against its keys.
  // Set ABS_SPARSITY_VERIFY_MAX_SERIES / ABS_SPARSITY_VERIFY_FLOWS for a quick partial run.
  const summary = analyseSparsity(sqlite, {
    verifyUpToSeries: Number(process.env["ABS_SPARSITY_VERIFY_MAX_SERIES"] ?? Number.POSITIVE_INFINITY),
    verifyMaxFlows: Number(process.env["ABS_SPARSITY_VERIFY_FLOWS"] ?? Number.POSITIVE_INFINITY),
    log,
  });

  writeFileSync(resolve(outDir, "sparsity.md"), `${renderSparsityMarkdown(summary)}\n`, "utf8");
  writeFileSync(
    resolve(outDir, "sparsity.json"),
    `${JSON.stringify(
      {
        ...summary,
        results: summary.results.map((r) => ({ ...r, observedProduct: r.observedProduct.toString() })),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  log(`flows: ${summary.flows}`);
  log(`exact cross-product: ${summary.exactProduct}`);
  log(`dependent dimensions (verified): ${summary.dependentDimensions}`);
  log(`arithmetic candidates (unverified): ${summary.arithmeticCandidates}`);
  log(`unexplained: ${summary.unexplained}`);
  log(`series explained: ${(summary.seriesExplainedShare * 100).toFixed(1)}%`);
  log(`verified: ${summary.verifiedOk}/${summary.verifiedFlows}`);
  log(`top patterns: ${summary.patterns.slice(0, 5).map((p) => `${p.dependent.join("+")}(${p.flows})`).join(", ")}`);
  log(`wrote ${outDir}/sparsity.md and sparsity.json`);
} finally {
  sqlite.close();
}
