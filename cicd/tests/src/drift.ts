/**
 * The freshness gate — surface test docs that no longer match their story
 * (ported from upstream, adapted to THIS repo).
 *
 * Two deterministic signals, per doc:
 *   - STALE   — the linked story's sha256 no longer matches the doc's `story_hash`
 *               (the story moved since the test was synced).
 *   - UNBOUND — a case has no resolving `**Script:**` and is not `(to-be)`
 *               (reuses audit-bind.ts). `(to-be)` cases are expected and ignored.
 * Exits non-zero if anything is stale or unbound, so CI fails on drift.
 *
 * Run: npm run drift
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readScenario, scenarioFiles } from './testdoc.js';
import { auditBindings } from './audit-bind.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'); // cicd/tests/src → repo root
const TESTS_DIR = join(REPO_ROOT, 'docs', 'tests');

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

interface Stale {
  doc: string;
  detail: string;
}

/** Flag every scenario whose linked story has moved since last sync. */
function staleDocs(): Stale[] {
  const stale: Stale[] = [];
  for (const f of scenarioFiles(TESTS_DIR)) {
    const { frontMatter: fm } = readScenario(join(TESTS_DIR, f));
    const story = fm.story;
    if (!story) {
      stale.push({ doc: f, detail: 'no story: link' });
      continue;
    }
    const storyFile = join(REPO_ROOT, 'docs', 'stories', `${story}.md`);
    if (!existsSync(storyFile)) {
      stale.push({ doc: f, detail: `story file missing: docs/stories/${story}.md` });
      continue;
    }
    if (fm.story_hash !== sha256(storyFile)) {
      stale.push({ doc: f, detail: `${story} changed since sync (re-check, then update story_hash)` });
    }
  }
  return stale;
}

const docCount = scenarioFiles(TESTS_DIR).length;
const stale = staleDocs();
const unbound = auditBindings().filter((b) => b.state === 'unbound');

for (const s of stale) console.log(`STALE    ${s.doc} — ${s.detail}`);
for (const u of unbound) console.log(`UNBOUND  ${u.doc} ${u.tc} — ${u.detail}`);

if (docCount === 0) console.log('WARNING: no test docs in docs/tests/ — the drift gate checked nothing.');

const problems = stale.length + unbound.length;
console.log(`\n${docCount} doc(s): ${stale.length} stale, ${unbound.length} unbound`);
if (problems === 0) console.log('drift check clean — tests still match their stories.');
process.exit(problems > 0 ? 1 : 0);
