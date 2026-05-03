import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { recordToolCall } from '../db/writer.js';
import { logger } from './logger.js';
import type { UpstreamProxy } from '../mcp/upstream-proxy.js';

const log = logger.child({ component: 'middleware' });

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
  proxy?: UpstreamProxy
): void {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const server = mcpServer.server;
  const handlers = (server as any)._requestHandlers as Map<
    string,
    (request: any, extra: any) => Promise<any>
  >;
  const original = handlers.get('tools/call');
  if (!original) {
    throw new Error(
      'McpServer has no tools/call handler — installCallRecording must run after createMcpServer'
    );
  }

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const name = request.params.name;
    const args = request.params.arguments ?? null;
    const surface = proxy?.getSurfaceForTool(name) ?? 'native';
    const startedAt = new Date();
    const traceId = randomUUID();

    let result: unknown;
    let errorPayload: unknown;
    try {
      result = await original(request, extra);
      return result as any;
    } catch (err) {
      errorPayload = {
        message: (err as Error).message,
        name: (err as Error).name,
      };
      throw err;
    } finally {
      const completedAt = new Date();
      void recordToolCall({
        trace_id: traceId,
        tool_name: name,
        surface,
        args,
        result: errorPayload ? undefined : result,
        error: errorPayload,
        started_at: startedAt,
        completed_at: completedAt,
      }).catch((err) => log.warn({ err }, 'recordToolCall threw unexpectedly'));
    }
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */
}
