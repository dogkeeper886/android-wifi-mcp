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
   * Client-provided logical caller id (Phase 2a). Populated by the express
   * layer from the `X-Caller-Session-Id` request header. null when the
   * client doesn't send it. NOT the MCP spec's `Mcp-Session-Id` — that's
   * server-issued and we're stateless. This is purely a label for grouping
   * tool_calls rows by caller (e.g. two parallel Claude Code windows).
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

/** Returns the active session label, or null when ALS is empty or no header was sent. */
export function getSessionId(): string | null {
  return als.getStore()?.session_id ?? null;
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
 * Max length we'll accept for a client-provided session label. Bounded so a
 * pathological caller can't bloat the DB or log lines. 256 chars is generous
 * for any realistic label (UUIDs, hostnames, "user@host", etc).
 */
const MAX_SESSION_ID_LEN = 256;

function readSessionHeader(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.length > MAX_SESSION_ID_LEN
    ? trimmed.slice(0, MAX_SESSION_ID_LEN)
    : trimmed;
}

/**
 * Build the per-request trace context from an incoming HTTP request.
 *
 * Honors:
 *  - W3C `traceparent` for trace_id / parent_span_id / sampled. Missing or
 *    malformed → mint a fresh trace_id.
 *  - `X-Caller-Session-Id` (Phase 2a) as a client-provided session label
 *    for grouping tool_calls rows by logical caller. Custom header chosen
 *    deliberately to avoid colliding with the MCP HTTP spec's
 *    `Mcp-Session-Id`, which is server-issued in stateful mode — we're
 *    stateless (the SDK Server is single-transport-per-instance, so true
 *    server-managed sessions would need one McpServer per session,
 *    deferred). Empty / whitespace-only / oversized values are normalized
 *    to null or truncated.
 *
 * Exported (rather than living inline in src/index.ts) so the express → ALS
 * wiring has a unit-testable seam.
 */
export function establishTraceContext(req: { header(name: string): string | undefined }): TraceContext {
  const tp = req.header('traceparent');
  const parsed = parseTraceparent(tp);
  const session_id = readSessionHeader(req.header('x-caller-session-id'));
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
