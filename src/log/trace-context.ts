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
  };
}

/**
 * Build the per-request trace context from an incoming HTTP request.
 * Honors a valid `traceparent` header when present, otherwise mints a
 * fresh context. Exported (rather than living inline in src/index.ts) so
 * the express → ALS wiring has a unit-testable seam.
 */
export function establishTraceContext(req: { header(name: string): string | undefined }): TraceContext {
  const tp = req.header('traceparent');
  const parsed = parseTraceparent(tp);
  if (!parsed) return newTraceContext();
  return {
    trace_id: parsed.trace_id,
    parent_span_id: parsed.parent_id,
    trace_flags: parsed.trace_flags,
    sampled: parsed.sampled,
  };
}
