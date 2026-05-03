import pino, { type Logger } from 'pino';
import { createWriteStream } from 'node:fs';
import { getTraceContext } from './trace-context.js';

const level = process.env.LOG_LEVEL ?? 'info';
const dest = process.env.LOG_DEST ?? 'stderr';

const stream =
  dest === 'stderr' || dest === ''
    ? pino.destination(2)
    : createWriteStream(dest, { flags: 'a' });

// `mixin` runs on every log line and returns extra fields to merge.
// We use it to inject the active trace context (set by the express layer
// via runWithTraceContext) so any log emitted while a tool call is
// in-flight is automatically tagged. Only `trace_id` is emitted —
// `sampled` is informational and never queried, so dropping it keeps
// log lines tighter without losing any join key for query_log.
export const logger: Logger = pino(
  {
    level,
    mixin: () => {
      const ctx = getTraceContext();
      if (!ctx) return {};
      return { trace_id: ctx.trace_id };
    },
  },
  stream
);
