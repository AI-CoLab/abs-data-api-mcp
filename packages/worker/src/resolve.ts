/**
 * Turns a named selection into a verified SDMX key — or the one typed failure.
 *
 * Steps, each producing an InvalidSelection with what IS valid when it fails:
 *   1. the table exists and serves data;
 *   2. every named dimension belongs to the table;
 *   3. every value resolves to an observed option (code or label);
 *   4. the combination exists — live, exact, via availableconstraint. When it
 *      does not, each specified dimension is relaxed in turn to find which one
 *      breaks the combination and what its valid options are given the rest.
 */
import type { InvalidSelection, Option, Selection } from "@abs/contract";
import { Catalogue, tableRecord } from "./catalogue.ts";
import { checkAvailability, type Availability } from "./availability.ts";

export interface ResolvedSelection {
  table: string;
  /** dimension id -> resolved codes, in key order. */
  codes: Map<string, string[]>;
  key: string;
  availability: Availability;
}

export type ResolveResult = { ok: true; value: ResolvedSelection } | { ok: false; error: InvalidSelection };

const VALID_OPTIONS_CAP = 40;

export function buildKey(dimensionOrder: readonly string[], codes: ReadonlyMap<string, string[]>): string {
  if (codes.size === 0) return "all";
  return dimensionOrder.map((d) => (codes.get(d) ?? []).join("+")).join(".");
}

export async function resolveSelection(
  catalogue: Catalogue,
  table: string,
  select: Selection,
): Promise<ResolveResult> {
  const t = tableRecord(table);
  if (!t) {
    return {
      ok: false,
      error: {
        table,
        dimension: null,
        given: null,
        reason: "unknown_table",
        message: `No table "${table}" serves data. Use search_tables to find one.`,
      },
    };
  }
  const order = t.dimensions.map((d) => d.id);

  const codes = new Map<string, string[]>();
  for (const [dimension, raw] of Object.entries(select)) {
    if (!order.includes(dimension)) {
      return {
        ok: false,
        error: {
          table,
          dimension,
          given: raw,
          reason: "unknown_dimension",
          message: `"${dimension}" is not a dimension of ${table}. Its dimensions, in key order: ${order.join(", ")}.`,
        },
      };
    }
    const values = Array.isArray(raw) ? raw : [raw];
    const resolved: string[] = [];
    for (const v of values) {
      const opt = await catalogue.resolveOption(table, dimension, v);
      if (!opt) {
        const { options, total } = await catalogue.options(table, dimension, { query: v, limit: VALID_OPTIONS_CAP });
        const fallback = options.length > 0 ? options : (await catalogue.options(table, dimension, { limit: VALID_OPTIONS_CAP })).options;
        return {
          ok: false,
          error: {
            table,
            dimension,
            given: v,
            reason: "unknown_option",
            message: `"${v}" matches no observed option of ${table}.${dimension}. Pass a code or an exact label; see validOptions.`,
            validOptions: fallback,
            validOptionsTotal: options.length > 0 ? total : t.dimensions.find((d) => d.id === dimension)?.optionCount,
          },
        };
      }
      resolved.push(opt.code);
    }
    codes.set(dimension, resolved);
  }

  const key = buildKey(order, codes);
  const availability = await checkAvailability(table, key);
  if (availability.exists) return { ok: true, value: { table, codes, key, availability } };

  // Diagnose: relax each specified dimension; the first relaxation that yields
  // data names the culprit and its valid options given the rest.
  const specified = [...codes.keys()];
  const relaxations = await Promise.all(
    specified.map(async (dim) => {
      const relaxed = new Map(codes);
      relaxed.delete(dim);
      return { dim, availability: await checkAvailability(table, buildKey(order, relaxed)) };
    }),
  );
  const culprit = relaxations.find((r) => r.availability.exists);
  if (culprit) {
    const validCodes = culprit.availability.available[culprit.dim] ?? [];
    const labelled = await labelCodes(catalogue, table, culprit.dim, validCodes.slice(0, VALID_OPTIONS_CAP));
    return {
      ok: false,
      error: {
        table,
        dimension: culprit.dim,
        given: codes.get(culprit.dim) ?? null,
        reason: "no_data_for_combination",
        message:
          `No data for that combination. Given your other choices, ${culprit.dim} ` +
          `has ${validCodes.length} valid option(s); see validOptions.`,
        validOptions: labelled,
        validOptionsTotal: validCodes.length,
      },
    };
  }

  return {
    ok: false,
    error: {
      table,
      dimension: null,
      given: null,
      reason: "no_data_for_combination",
      message: `No data for that combination of ${specified.join(", ")}, and no single relaxation recovers any. Loosen the selection.`,
    },
  };
}

async function labelCodes(catalogue: Catalogue, table: string, dimension: string, codes: string[]): Promise<Option[]> {
  if (codes.length === 0) return [];
  const { options } = await catalogue.options(table, dimension, { limit: 500 });
  const byCode = new Map(options.map((o) => [o.code, o] as const));
  return codes.map((c) => byCode.get(c) ?? { code: c, label: null });
}
