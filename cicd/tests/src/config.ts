/**
 * Project configuration for the test framework.
 */

export const SUITES = ['smoke', 'wifi', 'enterprise', 'ui', 'portal'] as const;
export type Suite = typeof SUITES[number];

export const CONFIG = {
  projectName: 'android-wifi-mcp',
  defaultTimeout: 60000,
  defaultStepTimeout: 30000,

  logs: {
    cleanupAge: 24 * 60 * 60 * 1000,
    maxBuffer: 50 * 1024 * 1024,
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
