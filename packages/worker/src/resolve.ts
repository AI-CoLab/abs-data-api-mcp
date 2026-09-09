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
      const match = await catalogue.resolveOption(table, dimension, v);
      if (match.kind === "ambiguous") {
        return {
          ok: false,
          error: {
            table,
            dimension,
            given: v,
            reason: "ambiguous_option",
            message:
              `"${v}" matches ${match.candidates.length} options of ${table}.${dimension}; ` +
              `pass the code of the one you mean. See validOptions.`,
            validOptions: match.candidates,
            validOptionsTotal: match.candidates.length,
          },
        };
      }
      if (match.kind === "none") {
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
      resolved.push(match.option.code);
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
  // Every single relaxation that recovers data is reported: the first is the
  // headline, the rest are alternatives. "Melbourne rents quarterly" fails
  // because quarterly rents exist only for the national aggregate — but monthly
  // rents exist for Melbourne. Both routes out are worth knowing.
  const recovering = relaxations.filter((r) => r.availability.exists);
  const culprit = recovering[0];
  if (culprit) {
    const describe = async (r: (typeof recovering)[number]) => {
      const validCodes = r.availability.available[r.dim] ?? [];
      return {
        dimension: r.dim,
        validOptions: await labelCodes(catalogue, table, r.dim, validCodes.slice(0, VALID_OPTIONS_CAP)),
        validOptionsTotal: validCodes.length,
      };
    };
    const primary = await describe(culprit);
    const alternatives = await Promise.all(recovering.slice(1).map(describe));
    const summary = [primary, ...alternatives]
      .map((a) => `${a.dimension} (${a.validOptionsTotal} valid)`)
      .join(", ");
    return {
      ok: false,
      error: {
        table,
        dimension: primary.dimension,
        given: codes.get(primary.dimension) ?? null,
        reason: "no_data_for_combination",
        message:
          `No data for that combination. Loosening any one of these recovers data: ${summary}. ` +
          `validOptions shows what ${primary.dimension} could be given your other choices; alternatives cover the rest.`,
        validOptions: primary.validOptions,
        validOptionsTotal: primary.validOptionsTotal,
        ...(alternatives.length > 0 ? { alternatives } : {}),
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
