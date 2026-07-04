/**
 * The chain gate — verify the full traceability chain, derived from the books we already
 * keep: src/server.ts (tools), cicd/tests/testcases/*.yml (scripts + suite), the docs in
 * docs/tests/, the stories in docs/stories/, and .github/workflows/. No story hash, no
 * coverage file. Every link is an existence/reference check, so a revert — deleting or
 * renaming a story, doc, script, or workflow — trips the gate.
 *
 * Five signals:
 *   UNCOVERED — a tool registered in src/server.ts is run by no YAML case (tool → script).
 *   NO-STORY  — a test doc's `story:` is missing or its story file doesn't exist (doc → story).
 *   UNBOUND   — a case has no resolving `**Script:**` and isn't `(to-be)` (doc → script; audit-bind).
 *   NO-WF     — a suite used by a YAML has no .github/workflows/test-<suite>.yml (script → workflow).
 *   ORPHAN    — a YAML case is bound by no test doc (script → doc).
 * Exits non-zero on any gap, so a broken or incomplete chain is visible.
 *
 * Story *meaning* drift — does a doc still cover its story's Success-Looks-Like? — is a human
 * read in qw-drift, not an automated hash (which only ever cried wolf on Status-section churn).
 *
 * Run: npm run drift
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { readScenario, scenarioFiles } from './testdoc.js';
import { auditBindings } from './audit-bind.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'); // cicd/tests/src → repo root
const TESTS_DIR = join(REPO_ROOT, 'docs', 'tests');
const CASES_DIR = join(REPO_ROOT, 'cicd', 'tests', 'testcases');
const WORKFLOWS_DIR = join(REPO_ROOT, '.github', 'workflows');
const SERVER_TS = join(REPO_ROOT, 'src', 'server.ts');

/** Recursively list files with `ext` under `dir`. */
function walk(dir: string, ext: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, ext));
    else if (e.name.endsWith(ext)) out.push(p);
  }
  return out;
}

interface Gap {
  kind: 'UNCOVERED' | 'NO-STORY' | 'UNBOUND' | 'NO-WF' | 'ORPHAN';
  detail: string;
}
const gaps: Gap[] = [];

// --- read the books once ---
const yamlFiles = walk(CASES_DIR, '.yml');
const yamlText = new Map(yamlFiles.map((y) => [y, readFileSync(y, 'utf8')]));
const docs = scenarioFiles(TESTS_DIR);

// ① tool → script: every mcpServer.tool('X') in server.ts is exercised by some YAML case.
// Whole-word match against the YAML text so fixture-driven cases (e.g. the proxy suite's
// .mjs harnesses) count too; \b keeps it precise (`wifi_connect` ≠ `wifi_connect_enterprise`).
const tools = [...readFileSync(SERVER_TS, 'utf8').matchAll(/mcpServer\.tool\(\s*['"]([a-z_]+)['"]/g)].map((m) => m[1]);
for (const t of tools) {
  const re = new RegExp(`\\b${t}\\b`);
  if (![...yamlText.values()].some((txt) => re.test(txt))) {
    gaps.push({ kind: 'UNCOVERED', detail: `tool '${t}' — no YAML case exercises it` });
  }
}

// ② doc → story: `story:` present and the story file exists (the hash-free link that remains).
for (const f of docs) {
  const { frontMatter: fm } = readScenario(join(TESTS_DIR, f));
  if (!fm.story) {
    gaps.push({ kind: 'NO-STORY', detail: `${f} — no story: link` });
  } else if (!existsSync(join(REPO_ROOT, 'docs', 'stories', `${fm.story}.md`))) {
    gaps.push({ kind: 'NO-STORY', detail: `${f} — story file missing: docs/stories/${fm.story}.md` });
  }
}

// ③ doc → script: a case's `**Script:**` must resolve (audit-bind owns this).
for (const b of auditBindings().filter((b) => b.state === 'unbound')) {
  gaps.push({ kind: 'UNBOUND', detail: `${b.doc} ${b.tc} — ${b.detail}` });
}

// ④ suite → workflow: every suite a YAML declares has a test-<suite>.yml.
const suites = new Set<string>();
for (const txt of yamlText.values()) {
  const m = txt.match(/^suite:\s*(\S+)/m);
  if (m) suites.add(m[1]);
}
for (const s of [...suites].sort()) {
  if (!existsSync(join(WORKFLOWS_DIR, `test-${s}.yml`))) {
    gaps.push({ kind: 'NO-WF', detail: `suite '${s}' — no .github/workflows/test-${s}.yml` });
  }
}

// ⑤ orphan script: every YAML case is bound by some doc's `**Script:**`.
const boundScripts = new Set<string>();
for (const f of docs) {
  for (const c of readScenario(join(TESTS_DIR, f)).cases) {
    if (c.script) boundScripts.add(join(REPO_ROOT, c.script));
  }
}
for (const y of yamlFiles) {
  if (!boundScripts.has(y)) gaps.push({ kind: 'ORPHAN', detail: `${relative(REPO_ROOT, y)} — bound by no test doc` });
}

// --- report, grouped by kind ---
const order: Gap['kind'][] = ['UNCOVERED', 'NO-STORY', 'UNBOUND', 'NO-WF', 'ORPHAN'];
for (const kind of order) {
  for (const g of gaps.filter((g) => g.kind === kind)) console.log(`${g.kind.padEnd(9)} ${g.detail}`);
}
const count = (k: Gap['kind']) => gaps.filter((g) => g.kind === k).length;
console.log(
  `\n${tools.length} tool(s) · ${yamlFiles.length} script(s) · ${docs.length} doc(s) → ` +
    `${gaps.length} gap(s): ${count('UNCOVERED')} uncovered, ${count('NO-STORY')} no-story, ` +
    `${count('UNBOUND')} unbound, ${count('NO-WF')} no-workflow, ${count('ORPHAN')} orphan`
);
if (gaps.length === 0) console.log('chain intact — every tool → doc → script → workflow resolves.');
process.exit(gaps.length > 0 ? 1 : 0);
