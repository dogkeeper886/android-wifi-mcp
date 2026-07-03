/**
 * Test case loader - reads YAML test definitions and provides
 * filtering, sorting, and grouping capabilities.
 */

import { readFileSync } from 'fs';
import { glob } from 'glob';
import yaml from 'js-yaml';
import path from 'path';
import { TestCase, TestStep, TestRequires } from './types.js';
import { SUITES, CONFIG } from './config.js';

/** Normalize a testcase's `judge` field. 'agent' opts into the agent judge; 'simple'
 *  or absent means deterministic-only. An unrecognized value is a likely typo that
 *  would silently downgrade verification — warn rather than swallow it. */
function normalizeJudge(raw: unknown): 'agent' | undefined {
  if (raw === undefined || raw === 'simple') return undefined;
  if (raw === 'agent') return 'agent';
  console.error(`[loader] Ignoring unrecognized judge value ${JSON.stringify(raw)} — expected 'simple' or 'agent'; running deterministic-only`);
  return undefined;
}

export class TestLoader {
  private testcasesDir: string;

  constructor(testcasesDir: string) {
    this.testcasesDir = testcasesDir;
  }

  async loadAll(): Promise<TestCase[]> {
    const pattern = path.join(this.testcasesDir, '**/*.yml');
    const files = await glob(pattern);

    const testCases: TestCase[] = [];

    for (const file of files) {
      try {
        const content = readFileSync(file, 'utf-8');
        const raw = yaml.load(content) as Record<string, unknown>;
        const testCase = this.validateAndNormalize(raw, file);
        if (testCase) {
          testCases.push(testCase);
        }
      } catch (error) {
        console.error(`Failed to load ${file}:`, error);
      }
    }

    return testCases;
  }

  async loadBySuite(suite: string): Promise<TestCase[]> {
    const all = await this.loadAll();
    return all.filter((tc) => tc.suite === suite);
  }

  async loadById(id: string): Promise<TestCase | undefined> {
    const all = await this.loadAll();
    return all.find((tc) => tc.id === id);
  }

  sortByDependencies(testCases: TestCase[]): TestCase[] {
    const sorted: TestCase[] = [];
    const visited = new Set<string>();
    const idMap = new Map(testCases.map((tc) => [tc.id, tc]));

    const visit = (tc: TestCase) => {
      if (visited.has(tc.id)) return;
      visited.add(tc.id);

      for (const depId of tc.dependencies) {
        const dep = idMap.get(depId);
        if (dep) visit(dep);
      }

      sorted.push(tc);
    };

    const byPriority = [...testCases].sort((a, b) => a.priority - b.priority);
    for (const tc of byPriority) {
      visit(tc);
    }

    return sorted;
  }

  resolveDependencies(
    filteredTests: TestCase[],
    allTests: TestCase[]
  ): { tests: TestCase[]; autoIncluded: string[] } {
    const filteredIds = new Set(filteredTests.map((tc) => tc.id));
    const allTestsMap = new Map(allTests.map((tc) => [tc.id, tc]));
    const result = new Map<string, TestCase>();
    const autoIncluded: string[] = [];

    const collectWithDeps = (testId: string) => {
      if (result.has(testId)) return;

      const test = allTestsMap.get(testId);
      if (!test) {
        process.stderr.write(`[WARN] Dependency ${testId} not found\n`);
        return;
      }

      for (const depId of test.dependencies) {
        collectWithDeps(depId);
      }

      result.set(testId, test);

      if (!filteredIds.has(testId)) {
        autoIncluded.push(testId);
      }
    };

    for (const test of filteredTests) {
      collectWithDeps(test.id);
    }

    return { tests: Array.from(result.values()), autoIncluded };
  }

  groupBySuite(testCases: TestCase[]): Map<string, TestCase[]> {
    const groups = new Map<string, TestCase[]>();

    for (const suite of SUITES) {
      groups.set(suite, []);
    }

    for (const tc of testCases) {
      const suite = tc.suite;
      if (!groups.has(suite)) {
        groups.set(suite, []);
      }
      groups.get(suite)!.push(tc);
    }

    for (const [suite, cases] of groups) {
      if (cases.length === 0) {
        groups.delete(suite);
      }
    }

    return groups;
  }

