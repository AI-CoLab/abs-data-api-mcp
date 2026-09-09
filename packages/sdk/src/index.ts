/**
 * @abs/sdk — the ABS Data API front door as a typed TypeScript client.
 *
 *   import { connect, invalidSelectionFromError } from "@abs/sdk";
 *
 *   const abs = connect("https://abs-data-front-door.aicolab.workers.dev/rpc");
 *   const cpi = await abs.getData({ table: "CPI", select: { REGION: "Australia", MEASURE: "1" }, lastN: 4 });
 *
 * The stub is a Cap'n Web `RpcStub<AbsRpcApi>`: every method is typed from the
 * same Zod contract the MCP and HTTP doors serve, and calls made before the
 * first `await` travel in one HTTP batch (promise pipelining). Each `connect`
 * over HTTP is a short-lived batch session — call it per unit of work. Over
 * WebSocket the session persists; dispose it with `using` or
 * `stub[Symbol.dispose]()`.
 *
 * Only observed tables and options are ever offered or accepted; a rejected
 * selection carries what IS valid (`invalidSelectionFromError`).
 */
import { type RpcStub, newHttpBatchRpcSession, newWebSocketRpcSession } from "capnweb";
import type { AbsRpcApi } from "@abs/contract/rpc";

export type { AbsRpcApi, GetDataRequest, SearchOptionsRequest, SearchTablesRequest } from "@abs/contract/rpc";
export { InvalidSelectionError, invalidSelectionFromError } from "@abs/contract/rpc";
export type {
  DescribeTableOutput,
  DimensionDescription,
  GetDataOutput,
  InvalidSelection,
  Observation,
  Option,
  SearchOptionsOutput,
  SearchTablesOutput,
  Selection,
  TableSummary,
} from "@abs/contract/verbs";
export type { RpcPromise, RpcStub } from "capnweb";

export const DEFAULT_RPC_URL = "https://abs-data-front-door.aicolab.workers.dev/rpc";

export interface ConnectOptions {
  /**
   * "http" (default): one batched request per session — stateless, cacheable,
   * right for scripts and serverless callers. "websocket": a persistent
   * session for many calls; the URL scheme is rewritten to ws(s).
   */
  transport?: "http" | "websocket";
}

export type AbsClient = RpcStub<AbsRpcApi>;

/** Open a session to the RPC door. Defaults to the deployed front door. */
export function connect(url: string = DEFAULT_RPC_URL, options: ConnectOptions = {}): AbsClient {
  if (options.transport === "websocket") {
    return newWebSocketRpcSession<AbsRpcApi>(url.replace(/^http/, "ws"));
  }
  return newHttpBatchRpcSession<AbsRpcApi>(url);
}
