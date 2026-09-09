/**
 * The catalogue service — everything the doors know about tables.
 *
 * Table-level facts come from the generated contract (static, stamped with the
 * crawl's run id). Option-level facts come from D1's observed tables — the
 * 2.7M observed (table, dimension, option) rows and the code labels. Nothing
 * here reads declared availability; `declared_dimension` is consulted only for
 * the codelist a dimension draws its labels from, which is structure, not an
 * availability claim.
 */
import { and, eq, sql } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import * as tables from "@abs/schema/tables";
import {
  MANIFEST,
  TABLES,
  type DescribeTableOutput,
  type DimensionDescription,
  type Option,
  type SearchOptionsOutput,
  type SearchTablesInput,
  type SearchTablesOutput,
  type TableRecord,
  type TableSummary,
} from "@abs/contract";
import { ABS_BASE } from "./env.ts";

/** Dimensions at or below this many observed options are listed inline. */
export const INLINE_OPTIONS_MAX = 64;

export const provenance = { runId: MANIFEST.runId, observedAt: MANIFEST.observedAt } as const;

const tablesById: Readonly<Record<string, TableRecord>> = TABLES;

export function tableRecord(id: string): TableRecord | undefined {
  return tablesById[id];
}

export function toSummary(t: TableRecord): TableSummary {
  return {
    id: t.id,
    name: t.name,
    seriesCount: t.seriesCount,
    frequencies: t.frequencies.filter((f): f is TableSummary["frequencies"][number] =>
      ["A", "S", "Q", "M", "W", "D"].includes(f),
    ),
    coverage: t.coverage,
    density: t.density,
    family: t.family,
    geography: t.geography,
    dimensions: t.dimensions.map((d) => d.id),
    topics: t.topics,
  };
}

export class Catalogue {
  readonly db: DrizzleD1Database<typeof tables>;

  constructor(d1: D1Database) {
    this.db = drizzle(d1, { schema: tables });
  }

