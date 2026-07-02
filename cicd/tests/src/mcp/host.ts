/**
 * Vendor-neutral MCP host: let a model-under-test drive a real MCP server's tools
 * end-to-end (no mock).
 *
 * Fork note: upstream connects to *stdio* MCP servers. Our server speaks HTTP, so we
 * spawn each server on an OS-assigned port (mcp/http-server.ts) and connect over
 * StreamableHTTP. The rest — merge every server's tools into one menu, run the tool
 * loop (chat → callTool against the real server → feed results back → chat) — is
 * transport-agnostic and unchanged.
 *
 * What's tested is the MODEL: given a real menu, does it pick the right tool with
 * valid args and use the result? The model runtime is reached ONLY through the
 * injected `ChatBackend` (chat-backend.ts) — this file knows nothing vendor-specific.
 * A model whose template lacks tool support is reported `supported:false` (a clean
 * verdict, not a crash). The server choice + credentials are config, not code.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { ChatBackend, ChatTool, ChatMessage } from './chat-backend.js';
import type { McpServerConfig } from './server-config.js';
import { spawnHttpMcpServer } from './http-server.js';

export interface McpHostOptions {
  /** The model runtime under test (the only thing that knows a vendor). */
  backend: ChatBackend;
  model: string;
  prompt: string;
  /** One or more MCP servers whose tools are merged into a single menu the model
   *  picks from. Two+ servers make "tool selection" a real choice; a tool call
   *  routes back to its owning server. */
  servers: McpServerConfig[];
  numCtx?: number;
  /** Max chat↔tool rounds before giving up (guards against a tool loop). */
  maxIters?: number;
  /** Per-call response timeout (ms). Default 600000 (10 min) — heavy models on slow
   *  hardware need more than fetch's implicit ~5-min default. */
  timeoutMs?: number;
}

export interface ToolCallRecord {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResultRecord {
  name: string;
  content: string;
  isError: boolean;
}

export interface McpTrajectory {
  model: string;
  /** false ⇢ the model's template can't do tools (the backend signalled it). */
  supported: boolean;
  /** Tool names the MCP server(s) exposed (merged across servers). */
  toolNames: string[];
  /** Required arg names per tool, from each tool's inputSchema.required. */
  toolRequired: Record<string, string[]>;
  /** Which server each tool came from (toolName → server name) — lets a caller
   *  pick out one server's tools (e.g. the verifier's read-only server). */
  toolServer: Record<string, string>;
  toolCalls: ToolCallRecord[];
  toolResults: ToolResultRecord[];
  finalAnswer: string;
  /** Generation perf, summed across the chat↔tool rounds. */
  inTokens: number;
  /** Largest single round's prompt tokens — the value to compare against num_ctx
   *  (summed inTokens spans rounds and can't be compared to the window). */
  maxPromptTokens: number;
  outTokens: number;
  totalDurationS: number;
  evalTps: number;
  error?: string;
}

/** MCP tool {name, description?, inputSchema} → ChatTool entry (OpenAI "function" shape). */
export function toChatTools(tools: Array<{ name: string; description?: string; inputSchema?: unknown }>): ChatTool[] {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description ?? '',
      parameters: t.inputSchema ?? { type: 'object', properties: {} },
    },
  }));
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const tps = (tokens: number, durNs: number): number => (durNs > 0 ? round2(tokens / (durNs / 1e9)) : 0);

/** Join an MCP CallToolResult's content blocks into a single text payload. */
function resultText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .map((c: any) => (c?.type === 'text' && typeof c.text === 'string' ? c.text : JSON.stringify(c)))
    .join('\n');
}

