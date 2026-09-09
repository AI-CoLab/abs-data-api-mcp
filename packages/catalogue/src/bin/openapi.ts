/**
 * Emits the corrected OpenAPI document from the HTTP contract.
 *
 *   pnpm --filter @abs/catalogue emit:openapi
 *
 * This is a cartography deliverable in its own right (decision 25): the API as
 * it actually behaves, generated from observation, to sit beside ABS's
 * inaccurate published specification in the defect report. The Worker serves
 * the identical document at /api/openapi.json from the same contract.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { OpenAPIGenerator } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { httpContract } from "@abs/contract/http";
import { MANIFEST } from "@abs/contract";

const outDir = resolve(process.env["ABS_REPORT_DIR"] ?? "reports");
mkdirSync(outDir, { recursive: true });

const generator = new OpenAPIGenerator({ schemaConverters: [new ZodToJsonSchemaConverter()] });

const spec = await generator.generate(httpContract, {
  info: {
    title: "ABS Data API — observed",
    version: MANIFEST.runId,
    description:
      "The Australian Bureau of Statistics Data API as it actually behaves, generated from an empirical crawl of " +
      `every dataflow: ${MANIFEST.corpus.seriesConfirmed.toLocaleString("en-AU")} series confirmed across ` +
      `${MANIFEST.corpus.tables} tables (observed ${MANIFEST.observedAt}). ABS's published metadata implies ` +
      `${MANIFEST.corpus.seriesImpliedByMetadata.toLocaleString("en-AU")} — a density of ` +
      `${((MANIFEST.corpus.density ?? 0) * 100).toFixed(2)}%. Every option offered here exists in real data, and ` +
      "every selection is verified live before data is fetched.",
  },
  servers: [{ url: "/api" }],
});

const path = resolve(outDir, "openapi.json");
writeFileSync(path, `${JSON.stringify(spec, null, 2)}\n`, "utf8");
process.stdout.write(`wrote ${path} (${Object.keys(spec.paths ?? {}).length} paths, run ${MANIFEST.runId})\n`);
