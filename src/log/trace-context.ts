import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import { parseTraceparent } from './traceparent.js';

/**
 * Per-request trace context, propagated via AsyncLocalStorage so deep callees
 * (db writer, adb commands, pino mixin) can read it without threading a
 * parameter through every function.
 *
 * Populated at the express boundary in src/index.ts: parse incoming
 * `traceparent` (or generate fresh), call `runWithTraceContext` around
 * `transport.handleRequest`. Everything inside sees the context until the
 * request completes.
 */
export interface TraceContext {
  trace_id: string;
  /**
   * W3C parent-span-id (16 hex chars, see traceparent spec).
   * NOT to be confused with `tool_calls.parent_call_id` in the schema, which
   * is the parent *tool call*'s UUID — a different concept entirely.
   */
  parent_span_id: string | null;
  trace_flags: string;
  /**
   * W3C sampling flag, parsed from `trace_flags`. We always record regardless
   * — sampled is informational only, kept on the context so future export to
   * an OTel collector preserves the upstream caller's decision.
   */
  sampled: boolean;
  /**
   * MCP transport session id (Phase 2). Populated by the express layer when
   * a per-session transport is in play. null on initialize requests (where
   * the session hasn't been assigned yet — but those don't generate
   * tool_calls rows anyway) and when stateless mode is in use.
   */
  session_id: string | null;
}

const als = new AsyncLocalStorage<TraceContext>();

export function runWithTraceContext<T>(ctx: TraceContext, fn: () => T): T {
  return als.run(ctx, fn);
}

export function getTraceContext(): TraceContext | undefined {
  return als.getStore();
}

export function getTraceId(): string | undefined {
  return als.getStore()?.trace_id;
}

export function getSessionId(): string | null | undefined {
  return als.getStore()?.session_id;
}

/**
 * Build a fresh trace context — used when no traceparent header is present.
 * trace_id is 32 hex chars (W3C format, also accepted by Postgres uuid type).
 *
 * `sampled` is always true on freshly-minted contexts: this server is the
 * trace origin in that case, so there's no upstream sampling decision to
 * honor. The flag is informational; we always record.
 */
export function newTraceContext(): TraceContext {
  return {
    trace_id: randomBytes(16).toString('hex'),
    parent_span_id: null,
    trace_flags: '01',
    sampled: true,
    session_id: null,
  };
}

/**
 * Build the per-request trace context from an incoming HTTP request.
 *
 * Honors:
 *  - W3C `traceparent` for trace_id / parent_span_id / sampled. Missing or
 *    malformed → mint a fresh trace_id.
 *  - `Mcp-Session-Id` (Phase 2a) as a client-provided session label. Pure
 *    tag today — the SDK transport is stateless because its Server is
 *    single-transport, so server-managed sessions would need one McpServer
 *    per session (deferred). Whatever the client sends is the logical
 *    caller identity for query_log grouping.
 *
 * Exported (rather than living inline in src/index.ts) so the express → ALS
 * wiring has a unit-testable seam.
 */
export function establishTraceContext(req: { header(name: string): string | undefined }): TraceContext {
  const tp = req.header('traceparent');
  const parsed = parseTraceparent(tp);
  const session_id = req.header('mcp-session-id') ?? null;
  if (!parsed) {
    return { ...newTraceContext(), session_id };
  }
  return {
    trace_id: parsed.trace_id,
    parent_span_id: parsed.parent_id,
    trace_flags: parsed.trace_flags,
    sampled: parsed.sampled,
    session_id,
  };
}
