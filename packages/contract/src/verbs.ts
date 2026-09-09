/**
 * The generic verbs — the stable, hand-written half of the contract.
 *
 * These schemas describe the *shape* of every door (MCP tools, oRPC procedures,
 * the SDK). They never change when ABS changes; only the generated data does.
 * That separation is what makes the doors impossible to drift out of alignment
 * (DESIGN.md decision 21): no door hardcodes the surface.
 *
 * Vocabulary is the user's, not SDMX's: "table" for dataflow, "dimension" for
 * dimension, "option" for code, "selection" for a dataKey. Callers may pass
 * codes or labels for options; the server resolves labels.
 */
import { z } from "zod";

// ---------------------------------------------------------------- primitives

export const frequencySchema = z.enum(["A", "S", "Q", "M", "W", "D"]).describe(
  "A annual, S semi-annual, Q quarterly, M monthly, W weekly, D daily",
);
export type Frequency = z.infer<typeof frequencySchema>;

export const optionSchema = z.object({
  code: z.string(),
  label: z.string().nullable(),
  /** Parent option code where the codelist is hierarchical (e.g. geography). */
  parent: z.string().nullable().optional(),
});
export type Option = z.infer<typeof optionSchema>;

export const coverageSchema = z.object({
  from: z.string().nullable().describe("Earliest observed period, e.g. 2002-Q1"),
  to: z.string().nullable().describe("Latest observed period"),
});

export const tableSummarySchema = z.object({
  id: z.string().describe("Dataflow id, e.g. CPI"),
  name: z.string().nullable(),
  seriesCount: z.number().int().describe("Series confirmed to exist by retrieval"),
  frequencies: z.array(frequencySchema),
  coverage: coverageSchema,
  /** observed series / series implied by ABS metadata. 1 = metadata exact. */
  density: z.number().nullable(),
  family: z.string().nullable().describe("Census table family, e.g. C21_G01"),
  geography: z.string().nullable().describe("Geography level for family members, e.g. LGA"),
  dimensions: z.array(z.string()).describe("Dimension ids in key order"),
  topics: z.array(z.string()),
});
export type TableSummary = z.infer<typeof tableSummarySchema>;

export const dimensionDescriptionSchema = z.object({
  id: z.string(),
  position: z.number().int(),
  codelist: z.string().nullable(),
  /** Number of options observed in real data for this table. */
  optionCount: z.number().int(),
  /** Inline when small; omitted when large (use search_options). */
  options: z.array(optionSchema).optional(),
  /** A dimension whose value is determined by another (e.g. STATE by REGION). */
  determinedBy: z.string().nullable().optional(),
});
export type DimensionDescription = z.infer<typeof dimensionDescriptionSchema>;

/** Every response carries which observation of ABS it answers from. */
export const provenanceSchema = z.object({
  runId: z.string(),
  observedAt: z.string(),
});

// ----------------------------------------------------------------- search

export const searchTablesInputSchema = z.object({
  query: z.string().min(1).max(200).optional().describe("Free text over ids, names, topics, dimensions"),
  geography: z.string().optional().describe("Restrict to a geography level, e.g. SA2, LGA"),
  frequency: frequencySchema.optional(),
  limit: z.number().int().min(1).max(50).default(10),
});
export type SearchTablesInput = z.infer<typeof searchTablesInputSchema>;

export const searchTablesOutputSchema = z.object({
  results: z.array(tableSummarySchema),
  total: z.number().int(),
  provenance: provenanceSchema,
});
export type SearchTablesOutput = z.infer<typeof searchTablesOutputSchema>;

// --------------------------------------------------------------- describe

export const describeTableInputSchema = z.object({
  table: z.string().min(1).describe("Dataflow id, e.g. CPI"),
});
export type DescribeTableInput = z.infer<typeof describeTableInputSchema>;

export const describeTableOutputSchema = z.object({
  table: tableSummarySchema,
  dimensions: z.array(dimensionDescriptionSchema),
  keyFormat: z.string().describe("Dimension ids joined by '.', the order a selection is serialised in"),
  exampleUrl: z.string().url(),
  provenance: provenanceSchema,
});
export type DescribeTableOutput = z.infer<typeof describeTableOutputSchema>;

