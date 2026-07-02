/**
 * How to spawn a stdio MCP server — the shared shape used by both MCP paths:
 * the model-under-test host (host.ts) and the live verifier (verifier-judge.ts).
 *
 * Lives in its own module so the verifier can depend on the config shape without
 * importing the host (which pulls in @modelcontextprotocol/sdk). The server choice
 * and its credentials are config, never hardcoded here.
 */
export interface McpServerConfig {
  /** Identifies the server when several share one menu — e.g. the verifier picks
   *  its read-only server by this name. Defaults to 'mcp' when unset. */
  name?: string;
  command: string;
  args: string[];
  cwd?: string;
  /** Extra env the server needs (e.g. an API URL / key) — merged over a minimal
   *  default environment; never hardcoded in this module. */
  env?: Record<string, string>;
}
