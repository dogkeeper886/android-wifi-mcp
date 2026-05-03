import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';

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
  parent_id: string | null;
  trace_flags: string;
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
 */
export function newTraceContext(): TraceContext {
  return {
    trace_id: randomBytes(16).toString('hex'),
    parent_id: null,
    trace_flags: '01',
    sampled: true,
  };
}