// --------------------------------------------------------- search options

export const searchOptionsInputSchema = z.object({
  table: z.string().min(1),
  dimension: z.string().min(1),
  query: z.string().min(1).max(200).describe("Match against option codes and labels"),
  limit: z.number().int().min(1).max(100).default(20),
});
export type SearchOptionsInput = z.infer<typeof searchOptionsInputSchema>;

export const searchOptionsOutputSchema = z.object({
  options: z.array(optionSchema),
  total: z.number().int(),
  provenance: provenanceSchema,
});
export type SearchOptionsOutput = z.infer<typeof searchOptionsOutputSchema>;

// ---------------------------------------------------------------- get data

export const selectionSchema = z
  .record(z.string(), z.union([z.string(), z.array(z.string()).min(1)]))
  .describe("dimension id -> option code or label (or several). Omitted dimensions match everything.");
export type Selection = z.infer<typeof selectionSchema>;

export const getDataInputSchema = z.object({
  table: z.string().min(1),
  select: selectionSchema.default({}),
  startPeriod: z.string().optional().describe("e.g. 2020, 2020-Q1, 2020-03"),
  endPeriod: z.string().optional(),
  lastN: z.number().int().min(1).max(1000).optional().describe("Most recent N observations per series; default 12 when no period is given"),
  firstN: z.number().int().min(1).max(1000).optional(),
  maxRows: z.number().int().min(1).max(2000).default(500).describe("Cap on returned observations"),
});
export type GetDataInput = z.infer<typeof getDataInputSchema>;

export const observationSchema = z.object({
  series: z.string().describe("The series key, e.g. 1.10001.10.50.Q"),
  period: z.string(),
  value: z.number().nullable(),
  unit: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
});
export type Observation = z.infer<typeof observationSchema>;

export const getDataOutputSchema = z.object({
  table: z.string(),
  key: z.string().describe("The resolved selection as an SDMX key"),
  seriesMatched: z.number().int(),
  rows: z.array(observationSchema),
  rowsReturned: z.number().int(),
  truncated: z.boolean(),
  periodRange: coverageSchema,
  /** Exact working URL for the complete, uncapped pull. */
  fullDataUrl: z.string().url(),
  /** Live existence check for this selection. */
  availabilityUrl: z.string().url(),
  provenance: provenanceSchema,
});
export type GetDataOutput = z.infer<typeof getDataOutputSchema>;

// ------------------------------------------------------ typed failure shape

/**
 * The one error shape a caller must handle. Carries what IS valid, from
 * observation, so a correction needs no second lookup. Surfaced as an oRPC
 * typed error on the HTTP door and as an MRTR `input_required` on MCP.
 */
export const invalidSelectionSchema = z.object({
  table: z.string(),
  dimension: z.string().nullable().describe("Offending dimension; null when the whole combination is empty"),
  given: z.union([z.string(), z.array(z.string())]).nullable(),
  reason: z.enum([
    "unknown_table",
    "unknown_dimension",
    "unknown_option",
    /** A label matched several options; pass the code. validOptions lists the candidates. */
    "ambiguous_option",
    "no_data_for_combination",
  ]),
  message: z.string(),
  /** Observed valid options for the offending dimension, given the rest of the selection. Capped. */
  validOptions: z.array(optionSchema).optional(),
  validOptionsTotal: z.number().int().optional(),
  /**
   * For an empty combination, every other single dimension whose relaxation
   * also recovers data, with what would then be valid. Lets a caller choose
   * which constraint to loosen — e.g. "REGION: only the national aggregate" vs
   * "FREQ: monthly works".
   */
  alternatives: z
    .array(
      z.object({
        dimension: z.string(),
        validOptions: z.array(optionSchema),
        validOptionsTotal: z.number().int(),
      }),
    )
    .optional(),
});
export type InvalidSelection = z.infer<typeof invalidSelectionSchema>;
