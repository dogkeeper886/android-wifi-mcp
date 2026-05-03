import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';

export interface UpstreamConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface UpstreamStatus {
  name: string;
  command: string;
  args: string[];
  state: 'connected' | 'disconnected' | 'failed';
  toolCount: number;
  lastError?: string;
}

interface UpstreamEntry {
  config: UpstreamConfig;
  client?: Client;
  transport?: StdioClientTransport;
  status: UpstreamStatus;
  /** Map from final (possibly prefixed) tool name → original upstream tool name */
  toolNameMap: Map<string, string>;
}

/**
 * Manages a set of upstream MCP servers spawned as subprocesses over stdio.
 * Their tools are surfaced through this server's tools/list and routed via
 * tools/call, so callers see one unified namespace.
 *
 * Tool name collision strategy: prefer the upstream's original name; if a
 * collision exists with a native tool or another upstream's tool, prefix
 * with `<upstream-name>__`.
 */
export class UpstreamProxy {
  private upstreams: Map<string, UpstreamEntry> = new Map();
  private toolToUpstream: Map<string, string> = new Map();
  private toolDefs: Map<string, Tool> = new Map();
  /** Names of native tools (so we know what counts as a collision) */
  private nativeToolNames: Set<string> = new Set();

  /**
   * Connect to all configured upstreams. Failures are recorded in status but
   * do not throw — startup continues so a flaky upstream doesn't take the
   * whole server down.
   */
  async connectAll(configs: UpstreamConfig[], nativeToolNames: string[]): Promise<void> {
    this.nativeToolNames = new Set(nativeToolNames);
    const adjusted = configs.map((c) => applyEnvOverrides(c));

    for (const config of adjusted) {
      const entry: UpstreamEntry = {
        config,
        status: {
          name: config.name,
          command: config.command,
          args: config.args ?? [],
          state: 'disconnected',
          toolCount: 0,
        },
        toolNameMap: new Map(),
      };
      this.upstreams.set(config.name, entry);

      try {
        await this.connectOne(entry);
      } catch (e) {
        entry.status.state = 'failed';
        entry.status.lastError = (e as Error).message;
        process.stderr.write(
          `[upstream:${config.name}] connect failed: ${(e as Error).message}\n`
        );
      }
    }
  }

  private async connectOne(entry: UpstreamEntry): Promise<void> {
    const transport = new StdioClientTransport({
      command: entry.config.command,
      args: entry.config.args ?? [],
      env: { ...process.env, ...entry.config.env } as Record<string, string>,
    });
    const client = new Client({
      name: `android-wifi-mcp-proxy:${entry.config.name}`,
      version: '1.0.0',
    });

    await client.connect(transport);
    entry.transport = transport;
    entry.client = client;

    const tools = await client.listTools();
    for (const tool of tools.tools) {
      const finalName = this.resolveToolName(entry.config.name, tool.name);
      entry.toolNameMap.set(finalName, tool.name);
      this.toolToUpstream.set(finalName, entry.config.name);
      this.toolDefs.set(finalName, { ...tool, name: finalName });
    }

    entry.status.state = 'connected';
    entry.status.toolCount = tools.tools.length;
    process.stderr.write(
      `[upstream:${entry.config.name}] connected, ${tools.tools.length} tool(s)\n`
    );
  }

  private resolveToolName(upstreamName: string, toolName: string): string {
    return resolveToolName(upstreamName, toolName, this.nativeToolNames, new Set(this.toolToUpstream.keys()));
  }

  hasTool(name: string): boolean {
    return this.toolToUpstream.has(name);
  }

  /**
   * Returns `proxy:<upstream-name>` for proxied tools, null otherwise.
   * Used by the recording middleware to label tool_calls.surface.
   */
  getSurfaceForTool(name: string): string | null {
    const upstream = this.toolToUpstream.get(name);
    return upstream ? `proxy:${upstream}` : null;
  }

  getTools(): Tool[] {
    return Array.from(this.toolDefs.values());
  }

  getStatus(): UpstreamStatus[] {
    return Array.from(this.upstreams.values()).map((e) => ({ ...e.status }));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const upstreamName = this.toolToUpstream.get(name);
    if (!upstreamName) {
      throw new Error(`No upstream registered for tool '${name}'`);
    }
    const entry = this.upstreams.get(upstreamName);
    if (!entry?.client) {
      throw new Error(`Upstream '${upstreamName}' is not connected`);
    }
    const originalName = entry.toolNameMap.get(name) ?? name;
    return await entry.client.callTool({
      name: originalName,
      arguments: args,
    });
  }

  /**
   * Tear down one upstream and respawn it, re-registering its tools.
   *
   * Why this exists: some upstream MCPs (notably `@playwright/mcp`) cache
   * handles to remote state — e.g. a CDP `Page` — and surface
   * `Target page, context or browser has been closed` for every subsequent
   * call once that state dies. The cache lives in the upstream's process
   * memory and there's no protocol-level reset; the only fix is to kill
   * and respawn the subprocess. This tool gives the agent a way to do that
   * in-conversation instead of telling the user to restart the host.
   */
  async restartOne(name: string): Promise<UpstreamStatus> {
    const entry = this.upstreams.get(name);
    if (!entry) {
      throw new Error(`No upstream named '${name}' is configured`);
    }

    // Best-effort close of the current client. The transport may already
    // be dead (that's usually why the caller is asking for a restart), so
    // failures here are expected and non-fatal. We leave entry.client
    // referencing the closed object until connectOne overwrites it; that
    // also keeps the type as `Client | undefined` so the partial-failure
    // close in the catch block below doesn't trip TS narrowing.
    try {
      await entry.client?.close();
    } catch {
      // ignore
    }

    // Drop every tool this upstream had registered. If the respawned
    // upstream comes back with a different tool list, stale entries
    // pointing at the dead client must not survive.
    for (const finalName of entry.toolNameMap.keys()) {
      this.toolToUpstream.delete(finalName);
      this.toolDefs.delete(finalName);
    }
    entry.toolNameMap.clear();
    entry.status.state = 'disconnected';
    entry.status.toolCount = 0;
    entry.status.lastError = undefined;

    try {
      await this.connectOne(entry);
    } catch (e) {
      // connectOne assigns entry.client / entry.transport before listTools,
      // so a partial success leaves a half-spawned subprocess attached. Close
      // whatever ended up there so we don't leak a process and poison the
      // next restart attempt.
      try {
        await entry.client?.close();
      } catch {
        // ignore
      }
      entry.client = undefined;
      entry.transport = undefined;
      entry.status.state = 'failed';
      entry.status.lastError = (e as Error).message;
      throw new Error(
        `Failed to restart upstream '${name}': ${(e as Error).message}`
      );
    }
    return { ...entry.status };
  }

