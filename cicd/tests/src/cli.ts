#!/usr/bin/env node
/**
 * CLI for the test framework.
 *
 * Usage:
 *   npx tsx src/cli.ts run [options]
 *   npx tsx src/cli.ts list [options]
 */

import { Command } from 'commander';
import path from 'path';
import { mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { TestLoader } from './loader.js';
import { TestExecutor } from './executor.js';
import { SimpleJudge, AgentJudge } from './judge/index.js';
import { CONFIG } from './config.js';
import { JsonReporter, ConsoleReporter } from './reporter/index.js';
import { RunConfig } from './types.js';

const program = new Command();

program
  .name('android-wifi-mcp test-runner')
  .description('Test framework for android-wifi-mcp')
  .version('1.0.0');

program
  .command('run')
  .description('Run test cases')
  .option('-s, --suite <suite>', 'Run only tests from this suite')
  .option('-t, --tag <tag>', 'Run only tests with this tag')
  .option('-i, --id <id>', 'Run only the test with this ID')
  .option('--dry-run', 'Show what would run without executing', false)
  .option('-o, --output-dir <dir>', 'Output directory for results')
  .option('-f, --format <format>', 'Output format (console, json)', 'console')
  .action(async (options) => {
    const startTime = new Date();

    const here = path.dirname(fileURLToPath(import.meta.url));
    const projectRoot = path.resolve(here, '..', '..', '..');
    const testcasesDir = path.join(here, '..', 'testcases');

    const timestamp = startTime.toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const suiteName = options.suite || options.tag || 'all';
    const outputDir =
      options.outputDir ||
      path.join(here, '..', '..', 'results', `${timestamp}_${suiteName}`);

    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    const config: RunConfig = {
      suite: options.suite,
      tag: options.tag,
      testId: options.id,
      dryRun: options.dryRun,
      outputDir,
      outputFormat: options.format as RunConfig['outputFormat'],
      workingDir: projectRoot,
    };

    process.stderr.write(`\n[CONFIG] Project root: ${projectRoot}\n`);
    process.stderr.write(`[CONFIG] Testcases: ${testcasesDir}\n`);
    process.stderr.write(`[CONFIG] Output: ${outputDir}\n`);

    const loader = new TestLoader(testcasesDir);
    const allTestCases = await loader.loadAll();

    if (allTestCases.length === 0) {
      process.stderr.write('[ERROR] No test cases found\n');
      process.exit(1);
    }

    let filteredTestCases = allTestCases;

    if (config.suite) {
      filteredTestCases = filteredTestCases.filter((tc) => tc.suite === config.suite);
    }

    if (config.tag) {
      filteredTestCases = filteredTestCases.filter((tc) => tc.tags?.includes(config.tag!));
    }

    if (config.testId) {
      filteredTestCases = filteredTestCases.filter((tc) => tc.id === config.testId);
    }

    if (filteredTestCases.length === 0) {
      process.stderr.write('[ERROR] No matching test cases found\n');
      process.exit(1);
    }

    const { tests: resolvedTestCases, autoIncluded } = loader.resolveDependencies(
      filteredTestCases,
      allTestCases
    );

    if (autoIncluded.length > 0) {
      process.stderr.write(
        `[INFO] Auto-included ${autoIncluded.length} dependency test(s): ${autoIncluded.join(', ')}\n`
      );
    }

    const testCases = loader.sortByDependencies(resolvedTestCases);

    process.stderr.write(`[INFO] Found ${testCases.length} test(s) to run\n`);

    if (config.dryRun) {
      process.stderr.write('\n[DRY RUN] Would execute:\n');
      for (const tc of testCases) {
        process.stderr.write(`  - ${tc.id}: ${tc.name} (${tc.suite})\n`);
        for (const step of tc.steps) {
          process.stderr.write(`      Step: ${step.name}\n`);
        }
      }
      process.exit(0);
    }

    const executor = new TestExecutor(config);
    const results = await executor.executeAll(testCases);

    process.stderr.write('\n[JUDGE] Running simple judge...\n');
    const simpleJudge = new SimpleJudge();
    let judgments = simpleJudge.judgeAll(results);

    // Dual mode (STORY-003): also run the ACP agent judge; a test passes only if
    // BOTH the deterministic and agent judges pass. Fail-safe: if the agent can't
    // run (no auth/agent), keep the simple verdicts rather than failing everything.
    if (CONFIG.judge.mode === 'dual') {
      process.stderr.write('[JUDGE] Running agent judge (dual mode)...\n');
      const agentJudge = new AgentJudge();
      if (await agentJudge.isAvailable()) {
        const agentJudgments = await agentJudge.judgeResults(results);
        const agentMap = new Map(agentJudgments.map((j) => [j.testId, j]));
        judgments = judgments.map((sj) => {
          const aj = agentMap.get(sj.testId);
          if (!aj) return sj;
          return {
            testId: sj.testId,
            pass: sj.pass && aj.pass,
            // Surface the reason from whichever judge failed (simple first).
            reason: !sj.pass ? sj.reason : aj.reason,
            evidence: aj.evidence,
          };
        });
      } else {
        process.stderr.write(
          '[JUDGE] [WARN] Agent judge unavailable — using deterministic verdicts only.\n'
        );
      }
    }

    const jsonReporter = new JsonReporter(outputDir);
    const { summary, reports } = jsonReporter.generateReports(
      results,
      judgments,
      startTime,
      suiteName
    );

    jsonReporter.writeReports(summary, reports);

    if (config.outputFormat === 'console') {
      const consoleReporter = new ConsoleReporter();
      consoleReporter.report(summary, reports);
    } else if (config.outputFormat === 'json') {
      jsonReporter.outputSummary(summary, reports);
    }

    process.exit(summary.failed > 0 ? 1 : 0);
  });

program
  .command('list')
  .description('List available test cases')
  .option('-s, --suite <suite>', 'Filter by suite')
  .action(async (options) => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const testcasesDir = path.join(here, '..', 'testcases');

    const loader = new TestLoader(testcasesDir);
    let testCases = await loader.loadAll();

    if (options.suite) {
      testCases = testCases.filter((tc) => tc.suite === options.suite);
    }

    testCases = loader.sortByDependencies(testCases);
    const groups = loader.groupBySuite(testCases);

    console.log('\nAvailable Test Cases:');
    console.log('='.repeat(60));

    for (const [suite, cases] of groups) {
      console.log(`\n${suite.toUpperCase()} SUITE (${cases.length} tests):`);
      for (const tc of cases) {
        console.log(`  ${tc.id}: ${tc.name}`);
        console.log(`    Priority: ${tc.priority}, Timeout: ${tc.timeout}ms`);
        if (tc.dependencies.length > 0) {
          console.log(`    Depends on: ${tc.dependencies.join(', ')}`);
        }
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log(`Total: ${testCases.length} test(s)`);
  });

program.parse();
