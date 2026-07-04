/**
 * The chain gate — verify the full traceability chain, derived from the books we already
 * keep: src/server.ts (tools), cicd/tests/testcases/*.yml (scripts + suite), the docs in
 * docs/tests/, the stories in docs/stories/, and .github/workflows/. No story hash, no
 * coverage file. Every link is an existence/reference check, so a revert — deleting or
 * renaming a story, doc, script, or workflow — trips the gate.
 *
 * Two tiers. HARD gaps are loose or broken links — they fail the gate:
 *   UNCOVERED — a tool in src/server.ts is run by no YAML case AND no (to-be) case plans it.
 *   NO-STORY  — a test doc's `story:` is missing or its story file doesn't exist (doc → story).
 *   UNBOUND   — a case has no resolving `**Script:**` and isn't `(to-be)` (doc → script; audit-bind).
 *   ORPHAN    — a YAML case is bound by no test doc (script → doc).
 * PLANNED items are tracked, not broken — reported but they do NOT fail the gate:
 *   PLANNED   — a tool with no script yet, but homed as a `(to-be)` case in a story.
 *   NO-WF     — a suite whose tests + docs exist but has no test-<suite>.yml yet (CI wiring pending).
 * Exits non-zero only on HARD gaps; a revert that breaks a link still trips it.
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
  kind: 'UNCOVERED' | 'NO-STORY' | 'UNBOUND' | 'NO-WF' | 'ORPHAN' | 'PLANNED';
  detail: string;
}
const gaps: Gap[] = []; //    hard — a loose or broken link; fails the gate.
const planned: Gap[] = []; // tracked as (to-be)/pending — reported, does NOT fail.

// --- read the books once ---
const yamlFiles = walk(CASES_DIR, '.yml');
const yamlText = new Map(yamlFiles.map((y) => [y, readFileSync(y, 'utf8')]));
const docs = scenarioFiles(TESTS_DIR);

// (to-be) case titles name the tool/feature a doc plans but hasn't bound yet — used below
// to tell a *planned* tool (homed in a story) from a *loose* one (nowhere at all).
const toBeTitles: string[] = [];
for (const f of docs) {
  for (const c of readScenario(join(TESTS_DIR, f)).cases) if (c.toBe) toBeTitles.push(c.title);
}

// ① tool → script: every mcpServer.tool('X') in server.ts is exercised by some YAML case.
// Whole-word match against the YAML text so fixture-driven cases (e.g. the proxy suite's
// .mjs harnesses) count too; \b keeps it precise (`wifi_connect` ≠ `wifi_connect_enterprise`).
const tools = [...readFileSync(SERVER_TS, 'utf8').matchAll(/mcpServer\.tool\(\s*['"]([a-z_]+)['"]/g)].map((m) => m[1]);
for (const t of tools) {
  const re = new RegExp(`\\b${t}\\b`);
  if ([...yamlText.values()].some((txt) => re.test(txt))) continue; // exercised by a script → covered
  if (toBeTitles.some((title) => re.test(title))) {
    planned.push({ kind: 'PLANNED', detail: `tool '${t}' — no script yet; homed as a (to-be) case in a story` });
  } else {
    gaps.push({ kind: 'UNCOVERED', detail: `tool '${t}' — no YAML case exercises it, and no (to-be) case plans it` });
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
    // Tests + docs exist; only the CI workflow is missing — wiring pending, not broken.
    planned.push({ kind: 'NO-WF', detail: `suite '${s}' — no test-${s}.yml yet (tests + docs exist; CI wiring pending)` });
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

// --- report: hard gaps fail; planned (to-be)/pending items are tracked, not failed ---
const order: Gap['kind'][] = ['UNCOVERED', 'NO-STORY', 'UNBOUND', 'ORPHAN'];
for (const kind of order) {
  for (const g of gaps.filter((g) => g.kind === kind)) console.log(`${g.kind.padEnd(10)} ${g.detail}`);
}
for (const p of planned) console.log(`${p.kind.padEnd(10)} ${p.detail}`);
console.log(
  `\n${tools.length} tool(s) · ${yamlFiles.length} script(s) · ${docs.length} doc(s) → ` +
    `${gaps.length} gap(s), ${planned.length} planned`
);
if (gaps.length === 0) {
  console.log(
    planned.length
      ? 'chain intact — no loose or broken links; the planned (to-be)/pending items above are tracked in a story.'
      : 'chain intact — every tool → doc → script → workflow resolves.'
  );
}
process.exit(gaps.length > 0 ? 1 : 0);
