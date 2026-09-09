/**
 * The HTTP contract — the same four verbs as REST resources, defined once with
 * oRPC's contract builder so that the Worker implements it, the typed client
 * derives from it, and the corrected OpenAPI document is generated from it.
 *
 * `INVALID_SELECTION` is the one typed error: a 422 whose payload is the
 * observed valid options, so a caller can correct without a second lookup.
 */
import { oc } from "@orpc/contract";
import {
  describeTableInputSchema,
  describeTableOutputSchema,
  getDataInputSchema,
  getDataOutputSchema,
  invalidSelectionSchema,
  searchOptionsInputSchema,
  searchOptionsOutputSchema,
  searchTablesInputSchema,
  searchTablesOutputSchema,
} from "./verbs.ts";

const base = oc.errors({
  INVALID_SELECTION: {
    status: 422,
    message: "The selection does not match any data; see data.validOptions",
    data: invalidSelectionSchema,
  },
  NOT_FOUND: {
    status: 404,
    message: "No such table or dimension",
    data: invalidSelectionSchema,
  },
});

export const httpContract = {
  searchTables: base
    .route({
      method: "GET",
      path: "/tables",
      summary: "Search tables",
      description:
        "Find dataflows by free text, geography level or frequency. Only tables confirmed to serve data are returned.",
      tags: ["catalogue"],
    })
    .input(searchTablesInputSchema)
    .output(searchTablesOutputSchema),

  describeTable: base
    .route({
      method: "GET",
      path: "/tables/{table}",
      summary: "Describe a table",
      description:
        "Key structure, coverage and observed options. Small dimensions list their options inline; large ones are searchable.",
      tags: ["catalogue"],
    })
    .input(describeTableInputSchema)
    .output(describeTableOutputSchema),

  searchOptions: base
    .route({
      method: "GET",
      path: "/tables/{table}/dimensions/{dimension}/options",
      summary: "Search a dimension's options",
      description: "Match observed option codes and labels for one dimension of one table.",
      tags: ["catalogue"],
    })
    .input(searchOptionsInputSchema)
    .output(searchOptionsOutputSchema),

  getData: base
    .route({
      method: "POST",
      path: "/data",
      summary: "Get data",
      description:
        "Resolve a named selection to a key, verify it exists live against ABS, and return capped observations plus the full-pull URL.",
      tags: ["data"],
    })
    .input(getDataInputSchema)
    .output(getDataOutputSchema),
};

export type HttpContract = typeof httpContract;
