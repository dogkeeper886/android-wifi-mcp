/**
 * TypeScript interfaces for the test framework.
 */

export interface TestStep {
  name: string;
  command: string;
  timeout?: number;
  expectPatterns?: string[];
  rejectPatterns?: string[];
  capture?: Record<string, string>;
}

/** A precondition a case needs before it runs. Checked before setup; when unmet the
 *  case skips (green) rather than failing deep in a step. Extend as new kinds appear. */
export interface TestRequires {
  /** SSID that must be in range (scan-confirmed) before the case runs. */
  ssidInRange?: string;
}

export interface TestCase {
  id: string;
  name: string;
  suite: string;
  tags?: string[];
  priority: number;
  timeout: number;
  dependencies: string[];
  /** Precondition checked before `setup` — unmet → the case is skipped. */
  requires?: TestRequires;
  /** Steps run before `steps` to bring the device to a known-clean starting state.
   *  Same shape as `steps`, run through the same substitute→execute path. */
  setup?: TestStep[];
  steps: TestStep[];
  /** Steps run after `steps` — ALWAYS, even after a failed step — to remove what the
   *  case created and return the device to its pre-test state. */
  teardown?: TestStep[];
  criteria: string;
  goal?: string;
  /** Judge style (STORY-003 #125). 'simple' (default) = deterministic checks only —
   *  fast, free, right for stable tools. 'agent' = ALSO run the ACP agent judge in
   *  dual mode, for tools whose output isn't deterministic (connect/scan/status). */
  judge?: 'simple' | 'agent';
}

export interface PatternMatch {
  pattern: string;
  found: boolean;
}

export interface StepResult {
  name: string;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  duration: number;
  patternMatches?: {
    expected: PatternMatch[];
    rejected: PatternMatch[];
  };
}

export interface TestResult {
  testCase: TestCase;
  steps: StepResult[];
  totalDuration: number;
  logs: string;
  logFile: string;
}

export interface Judgment {
  testId: string;
  pass: boolean;
  reason: string;
  evidence?: string;
  /** Why the evidence cell is what it is — set by the live verifier (VerifierJudge)
   *  so an empty cell explains itself instead of reading as a silent pass. */
  evidenceStatus?:
    | 'captured'
    | 'denied'
    | 'not-called'
    | 'no-data'
    | 'verifier-unavailable';
  /** Per-stage rubric flags from the live verifier: did the model pick the right
   *  tool, call it correctly, and ground its answer in the result? */
  stages?: { tool: boolean; query: boolean; content: boolean };
  /** Deterministic cross-check: claims in the answer the live tool result does not
   *  support (the verifier's PASS cannot stand if this is non-empty). */
  crossCheckUnsupported?: string[];
}

export interface StepReportEntry {
  name: string;
  command: string;
  exitCode: number;
  duration: number;
  stdout: string;
  stderr: string;
  pass: boolean;
}

export interface TestReport {
  testId: string;
  name: string;
  suite: string;
  pass: boolean;
  reason: string;
  duration: number;
  steps: StepReportEntry[];
  logFile: string;
  judgment: Judgment;
}

export interface TestSummary {
  runId: string;
  suite: string;
  timestamp: string;
  duration: number;
  total: number;
  passed: number;
  failed: number;
  environment: {
    hostname: string;
    nodeVersion: string;
  };
  tests: string[];
}

export interface RunConfig {
  suite?: string;
  tag?: string;
  testId?: string;
  dryRun: boolean;
  outputDir: string;
  outputFormat: 'console' | 'json';
  workingDir: string;
}

export const DEFAULT_CONFIG: Partial<RunConfig> = {
  dryRun: false,
  outputFormat: 'console',
};
