/**
 * Audit that each test-doc case is bound to an executable (ported from upstream,
 * adapted to THIS repo).
 *
 * Binding is *audit, not codegen*: the markdown owns intent, the cicd YAML owns
 * execution. A case is **bound** when its `**Script:**` path resolves to a file.
 *
 * Adaptation: our docs are outcome-oriented (a case's Action/Expected rows are NOT
 * 1:1 with the YAML's steps), so — unlike upstream — we do NOT compare step counts;
 * that would flag every outcome-doc unbound. A case whose title carries `(to-be)`
 * is intentionally not-yet-bound and reported as `to-be`, not a failure.
 *
 * Exits non-zero if any case is genuinely unbound, so CI and the drift gate gate on it.
 * Run: npm run audit-bind
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readScenario, scenarioFiles } from './testdoc.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'); // cicd/tests/src → repo root
const TESTS_DIR = join(REPO_ROOT, 'docs', 'tests');

export type BindState = 'bound' | 'to-be' | 'manual' | 'unbound';

export interface BindFinding {
  doc: string;
  tc: string;
  state: BindState;
  detail: string;
}

/** Audit every case in every docs/tests/ scenario; one finding per case. */
export function auditBindings(): BindFinding[] {
  const findings: BindFinding[] = [];
  for (const f of scenarioFiles(TESTS_DIR)) {
    const { frontMatter, cases } = readScenario(join(TESTS_DIR, f));
    // A doc verified by hand (no cicd script by design) opts out with `binding: manual`.
    if (frontMatter.binding === 'manual') {
      for (const c of cases) findings.push({ doc: f, tc: c.tc, state: 'manual', detail: 'binding: manual — verified by hand' });
      continue;
    }
    for (const c of cases) {
      if (!c.script) {
        findings.push(
          c.toBe
            ? { doc: f, tc: c.tc, state: 'to-be', detail: '(to-be) — no binding yet, by design' }
            : { doc: f, tc: c.tc, state: 'unbound', detail: 'no Script: binding' }
        );
        continue;
      }
      const scriptPath = join(REPO_ROOT, c.script);
      findings.push(
        existsSync(scriptPath)
          ? { doc: f, tc: c.tc, state: 'bound', detail: `↔ ${c.script}` }
          : { doc: f, tc: c.tc, state: 'unbound', detail: `script not found: ${c.script}` }
      );
    }
  }
  return findings;
}

// Run as a script: print findings, exit non-zero if anything is genuinely unbound.
if (import.meta.url === `file://${process.argv[1]}`) {
  const findings = auditBindings();
  const tags: Record<BindState, string> = { bound: 'bound  ', 'to-be': 'to-be  ', manual: 'manual ', unbound: 'UNBOUND' };
  for (const f of findings) console.log(`${tags[f.state]}  ${f.doc} ${f.tc} — ${f.detail}`);
  const n = (s: BindState) => findings.filter((f) => f.state === s).length;
  console.log(`\n${findings.length} case(s): ${n('bound')} bound, ${n('to-be')} to-be, ${n('manual')} manual, ${n('unbound')} unbound`);
  process.exit(n('unbound') > 0 ? 1 : 0);
}
