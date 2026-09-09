/**
 * DECLARED metadata — what ABS says exists.
 *
 * Known to be wrong: content constraints are per-dimension marginals, so for
 * CPI they imply 40,572 series where only 8,467 exist (20.9% density, a 4.8x
 * overstatement). Nothing in here is authoritative.
 *
 * These tables exist for exactly two reasons:
 *   1. to describe the dimension space so the probe knows what to ask for; and
 *   2. to derive the declared-vs-observed delta report.
 *
 * They must NEVER be joined into a canonical availability answer. The observed
 * tables are the only source of truth about what exists.
 */
import { sqliteTable, text, integer, index, primaryKey } from "drizzle-orm/sqlite-core";

export const declaredFlow = sqliteTable(
  "declared_flow",
  {
    id: text("id").primaryKey(),
    agencyId: text("agency_id").notNull(),
    version: text("version").notNull(),
    name: text("name"),
    description: text("description"),
    /** URN of the DSD this flow is built on. */
    dsdRef: text("dsd_ref"),
    isFinal: integer("is_final", { mode: "boolean" }),
    isExternalReference: integer("is_external_reference", { mode: "boolean" }),
    /** Product of declared per-dimension cardinalities — the overstated figure. */
    declaredKeyCount: integer("declared_key_count"),
    structureFetchedAt: text("structure_fetched_at"),
  },
  (t) => [index("declared_flow_agency_idx").on(t.agencyId)],
);

export const declaredDimension = sqliteTable(
  "declared_dimension",
  {
    flowId: text("flow_id")
      .notNull()
      .references(() => declaredFlow.id),
    dimensionId: text("dimension_id").notNull(),
    /** Zero-based, and the order in which codes appear in a dataKey. */
    position: integer("position").notNull(),
    /** "Dimension" | "TimeDimension". */
    dimensionType: text("dimension_type").notNull(),
    conceptRef: text("concept_ref"),
    codelistId: text("codelist_id"),
    /** Cardinality of the codelist as declared. */
    codelistSize: integer("codelist_size"),
  },
  (t) => [
    primaryKey({ columns: [t.flowId, t.dimensionId] }),
    index("declared_dimension_position_idx").on(t.flowId, t.position),
  ],
);

export const declaredAttribute = sqliteTable(
  "declared_attribute",
  {
    flowId: text("flow_id")
      .notNull()
      .references(() => declaredFlow.id),
    attributeId: text("attribute_id").notNull(),
    /** dimensions | primaryMeasure | dataflow (dataset-level) | none. */
    relationship: text("relationship"),
    assignmentStatus: text("assignment_status"),
    codelistId: text("codelist_id"),
  },
  (t) => [primaryKey({ columns: [t.flowId, t.attributeId] })],
);

/**
 * Content constraints as published. Type is typically "Actual", which is
 * misleading: they are marginals, not actual key sets.
 */
export const declaredConstraint = sqliteTable(
  "declared_constraint",
  {
    id: text("id").primaryKey(),
    flowId: text("flow_id").notNull(),
    constraintType: text("constraint_type"),
    validFrom: text("valid_from"),
    fetchedAt: text("fetched_at"),
  },
  (t) => [index("declared_constraint_flow_idx").on(t.flowId)],
);

export const declaredConstraintValue = sqliteTable(
  "declared_constraint_value",
  {
    constraintId: text("constraint_id")
      .notNull()
      .references(() => declaredConstraint.id),
    dimensionId: text("dimension_id").notNull(),
    codeId: text("code_id").notNull(),
    isIncluded: integer("is_included", { mode: "boolean" }).notNull().default(true),
  },
  (t) => [
    primaryKey({ columns: [t.constraintId, t.dimensionId, t.codeId] }),
    index("declared_constraint_value_dim_idx").on(t.constraintId, t.dimensionId),
  ],
);
