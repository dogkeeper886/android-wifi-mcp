/**
 * Simple Judge — fast, deterministic verification based on:
 * 1. Exit codes (all steps must return 0)
 * 2. Pattern matching (expected patterns found, rejected patterns absent)
 * 3. Error pattern detection in logs
 */

import { TestResult, Judgment } from '../types.js';
import { ERROR_PATTERNS, ERROR_EXCLUSIONS } from '../config.js';

export class SimpleJudge {
  judge(result: TestResult): Judgment {
    const reasons: string[] = [];
    let pass = true;

    const failedSteps = result.steps.filter((s) => s.exitCode !== 0);
    if (failedSteps.length > 0) {
      pass = false;
      reasons.push(
        `${failedSteps.length} step(s) failed with non-zero exit code: ${failedSteps.map((s) => `${s.name}(${s.exitCode})`).join(', ')}`
      );
    }

    for (const step of result.steps) {
      if (step.patternMatches) {
        const missing = step.patternMatches.expected.filter((p) => !p.found);
        if (missing.length > 0) {
          pass = false;
          reasons.push(
            `Step "${step.name}" missing expected patterns: ${missing.map((p) => p.pattern).join(', ')}`
          );
        }

        const found = step.patternMatches.rejected.filter((p) => p.found);
        if (found.length > 0) {
          pass = false;
          reasons.push(
            `Step "${step.name}" found rejected patterns: ${found.map((p) => p.pattern).join(', ')}`
          );
        }
      }
    }

    const combinedLogs = result.logs + '\n' + result.steps.map((s) => s.stdout + s.stderr).join('\n');

    for (const pattern of ERROR_PATTERNS) {
      if (pattern.test(combinedLogs)) {
        const isExcluded = ERROR_EXCLUSIONS.some((exc) => exc.test(combinedLogs));
        if (!isExcluded) {
          pass = false;
          reasons.push(`Error pattern detected: ${pattern.source}`);
          break;
        }
      }
    }

    return {
      testId: result.testCase.id,
      pass,
      reason: pass
        ? 'All steps passed with exit code 0, patterns matched, no errors'
        : reasons.join('; '),
    };
  }

  judgeAll(results: TestResult[]): Judgment[] {
    return results.map((r) => this.judge(r));
  }
}