  private validateAndNormalize(
    raw: Record<string, unknown>,
    filePath: string
  ): TestCase | null {
    if (!raw.id || typeof raw.id !== 'string') {
      console.error(`${filePath}: missing or invalid 'id' field`);
      return null;
    }
    if (!raw.name || typeof raw.name !== 'string') {
      console.error(`${filePath}: missing or invalid 'name' field`);
      return null;
    }
    if (!raw.suite || typeof raw.suite !== 'string') {
      console.error(`${filePath}: missing or invalid 'suite' field`);
      return null;
    }
    if (!raw.steps || !Array.isArray(raw.steps) || raw.steps.length === 0) {
      console.error(`${filePath}: missing or empty 'steps' array`);
      return null;
    }

    // `steps` (required, non-empty) plus optional `setup`/`teardown` phases — all
    // step-arrays, validated the same way so setup/teardown behave exactly like steps.
    const steps = this.normalizeSteps(raw.steps, filePath, 'steps');
    if (!steps) return null;

    let setup: TestStep[] | undefined;
    if (raw.setup !== undefined) {
      const parsed = this.normalizeSteps(raw.setup, filePath, 'setup');
      if (!parsed) return null;
      setup = parsed;
    }

    let teardown: TestStep[] | undefined;
    if (raw.teardown !== undefined) {
      const parsed = this.normalizeSteps(raw.teardown, filePath, 'teardown');
      if (!parsed) return null;
      teardown = parsed;
    }

    let requires: TestRequires | undefined;
    if (raw.requires !== undefined) {
      if (typeof raw.requires !== 'object' || raw.requires === null || Array.isArray(raw.requires)) {
        console.error(`${filePath}: 'requires' must be an object`);
        return null;
      }
      const r = raw.requires as Record<string, unknown>;
      requires = {
        ssidInRange: typeof r.ssidInRange === 'string' ? r.ssidInRange : undefined,
      };
    }

    return {
      id: raw.id as string,
      name: raw.name as string,
      suite: raw.suite as string,
      tags: Array.isArray(raw.tags) ? raw.tags : undefined,
      priority: typeof raw.priority === 'number' ? raw.priority : 1,
      timeout: typeof raw.timeout === 'number' ? raw.timeout : CONFIG.defaultTimeout,
      dependencies: Array.isArray(raw.dependencies) ? raw.dependencies : [],
      requires,
      setup,
      steps,
      teardown,
      criteria: typeof raw.criteria === 'string' ? raw.criteria : '',
      goal: typeof raw.goal === 'string' ? raw.goal : undefined,
      judge: normalizeJudge(raw.judge),
    };
  }

  /** Validate + normalize a step-array (used for `steps`, `setup`, and `teardown`).
   *  Returns null on the first invalid step so the caller can bail. `label` names the
   *  phase in error messages. */
  private normalizeSteps(
    raw: unknown,
    filePath: string,
    label: string
  ): TestStep[] | null {
    if (!Array.isArray(raw)) {
      console.error(`${filePath}: '${label}' must be an array`);
      return null;
    }
    const steps: TestStep[] = [];
    for (const step of raw as Array<Record<string, unknown>>) {
      if (!step.name || typeof step.name !== 'string') {
        console.error(`${filePath}: ${label} step missing 'name' field`);
        return null;
      }
      if (!step.command || typeof step.command !== 'string') {
        console.error(`${filePath}: ${label} step '${step.name}' missing 'command' field`);
        return null;
      }
      steps.push({
        name: step.name,
        command: step.command,
        timeout: typeof step.timeout === 'number' ? step.timeout : undefined,
        expectPatterns: Array.isArray(step.expectPatterns) ? (step.expectPatterns as string[]) : undefined,
        rejectPatterns: Array.isArray(step.rejectPatterns) ? (step.rejectPatterns as string[]) : undefined,
        capture: typeof step.capture === 'object' && step.capture !== null ? (step.capture as Record<string, string>) : undefined,
      });
    }
    return steps;
  }
}
