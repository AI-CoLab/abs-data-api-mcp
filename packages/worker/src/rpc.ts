/**
 * The RPC door: Cap'n Web (DESIGN.md decision 21). The TypeScript SDK talks to
 * this; it is also what a browser or another Worker would use for pipelined
 * calls — several verbs in one HTTP batch, or a WebSocket session.
 *
 * Implements the contract's AbsRpcApi with exactly the code the other doors
 * use (Catalogue, resolveSelection, fetchData), so observed-only holds here
 * without a second implementation. No OpenAPI story on purpose — the HTTP door
 * has that; this door has promise pipelining and typed stubs.
 */
import { RpcTarget, newWorkersRpcResponse } from "capnweb";
import {
  type AbsRpcApi,
  InvalidSelectionError,
  describeTableInputSchema,
  getDataInputSchema,
  searchOptionsInputSchema,
  searchTablesInputSchema,
} from "@abs/contract";
import type { Env } from "./env.ts";
import { Catalogue } from "./catalogue.ts";
import { resolveSelection } from "./resolve.ts";
import { fetchData } from "./abs-data.ts";

export class AbsRpcServer extends RpcTarget implements AbsRpcApi {
  readonly #catalogue: Catalogue;

  constructor(env: Env) {
    super();
    this.#catalogue = new Catalogue(env.CATALOGUE);
  }

  async searchTables(input?: unknown) {
    return this.#catalogue.searchTables(searchTablesInputSchema.parse(input ?? {}));
  }

  async describeTable(table: unknown) {
    const { table: id } = describeTableInputSchema.parse({ table });
    const described = await this.#catalogue.describeTable(id);
    if (!described) {
      throw new InvalidSelectionError({
        table: id,
        dimension: null,
        given: null,
        reason: "unknown_table",
        message: `No table "${id}" serves data.`,
      });
    }
    return described;
  }

  async searchOptions(input: unknown) {
    const i = searchOptionsInputSchema.parse(input);
    return this.#catalogue.searchOptions(i.table, i.dimension, i.query, i.limit);
  }

  async getData(input: unknown) {
    const i = getDataInputSchema.parse(input);
    const resolved = await resolveSelection(this.#catalogue, i.table, i.select);
    if (!resolved.ok) throw new InvalidSelectionError(resolved.error);
    return fetchData(resolved.value, i);
  }
}

/** Answers both an HTTP batch (POST) and a WebSocket upgrade (GET). */
export function handleRpc(request: Request, env: Env): Promise<Response> {
  return newWorkersRpcResponse(request, new AbsRpcServer(env));
}
