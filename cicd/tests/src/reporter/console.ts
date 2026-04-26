/**
 * Console Reporter — outputs test results to terminal with formatting.
 */

import chalk from 'chalk';
import { TestReport, TestSummary } from '../types.js';

export class ConsoleReporter {
  private formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}min`;
  }

  report(summary: TestSummary, reports: TestReport[]): void {
    console.log('\n' + '='.repeat(60));
    console.log(chalk.bold('Test Results'));
    console.log('='.repeat(60));

    for (const report of reports) {
      const status = report.pass
        ? chalk.green.bold('[PASS]')
        : chalk.red.bold('[FAIL]');

      console.log(`\n${status} ${report.testId}: ${report.name}`);
      console.log(`  Suite: ${report.suite}`);
      console.log(`  Duration: ${this.formatDuration(report.duration)}`);
      console.log(`  Reason: ${report.reason}`);

      if (report.logFile) {
        console.log(`  Log file: ${report.logFile}`);
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log(chalk.bold('Summary'));
    console.log('='.repeat(60));

    const passColor = summary.passed === summary.total ? chalk.green : chalk.yellow;
    console.log(
      `Total: ${summary.total} | ` +
        passColor(`Passed: ${summary.passed}`) +
        ` | ` +
        chalk.red(`Failed: ${summary.failed}`)
    );

    console.log(`Duration: ${this.formatDuration(summary.duration)}`);
    console.log(`Output: ${summary.runId}`);

    console.log('\n' + '='.repeat(60));
    if (summary.failed === 0) {
      console.log(chalk.green.bold('All tests passed!'));
    } else {
      console.log(
        chalk.red.bold(`${summary.failed} test(s) failed.`)
      );
    }
    console.log('='.repeat(60) + '\n');
  }
}
