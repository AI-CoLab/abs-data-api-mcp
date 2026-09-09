/**
 * Rate limiting (DESIGN.md decision 22, the deliberately-last step).
 *
 * Public and unauthenticated by design, so the key is the client IP. Three
 * tiers, because the cost of a request is what matters, not its count:
 *
 *   READS     every request. Catalogue lookups are D1-backed and cacheable.
 *   UPSTREAM  requests that will call ABS: get_data / getData / GET|POST /api/data.
 *             Each is an oracle check plus a data pull against a public API we
 *             are a front door to, not a shield for.
 *   EXECUTE   Code Mode `execute`: one call may make 50 upstream requests from
 *             inside the sandbox, so it is budgeted an order of magnitude tighter.
 *
 * Enforced once, at the edge, by classifying the request — every door is
 * covered without threading a limiter through four implementations. Uses the
 * Workers Rate Limiting binding (per-colo sliding window); absent bindings
 * (local dev without them) mean no limiting, never a failure.
 */
import type { Env } from "./env.ts";

export type Tier = "READS" | "UPSTREAM" | "EXECUTE";

/** Mirrors wrangler.toml; used for the message and Retry-After. */
export const LIMITS: Record<Tier, { limit: number; period: number }> = {
  READS: { limit: 600, period: 60 },
  UPSTREAM: { limit: 120, period: 60 },
  EXECUTE: { limit: 20, period: 60 },
};

export interface Classified {
  tiers: Tier[];
  /** For MCP tools/call: the JSON-RPC id, so a limit can answer as a tool error. */
  jsonRpcId?: string | number | null | undefined;
  toolName?: string | undefined;
}

/** Which budgets a request draws on, from its route and, for MCP/RPC, its body. */
export async function classify(request: Request, url: URL): Promise<Classified> {
  const tiers: Tier[] = ["READS"];
  const upstream = () => tiers.push("UPSTREAM");

  if (url.pathname === "/api/data") {
    upstream();
    return { tiers };
  }

  if (url.pathname === "/mcp" && request.method === "POST") {
    // 2026-07-28 header routing names the tool; older clients only put it in the body.
    let toolName = request.headers.get("Mcp-Name") ?? undefined;
    let jsonRpcId: Classified["jsonRpcId"];
    if (request.headers.get("Mcp-Method") !== "tools/call" || !toolName) {
      const body = await peekJson(request);
      if (body && body["method"] === "tools/call") {
        const params = body["params"] as Record<string, unknown> | undefined;
        toolName = typeof params?.["name"] === "string" ? (params["name"] as string) : toolName;
        jsonRpcId = body["id"] as Classified["jsonRpcId"];
      } else {
        toolName = undefined;
      }
    } else {
      const body = await peekJson(request);
      jsonRpcId = body?.["id"] as Classified["jsonRpcId"];
    }
    if (toolName === "execute") tiers.push("EXECUTE");
    else if (toolName === "get_data") upstream();
    return { tiers, jsonRpcId, toolName };
  }

  if (url.pathname === "/rpc" && request.method === "POST") {
    // A Cap'n Web batch is newline-separated expressions; a getData call names
    // its method as a string literal. One batch may carry several, hence the
    // count-insensitive check: the tier is charged once per request.
    const text = await request.clone().text().catch(() => "");
    if (/"getData"/.test(text)) upstream();
    return { tiers };
  }

  return { tiers };
}

async function peekJson(request: Request): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed: unknown = await request.clone().json();
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

export interface Exceeded {
  tier: Tier;
  retryAfterSeconds: number;
  message: string;
}

/** Charge every tier the request draws on; report the first that is exhausted. */
export async function enforce(env: Env, request: Request, tiers: Tier[]): Promise<Exceeded | undefined> {
  const key = request.headers.get("cf-connecting-ip") ?? "unknown";
  for (const tier of tiers) {
    const binding = env[tier];
    if (!binding) continue;
    const { success } = await binding.limit({ key });
    if (!success) {
      const { limit, period } = LIMITS[tier];
      return {
        tier,
        retryAfterSeconds: period,
        message:
          tier === "EXECUTE"
            ? `Rate limited: more than ${limit} execute calls per ${period}s from this address. Each execute may make 50 upstream calls; batch more work into fewer calls, or use get_data for single series.`
            : tier === "UPSTREAM"
              ? `Rate limited: more than ${limit} data requests per ${period}s from this address. Catalogue verbs (search, describe, options) are not limited this way; for bulk pulls use fullDataUrl against ABS directly.`
              : `Rate limited: more than ${limit} requests per ${period}s from this address.`,
      };
    }
  }
  return undefined;
}

/** The 429 every door answers with; MCP tools/call gets a tool error instead so the model can adapt. */
export function limitedResponse(exceeded: Exceeded, classified: Classified): Response {
  const body = { reason: "rate_limited", tier: exceeded.tier, retryAfterSeconds: exceeded.retryAfterSeconds, message: exceeded.message };
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "retry-after": String(exceeded.retryAfterSeconds),
    "cache-control": "no-store",
  };
  if (classified.toolName !== undefined && classified.jsonRpcId !== undefined) {
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: classified.jsonRpcId,
        result: { isError: true, content: [{ type: "text", text: exceeded.message }], structuredContent: body },
      }),
      { status: 200, headers },
    );
  }
  return new Response(JSON.stringify(body, null, 2), { status: 429, headers });
}