  async closeAll(): Promise<void> {
    for (const entry of this.upstreams.values()) {
      try {
        await entry.client?.close();
      } catch {
        // ignore
      }
    }
    this.upstreams.clear();
    this.toolToUpstream.clear();
    this.toolDefs.clear();
  }

  /**
   * Wire the proxy into an existing McpServer by replacing its tools/list and
   * tools/call request handlers. The original handlers are preserved and
   * called for native tools.
   *
   * This reaches into the SDK's private `_requestHandlers` Map. If the SDK
   * changes that surface, this method needs an update.
   */
  attach(mcpServer: McpServer): void {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const server = mcpServer.server;
    const handlers = (server as any)._requestHandlers as Map<
      string,
      (request: any, extra: any) => Promise<any>
    >;

    const originalList = handlers.get('tools/list');
    const originalCall = handlers.get('tools/call');
    if (!originalList || !originalCall) {
      throw new Error(
        'McpServer has not registered tools/list or tools/call yet — call attach() after native tools are registered'
      );
    }

    server.setRequestHandler(ListToolsRequestSchema, async (request, extra) => {
      const nativeResp = await originalList(request, extra);
      return { tools: [...(nativeResp.tools ?? []), ...this.getTools()] };
    });

    server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const name = request.params.name;
      if (this.hasTool(name)) {
        return (await this.callTool(
          name,
          (request.params.arguments as Record<string, unknown>) ?? {}
        )) as any;
      }
      return await originalCall(request, extra);
    });
    /* eslint-enable @typescript-eslint/no-explicit-any */
  }
}

/**
 * Decide the final tool name in our merged namespace.
 * Prefer the upstream's name; on collision (with native or another upstream's
 * already-registered tool), prefix with `<upstream>__`.
 *
 * Pure function — exported for unit testing.
 */
export function resolveToolName(
  upstreamName: string,
  toolName: string,
  nativeToolNames: ReadonlySet<string>,
  alreadyTaken: ReadonlySet<string>
): string {
  if (!nativeToolNames.has(toolName) && !alreadyTaken.has(toolName)) {
    return toolName;
  }
  return `${upstreamName}__${toolName}`;
}

/**
 * Apply per-upstream env-var overrides. Today only one is recognized:
 * `PLAYWRIGHT_HEADED=1` — when set, strips `--headless` from the args of any
 * upstream named `playwright`. Lets users flip @playwright/mcp's window
 * visibility without re-running `claude mcp add`.
 *
 * Exported for unit testing.
 */
export function applyEnvOverrides(config: UpstreamConfig): UpstreamConfig {
  if (config.name !== 'playwright') return config;
  const flag = process.env.PLAYWRIGHT_HEADED;
  if (!flag || flag === '0' || flag.toLowerCase() === 'false') return config;
  if (!config.args?.includes('--headless')) return config;
  return { ...config, args: config.args.filter((a) => a !== '--headless') };
}

/**
 * Parse the `UPSTREAM_MCP` env variable into a list of upstream configs.
 *
 * Two accepted formats:
 *   1. JSON array: `UPSTREAM_MCP='[{"name":"playwright","command":"npx","args":["-y","@playwright/mcp@latest"]}]'`
 *   2. Semicolon-separated entries, each `name=command [arg1 arg2 ...]`:
 *      `UPSTREAM_MCP="playwright=npx -y @playwright/mcp@latest"`
 *
 * Multiple entries in shorthand form are separated by `;`.
 */
export function parseUpstreamConfig(raw: string | undefined): UpstreamConfig[] {
  if (!raw || !raw.trim()) return [];

  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as UpstreamConfig[];
      return parsed.map((c) => ({
        name: c.name,
        command: c.command,
        args: c.args ?? [],
        env: c.env,
      }));
    } catch (e) {
      throw new Error(`UPSTREAM_MCP JSON parse failed: ${(e as Error).message}`);
    }
  }

  const out: UpstreamConfig[] = [];
  for (const entry of trimmed.split(';').map((s) => s.trim()).filter(Boolean)) {
    const eq = entry.indexOf('=');
    if (eq < 0) {
      throw new Error(`UPSTREAM_MCP entry missing '=': ${entry}`);
    }
    const name = entry.slice(0, eq).trim();
    const rest = entry.slice(eq + 1).trim();
    if (!name || !rest) {
      throw new Error(`UPSTREAM_MCP entry malformed: ${entry}`);
    }
    const tokens = rest.match(/[^\s"']+|"[^"]*"|'[^']*'/g) ?? [];
    const command = tokens[0]?.replace(/^["']|["']$/g, '') ?? '';
    const args = tokens.slice(1).map((t) => t.replace(/^["']|["']$/g, ''));
    out.push({ name, command, args });
  }
  return out;
}
