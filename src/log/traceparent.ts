/**
 * W3C Trace Context "traceparent" header parser.
 *
 * Format (version 00, the only one currently defined):
 *   traceparent = "00-" trace-id "-" parent-id "-" trace-flags
 *   trace-id    = 32 lowercase hex chars, must not be all zero
 *   parent-id   = 16 lowercase hex chars, must not be all zero
 *   trace-flags = 2 lowercase hex chars; bit 0 is "sampled"
 *
 * Spec: https://www.w3.org/TR/trace-context/#traceparent-header
 *
 * Pure function — exported for unit testing.
 */

export interface ParsedTraceparent {
  version: string;
  trace_id: string;
  parent_id: string;
  trace_flags: string;
  sampled: boolean;
}

const TRACEPARENT_RE =
  /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

const ALL_ZERO_TRACE_ID = '0'.repeat(32);
const ALL_ZERO_PARENT_ID = '0'.repeat(16);

export function parseTraceparent(header: string | undefined): ParsedTraceparent | null {
  if (!header) return null;
  // The spec allows comma-separated lists from proxies; we honor only the first.
  const first = header.split(',')[0]?.trim();
  if (!first) return null;

  const match = TRACEPARENT_RE.exec(first);
  if (!match) return null;

  const [, version, trace_id, parent_id, trace_flags] = match;

  // Version FF is reserved for future use and MUST NOT be sent. We accept
  // unknown versions (forward compat per spec section 3.2.2.1) only when
  // they're not FF.
  if (version === 'ff') return null;

  if (trace_id === ALL_ZERO_TRACE_ID) return null;
  if (parent_id === ALL_ZERO_PARENT_ID) return null;

  return {
    version,
    trace_id,
    parent_id,
    trace_flags,
    sampled: (parseInt(trace_flags, 16) & 0x01) === 0x01,
  };
}

/**
 * Convert a 32-hex W3C trace-id into the 8-4-4-4-12 UUID string our DB expects.
 * Postgres `uuid` type accepts either form, but normalizing keeps query
 * filtering and join keys consistent.
 */
export function traceIdToUuid(traceId: string): string {
  if (traceId.length !== 32) {
    throw new Error(`trace-id must be 32 hex chars, got ${traceId.length}`);
  }
  return [
    traceId.slice(0, 8),
    traceId.slice(8, 12),
    traceId.slice(12, 16),
    traceId.slice(16, 20),
    traceId.slice(20, 32),
  ].join('-');
}
