/**
 * The RPC face of the contract — the interface the Cap'n Web door implements
 * and the TypeScript SDK's stub is typed as (DESIGN.md decision 21).
 *
 * Same four verbs, same Zod-derived types as the MCP and HTTP doors; nothing
 * here is hand-shaped per table. Inputs are the schemas' *input* types, so
 * fields with defaults (limit, select, maxRows) are optional for callers.
 *
 * Failure shape: a rejected call whose Error message is the InvalidSelection
 * JSON — the same convention the Code Mode sandbox client uses — because RPC
 * serialises Errors by message. `invalidSelectionFromError` recovers the typed
 * object on the client.
 */
import type { z } from "zod";
import {
  type DescribeTableOutput,
  type GetDataOutput,
  type InvalidSelection,
  type SearchOptionsOutput,
  type SearchTablesOutput,
  type getDataInputSchema,
  invalidSelectionSchema,
  type searchOptionsInputSchema,
  type searchTablesInputSchema,
} from "./verbs.ts";

export type SearchTablesRequest = z.input<typeof searchTablesInputSchema>;
export type SearchOptionsRequest = z.input<typeof searchOptionsInputSchema>;
export type GetDataRequest = z.input<typeof getDataInputSchema>;

export interface AbsRpcApi {
  /** Free-text search over the observed tables; empty input lists the largest. */
  searchTables(input?: SearchTablesRequest): Promise<SearchTablesOutput>;
  /** Key structure, observed options and coverage of one table. Rejects with unknown_table. */
  describeTable(table: string): Promise<DescribeTableOutput>;
  /** Options of one dimension matching a query, by code or label. */
  searchOptions(input: SearchOptionsRequest): Promise<SearchOptionsOutput>;
  /** Validate the selection against observation (live oracle), then fetch. Rejects with InvalidSelection. */
  getData(input: GetDataRequest): Promise<GetDataOutput>;
}

/** Method names of the RPC API, for doors that enumerate the surface. */
export const RPC_METHODS = ["searchTables", "describeTable", "searchOptions", "getData"] as const satisfies ReadonlyArray<keyof AbsRpcApi>;

/** Thrown by RPC (and sandbox) methods for a selection observation rejects. */
export class InvalidSelectionError extends Error {
  readonly selection: InvalidSelection;
  constructor(selection: InvalidSelection) {
    super(JSON.stringify(selection));
    this.name = "InvalidSelectionError";
    this.selection = selection;
  }
}

/**
 * Recover the typed InvalidSelection from any rejection — a local
 * InvalidSelectionError, or an Error that crossed RPC and kept only its message.
 */
export function invalidSelectionFromError(err: unknown): InvalidSelection | undefined {
  if (err instanceof InvalidSelectionError) return err.selection;
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : undefined;
  if (!message || !message.startsWith("{")) return undefined;
  try {
    const parsed = invalidSelectionSchema.safeParse(JSON.parse(message));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
