/**
 * Project configuration for the test framework.
 */

export const SUITES = ['smoke', 'wifi', 'enterprise', 'ui', 'sms', 'notifications', 'portal', 'proxy'] as const;
export type Suite = typeof SUITES[number];

/** Forward selected env vars by NAME (comma-separated) — used to hand the MCP server
 *  only the credentials it needs, never the whole environment. */
export function pickEnv(names: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of names.split(',').map((s) => s.trim()).filter(Boolean)) {
    const v = process.env[n];
    if (v !== undefined) out[n] = v;
  }
  return out;
}

export const CONFIG = {
  projectName: 'android-wifi-mcp',
  defaultTimeout: 60000,
  defaultStepTimeout: 30000,

  logs: {
    cleanupAge: 24 * 60 * 60 * 1000,
    maxBuffer: 50 * 1024 * 1024,
  },

  // Agent judge (STORY-003). The deterministic SimpleJudge always runs; set
  // JUDGE_MODE=dual to ALSO run the ACP agent judge (both must pass).
  judge: {
    // 'simple' (default) = deterministic checks only. 'dual' = also run the agent judge.
    // Case-insensitive so JUDGE_MODE=DUAL isn't a silent no-op.
    mode: (process.env.JUDGE_MODE || 'simple').toLowerCase(),
    // Command that launches the ACP agent. Empty → the bundled Claude ACP agent
    // (@agentclientprotocol/claude-agent-acp), keyless via the agent's own auth
    // (~/.claude / CLAUDE_CODE_OAUTH_TOKEN). Set to another ACP agent's command to
    // swap models/vendors — config, not code.
    agent: process.env.JUDGE_AGENT || '',
    timeout: 300000,
    stdoutLimit: 1000,
    stderrLimit: 500,
    logsLimit: 3000,
  },

  // Live-MCP paths (STORY-003 #124): the model-under-test host (test-mcp) and the
  // live verifier. Our server speaks HTTP — the runner spawns it with PORT=0 and
  // connects to the printed URL (see mcp/http-server.ts), so command/args describe
  // how to LAUNCH it, not a stdio pipe. Point elsewhere via .env.
  mcp: {
    command: process.env.MCP_COMMAND || 'node',
    args: (process.env.MCP_ARGS || 'dist/index.js').split(' ').filter(Boolean),
    cwd: process.env.MCP_CWD || undefined,
    prompt: process.env.MCP_PROMPT || 'List the connected Android devices.',
    env: pickEnv(process.env.MCP_ENV || ''),
    backend: process.env.MCP_BACKEND || 'ollama', // selects the ChatBackend (model runtime)
    host: process.env.OLLAMA_HOST || 'http://localhost:11434',
  },
};

export const ERROR_PATTERNS: RegExp[] = [
  /\bError executing\b/i,
  /\bUnknown tool\b/i,
  /\bconnection refused\b/i,
];

export const ERROR_EXCLUSIONS: RegExp[] = [
  /error.*handled/i,
  /expected.*error/i,
  /rejectPatterns/i,
  /_idleTimeout/i,
];
