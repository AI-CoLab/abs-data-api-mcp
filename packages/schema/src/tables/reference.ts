/**
 * Shared structural reference data: codelists, codes, concepts, categories.
 *
 * These are structural facts (what a code *means*), not availability claims.
 * They are therefore safe to share between the declared and observed halves of
 * the catalogue without violating the observed-only rule — nothing here asserts
 * that any series exists.
 */
import { sqliteTable, text, integer, index, primaryKey } from "drizzle-orm/sqlite-core";

export const codelist = sqliteTable("codelist", {
  id: text("id").primaryKey(),
  agencyId: text("agency_id").notNull(),
  version: text("version").notNull(),
  name: text("name"),
  description: text("description"),
  codeCount: integer("code_count").notNull().default(0),
});

/**
 * 301,722 codes across 573 codelists; 77% carry a `parent`.
 * ASGS geography nests AUS -> STE -> GCCSA -> SA4 -> SA3 -> SA2 -> SA1.
 */
export const code = sqliteTable(
  "code",
  {
    codelistId: text("codelist_id")
      .notNull()
      .references(() => codelist.id),
    codeId: text("code_id").notNull(),
    name: text("name"),
    description: text("description"),
    parentCodeId: text("parent_code_id"),
    /** From the ORDER annotation, where present. ABS uses both ORDER and order. */
    sortOrder: integer("sort_order"),
  },
  (t) => [
    primaryKey({ columns: [t.codelistId, t.codeId] }),
    index("code_parent_idx").on(t.codelistId, t.parentCodeId),
  ],
);

/**
 * 17 annotation types observed, carrying real payload: AREA_ALBERS_SQKM,
 * ASGS_LOCI_URI (linked-data URIs), LEVEL, FULL_NAME, and for ANZSCO
 * occupations SKILL_LEVEL, TASKS_INCLUDE, SPECIALISATIONS.
 * Kept in a typed key-value table so it stays queryable in SQL.
 */
export const codeAnnotation = sqliteTable(
  "code_annotation",
  {
    codelistId: text("codelist_id").notNull(),
    codeId: text("code_id").notNull(),
    /** Normalised to upper case: ABS emits both ORDER and order. */
    type: text("type").notNull(),
    title: text("title"),
    text: text("text"),
  },
  (t) => [
    index("code_annotation_code_idx").on(t.codelistId, t.codeId),
    index("code_annotation_type_idx").on(t.type),
  ],
);

/**
 * Ancestor-descendant closure over `code.parentCodeId` (DESIGN.md decision 9).
 * Makes "every SA2 within Greater Sydney" a single indexed lookup instead of a
 * recursive CTE over a 61,845-code list.
 */
export const codeClosure = sqliteTable(
  "code_closure",
  {
    codelistId: text("codelist_id").notNull(),
    ancestorCodeId: text("ancestor_code_id").notNull(),
    descendantCodeId: text("descendant_code_id").notNull(),
    /** 0 = self. */
    depth: integer("depth").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.codelistId, t.ancestorCodeId, t.descendantCodeId] }),
    index("code_closure_descendant_idx").on(t.codelistId, t.descendantCodeId),
  ],
);

export const conceptScheme = sqliteTable("concept_scheme", {
  id: text("id").primaryKey(),
  agencyId: text("agency_id").notNull(),
  version: text("version").notNull(),
  name: text("name"),
});

export const concept = sqliteTable(
  "concept",
  {
    schemeId: text("scheme_id")
      .notNull()
      .references(() => conceptScheme.id),
    conceptId: text("concept_id").notNull(),
    name: text("name"),
    description: text("description"),
  },
  (t) => [primaryKey({ columns: [t.schemeId, t.conceptId] })],
);

export const categoryScheme = sqliteTable("category_scheme", {
  id: text("id").primaryKey(),
  agencyId: text("agency_id").notNull(),
  version: text("version").notNull(),
  name: text("name"),
});

/** 143 distinct categories across the ABS topic tree. */
export const category = sqliteTable(
  "category",
  {
    schemeId: text("scheme_id")
      .notNull()
      .references(() => categoryScheme.id),
    /** Dot-joined path within the scheme, e.g. POPULATION.ERP. */
    categoryPath: text("category_path").notNull(),
    parentPath: text("parent_path"),
    name: text("name"),
  },
  (t) => [primaryKey({ columns: [t.schemeId, t.categoryPath] })],
);

/**
 * Flow-to-category links. 1,226 of 1,227 flows are categorised; the orphan is
 * recorded as a delta finding rather than silently dropped.
 */
export const categorisation = sqliteTable(
  "categorisation",
  {
    id: text("id").primaryKey(),
    flowId: text("flow_id").notNull(),
    schemeId: text("scheme_id").notNull(),
    categoryPath: text("category_path").notNull(),
  },
  (t) => [
    index("categorisation_flow_idx").on(t.flowId),
    index("categorisation_category_idx").on(t.schemeId, t.categoryPath),
  ],
);
