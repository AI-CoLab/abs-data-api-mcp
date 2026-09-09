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

/** family id -> members, built once: lets a search collapse nine census variants to one row. */
const familyMembers = new Map<string, TableRecord[]>();
for (const t of Object.values(tablesById)) {
  if (!t.family) continue;
  const list = familyMembers.get(t.family) ?? [];
  list.push(t);
  familyMembers.set(t.family, list);
}

export function tableRecord(id: string): TableRecord | undefined {
  return tablesById[id];
}

export function toSummary(t: TableRecord): TableSummary {
  return {
    id: t.id,
    name: t.name,
    description: t.description ? t.description.slice(0, 300) : null,
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
   * Search over the generated table records (in memory, 1,227 entries) plus
   * one D1 query for option labels, so a term that names something *inside* a
   * dimension still finds the table: "rent" reaches CPI through its INDEX
   * option "Rents", and the result says so in matchedOptions. Ranking is simple
   * and explainable; census families collapse to one result per page.
   */
  async searchTables(input: SearchTablesInput): Promise<SearchTablesOutput> {
    const terms = (input.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    // Whole words with a light plural/suffix allowance: "rent" matches "Rents"
    // but not "parent" or "current".
    const words = terms.map(
      (term) =>
        new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(s|es)?([^a-z0-9]|$)`),
    );
    // Left word boundary in SQL so common substrings ("parent") cannot exhaust
    // the row limit before real hits; GLOB metacharacters are bracket-escaped.
    const globTerm = (term: string) => term.replace(/[[\]*?]/g, (c) => `[${c}]`);

    // Option-label matches: which tables have an OBSERVED option whose label
    // contains the term. SQL LIKE narrows; the word-boundary regex decides.
    // Two steps, deliberately. A single join fans out one row per (table × code),
    // and a common label like "Rent not stated" across dozens of census tables
    // exhausted the row limit before CPI's lone "Rents" ever arrived. So: find
    // the matching codes first (small), then map each codelist's matches to the
    // tables whose dimensions draw from it.
    const optionHits = new Map<string, Array<{ dimension: string; code: string; label: string | null }>>();
    for (const [i, term] of terms.entries()) {
      if (term.length < 3) continue;
      const word = words[i]!;
      const codes = (
        await this.db.all<{ codelist_id: string; code_id: string; name: string | null }>(
          sql`SELECT c.codelist_id, c.code_id, c.name FROM code c
              WHERE (lower(c.name) GLOB ${`*[^a-z0-9]${globTerm(term)}*`} OR lower(c.name) GLOB ${`${globTerm(term)}*`})
              LIMIT 2000`,
        )
      ).filter((c) => word.test((c.name ?? "").toLowerCase()));

      const byCodelist = new Map<string, Map<string, string | null>>();
      for (const c of codes) {
        const m = byCodelist.get(c.codelist_id) ?? new Map<string, string | null>();
        m.set(c.code_id, c.name);
        byCodelist.set(c.codelist_id, m);
      }

      for (const [codelistId, codeLabels] of byCodelist) {
        const codeIds = [...codeLabels.keys()];
        // D1 caps bound parameters; chunk the IN list.
        for (let start = 0; start < codeIds.length; start += 50) {
          const chunk = codeIds.slice(start, start + 50);
          const rows = await this.db.all<{ flow_id: string; dimension_id: string; code_id: string }>(
            sql`SELECT o.flow_id, o.dimension_id, o.code_id
                FROM declared_dimension dd
                JOIN observed_dimension_code o
                  ON o.flow_id = dd.flow_id AND o.dimension_id = dd.dimension_id
                WHERE dd.codelist_id = ${codelistId}
                  AND o.code_id IN (${sql.join(chunk.map((c) => sql`${c}`), sql`, `)})
                LIMIT 5000`,
          );
          for (const r of rows) {
            const list = optionHits.get(r.flow_id) ?? [];
            if (list.length < 5 && !list.some((m) => m.dimension === r.dimension_id && m.code === r.code_id)) {
              list.push({ dimension: r.dimension_id, code: r.code_id, label: codeLabels.get(r.code_id) ?? null });
            }
            optionHits.set(r.flow_id, list);
          }
        }
      }
    }

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
        for (const [i, term] of terms.entries()) {
          const word = words[i]!;
          if (id === term) score += 100;
          else if (word.test(id)) score += 30;
          if (word.test(name)) score += 20;
          if (word.test(topics)) score += 8;
          if (word.test(dims)) score += 6;
          if (word.test(desc)) score += 3;
        }
        // An option match is a real hit — a table whose dimension offers the
        // thing asked for — ranked between a name match and a topic match.
        const hits = optionHits.get(t.id);
        if (hits) score += 12 + Math.min(hits.length, 3);
        if (score === 0) continue;
      }
      // Relevance decides; data volume only breaks ties (a census giant must not
      // outrank CPI on size alone).
      score += Math.log10(t.seriesCount + 1) * 0.1 - (t.family ? 0.5 : 0);
      scored.push({ t, score });
    }
    scored.sort((a, b) => b.score - a.score || a.t.id.localeCompare(b.t.id));

    // Collapse census families: one result per family carrying the other
    // geography levels, unless the caller asked for a specific geography.
    const collapse = !input.geography;
    const seenFamilies = new Set<string>();
    const results: TableSummary[] = [];
    let total = 0;
    for (const { t } of scored) {
      if (collapse && t.family) {
        if (seenFamilies.has(t.family)) continue;
        seenFamilies.add(t.family);
      }
      total += 1;
      if (results.length >= input.limit) continue;
      const summary = toSummary(t);
      const hits = optionHits.get(t.id);
      if (hits) summary.matchedOptions = hits;
      if (collapse && t.family) {
        const others = familyMembers.get(t.family)?.filter((m) => m.id !== t.id).map((m) => m.geography ?? m.id) ?? [];
        if (others.length > 0) summary.familyGeographies = others.sort();
      }
      results.push(summary);
    }

    return { results, total, provenance };
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
