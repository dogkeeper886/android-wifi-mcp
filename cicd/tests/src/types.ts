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

export interface TestCase {
  id: string;
  name: string;
  suite: string;
  tags?: string[];
  priority: number;
  timeout: number;
  dependencies: string[];
  steps: TestStep[];
  criteria: string;
  goal?: string;
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
