/**
 * The HTTP door: the same four verbs as REST, implemented against the oRPC
 * contract in @abs/contract, with the corrected OpenAPI document and a Scalar
 * reference served from the same definitions (decision 27).
 */
import { implement } from "@orpc/server";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { ZodToJsonSchemaConverter, experimental_ZodSmartCoercionPlugin } from "@orpc/zod/zod4";
import { httpContract } from "@abs/contract/http";
import { MANIFEST } from "@abs/contract";
import type { Catalogue } from "./catalogue.ts";
import { resolveSelection } from "./resolve.ts";
import { fetchData } from "./abs-data.ts";

export interface HttpContext {
  catalogue: Catalogue;
}

const os = implement(httpContract).$context<HttpContext>();

export const router = os.router({
  searchTables: os.searchTables.handler(({ input, context }) => context.catalogue.searchTables(input)),

  describeTable: os.describeTable.handler(async ({ input, context, errors }) => {
    const described = await context.catalogue.describeTable(input.table);
    if (!described) {
      throw errors.NOT_FOUND({
        data: {
          table: input.table,
          dimension: null,
          given: null,
          reason: "unknown_table",
          message: `No table "${input.table}" serves data.`,
        },
      });
    }
    return described;
  }),

  searchOptions: os.searchOptions.handler(({ input, context }) =>
    context.catalogue.searchOptions(input.table, input.dimension, input.query, input.limit),
  ),

  getData: os.getData.handler(async ({ input, context, errors }) => {
    const resolved = await resolveSelection(context.catalogue, input.table, input.select);
    if (!resolved.ok) {
      if (resolved.error.reason === "unknown_table" || resolved.error.reason === "unknown_dimension") {
        throw errors.NOT_FOUND({ data: resolved.error });
      }
      throw errors.INVALID_SELECTION({ data: resolved.error });
    }
    return fetchData(resolved.value, input);
  }),
});

export const OPENAPI_INFO = {
  title: "ABS Data API — observed",
  version: MANIFEST.runId,
  description:
    "The Australian Bureau of Statistics Data API as it actually behaves, generated from an empirical crawl " +
    `of every dataflow (${MANIFEST.corpus.seriesConfirmed.toLocaleString("en-AU")} series confirmed across ` +
    `${MANIFEST.corpus.tables} tables, observed ${MANIFEST.observedAt}). Every option offered exists in real data; ` +
    "every selection is verified live before data is fetched.",
};

export const httpHandler = new OpenAPIHandler(router, {
  plugins: [
    // Query strings arrive as text; coerce "limit=3" to the schema's number so
    // GET /api/tables?limit=3 validates instead of 400ing.
    new experimental_ZodSmartCoercionPlugin(),
    new OpenAPIReferencePlugin({
      schemaConverters: [new ZodToJsonSchemaConverter()],
      specGenerateOptions: { info: OPENAPI_INFO, servers: [{ url: "/api" }] },
      docsPath: "/docs",
      specPath: "/openapi.json",
      docsTitle: OPENAPI_INFO.title,
    }),
  ],
});
