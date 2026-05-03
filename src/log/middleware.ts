import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { recordToolCall, type ToolCallRecord } from '../db/writer.js';
import { redactArgs } from './redact.js';
import { attributeFailure, RECENT_EVENTS_LIMIT, type RelatedEvent } from './attribution.js';
import { logger } from './logger.js';
import { getTraceId, getSessionId, newTraceContext } from './trace-context.js';
import type { UpstreamProxy } from '../mcp/upstream-proxy.js';

const log = logger.child({ component: 'middleware' });

/* eslint-disable @typescript-eslint/no-explicit-any */
type ToolsCallHandler = (request: any, extra: any) => Promise<any>;
type Recorder = (call: ToolCallRecord) => Promise<void>;

/**
 * Loose dep on the device observer so the middleware can correlate failed
 * tool calls with recent device transitions (Phase 4 attribution). Pick'd
 * to a single method for testability — tests pass `{ getRecent: () => [...] }`
 * without standing up the real observer.
 */
export interface RecentEventsSource {
  getRecent(limit?: number): RelatedEvent[];
}

/**
 * Build a handler that wraps `original` with the recording layer. Exported so
 * unit tests can drive the wrapping in isolation, without standing up an
 * McpServer.
 */
export function buildRecordingHandler(
  original: ToolsCallHandler,
  proxy?: Pick<UpstreamProxy, 'getSurfaceForTool'>,
  recorder: Recorder = recordToolCall,
  observer?: RecentEventsSource
): ToolsCallHandler {
  return async (request, extra) => {
    const name = request.params.name;
    const args = redactArgs(request.params.arguments ?? null);
    const surface = proxy?.getSurfaceForTool(name) ?? 'native';
    const startedAt = new Date();
    // Trace id comes from the ALS-stored context (set by the express layer
    // from incoming traceparent or freshly generated). Falls back to a
    // freshly-minted W3C-format trace id when called outside any HTTP
    // request — primarily a unit-test convenience. Format matches
    // newTraceContext so rows from both paths look identical in queries.
    const traceId = getTraceId() ?? newTraceContext().trace_id;
    // Session id comes from the same ALS, populated by the express layer
    // after the per-session transport has assigned one. null on initialize
    // (no tool calls fire there anyway) and outside any HTTP context.
    const sessionId = getSessionId() ?? null;

    let result: unknown;
    let errorPayload: Record<string, unknown> | undefined;
    try {
      result = await original(request, extra);
      // Tools signal failure two ways: throw, or return { isError: true, ... }.
      // The SDK passes the latter through as a normal JSON-RPC result, so we
      // have to inspect the shape here — otherwise the error column stays null
      // for tool-level failures and Phase 4's diagnosis queries miss them.
      if (
        typeof result === 'object' &&
        result !== null &&
        (result as { isError?: boolean }).isError === true
      ) {
        errorPayload = {
          source: 'tool_result',
          content: (result as { content?: unknown }).content,
        };
      }
      return result;
    } catch (err) {
      errorPayload = {
        source: 'thrown',
        message: (err as Error).message,
        name: (err as Error).name,
      };
      throw err;
    } finally {
      const completedAt = new Date();

      // Phase 4: when the call failed, look at recent device transitions and
      // try to classify the cause. Attribution only attaches when there's a
      // genuinely related event in the failure window; tool-internal errors
      // (bad args, timeouts, etc.) leave the column unset.
      if (errorPayload && observer) {
        const events = observer.getRecent(RECENT_EVENTS_LIMIT);
        const attribution = attributeFailure(
          { started_at: startedAt, completed_at: completedAt },
          events
        );
        if (attribution) errorPayload.attribution = attribution;
      }

      void recorder({
        trace_id: traceId,
        session_id: sessionId,
        tool_name: name,
        surface,
        args,
        result: errorPayload ? undefined : result,
        error: errorPayload,
        started_at: startedAt,
        completed_at: completedAt,
      }).catch((err) => log.warn({ err }, 'recorder threw unexpectedly'));
    }
  };
}

/**
 * Wrap the existing tools/call handler with a recording layer that writes
 * every call to the tool_calls table. Must be installed AFTER native tools
 * are registered and (optionally) the upstream proxy is attached, so we wrap
 * the final, composed handler.
 *
 * Recording is fire-and-forget; DB outages never propagate to the caller.
 * When DATABASE_URL is unset the writer is a no-op.
 */
export function installCallRecording(
  mcpServer: McpServer,
  proxy?: UpstreamProxy,
  observer?: RecentEventsSource,
  recorder: Recorder = recordToolCall
): void {
  const server = mcpServer.server;
  const handlers = (server as any)._requestHandlers as Map<string, ToolsCallHandler>;
  const original = handlers.get('tools/call');
  if (!original) {
    throw new Error(
      'McpServer has no tools/call handler — installCallRecording must run after createMcpServer'
    );
  }
  server.setRequestHandler(
    CallToolRequestSchema,
    buildRecordingHandler(original, proxy, recorder, observer)
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */
