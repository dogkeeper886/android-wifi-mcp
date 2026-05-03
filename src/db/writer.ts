import { getPool } from './pool.js';
import { logger } from '../log/logger.js';
import type { Attribution } from '../log/attribution.js';

const log = logger.child({ component: 'db.writer' });

/**
 * Shape of the `tool_calls.error` JSONB column. Two variants — one for
 * thrown exceptions, one for tools that returned `{ isError: true, ... }`
 * — both optionally carrying a Phase 4 attribution. Documented here so
 * Phase 5's query_log and any downstream consumer have a typed reference.
 */
export type ToolCallErrorThrown = {
  source: 'thrown';
  message: string;
  name: string;
  attribution?: Attribution;
};

export type ToolCallErrorToolResult = {
  source: 'tool_result';
  content: unknown;
  attribution?: Attribution;
};

export type ToolCallError = ToolCallErrorThrown | ToolCallErrorToolResult;

export interface ToolCallRecord {
  call_id?: string;
  trace_id?: string | null;
  parent_call_id?: string | null;
  session_id?: string | null;
  connection_id?: string | null;
  client_info?: unknown;
  tool_name: string;
  surface: string;
  args?: unknown;
  result?: unknown;
  error?: unknown;
  started_at: Date;
  completed_at: Date | null;
}

export interface DeviceEventRecord {
  trace_id?: string | null;
  layer: string;
  serial?: string | null;
  state?: string | null;
  raw?: unknown;
  occurred_at?: Date;
}

export interface SessionRecord {
  session_id: string;
  client_info?: unknown;
  selected_serial?: string | null;
  upstream_ctx_map?: unknown;
}

const TOOL_CALLS_INSERT = `
  INSERT INTO tool_calls (
    call_id, trace_id, parent_call_id, session_id, connection_id, client_info,
    tool_name, surface, args, result, error, started_at, completed_at
  ) VALUES (
    COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6,
    $7, $8, $9, $10, $11, $12, $13
  )
`;

export async function recordToolCall(call: ToolCallRecord): Promise<void> {
  const pool = getPool();
  if (!pool) return;
  try {
    await pool.query(TOOL_CALLS_INSERT, [
      call.call_id ?? null,
      call.trace_id ?? null,
      call.parent_call_id ?? null,
      call.session_id ?? null,
      call.connection_id ?? null,
      call.client_info ? JSON.stringify(call.client_info) : null,
      call.tool_name,
      call.surface,
      call.args !== undefined ? JSON.stringify(call.args) : null,
      call.result !== undefined ? JSON.stringify(call.result) : null,
      call.error !== undefined ? JSON.stringify(call.error) : null,
      call.started_at,
      call.completed_at,
    ]);
  } catch (err) {
    log.warn({ err, tool: call.tool_name }, 'recordToolCall failed');
  }
}

const DEVICE_EVENTS_INSERT = `
  INSERT INTO device_events (trace_id, layer, serial, state, raw, occurred_at)
  VALUES ($1, $2, $3, $4, $5, COALESCE($6, now()))
`;

export async function recordDeviceEvent(event: DeviceEventRecord): Promise<void> {
  const pool = getPool();
  if (!pool) return;
  try {
    await pool.query(DEVICE_EVENTS_INSERT, [
      event.trace_id ?? null,
      event.layer,
      event.serial ?? null,
      event.state ?? null,
      event.raw !== undefined ? JSON.stringify(event.raw) : null,
      event.occurred_at ?? null,
    ]);
  } catch (err) {
    log.warn({ err, layer: event.layer }, 'recordDeviceEvent failed');
  }
}

const SESSIONS_UPSERT = `
  INSERT INTO sessions (session_id, client_info, selected_serial, upstream_ctx_map)
  VALUES ($1, $2, $3, $4)
  ON CONFLICT (session_id) DO UPDATE SET
    client_info = EXCLUDED.client_info,
    selected_serial = EXCLUDED.selected_serial,
    upstream_ctx_map = EXCLUDED.upstream_ctx_map,
    last_active_at = now()
`;

export async function recordSession(session: SessionRecord): Promise<void> {
  const pool = getPool();
  if (!pool) return;
  try {
    await pool.query(SESSIONS_UPSERT, [
      session.session_id,
      session.client_info ? JSON.stringify(session.client_info) : null,
      session.selected_serial ?? null,
      session.upstream_ctx_map ? JSON.stringify(session.upstream_ctx_map) : null,
    ]);
  } catch (err) {
    log.warn({ err, session: session.session_id }, 'recordSession failed');
  }
}
