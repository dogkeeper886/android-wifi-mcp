/**
 * Project configuration for the test framework.
 */

export const SUITES = ['smoke', 'wifi', 'enterprise', 'ui', 'sms', 'notifications', 'portal', 'proxy'] as const;
export type Suite = typeof SUITES[number];

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
    mode: process.env.JUDGE_MODE || 'simple',
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