  /**
   * Search runs over the generated table records in memory: 1,227 entries,
   * deterministic, no query. Ranking is deliberately simple and explainable.
   */
  searchTables(input: SearchTablesInput): SearchTablesOutput {
    const terms = (input.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    const scored: Array<{ t: TableRecord; score: number }> = [];

    for (const t of Object.values(tablesById)) {
      if (input.geography && t.geography?.toUpperCase() !== input.geography.toUpperCase()) continue;
      if (input.frequency && !t.frequencies.includes(input.frequency)) continue;

      let score = 0;
      if (terms.length > 0) {
        const id = t.id.toLowerCase();
        const name = (t.name ?? "").toLowerCase();
        const desc = (t.description ?? "").toLowerCase();
        const topics = t.topics.join(" ").toLowerCase();
        const dims = t.dimensions.map((d) => d.id.toLowerCase()).join(" ");
        for (const term of terms) {
          // Whole-word matches only: "rent" must not hit "parent" or "current".
          const word = new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`);
          if (id === term) score += 100;
          else if (word.test(id)) score += 30;
          if (word.test(name)) score += 20;
          if (word.test(topics)) score += 8;
          if (word.test(dims)) score += 6;
          if (word.test(desc)) score += 3;
        }
        if (score === 0) continue;
      }
      // Relevance decides; data volume only breaks ties (a census giant must not
      // outrank CPI on size alone). Families are de-emphasised slightly so nine
      // near-identical census variants do not crowd a page.
      score += Math.log10(t.seriesCount + 1) * 0.1 - (t.family ? 0.5 : 0);
      scored.push({ t, score });
    }

    scored.sort((a, b) => b.score - a.score || a.t.id.localeCompare(b.t.id));
    return {
      results: scored.slice(0, input.limit).map((s) => toSummary(s.t)),
      total: scored.length,
      provenance,
    };
  }

  /** Observed options for one dimension of one table, with labels. */
  async options(
    table: string,
    dimension: string,
    opts: { query?: string; limit?: number } = {},
  ): Promise<{ options: Option[]; total: number }> {
    const o = tables.observedDimensionCode;
    const dd = tables.declaredDimension;
    const c = tables.code;

    const filter = opts.query ? `%${opts.query.toLowerCase()}%` : undefined;
    const where = and(
      eq(o.flowId, table),
      eq(o.dimensionId, dimension),
      filter
        ? sql`(lower(${o.codeId}) like ${filter} or lower(coalesce(${c.name}, '')) like ${filter})`
        : undefined,
    );

    const base = this.db
      .select({
        code: o.codeId,
        label: c.name,
        parent: c.parentCodeId,
        seriesCount: o.seriesCount,
      })
      .from(o)
      .leftJoin(dd, and(eq(dd.flowId, o.flowId), eq(dd.dimensionId, o.dimensionId)))
      .leftJoin(c, and(eq(c.codelistId, dd.codelistId), eq(c.codeId, o.codeId)))
      .where(where);

    const rows = await base.orderBy(sql`${o.seriesCount} desc, ${o.codeId}`).limit(opts.limit ?? 100);
    const total = filter
      ? (
          await this.db
            .select({ n: sql<number>`count(*)` })
            .from(o)
            .leftJoin(dd, and(eq(dd.flowId, o.flowId), eq(dd.dimensionId, o.dimensionId)))
            .leftJoin(c, and(eq(c.codelistId, dd.codelistId), eq(c.codeId, o.codeId)))
            .where(where)
        )[0]?.n ?? rows.length
      : (tableRecord(table)?.dimensions.find((d) => d.id === dimension)?.optionCount ?? rows.length);

    return {
      options: rows.map((r) => ({ code: r.code, label: r.label ?? null, parent: r.parent ?? null })),
      total,
    };
  }

  async searchOptions(table: string, dimension: string, query: string, limit: number): Promise<SearchOptionsOutput> {
    const { options, total } = await this.options(table, dimension, { query, limit });
    return { options, total, provenance };
  }

  async describeTable(id: string): Promise<DescribeTableOutput | undefined> {
    const t = tableRecord(id);
    if (!t) return undefined;

    const dimensions: DimensionDescription[] = [];
    for (const d of t.dimensions) {
      const inline = d.optionCount <= INLINE_OPTIONS_MAX;
      const desc: DimensionDescription = {
        id: d.id,
        position: d.position,
        codelist: d.codelist,
        optionCount: d.optionCount,
      };
      if (inline) desc.options = (await this.options(t.id, d.id, { limit: INLINE_OPTIONS_MAX })).options;
      dimensions.push(desc);
    }

    const keyFormat = t.dimensions.map((d) => d.id).join(".");
    return {
      table: toSummary(t),
      dimensions,
      keyFormat,
      exampleUrl: `${ABS_BASE}/data/ABS,${t.id}/all?format=csv&lastNObservations=1`,
      provenance,
    };
  }

  /**
   * Resolve one given value (a code, or a label) to an observed code for the
   * dimension. Exact code match wins; then case-insensitive exact label; then a
   * unique label containing the text. Several matches are reported as
   * ambiguous rather than guessed — CPI's INDEX has two options both labelled
   * "Rents" (the quarterly series and the monthly indicator).
   */
  async resolveOption(
    table: string,
    dimension: string,
    given: string,
  ): Promise<
    | { kind: "resolved"; option: Option }
    | { kind: "ambiguous"; candidates: Option[] }
    | { kind: "none" }
  > {
    const o = tables.observedDimensionCode;
    const exact = await this.db
      .select({ code: o.codeId })
      .from(o)
      .where(and(eq(o.flowId, table), eq(o.dimensionId, dimension), eq(o.codeId, given)))
      .limit(1);
    if (exact[0]) return { kind: "resolved", option: { code: exact[0].code, label: null } };

    const { options } = await this.options(table, dimension, { query: given, limit: 25 });
    const lower = given.toLowerCase();
    const exactLabel = options.filter((x) => (x.label ?? "").toLowerCase() === lower);
    if (exactLabel.length === 1) return { kind: "resolved", option: exactLabel[0]! };
    if (exactLabel.length > 1) return { kind: "ambiguous", candidates: exactLabel };
    const contains = options.filter((x) => (x.label ?? "").toLowerCase().includes(lower));
    if (contains.length === 1) return { kind: "resolved", option: contains[0]! };
    if (contains.length > 1) return { kind: "ambiguous", candidates: contains };
    return { kind: "none" };
  }
}
