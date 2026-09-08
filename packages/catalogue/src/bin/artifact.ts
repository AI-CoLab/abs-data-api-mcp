/**
 * Builds the browsable catalogue artifact.
 *
 *   pnpm --filter @abs/catalogue build:artifact
 *
 * Injects the extracted payload into the page template and writes a
 * self-contained HTML file ready to publish.
 */
import Database from "better-sqlite3";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { extractPayload } from "../extract.ts";

const dbPath = resolve(process.env["ABS_DB_PATH"] ?? "data/abs-catalogue.sqlite");
const outDir = resolve(process.env["ABS_ARTIFACT_DIR"] ?? "artifact");
const outPath = resolve(outDir, "abs-cartography.html");
const templatePath = new URL("../artifact/template.html", import.meta.url).pathname;

mkdirSync(outDir, { recursive: true });

const sqlite = new Database(dbPath, { readonly: true });

try {
  const payload = extractPayload(sqlite);

  // The payload lands inside a <script type="application/json"> block, so the
  // only sequence that can break out of it is a literal "</script".
  const json = JSON.stringify(payload).replace(/<\//g, "<\\/");

  const template = readFileSync(templatePath, "utf8");
  if (!template.includes("/*__PAYLOAD__*/")) {
    throw new Error("template is missing the /*__PAYLOAD__*/ placeholder");
  }

  writeFileSync(outPath, template.replace("/*__PAYLOAD__*/", json), "utf8");

  const bytes = statSync(outPath).size;
  process.stdout.write(`wrote ${outPath}\n`);
  process.stdout.write(`page size: ${(bytes / 1_048_576).toFixed(2)}MB (16MB limit)\n`);
  process.stdout.write(`totals: ${JSON.stringify(payload.totals, null, 2)}\n`);

  if (bytes > 15_000_000) {
    process.stdout.write(
      "WARNING: close to the 16MB artifact limit — lower EMBED_CODELIST_MAX in extract.ts\n",
    );
  }
} finally {
  sqlite.close();
}
