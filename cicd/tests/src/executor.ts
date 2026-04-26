/**
 * Test executor - orchestrates test execution with pattern matching.
 *
 * Adapted from ruckus1-mcp's executor.ts. Adds per-test snapshot/restore
 * of Android device state so a failing test cannot poison subsequent tests.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { TestCase, TestResult, StepResult, PatternMatch, RunConfig } from './types.js';
import { CONFIG } from './config.js';
import {
  snapshotDeviceState,
  restoreDeviceState,
  DeviceSnapshot,
} from './device-state.js';

const execAsync = promisify(exec);

function stripAnsi(str: string): string {
  return str.replace(
    /\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[()][AB012]|\x1b[a-zA-Z]/g,
    ''
  );
}

export class TestExecutor {
  private config: RunConfig;
  private totalTests: number = 0;
  private currentTest: number = 0;
  private currentTestId: string | null = null;
  private variables: Record<string, string> = {};
  // Per-run unique suffix used by YAMLs to namespace resources where needed.
  // Prefers GITHUB_RUN_ID in CI for traceability; falls back to TEST_RUN_ID
  // override or a random 6-char string locally.
  private readonly runId: string;

  constructor(config: RunConfig) {
    this.config = config;
    const raw =
      process.env.GITHUB_RUN_ID ||
      process.env.TEST_RUN_ID ||
      Math.random().toString(36).slice(2, 8);
    this.runId = raw.slice(-6);
  }

  private substituteVariables(command: string): string {
    return command.replace(/\{\{(\w+)\}\}/g, (_match, varName) => {
      if (varName === 'TEST_RUN_ID') return this.runId;
      const value = this.variables[varName] ?? process.env[varName];
      if (value === undefined) {
        throw new Error(
          `Undefined variable {{${varName}}} — not set by any prior capture or environment`
        );
      }
      return value;
    });
  }

  /**
   * Resolve a dot-notation path with optional array find syntax.
   * Supports: "field", "nested.field", "data[name=foo].id"
   */
  private resolvePath(obj: any, fieldPath: string): any {
    const segments = fieldPath.match(/[^.]+/g) || [];
    let current = obj;

    for (const segment of segments) {
      if (current === undefined || current === null) return undefined;

      const rootArrayMatch = segment.match(/^\$\[(\w+)=(.+)\]$/);
      if (rootArrayMatch) {
        const [, matchKey, matchValue] = rootArrayMatch;
        if (!Array.isArray(current)) return undefined;
        current = current.find((item: any) => String(item[matchKey]) === matchValue);
        continue;
      }

      const arrayMatch = segment.match(/^(\w+)\[(\w+)=(.+)\]$/);
      if (arrayMatch) {
        const [, arrayField, matchKey, matchValue] = arrayMatch;
        const arr = current[arrayField];
        if (!Array.isArray(arr)) return undefined;
        current = arr.find((item: any) => String(item[matchKey]) === matchValue);
      } else {
        current = current[segment];
      }
    }

    return current;
  }

  private captureVariables(step: TestCase['steps'][0], result: StepResult): void {
    if (!step.capture || result.exitCode !== 0) return;

    try {
      const mcpResponse = JSON.parse(result.stdout);
      const innerText = mcpResponse?.content?.[0]?.text;
      if (!innerText) return;

      const toolResponse = JSON.parse(innerText);

      for (const [varName, fieldPath] of Object.entries(step.capture)) {
        const resolvedPath = this.substituteVariables(fieldPath);
        const value = this.resolvePath(toolResponse, resolvedPath);
        if (value !== undefined) {
          this.variables[varName] = String(value);
          this.progress(`    Captured: ${varName} = ${String(value).substring(0, 60)}`);
        } else {
          this.progress(`    [WARN] Capture field '${fieldPath}' not found in response`);
        }
      }
    } catch (e) {
      this.progress(`    [WARN] Failed to capture variables: ${e}`);
    }
  }

  private progress(msg: string): void {
    process.stderr.write(msg + '\n');
  }

  private async executeStep(
    step: { name: string; command: string; timeout?: number },
    defaultTimeout: number
  ): Promise<StepResult> {
    const startTime = Date.now();
    let stdout = '';
    let stderr = '';
    let exitCode = 0;
    let timedOut = false;

    const timeout = step.timeout || defaultTimeout;

    const env = { ...process.env };
    if (this.currentTestId) {
      env.TEST_ID = this.currentTestId;
    }

    try {
      const result = await execAsync(step.command, {
        cwd: this.config.workingDir,
        timeout,
        maxBuffer: CONFIG.logs.maxBuffer,
        shell: '/bin/bash',
        env,
      });
      stdout = result.stdout;
      stderr = result.stderr;
    } catch (error: unknown) {
      const err = error as {
        stdout?: string;
        stderr?: string;
        message?: string;
        code?: number;
        killed?: boolean;
      };
      stdout = err.stdout || '';
      stderr = err.stderr || err.message || 'Unknown error';
      exitCode = err.code || 1;
      timedOut = err.killed === true;
    }

    const duration = Date.now() - startTime;

    stdout = stripAnsi(stdout);
    stderr = stripAnsi(stderr);

    if (timedOut) {
      stderr = `[TIMEOUT] Command killed after ${timeout / 1000}s\n\n${stderr}`;
    }

    return {
      name: step.name,
      command: step.command,
      stdout,
      stderr,
      exitCode,
      duration,
    };
  }

  private checkPatterns(
    result: StepResult,
    expectPatterns?: string[],
    rejectPatterns?: string[]
  ): StepResult['patternMatches'] {
    if (!expectPatterns && !rejectPatterns) {
      return undefined;
    }

    const combined = result.stdout + '\n' + result.stderr;

    const expected: PatternMatch[] = (expectPatterns || []).map((pattern) => {
      try {
        const resolved = this.substituteVariables(pattern);
        return { pattern: resolved, found: new RegExp(resolved, 'i').test(combined) };
      } catch (e) {
        const msg = (e as Error).message;
        return { pattern: `[UNDEFINED] ${pattern} — ${msg}`, found: false };
      }
    });

    const rejected: PatternMatch[] = (rejectPatterns || []).map((pattern) => {
      try {
        const resolved = this.substituteVariables(pattern);
        return { pattern: resolved, found: new RegExp(resolved, 'i').test(combined) };
      } catch (e) {
        const msg = (e as Error).message;
        return { pattern: `[UNDEFINED] ${pattern} — ${msg}`, found: true };
      }
    });

    return { expected, rejected };
  }

  async executeTestCase(testCase: TestCase): Promise<TestResult> {
    const startTime = Date.now();
    const stepResults: StepResult[] = [];
    const timestamp = new Date().toISOString().substring(11, 19);

    this.currentTest++;
    this.currentTestId = testCase.id;
    this.variables = {};
    this.progress(
      `[${timestamp}] [${this.currentTest}/${this.totalTests}] ${testCase.id}: ${testCase.name}`
    );

    // Snapshot device state before the test. Per-test, not per-suite —
    // a failing test must not poison subsequent ones.
    let snapshot: DeviceSnapshot | null = null;
    try {
      snapshot = await snapshotDeviceState();
      this.progress(
        `    Snapshot: wifiEnabled=${snapshot.wifiEnabled}, ssid=${snapshot.currentSsid ?? '<none>'}, savedNetworks=${snapshot.savedNetworkIds.length}`
      );
    } catch (e) {
      this.progress(`    [WARN] Snapshot failed: ${(e as Error).message}`);
    }

    for (let i = 0; i < testCase.steps.length; i++) {
      const step = testCase.steps[i];
      const stepTimestamp = new Date().toISOString().substring(11, 19);

      this.progress(
        `  [${stepTimestamp}] Step ${i + 1}/${testCase.steps.length}: ${step.name}`
      );

      let resolvedCommand: string;
      try {
        resolvedCommand = this.substituteVariables(step.command);
      } catch (e) {
        const msg = (e as Error).message;
        const synthetic: StepResult = {
          name: step.name,
          command: step.command,
          stdout: '',
          stderr: `[SUBSTITUTION FAILED] ${msg}`,
          exitCode: 1,
          duration: 0,
        };
        this.progress(`    [FAIL] Substitution: ${msg}`);
        stepResults.push(synthetic);
        continue;
      }

      const cmdPreview =
        resolvedCommand.length > 80
          ? resolvedCommand.substring(0, 80) + '...'
          : resolvedCommand;
      this.progress(`    Command: ${cmdPreview}`);

      const resolvedStep = { ...step, command: resolvedCommand };
      const result = await this.executeStep(resolvedStep, testCase.timeout);

      result.patternMatches = this.checkPatterns(
        result,
        step.expectPatterns,
        step.rejectPatterns
      );

      this.captureVariables(step, result);

      stepResults.push(result);

      const status = result.exitCode === 0 ? '[PASS]' : '[FAIL]';
      const duration = `${(result.duration / 1000).toFixed(1)}s`;
      this.progress(`    ${status} Exit: ${result.exitCode} (${duration})`);

      if (result.patternMatches) {
        const expectedMissing = result.patternMatches.expected.filter(
          (p) => !p.found
        );
        const rejectedFound = result.patternMatches.rejected.filter(
          (p) => p.found
        );
        if (expectedMissing.length > 0) {
          this.progress(
            `    Missing patterns: ${expectedMissing.map((p) => p.pattern).join(', ')}`
          );
        }
        if (rejectedFound.length > 0) {
          this.progress(
            `    Rejected patterns found: ${rejectedFound.map((p) => p.pattern).join(', ')}`
          );
        }
      }

      if (result.exitCode !== 0 && result.stderr) {
        const errorPreview = result.stderr.split('\n')[0].substring(0, 100);
        this.progress(`    Error: ${errorPreview}`);
      }
    }

    // Restore device state. Always attempt — even after failures.
    if (snapshot) {
      try {
        await restoreDeviceState(snapshot);
        this.progress(`    Restored device state`);
      } catch (e) {
        this.progress(`    [WARN] Restore failed: ${(e as Error).message}`);
      }
    }

    const totalDuration = Date.now() - startTime;

    const logs = stepResults
      .map(
        (r) =>
          `=== Step: ${r.name} ===
Command: ${r.command}
Exit Code: ${r.exitCode}
Duration: ${r.duration}ms

STDOUT:
${r.stdout || '(empty)'}

STDERR:
${r.stderr || '(empty)'}
`
      )
      .join('\n' + '='.repeat(50) + '\n');

    this.currentTestId = null;

    return {
      testCase,
      steps: stepResults,
      totalDuration,
      logs,
      logFile: '',
    };
  }

  async executeAll(testCases: TestCase[]): Promise<TestResult[]> {
    const results: TestResult[] = [];

    this.totalTests = testCases.length;
    this.currentTest = 0;

    const startTimestamp = new Date().toISOString().substring(11, 19);
    this.progress(`\n[${startTimestamp}] Starting ${this.totalTests} test(s)...`);
    this.progress('-'.repeat(60));

    for (const tc of testCases) {
      const result = await this.executeTestCase(tc);
      results.push(result);
    }

    const endTimestamp = new Date().toISOString().substring(11, 19);
    this.progress('-'.repeat(60));
    this.progress(`[${endTimestamp}] Execution complete: ${results.length} test(s)`);

    return results;
  }
}
