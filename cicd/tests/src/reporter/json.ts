/**
 * JSON Reporter — outputs test results as JSON files.
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { hostname } from 'os';
import path from 'path';
import { TestResult, TestReport, TestSummary, Judgment, StepReportEntry } from '../types.js';

export class JsonReporter {
  private outputDir: string;

  constructor(outputDir: string) {
    this.outputDir = outputDir;
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }
  }

  generateReports(
    results: TestResult[],
    judgments: Judgment[],
    startTime: Date,
    suite: string
  ): { summary: TestSummary; reports: TestReport[] } {
    const endTime = new Date();
    const duration = endTime.getTime() - startTime.getTime();

    const judgmentMap = new Map(judgments.map((j) => [j.testId, j]));

    const reports: TestReport[] = results.map((result) => {
      const judgment = judgmentMap.get(result.testCase.id) || {
        testId: result.testCase.id,
        pass: false,
        reason: 'No judgment',
      };

      const steps: StepReportEntry[] = result.steps.map((step) => ({
        name: step.name,
        command: step.command,
        exitCode: step.exitCode,
        duration: step.duration,
        stdout: step.stdout,
        stderr: step.stderr,
        pass: step.exitCode === 0,
      }));

      return {
        testId: result.testCase.id,
        name: result.testCase.name,
        suite: result.testCase.suite,
        pass: judgment.pass,
        reason: judgment.reason,
        duration: result.totalDuration,
        steps,
        logFile: result.logFile,
        judgment,
      };
    });

    const passed = reports.filter((r) => r.pass).length;

    const summary: TestSummary = {
      runId: startTime.toISOString(),
      suite,
      timestamp: startTime.toISOString(),
      duration,
      total: results.length,
      passed,
      failed: results.length - passed,
      environment: {
        hostname: hostname(),
        nodeVersion: process.version,
      },
      tests: results.map((r) => r.testCase.id),
    };

    return { summary, reports };
  }

  writeReports(summary: TestSummary, reports: TestReport[]): void {
    const summaryPath = path.join(this.outputDir, 'summary.json');
    writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

    for (const report of reports) {
      const reportPath = path.join(this.outputDir, `${report.testId}.json`);
      writeFileSync(reportPath, JSON.stringify(report, null, 2));
    }

    process.stderr.write(`\n[JSON] Results written to ${this.outputDir}/\n`);
  }

  outputSummary(summary: TestSummary, reports: TestReport[]): void {
    const output = {
      summary,
      results: reports.map((r) => ({
        testId: r.testId,
        name: r.name,
        suite: r.suite,
        pass: r.pass,
        reason: r.reason,
        duration: r.duration,
        steps: r.steps,
        judgment: r.judgment,
      })),
    };
    console.log(JSON.stringify(output, null, 2));
  }
}