export async function runMcpHost(opts: McpHostOptions): Promise<McpTrajectory> {
  const numCtx = opts.numCtx ?? 4096;
  const maxIters = opts.maxIters ?? 5;
  // Clamp to a sane (1s … 1h) window: rejects NaN/0/negative (→ default) and caps huge values that
  // would overflow the 32-bit timer and abort instantly. Bad --timeout can't silently fail every model.
  const reqMs = Number(opts.timeoutMs);
  const timeoutMs = Number.isFinite(reqMs) && reqMs > 0 ? Math.min(reqMs, 3_600_000) : 600000;
  let totalDurNs = 0;
  let evalDurNs = 0;

  // One connection per server; each is spawned over HTTP (PORT=0) and its tools are
  // merged into a single menu. A tool call routes back to the server that owns the
  // name (toolToClient); each server's process is torn down in `finally`.
  const conns: Array<{ name: string; client: Client; cleanup: () => void }> = [];
  const toolToClient = new Map<string, Client>();

  const traj: McpTrajectory = {
    model: opts.model,
    supported: true,
    toolNames: [],
    toolRequired: {},
    toolServer: {},
    toolCalls: [],
    toolResults: [],
    finalAnswer: '',
    inTokens: 0,
    maxPromptTokens: 0,
    outTokens: 0,
    totalDurationS: 0,
    evalTps: 0,
  };

  const messages: ChatMessage[] = [{ role: 'user', content: opts.prompt }];

  try {
    // Spawn every server, connect over HTTP, list its tools, and merge into one menu.
    // A tool name exposed by two servers can't be routed unambiguously — fail fast
    // rather than silently send the call to the wrong one.
    const merged: Array<{ name: string; description?: string; inputSchema?: unknown }> = [];
    for (const s of opts.servers) {
      const serverName = s.name ?? 'mcp';
      const running = await spawnHttpMcpServer(s);
      const client = new Client({ name: 'mcp-host', version: '1.0.0' });
      const transport = new StreamableHTTPClientTransport(new URL(`${running.baseUrl}/mcp`));
      await client.connect(transport);
      conns.push({ name: serverName, client, cleanup: running.cleanup });

      const listed = await client.listTools();
      for (const t of listed.tools) {
        if (toolToClient.has(t.name)) {
          throw new Error(`tool name collision: "${t.name}" exposed by "${traj.toolServer[t.name]}" and "${serverName}"`);
        }
        toolToClient.set(t.name, client);
        traj.toolServer[t.name] = serverName;
        traj.toolRequired[t.name] = Array.isArray((t.inputSchema as any)?.required) ? (t.inputSchema as any).required : [];
        merged.push(t);
      }
    }
    traj.toolNames = merged.map((t) => t.name);
    const tools = toChatTools(merged);

    for (let i = 0; i < maxIters; i++) {
      const res = await opts.backend.chat({ model: opts.model, messages, tools, numCtx, timeoutMs });

      // Backend signalled the model's template can't do tools — a clean capability verdict.
      if (res.toolsUnsupported) {
        traj.supported = false;
        traj.error = res.error;
        return traj;
      }
      if (res.error) {
        traj.error = res.error;
        return traj;
      }

      // Accumulate generation perf across the rounds (durations are ns).
      traj.inTokens += res.metrics.inTokens;
      traj.maxPromptTokens = Math.max(traj.maxPromptTokens, res.metrics.inTokens);
      traj.outTokens += res.metrics.outTokens;
      totalDurNs += res.metrics.totalDurationNs;
      evalDurNs += res.metrics.evalDurationNs;
      traj.totalDurationS = round2(totalDurNs / 1e9);
      traj.evalTps = tps(traj.outTokens, evalDurNs);

      if (res.toolCalls.length === 0) {
        traj.finalAnswer = res.content;
        return traj;
      }

      // Echo the assistant's tool-call turn, then run each call.
      messages.push(res.assistantMessage ?? { role: 'assistant', content: res.content, tool_calls: [] });
      for (const call of res.toolCalls) {
        traj.toolCalls.push({ name: call.name, arguments: call.arguments });

        // A bad tool name / args throws — but "the model picked wrong" is exactly
        // the verdict under test, so capture it and feed it back, don't crash.
        let content: string;
        let isError: boolean;
        const owner = toolToClient.get(call.name);
        if (!owner) {
          content = `tool call failed: unknown tool "${call.name}"`;
          isError = true;
        } else {
          try {
            const result: any = await owner.callTool({ name: call.name, arguments: call.arguments });
            content = resultText(result?.content);
            isError = Boolean(result?.isError);
          } catch (e) {
            content = `tool call failed: ${e instanceof Error ? e.message : String(e)}`;
            isError = true;
          }
        }
        traj.toolResults.push({ name: call.name, content, isError });
        messages.push({ role: 'tool', content, tool_name: call.name });
      }
    }

    // Ran out of iterations still calling tools — report what we have.
    traj.error = `no final answer within ${maxIters} tool rounds`;
    return traj;
  } catch (e) {
    // Connect/list/transport failure or a backend failure: return a trajectory
    // carrying the error rather than throwing.
    traj.error = e instanceof Error ? e.message : String(e);
    return traj;
  } finally {
    for (const { client, cleanup } of conns) {
      await client.close().catch(() => {});
      cleanup();
    }
  }
}
