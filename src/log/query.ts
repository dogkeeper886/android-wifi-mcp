/**
 * Structured query layer over `tool_calls` + `device_events` (Phase 5 of #51).
 *
 * The SQL builder is exported pure for testing. The executor reads from the
 * lazy pg pool — when DATABASE_URL is unset the tool returns a note rather
 * than rows.
 */

import { getPool } from '../db/pool.js';
import { logger } from './logger.js';

const log = logger.child({ component: 'query' });

const KNOWN_CLASSIFICATIONS = [
  'physical_disconnect',
  'rsa_revoked',
  'adb_server_confusion',
  'unknown_disconnect',
] as const;
export type Classification = (typeof KNOWN_CLASSIFICATIONS)[number];
const KNOWN_CLASSIFICATION_SET: ReadonlySet<string> = new Set(KNOWN_CLASSIFICATIONS);

const MAX_LIMIT = 1000;
const DEFAULT_LIMIT = 50;

export interface QueryFilters {
  trace_id?: string;
  session_id?: string;
  tool_name?: string;
  surface?: string;
  since?: string;          // ISO timestamp; rows with started_at >= since
  until?: string;          // ISO timestamp; rows with started_at <= until
  errors_only?: boolean;
  classification?: Classification;
  limit?: number;
  offset?: number;
  include_events?: boolean;
}

export interface BuiltQuery {
  callsSql: string;
  callsParams: unknown[];
  countSql: string;
  countParams: unknown[];
  /** Set when include_events is true AND there's at least one filter that scopes results to a finite trace set. */
  eventsSql?: string;
  eventsParams?: unknown[];
}

/**
 * Pure function — exported for unit testing. Builds a parameterized SQL
 * query from the structured filter set. Never interpolates user input.
 */
export function buildQuery(filters: QueryFilters): BuiltQuery {
  const where: string[] = [];
  const params: unknown[] = [];

  const push = (clause: (idx: number) => string, value: unknown) => {
    params.push(value);
    where.push(clause(params.length));
  };

  if (filters.trace_id) push((i) => `trace_id = $${i}`, filters.trace_id);
  if (filters.session_id) push((i) => `session_id = $${i}`, filters.session_id);
  if (filters.tool_name) push((i) => `tool_name = $${i}`, filters.tool_name);
  if (filters.surface) push((i) => `surface = $${i}`, filters.surface);
  if (filters.since) push((i) => `started_at >= $${i}`, parseTs(filters.since, 'since'));
  if (filters.until) push((i) => `started_at <= $${i}`, parseTs(filters.until, 'until'));
  if (filters.errors_only) where.push(`error IS NOT NULL`);
  if (filters.classification) {
    if (!KNOWN_CLASSIFICATION_SET.has(filters.classification)) {
      throw new Error(`Unknown classification '${filters.classification}'`);
    }
    push((i) => `error->'attribution'->>'classification' = $${i}`, filters.classification);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const limit = clampLimit(filters.limit);
  const offset = Math.max(0, Math.floor(filters.offset ?? 0));

  // Newest-first so the "what happened recently" common case is cheap.
  const callsSql = `
    SELECT call_id, trace_id, parent_call_id, session_id, connection_id,
           tool_name, surface, args, result, error,
           started_at, completed_at, duration_ms
    FROM tool_calls
    ${whereSql}
    ORDER BY started_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  const callsParams = [...params];

  // Separate count query — running it on the same filters is cheap on a small
  // table and lets pagination know when there's more.
  const countSql = `SELECT count(*)::int AS total FROM tool_calls ${whereSql}`;
  const countParams = [...params];

  // Events: only run when include_events is set AND a trace-scoping filter is
  // present, otherwise we'd return events for the entire DB.
  let eventsSql: string | undefined;
  let eventsParams: unknown[] | undefined;
  if (filters.include_events) {
    if (!filters.trace_id) {
      // We can't sanely correlate events by tool_name or session_id today —
      // device_events.serial is the join key for those, and that requires a
      // join through tool_calls.args which we don't enforce. Defer until
      // there's a real cross-table need.
      eventsSql = undefined;
    } else {
      eventsSql = `
        SELECT event_id, trace_id, layer, serial, state, raw, occurred_at
        FROM device_events
        WHERE trace_id = $1
        ORDER BY occurred_at ASC
      `;
      eventsParams = [filters.trace_id];
    }
  }

  return { callsSql, callsParams, countSql, countParams, eventsSql, eventsParams };
}

function parseTs(s: string, label: string): Date {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid ${label} timestamp: ${s}`);
  }
  return d;
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  const n = Math.floor(limit);
  if (n < 1) return 1;
  if (n > MAX_LIMIT) return MAX_LIMIT;
  return n;
}

export interface QueryResult {
  count: number;          // rows returned (after pagination)
  total_matched: number;  // total matching rows (before pagination)
  limit: number;
  offset: number;
  calls: unknown[];
  events?: unknown[];
  note?: string;
}

/**
 * Execute a structured query. Tolerates a missing pg pool (DATABASE_URL
 * unset) — returns an empty result with a note, never throws.
 */
export async function runQuery(filters: QueryFilters): Promise<QueryResult> {
  const pool = getPool();
  const limit = clampLimit(filters.limit);
  const offset = Math.max(0, Math.floor(filters.offset ?? 0));

  if (!pool) {
    return {
      count: 0,
      total_matched: 0,
      limit,
      offset,
      calls: [],
      note: 'DATABASE_URL is unset — structured logging disabled. Set it and restart the server to enable query_log.',
    };
  }

  let built: BuiltQuery;
  try {
    built = buildQuery(filters);
  } catch (err) {
    return {
      count: 0,
      total_matched: 0,
      limit,
      offset,
      calls: [],
      note: `Filter validation failed: ${(err as Error).message}`,
    };
  }

  try {
    const callsRes = await pool.query(built.callsSql, built.callsParams);
    const countRes = await pool.query(built.countSql, built.countParams);

    let events: unknown[] | undefined;
    if (built.eventsSql) {
      const eventsRes = await pool.query(built.eventsSql, built.eventsParams);
      events = eventsRes.rows;
    }

    return {
      count: callsRes.rowCount ?? callsRes.rows.length,
      total_matched: countRes.rows[0]?.total ?? 0,
      limit,
      offset,
      calls: callsRes.rows,
      events,
    };
  } catch (err) {
    log.warn({ err }, 'query_log execution failed');
    return {
      count: 0,
      total_matched: 0,
      limit,
      offset,
      calls: [],
      note: `Query execution failed: ${(err as Error).message}`,
    };
  }
}

export { KNOWN_CLASSIFICATIONS };
